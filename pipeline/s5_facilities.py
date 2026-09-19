"""Stage S5: the facility registry.

Every facility that filed a report gets a centroid, a footprint radius, and an honest
label saying where each came from. Precedence:

  centroid   config/facilities.override.yaml  (hand-placed)   -> manual
             EPA ECHO / FRS, joined on the TCEQ RN number     -> echo_frs
             nothing                                          -> none, and the facility
                                                                 can never reach MATCHED

  footprint  override file                                    -> manual
             OpenStreetMap industrial polygon                 -> osm:contains_point|nearby
             class default from config                        -> default_by_class:<keyword>

Overpass is frequently overloaded, so the OSM lookup is best-effort and cached; re-running
S5 later upgrades any facility that has since resolved. A class default only widens the
angular span the bearing test allows, which is the forgiving direction.

Outputs  data/interim/facilities.parquet
         data/interim/facility_geometry.parquet   one row per (monitor, facility)
"""

from __future__ import annotations

import pandas as pd
import yaml

from .config import Config, load_config
from .frs import osm_footprint, resolve
from .geo import alpha_deg, bearing_deg, haversine_m
from .logging_setup import get
from .paths import CONFIG_DIR, interim

log = get("s5.facilities")

OVERRIDE_FILE = "facilities.override.yaml"


def load_overrides() -> dict[str, dict]:
    path = CONFIG_DIR / OVERRIDE_FILE
    if not path.exists():
        return {}
    rows = yaml.safe_load(path.read_text()) or []
    out: dict[str, dict] = {}
    for row in rows:
        rn = str(row.get("rn", "")).strip()
        lat, lon = row.get("lat"), row.get("lon")
        if not rn or not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            if rn:
                log.info("override for %s has no coordinates yet; falling back to ECHO", rn)
            continue
        out[rn] = {"lat": float(lat), "lon": float(lon), "radius_m": row.get("radius_m")}
    if out:
        log.info("loaded %d hand-placed facilities", len(out))
    return out


