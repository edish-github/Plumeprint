"""Stage S10: coverage, or what the monitor was ever in a position to see.

"Unseen" is only an accusation if the monitor could have seen it. For each facility this
stage answers: what share of hours is the monitor downwind of you, and what share of the
pounds you reported were released while it was?

That turns a gap in the record into a statement about monitor siting, which is a fair
thing to say out loud and a useful thing for a community to ask about.

Output  data/interim/coverage.parquet   one row per (monitor, facility)
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import Config, load_config
from .geo import hour_score_arr
from .logging_setup import get
from .paths import interim

log = get("s10.coverage")

UPWIND_CUT = 0.5


def run(cfg: Config | None = None) -> dict:
    cfg = cfg or load_config()
    hourly = pd.read_parquet(interim("hourly"))
    events = pd.read_parquet(interim("events"))
    facilities = pd.read_parquet(interim("facilities"))
    geometry = pd.read_parquet(interim("facility_geometry"))
    if geometry.empty:
        raise SystemExit("run S5 first: data/interim/facility_geometry.parquet is empty")

    fac = facilities.set_index("rn")
    rows = []

    for site in cfg.sites:
        monitor = site.primary
        mh = hourly[hourly.monitor_id == monitor.id].sort_values("t_utc").reset_index(drop=True)
        if mh.empty:
            continue
        wd = mh.wd_deg.to_numpy(dtype=float)
        ws = mh.ws_ms.to_numpy(dtype=float)
        src = mh.wind_source.to_numpy()
        t = mh.t_utc

        site_events = events[events.site_id == site.id]
        for rn, ev in site_events.groupby("rn"):
            geom = geometry[(geometry.monitor_id == monitor.id) & (geometry.rn == rn)]
            if geom.empty or rn not in fac.index:
                continue
            g = geom.iloc[0]
            scores = hour_score_arr(wd, ws, float(g.bearing_deg), float(g.alpha_deg), src, cfg.wind)
            usable = np.isfinite(scores)
            upwind = usable & (scores >= UPWIND_CUT)
            upwind_share = float(upwind.mean()) if usable.any() else float("nan")

            # Spread each report's mass evenly across its hours, then ask how much of it
            # was released while the monitor was downwind of that facility.
            lb_total = float(ev.pollutant_lb.sum())
            lb_upwind = 0.0
            for r in ev.itertuples():
                if not np.isfinite(r.duration_h) or r.duration_h <= 0 or r.pollutant_lb <= 0:
                    continue
                window = (t >= r.start_utc) & (t < r.end_utc)
                n = int(window.sum())
                if n == 0:
                    continue
                lb_upwind += float(r.pollutant_lb) * float(upwind[window.to_numpy()].mean())

            rows.append({
                "monitor_id": monitor.id, "site_id": site.id, "rn": rn,
                "facility": fac.loc[rn, "name"],
                "distance_m": float(g.distance_m), "bearing_deg": float(g.bearing_deg),
                "alpha_deg": float(g.alpha_deg),
                "coord_source": fac.loc[rn, "coord_source"],
                "footprint_source": fac.loc[rn, "footprint_source"],
                "n_reports": int(len(ev)),
                "upwind_share_hours": round(upwind_share, 4),
                "usable_hours": int(usable.sum()),
                "pollutant_lb_total": round(lb_total, 2),
                "pollutant_lb_while_upwind": round(lb_upwind, 2),
                "visible_mass_share": round(lb_upwind / lb_total, 4) if lb_total > 0 else None,
            })

    coverage = pd.DataFrame(rows).sort_values("pollutant_lb_total", ascending=False)
    coverage.to_parquet(interim("coverage"), index=False)

    log.info("wrote %d monitor-facility coverage rows", len(coverage))
    for r in coverage.head(8).itertuples():
        log.info("   %-44s %9.0f lb  %4.1f km  upwind %4.1f%% of hours  %4.1f%% of mass",
                 str(r.facility)[:44], r.pollutant_lb_total, r.distance_m / 1000,
                 100 * (r.upwind_share_hours or 0), 100 * (r.visible_mass_share or 0))
    return {"coverage": interim("coverage")}


def acceptance() -> list[tuple[str, bool, str]]:
    c = pd.read_parquet(interim("coverage"))
    shares = c.upwind_share_hours.dropna()
    mass = c.visible_mass_share.dropna()
    over = c[c.pollutant_lb_while_upwind > c.pollutant_lb_total + 0.01]
    return [
        ("coverage rows exist", len(c) > 0, f"{len(c)} rows"),
        ("upwind shares are proportions", bool(((shares >= 0) & (shares <= 1)).all()),
         f"range {shares.min():.3f}-{shares.max():.3f}"),
        ("visible mass never exceeds reported mass", len(over) == 0, f"{len(over)} violations"),
        ("mass shares are proportions", bool(((mass >= 0) & (mass <= 1)).all()),
         f"range {mass.min():.3f}-{mass.max():.3f}"),
    ]


if __name__ == "__main__":
    from .logging_setup import setup

    setup()
    run()
    for name, ok, detail in acceptance():
        print(("PASS  " if ok else "FAIL  ") + name + "   " + detail)
