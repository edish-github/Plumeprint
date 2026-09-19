"""Stage S11: the static data contract.

Everything the web app ever reads is written here. No page calls EPA, TCEQ or Open-Meteo
at runtime, so the live site cannot fail because a government server is slow, and the demo
does not depend on anyone else's uptime.

Layout under web/public/data:
  meta.json                              build stamp, sources, licences, parameters
  sites.json                             sites, monitors, facilities, headline numbers
  series/{site}/{monitor}/{year}.json    columnar hourly arrays, loaded on demand
  events/{site}.json                     self-reported events with visibility status
  episodes/{site}.json                   episodes with verdicts and candidate matches
  fingerprint/{site}.json                CPF bins with intervals, all years and per year
  coverage/{site}.json                   upwind share and visible mass per facility
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from . import __version__
from .config import Config, load_config
from .logging_setup import get
from .paths import WEB_DATA, interim
from .timeutil import iso_z

log = get("s11.export")

SOURCES = [
    {"name": "EPA AQS pre-generated hourly data files",
     "url": "https://aqs.epa.gov/aqsweb/airdata/download_files.html",
     "licence": "US public domain", "used_for": "hourly SO2 and on-site wind"},
    {"name": "TCEQ Air Emission Event Reports",
     "url": "https://www2.tceq.texas.gov/oce/eer/index.cfm",
     "licence": "Texas public records", "used_for": "self-reported emission events"},
    {"name": "Open-Meteo historical weather API",
     "url": "https://open-meteo.com/en/docs/historical-weather-api",
     "licence": "CC BY 4.0", "used_for": "modelled hourly wind where no on-site wind exists"},
    {"name": "EPA FRS and ECHO",
     "url": "https://echo.epa.gov/", "licence": "US public domain",
     "used_for": "facility coordinates, joined on the TCEQ RN number"},
    {"name": "OpenStreetMap via Overpass",
     "url": "https://www.openstreetmap.org/copyright", "licence": "ODbL",
     "used_for": "industrial footprint polygons where available"},
]


def _clean(obj):
    """NaN and NaT are not JSON; they become null so the client sees a real absence."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return None if np.isnan(obj) else round(float(obj), 6)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, pd.Timestamp):
        return iso_z(obj)
    if obj is pd.NaT:
        return None
    if isinstance(obj, float) and np.isnan(obj):
        return None
    return obj


def _write(path: Path, payload) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(_clean(payload), separators=(",", ":"), allow_nan=False)
    path.write_text(text, encoding="utf-8")
    return len(text)


def _headline(episodes: pd.DataFrame, visibility: pd.DataFrame, cfg: Config) -> dict:
    counts = episodes.verdict.value_counts().to_dict() if len(episodes) else {}
    assessed = visibility[visibility.status != "NO_DATA"] if len(visibility) else visibility
    unseen = int(assessed.status.str.startswith("UNSEEN").sum()) if len(assessed) else 0
    not_seen = int((assessed.status != "SEEN").sum()) if len(assessed) else 0
    return {
        "episodes_total": int(len(episodes)),
        "episodes_matched": int(counts.get("MATCHED", 0)),
        "episodes_weak": int(counts.get("WEAK_MATCH", 0)),
        "episodes_unexplained": int(counts.get("UNEXPLAINED", 0)),
        "episodes_regional": int(counts.get("REGIONAL", 0)),
        "reports_assessed": int(len(assessed)),
        "reports_seen": int((assessed.status == "SEEN").sum()) if len(assessed) else 0,
        "reports_faint": int((assessed.status == "FAINT").sum()) if len(assessed) else 0,
        "reports_unseen": unseen,
        "reports_not_seen": not_seen,
        "reports_no_data": int((visibility.status == "NO_DATA").sum()) if len(visibility) else 0,
        "pollutant_lb_assessed": round(float(assessed.pollutant_lb.sum()), 1) if len(assessed) else 0.0,
        "min_report_lb": cfg.visibility.min_lb,
    }


