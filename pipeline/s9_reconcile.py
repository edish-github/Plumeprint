"""Stage S9: reconciliation, in both directions.

Direction one, episodes to reports: did anyone file paperwork for what the monitor saw?
Direction two, reports to the monitor: did the monitor see what was filed?

Verdicts come from explicit rules (spec 6.1), because a rule can be explained to a
resident and defended to a regulator. The confidence score only ranks candidate reports
and drives a meter in the UI; it never decides a verdict.

Two safeguards against over-claiming:
  - A facility whose centroid came from a street-address geocode cannot reach MATCHED on
    its bearing alone; address points are not plant centroids.
  - When no report overlaps, other monitors are checked first, so a regional haze day is
    labelled REGIONAL rather than accused of being unexplained.

Outputs  data/interim/matches.parquet     every scored episode-report pair
         data/interim/episodes.parquet    rewritten with verdicts
         data/interim/visibility.parquet  one row per (report, monitor)
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import Config, load_config
from .geo import hour_score_arr
from .logging_setup import get
from .paths import interim

log = get("s9.reconcile")

WEAK_COORD_SOURCES = {"nominatim_address"}   # good enough to rank, not to conclude


def _episode_hours(hourly: pd.DataFrame, monitor_id: str, start, end) -> pd.DataFrame:
    m = hourly[(hourly.monitor_id == monitor_id) & (hourly.t_utc >= start) & (hourly.t_utc < end)]
    return m.sort_values("t_utc")


def _score_pair(ep_hours: pd.DataFrame, report, geom_row, cfg: Config) -> dict:
    """Component scores for one episode-report pair (spec 6.1)."""
    mc = cfg.match
    lead = pd.Timedelta(hours=mc.lead_h)
    lag = pd.Timedelta(hours=mc.lag_h)
    inside = ((ep_hours.t_utc >= report.start_utc - lead) &
              (ep_hours.t_utc < report.end_utc + lag))
    s_time = float(inside.mean()) if len(ep_hours) else 0.0

    duration_h = max(1.0, float(report.duration_h) if pd.notna(report.duration_h) else 1.0)
    s_spec = float(np.clip(mc.spec_hours / duration_h, mc.spec_floor, 1.0))
    s_poll = 1.0 if float(report.pollutant_lb or 0) > 0 else 0.0

    if geom_row is None:
        s_bearing = float("nan")
    else:
        scores = hour_score_arr(
            ep_hours.wd_deg.to_numpy(dtype=float), ep_hours.ws_ms.to_numpy(dtype=float),
            float(geom_row.bearing_deg), float(geom_row.alpha_deg),
            ep_hours.wind_source.to_numpy(), cfg.wind)
        weights = np.maximum((ep_hours.so2_ppb - ep_hours.baseline_ppb).to_numpy(dtype=float), 0.1)
        ok = np.isfinite(scores) & np.isfinite(weights)
        s_bearing = float(np.average(scores[ok], weights=weights[ok])) if ok.any() else float("nan")

    bearing_term = 0.0 if np.isnan(s_bearing) else s_bearing
    confidence = s_poll * float(np.sqrt(max(s_time, 0.0) * s_spec)) * (0.4 + 0.6 * bearing_term)
    return {"s_time": round(s_time, 4), "s_spec": round(s_spec, 4), "s_poll": s_poll,
            "s_bearing": None if np.isnan(s_bearing) else round(s_bearing, 4),
            "confidence": round(confidence, 4), "duration_h": round(duration_h, 2)}


def _regional(hourly: pd.DataFrame, context_ids: list[str], start, end,
              thresholds: dict[str, float], cfg: Config) -> dict:
    """Were other monitors also high during this window?"""
    rc = cfg.regional
    detail, agreeing, with_data = [], 0, 0
    for cid in context_ids:
        g = hourly[(hourly.monitor_id == cid) & (hourly.t_utc >= start) & (hourly.t_utc < end)]
        vals = g.so2_ppb.dropna()
        if vals.empty:
            detail.append({"monitor_id": cid, "share_high": None})
            continue
        with_data += 1
        share = float((vals > thresholds.get(cid, np.inf)).mean())
        detail.append({"monitor_id": cid, "share_high": round(share, 3)})
        if share >= rc.min_share_hours:
            agreeing += 1
    is_regional = (with_data > 0 and agreeing / with_data >= rc.min_monitors_share)
    return {"checked": with_data > 0, "regional": is_regional,
            "monitors_with_data": with_data, "monitors_high": agreeing, "detail": detail}


def run(cfg: Config | None = None) -> dict:
    cfg = cfg or load_config()
    hourly = pd.read_parquet(interim("hourly"))
    episodes = pd.read_parquet(interim("episodes"))
    events = pd.read_parquet(interim("events"))
    facilities = pd.read_parquet(interim("facilities"))
    geometry = pd.read_parquet(interim("facility_geometry"))
    if episodes.empty or events.empty:
        raise SystemExit("run S4 and S7 first")

    mc = cfg.match
    lead, lag = pd.Timedelta(hours=mc.lead_h), pd.Timedelta(hours=mc.lag_h)
    long_report = pd.Timedelta(days=mc.long_report_days)

    fac_by_rn = facilities.set_index("rn").to_dict("index")
    geom_idx = {(r.monitor_id, r.rn): r for r in geometry.itertuples()}
    site_of_monitor = {m.id: s for s in cfg.sites for m in s.monitors}
    context_of_monitor = {m.id: list(s.context_monitors) for s in cfg.sites for m in s.monitors}

    # Per-monitor "unusually high" line for the regional check.
    thresholds = {mid: float(g.so2_ppb.quantile(cfg.regional.top_pct))
                  for mid, g in hourly.groupby("monitor_id") if g.so2_ppb.notna().any()}

    match_rows, verdicts, regional_rows = [], [], []
    for ep in episodes.itertuples():
        site = site_of_monitor.get(ep.monitor_id)
        ep_hours = _episode_hours(hourly, ep.monitor_id, ep.start_utc, ep.end_utc)

        pool = events if site is None else events[events.site_id == site.id]
        overlapping = pool[(pool.start_utc <= ep.end_utc + lag) &
                           (pool.end_utc >= ep.start_utc - lead)]
        with_pollutant = overlapping[overlapping.pollutant_lb > 0]

        scored = []
        for report in with_pollutant.itertuples():
            geom_row = geom_idx.get((ep.monitor_id, report.rn))
            fac = fac_by_rn.get(report.rn, {})
            s = _score_pair(ep_hours, report, geom_row, cfg)
            s.update(episode_id=ep.episode_id, incident=report.incident, rn=report.rn,
                     facility=report.facility, pollutant_lb=float(report.pollutant_lb),
                     coord_source=fac.get("coord_source", "none"),
                     distance_m=(None if geom_row is None else geom_row.distance_m),
                     bearing_deg=(None if geom_row is None else geom_row.bearing_deg))
            scored.append(s)

        best = max(scored, key=lambda s: s["confidence"]) if scored else None
        regional_info = None
        if best is None:
            ctx = context_of_monitor.get(ep.monitor_id, [])
            regional_info = _regional(hourly, ctx, ep.start_utc, ep.end_utc, thresholds, cfg)
            verdict = "REGIONAL" if regional_info["regional"] else "UNEXPLAINED"
            reason = ("other monitors were high at the same time" if regional_info["regional"]
                      else ("no report lists the pollutant" if len(overlapping)
                            else "no report overlaps this window"))
        else:
            weak_coords = best["coord_source"] in WEAK_COORD_SOURCES
            bearing_ok = best["s_bearing"] is not None and best["s_bearing"] >= mc.min_bearing
            long_window = (pd.Timedelta(hours=best["duration_h"]) > long_report)
            if best["s_time"] >= mc.min_time_share and bearing_ok and not long_window and not weak_coords:
                verdict, reason = "MATCHED", "time, direction and pollutant all agree"
            else:
                verdict = "WEAK_MATCH"
                if best["s_time"] < mc.min_time_share:
                    reason = "the report covers only part of the episode"
                elif not bearing_ok:
                    reason = "the facility was not consistently upwind"
                elif long_window:
                    reason = f"the report window is longer than {mc.long_report_days} days"
                else:
                    reason = "the facility's coordinates are too approximate to conclude"

        match_rows.extend(scored)
        if regional_info:
            for d in regional_info["detail"]:
                regional_rows.append({"episode_id": ep.episode_id, **d})
        verdicts.append({
            "episode_id": ep.episode_id, "verdict": verdict, "verdict_reason": reason,
            "best_incident": None if best is None else best["incident"],
            "best_rn": None if best is None else best["rn"],
            "best_confidence": None if best is None else best["confidence"],
            "best_s_time": None if best is None else best["s_time"],
            "best_s_bearing": None if best is None else best["s_bearing"],
            "n_candidates": len(scored),
            "concurrent_non_pollutant": len(overlapping) - len(with_pollutant),
            "regional_checked": bool(regional_info and regional_info["checked"]),
            "regional_monitors_high": (regional_info or {}).get("monitors_high", 0),
        })

    matches = pd.DataFrame(match_rows)
    if not matches.empty:
        best_ids = {(v["episode_id"], v["best_incident"]) for v in verdicts if v["best_incident"]}
        matches["is_best"] = [
            (r.episode_id, r.incident) in best_ids for r in matches.itertuples()
        ]
    episodes = episodes.merge(pd.DataFrame(verdicts), on="episode_id", how="left")

    # ---- direction two: what did the monitor see of each report? ----
    matched_incidents = {v["best_incident"] for v in verdicts if v["verdict"] == "MATCHED"}
    vc = cfg.visibility
    vis_rows = []
    for site in cfg.sites:
        monitor = site.primary
        big = events[(events.site_id == site.id) & (events.pollutant_lb >= vc.min_lb)]
        mh = hourly[hourly.monitor_id == monitor.id]
        for report in big.itertuples():
            window = mh[(mh.t_utc >= report.start_utc - pd.Timedelta(hours=1)) &
                        (mh.t_utc < report.end_utc + pd.Timedelta(hours=1))]
            data_share = float(window.so2_ppb.notna().mean()) if len(window) else 0.0
            peak = float(window.so2_ppb.max()) if window.so2_ppb.notna().any() else float("nan")
            base = float(window.baseline_ppb.median()) if len(window) else float("nan")
            geom_row = geom_idx.get((monitor.id, report.rn))
            upwind_share = float("nan")
            if geom_row is not None and len(window):
                scores = hour_score_arr(window.wd_deg.to_numpy(dtype=float),
                                        window.ws_ms.to_numpy(dtype=float),
                                        float(geom_row.bearing_deg), float(geom_row.alpha_deg),
                                        window.wind_source.to_numpy(), cfg.wind)
                ok = np.isfinite(scores)
                upwind_share = float((scores[ok] >= 0.5).mean()) if ok.any() else float("nan")

            if len(window) == 0 or data_share < vc.min_data_share:
                status = "NO_DATA"
            elif report.incident in matched_incidents:
                status = "SEEN"
            elif np.isfinite(peak) and np.isfinite(base) and (peak - base) >= vc.faint_delta_ppb:
                status = "FAINT"
            elif geom_row is None:
                status = "UNSEEN_UNKNOWN"
            elif np.isfinite(upwind_share) and upwind_share >= vc.upwind_share:
                status = "UNSEEN_WIND_TOWARD"
            else:
                status = "UNSEEN_WIND_AWAY"

            vis_rows.append({
                "incident": report.incident, "monitor_id": monitor.id, "site_id": site.id,
                "rn": report.rn, "facility": report.facility,
                "pollutant_lb": float(report.pollutant_lb), "status": status,
                "peak_ppb_during": None if not np.isfinite(peak) else round(peak, 2),
                "baseline_ppb": None if not np.isfinite(base) else round(base, 2),
                "data_share": round(data_share, 3),
                "upwind_share": None if not np.isfinite(upwind_share) else round(upwind_share, 3),
                "duration_h": round(float(report.duration_h or 0), 2),
            })
    visibility = pd.DataFrame(vis_rows)

    matches.to_parquet(interim("matches"), index=False)
    episodes.to_parquet(interim("episodes"), index=False)
    visibility.to_parquet(interim("visibility"), index=False)
    if regional_rows:
        pd.DataFrame(regional_rows).to_parquet(interim("regional_checks"), index=False)

    log.info("episode verdicts: %s", episodes.verdict.value_counts().to_dict())
    if not visibility.empty:
        log.info("report visibility: %s", visibility.status.value_counts().to_dict())
    for site in cfg.sites:
        e = episodes[episodes.monitor_id == site.primary.id]
        v = visibility[visibility.site_id == site.id]
        unexplained = int((e.verdict == "UNEXPLAINED").sum())
        unseen = int(v.status.str.startswith("UNSEEN").sum()) if len(v) else 0
        log.info("   %-22s %3d episodes (%d unexplained) | %3d large reports (%d unseen)",
                 site.name, len(e), unexplained, len(v), unseen)
    return {"matches": interim("matches"), "visibility": interim("visibility")}


def acceptance() -> list[tuple[str, bool, str]]:
    episodes = pd.read_parquet(interim("episodes"))
    visibility = pd.read_parquet(interim("visibility"))
    checks = [
        ("every episode carries a verdict",
         bool(episodes.verdict.notna().all()), f"{int(episodes.verdict.isna().sum())} missing"),
        ("verdict vocabulary is closed",
         set(episodes.verdict.dropna()) <= {"MATCHED", "WEAK_MATCH", "UNEXPLAINED", "REGIONAL"},
         str(sorted(set(episodes.verdict.dropna())))),
        ("the audit finds disagreement in both directions",
         int((episodes.verdict == "UNEXPLAINED").sum()) > 0 and
         int(visibility.status.str.startswith("UNSEEN").sum()) > 0,
         f"{int((episodes.verdict == 'UNEXPLAINED').sum())} unexplained, "
         f"{int(visibility.status.str.startswith('UNSEEN').sum())} unseen"),
    ]
    gb = visibility[visibility.incident == 403267]
    if len(gb):
        r = gb.iloc[0]
        checks.append(("the June 2023 shelter-in-place release is not SEEN",
                       r.status != "SEEN", f"{r.status}, peak {r.peak_ppb_during} ppb"))
    return checks


if __name__ == "__main__":
    from .logging_setup import setup

    setup()
    run()
    for name, ok, detail in acceptance():
        print(("PASS  " if ok else "FAIL  ") + name + "   " + detail)