def run(cfg: Config | None = None, force: bool = False, skip_osm: bool = False) -> dict:
    cfg = cfg or load_config()
    events = pd.read_parquet(interim("events"))
    monitors = pd.read_parquet(interim("monitors_aqs"))
    if events.empty:
        raise SystemExit("run S4 first: data/interim/events.parquet is empty")

    reg = (events.groupby("rn")
           .agg(name=("facility", "first"), operator=("operator", "first"),
                address=("address", "first"), county=("county", "first"),
                site_id=("site_id", "first"), n_reports=("incident", "size"),
                pollutant_lb_total=("pollutant_lb", "sum"),
                first_utc=("start_utc", "min"), last_utc=("end_utc", "max"))
           .reset_index()
           .sort_values("pollutant_lb_total", ascending=False))

    overrides = load_overrides()
    resolved: list[dict] = []
    for i, f in enumerate(reg.itertuples(), 1):
        rec = {"rn": f.rn, "lat": None, "lon": None, "radius_m": None,
               "coord_source": "none", "footprint_source": "none",
               "frs_registry_id": None, "frs_name": None, "osm_id": None,
               "echo_accuracy": None}
        ov = overrides.get(f.rn)
        if ov:
            rec.update(lat=ov["lat"], lon=ov["lon"], coord_source="manual")
            if ov.get("radius_m"):
                rec.update(radius_m=float(ov["radius_m"]), footprint_source="manual")
        else:
            rec.update(resolve(f.rn, f.name, address=f.address, force=force))

        if rec["lat"] is not None and rec["radius_m"] is None and not skip_osm:
            fp = osm_footprint(rec["lat"], rec["lon"], cache_key=f.rn, force=force)
            if fp:
                rec.update(radius_m=fp["radius_m"], footprint_source=f"osm:{fp['fit']}",
                           osm_id=fp["osm_id"])
        # Sanity-check any address geocode against the site's monitor. A match on the
        # wrong continent is worse than no coordinates at all, because everything
        # downstream would treat it as real.
        if rec["coord_source"] == "nominatim_address" and rec["lat"] is not None:
            ref = monitors[monitors.monitor_id.isin(
                [m.id for s in cfg.sites if s.id == f.site_id for m in s.monitors])]
            if len(ref):
                km = min(haversine_m(r.lat, r.lon, rec["lat"], rec["lon"]) / 1000
                         for r in ref.itertuples())
                if km > cfg.geocode.max_km_from_monitor:
                    log.warning("rejecting geocode for %s (%s): %.0f km from the monitor",
                                f.rn, str(f.name)[:40], km)
                    rec.update(lat=None, lon=None, coord_source="none")

        if rec["radius_m"] is None:
            radius, source = cfg.footprint.radius_for(f.name)
            rec.update(radius_m=radius, footprint_source=source)

        resolved.append(rec)
        if i % 25 == 0:
            log.info("resolved %d/%d facilities", i, len(reg))

    reg = reg.merge(pd.DataFrame(resolved), on="rn", how="left")
    reg["placed"] = reg.lat.notna()

    pairs = []
    for m in monitors.itertuples():
        for f in reg[reg.placed].itertuples():
            dist = haversine_m(m.lat, m.lon, f.lat, f.lon)
            pairs.append({
                "monitor_id": m.monitor_id, "rn": f.rn,
                "distance_m": round(dist, 1),
                "bearing_deg": round(bearing_deg(m.lat, m.lon, f.lat, f.lon), 2),
                "alpha_deg": round(alpha_deg(f.radius_m or 0.0, dist), 2),
            })
    geom = pd.DataFrame(pairs)

    reg.to_parquet(interim("facilities"), index=False)
    geom.to_parquet(interim("facility_geometry"), index=False)

    reporters = reg[reg.pollutant_lb_total > 0]
    log.info("facilities=%d placed=%d | %s reporters=%d placed=%d",
             len(reg), int(reg.placed.sum()), cfg.pollutant.name,
             len(reporters), int(reporters.placed.sum()))
    log.info("coord sources: %s", reg.coord_source.value_counts().to_dict())
    log.info("footprint sources: %s",
             reg.footprint_source.str.split(":").str[0].value_counts().to_dict())
    for r in reporters.head(8).itertuples():
        log.info("   %-46s %9.0f lb  %s  r=%sm  %s", str(r.name)[:46], r.pollutant_lb_total,
                 r.coord_source, r.radius_m, r.footprint_source)
    for r in reporters[~reporters.placed].itertuples():
        log.warning("   UNPLACED %s %-40s %9.0f lb", r.rn, str(r.name)[:40], r.pollutant_lb_total)
    return {"facilities": interim("facilities"), "facility_geometry": interim("facility_geometry")}


def acceptance() -> list[tuple[str, bool, str]]:
    reg = pd.read_parquet(interim("facilities"))
    geom = pd.read_parquet(interim("facility_geometry"))
    reporters = reg[reg.pollutant_lb_total > 0]
    placed = int(reporters.placed.sum())
    # Mass-weighted, not count-weighted: a pipeline segment that reported three pounds and
    # has no public coordinates must not block a run, but an unplaced refinery must.
    total_lb = float(reporters.pollutant_lb_total.sum()) or 1.0
    placed_lb = float(reporters[reporters.placed].pollutant_lb_total.sum())
    share = placed_lb / total_lb
    gb = reg[reg.rn == "RN102535077"]
    checks = [
        ("placed facilities cover >= 99% of reported pollutant mass", share >= 0.99,
         f"{share:.3%} ({placed} of {len(reporters)} facilities)"),
        ("every facility has a footprint radius",
         bool(reg.radius_m.notna().all()), f"{int(reg.radius_m.isna().sum())} missing"),
        ("monitor-facility geometry is populated", len(geom) > 0, f"{len(geom)} pairs"),
    ]
    if len(gb):
        lat, lon = float(gb.lat.iloc[0]), float(gb.lon.iloc[0])
        checks.append(("Galveston Bay Refinery within 3 km of its filed address",
                       haversine_m(lat, lon, 29.3775, -94.9328) < 3000,
                       f"({lat:.4f}, {lon:.4f}) via {gb.coord_source.iloc[0]}"))
    return checks


if __name__ == "__main__":
    from .logging_setup import setup

    setup()
    run()
    for name, ok, detail in acceptance():
        print(("PASS  " if ok else "FAIL  ") + name + "   " + detail)