def run(cfg: Config | None = None, clean: bool = True) -> dict:
    cfg = cfg or load_config()
    hourly = pd.read_parquet(interim("hourly"))
    episodes = pd.read_parquet(interim("episodes"))
    matches = pd.read_parquet(interim("matches"))
    events = pd.read_parquet(interim("events"))
    visibility = pd.read_parquet(interim("visibility"))
    fingerprint = pd.read_parquet(interim("fingerprint"))
    coverage = pd.read_parquet(interim("coverage"))
    facilities = pd.read_parquet(interim("facilities"))
    geometry = pd.read_parquet(interim("facility_geometry"))
    monitors = pd.read_parquet(interim("monitors_aqs"))

    if clean and WEB_DATA.exists():
        shutil.rmtree(WEB_DATA)
    WEB_DATA.mkdir(parents=True, exist_ok=True)

    bytes_written = 0
    site_payloads = []

    for site in cfg.sites:
        monitor_ids = [m.id for m in site.monitors]
        site_events = events[events.site_id == site.id]
        site_vis = visibility[visibility.site_id == site.id]
        site_eps = episodes[episodes.monitor_id.isin(monitor_ids)]
        site_fp = fingerprint[fingerprint.monitor_id.isin(monitor_ids)]
        site_cov = coverage[coverage.site_id == site.id]
        site_rns = set(site_events.rn)
        site_fac = facilities[facilities.rn.isin(site_rns) & facilities.placed]

        # ---- hourly series, one file per monitor-year ----
        # An AQS year file runs on local standard time, so its last hours land in the next
        # UTC year. Those few hours are real data but they are not a year of coverage, and
        # listing them makes the site claim a span it does not have.
        MIN_HOURS_FOR_A_YEAR = 24 * 14
        year_counts = (hourly[hourly.monitor_id.isin(monitor_ids)]
                       .groupby(hourly.t_utc.dt.year).size())
        years = sorted(int(y) for y, n in year_counts.items() if n >= MIN_HOURS_FOR_A_YEAR)
        for mid in monitor_ids:
            for year in years:
                g = hourly[(hourly.monitor_id == mid) & (hourly.t_utc.dt.year == year)]
                if g.empty:
                    continue
                g = g.sort_values("t_utc")
                payload = {
                    "monitor_id": mid, "year": int(year),
                    "t0": iso_z(g.t_utc.iloc[0]), "step_h": 1, "n": int(len(g)),
                    "so2": [None if pd.isna(v) else round(float(v), 1) for v in g.so2_ppb],
                    "wd": [None if pd.isna(v) else int(round(float(v))) for v in g.wd_deg],
                    "ws": [None if pd.isna(v) else round(float(v), 1) for v in g.ws_ms],
                    "src": "".join("a" if s == "aqs" else ("o" if s == "openmeteo" else "n")
                                   for s in g.wind_source),
                }
                bytes_written += _write(WEB_DATA / "series" / site.id / mid / f"{year}.json", payload)

        # ---- events ----
        vis_by_incident = {r.incident: r for r in site_vis.itertuples()}
        ev_out = []
        for e in site_events.itertuples():
            v = vis_by_incident.get(e.incident)
            ev_out.append({
                "incident": int(e.incident), "rn": e.rn, "facility": e.facility,
                "operator": e.operator, "event_type": e.event_type, "report_type": e.report_type,
                "start_utc": iso_z(e.start_utc), "end_utc": iso_z(e.end_utc),
                "notified_utc": iso_z(e.notified_utc), "duration_h": e.duration_h,
                "pollutant_lb": e.pollutant_lb, "n_emission_points": int(e.n_emission_points),
                "process_units": e.process_units, "cause": e.cause, "actions": e.actions,
                "basis": e.basis, "url": e.url,
                "visibility": None if v is None else {
                    "monitor_id": v.monitor_id, "status": v.status,
                    "peak_ppb_during": v.peak_ppb_during, "baseline_ppb": v.baseline_ppb,
                    "upwind_share": v.upwind_share, "data_share": v.data_share},
            })
        bytes_written += _write(WEB_DATA / "events" / f"{site.id}.json", ev_out)

        # ---- episodes, with their candidate reports ----
        cand = matches[matches.episode_id.isin(set(site_eps.episode_id))] if len(matches) else matches
        by_episode: dict[str, list] = {}
        for c in cand.itertuples():
            by_episode.setdefault(c.episode_id, []).append({
                "incident": int(c.incident), "rn": c.rn, "facility": c.facility,
                "confidence": c.confidence, "s_time": c.s_time, "s_spec": c.s_spec,
                "s_bearing": c.s_bearing, "pollutant_lb": c.pollutant_lb,
                "distance_m": c.distance_m, "bearing_deg": c.bearing_deg,
                "coord_source": c.coord_source, "is_best": bool(getattr(c, "is_best", False)),
            })
        ep_out = []
        for e in site_eps.itertuples():
            hours = hourly[(hourly.monitor_id == e.monitor_id) &
                           (hourly.t_utc >= e.start_utc) & (hourly.t_utc < e.end_utc)].sort_values("t_utc")
            ep_out.append({
                "id": e.episode_id, "monitor_id": e.monitor_id,
                "start_utc": iso_z(e.start_utc), "end_utc": iso_z(e.end_utc),
                "t_peak_utc": iso_z(e.t_peak_utc), "n_hours": int(e.n_hours),
                "peak_ppb": e.peak_ppb, "mean_ppb": e.mean_ppb, "baseline_ppb": e.baseline_ppb,
                "threshold_ppb": e.threshold_ppb, "wd_mean_deg": e.wd_mean_deg,
                "ws_mean_ms": e.ws_mean_ms, "wind_source": e.wind_source, "severe": bool(e.severe),
                "verdict": e.verdict, "verdict_reason": e.verdict_reason,
                "best_incident": None if pd.isna(e.best_incident) else int(e.best_incident),
                "best_confidence": e.best_confidence,
                "regional_checked": bool(e.regional_checked),
                "regional_monitors_high": int(e.regional_monitors_high or 0),
                "concurrent_non_pollutant": int(e.concurrent_non_pollutant or 0),
                "candidates": sorted(by_episode.get(e.episode_id, []),
                                     key=lambda c: -(c["confidence"] or 0))[:8],
                "hours": [{"t": iso_z(h.t_utc), "ppb": None if pd.isna(h.so2_ppb) else round(float(h.so2_ppb), 1),
                           "base": None if pd.isna(h.baseline_ppb) else round(float(h.baseline_ppb), 2),
                           "wd": None if pd.isna(h.wd_deg) else int(round(float(h.wd_deg))),
                           "ws": None if pd.isna(h.ws_ms) else round(float(h.ws_ms), 1)}
                          for h in hours.itertuples()],
            })
        bytes_written += _write(WEB_DATA / "episodes" / f"{site.id}.json", ep_out)

        # ---- fingerprint ----
        fp_out: dict[str, dict] = {}
        for mid, g in site_fp.groupby("monitor_id"):
            per_period = {}
            for year, gy in g.groupby("year"):
                gy = gy.sort_values("bin_deg")
                peak = gy[gy.is_peak]
                per_period[str(int(year))] = {
                    "bins": [{"deg": int(b.bin_deg), "cpf": b.cpf, "lo": b.ci_low, "hi": b.ci_high,
                              "n": int(b.n_hours), "lobe": bool(b.in_lobe)} for b in gy.itertuples()],
                    "peak_deg": None if peak.empty else int(peak.bin_deg.iloc[0]),
                    "threshold_ppb": float(gy.threshold_ppb.iloc[0]),
                    "measured_wind_share": float(gy.wind_source_share_aqs.iloc[0]),
                }
            fp_out[mid] = per_period
        bytes_written += _write(WEB_DATA / "fingerprint" / f"{site.id}.json", fp_out)

        # ---- coverage ----
        bytes_written += _write(WEB_DATA / "coverage" / f"{site.id}.json",
                                site_cov.to_dict("records"))

        # ---- site summary ----
        geom_site = geometry[geometry.monitor_id.isin(monitor_ids) & geometry.rn.isin(site_rns)]
        geom_idx = {(g.monitor_id, g.rn): g for g in geom_site.itertuples()}
        mon_out = []
        for m in site.monitors:
            row = monitors[monitors.monitor_id == m.id]
            if row.empty:
                continue
            r = row.iloc[0]
            eps_m = site_eps[site_eps.monitor_id == m.id]
            mon_out.append({
                "id": m.id, "role": m.role, "lat": float(r.lat), "lon": float(r.lon),
                "county_name": r.county_name, "n_hours": int(r.n_hours), "n_valid": int(r.n_valid),
                "has_onsite_wind": bool(r.has_onsite_wind),
                "threshold_ppb": None if eps_m.empty else float(eps_m.threshold_ppb.iloc[0]),
                "max_ppb": float(r.max_ppb),
            })
        fac_out = []
        for f in site_fac.itertuples():
            g = geom_idx.get((site.primary.id, f.rn))
            fac_out.append({
                "rn": f.rn, "name": f.name, "operator": f.operator, "address": f.address,
                "lat": f.lat, "lon": f.lon, "radius_m": f.radius_m,
                "coord_source": f.coord_source, "footprint_source": f.footprint_source,
                "echo_accuracy": f.echo_accuracy, "frs_registry_id": f.frs_registry_id,
                "n_reports": int(f.n_reports), "pollutant_lb_total": float(f.pollutant_lb_total),
                "distance_m": None if g is None else float(g.distance_m),
                "bearing_deg": None if g is None else float(g.bearing_deg),
                "alpha_deg": None if g is None else float(g.alpha_deg),
            })
        lats = [m["lat"] for m in mon_out] + [f["lat"] for f in fac_out if f["lat"]]
        lons = [m["lon"] for m in mon_out] + [f["lon"] for f in fac_out if f["lon"]]
        by_year = {}
        for year in years:
            e_y = site_eps[site_eps.start_utc.dt.year == year]
            inc_y = set(site_events[site_events.start_utc.dt.year == year].incident)
            v_y = site_vis[site_vis.incident.isin(inc_y)]
            by_year[str(int(year))] = _headline(e_y, v_y, cfg)

        site_payloads.append({
            "id": site.id, "name": site.name, "tz": site.tz,
            "counties": list(site.aeer_counties),
            "center": [round(float(np.mean(lons)), 5), round(float(np.mean(lats)), 5)] if lats else None,
            "years": [int(y) for y in years],
            "monitors": mon_out, "facilities": fac_out,
            "headline": {"all": _headline(site_eps, site_vis, cfg), "by_year": by_year},
        })

    bytes_written += _write(WEB_DATA / "sites.json", site_payloads)
    meta = {
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "pipeline_version": __version__,
        "pollutant": {"name": cfg.pollutant.name, "units": cfg.pollutant.units},
        "years": list(cfg.years),
        "parameters": {
            "episode": vars(cfg.episode), "match": vars(cfg.match),
            "visibility": vars(cfg.visibility), "wind": vars(cfg.wind),
            "fingerprint": {**vars(cfg.fingerprint), "ci": list(cfg.fingerprint.ci)},
            "regional": vars(cfg.regional),
        },
        "sources": SOURCES,
        "verdicts": {
            "MATCHED": "time, direction and pollutant all agree with a filed report",
            "WEAK_MATCH": "a report overlaps but the fit is partial or indirect",
            "UNEXPLAINED": "no filed report matches this episode",
            "REGIONAL": "other monitors were high at the same time, so the cause is not local",
        },
        "visibility_statuses": {
            "SEEN": "the monitor recorded an episode matching this report",
            "FAINT": "a bump above background, below the episode threshold",
            "UNSEEN_WIND_TOWARD": "no bump, though the monitor was downwind for part of it",
            "UNSEEN_WIND_AWAY": "no bump, and the wind was not blowing toward the monitor",
            "UNSEEN_UNKNOWN": "no bump, and the facility has no reliable coordinates",
            "NO_DATA": "the monitor was not reporting for enough of the window",
        },
        "caveat": ("No matching report does not mean an illegal release. Releases below the "
                   "reportable quantity, permitted emissions in poor dispersion, mobile "
                   "sources and sources outside the searched counties all look the same here."),
    }
    bytes_written += _write(WEB_DATA / "meta.json", meta)

    files = list(WEB_DATA.rglob("*.json"))
    log.info("wrote %d JSON files, %.1f MB, to %s", len(files), bytes_written / 1e6, WEB_DATA)
    for s in site_payloads:
        h = s["headline"]["all"]
        log.info("   %-24s %3d episodes (%d unexplained) | %3d reports assessed (%d not seen)",
                 s["name"], h["episodes_total"], h["episodes_unexplained"],
                 h["reports_assessed"], h["reports_not_seen"])
    return {"web_data": WEB_DATA, "files": len(files), "bytes": bytes_written}


def acceptance() -> list[tuple[str, bool, str]]:
    checks = []
    for name in ("meta.json", "sites.json"):
        checks.append((f"{name} exists", (WEB_DATA / name).exists(), str(WEB_DATA / name)))
    if (WEB_DATA / "sites.json").exists():
        sites = json.loads((WEB_DATA / "sites.json").read_text())
        checks.append(("every site has monitors and facilities",
                       all(s["monitors"] and s["facilities"] for s in sites),
                       f"{len(sites)} sites"))
        tc = next((s for s in sites if s["id"] == "texas-city"), None)
        if tc:
            h = tc["headline"]["by_year"].get("2023", {})
            checks.append(("texas-city 2023 headline is exported",
                           h.get("episodes_total") == 10 and h.get("episodes_unexplained") == 6,
                           f"{h.get('episodes_total')} episodes, "
                           f"{h.get('episodes_unexplained')} unexplained"))
    total = sum(f.stat().st_size for f in WEB_DATA.rglob("*.json"))
    checks.append(("payload stays under 15 MB", total < 15e6, f"{total / 1e6:.1f} MB"))
    bad = [f.name for f in WEB_DATA.rglob("*.json") if b"NaN" in f.read_bytes()[:2_000_000]]
    checks.append(("no NaN literals in the JSON", not bad, f"{len(bad)} files"))
    return checks


if __name__ == "__main__":
    from .logging_setup import setup

    setup()
    run()
    for name, ok, detail in acceptance():
        print(("PASS  " if ok else "FAIL  ") + name + "   " + detail)
