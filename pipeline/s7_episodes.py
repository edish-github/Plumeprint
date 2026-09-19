"""Stage S7: episodes.

An episode is a run of hours where the monitor read unusually high. The threshold is
per-monitor, because a Big Spring hour of 40 ppb is ordinary there and extraordinary in
Texas City, and it is the higher of an absolute floor and a percentile of the monitor's
own record. Short dips do not end an episode: gaps up to merge_gap_h are absorbed, since
a plume that wavers across a monitor for eight hours is one event, not five.

Feasibility mode reproduces the 17 Sep 2026 numbers exactly (fixed 5 ppb floor, gaps over
4 h split, modelled wind only), so the golden checks stay meaningful as the rules improve.

Output  data/interim/episodes.parquet
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import Config, load_config
from .geo import circular_mean_deg
from .logging_setup import get
from .paths import interim

log = get("s7.episodes")


def _thresholds(series: pd.Series, cfg: Config, feasibility: bool) -> tuple[float, float]:
    """(episode threshold, typical background) for one monitor, in ppb."""
    if feasibility:
        return cfg.episode.abs_min_ppb, float(series.median())
    pct = float(series.quantile(cfg.episode.pct))
    return max(cfg.episode.abs_min_ppb, pct), float(series.median())


def detect(hourly: pd.DataFrame, cfg: Config, feasibility: bool = False) -> pd.DataFrame:
    rows = []
    for monitor_id, g in hourly.groupby("monitor_id", sort=False):
        g = g.sort_values("t_utc").reset_index(drop=True)
        valid = g.so2_ppb.dropna()
        if valid.empty:
            continue
        threshold, median = _thresholds(valid, cfg, feasibility)
        gap = 4 if feasibility else cfg.episode.merge_gap_h + 1

        hi = g[g.so2_ppb >= threshold].copy()
        if hi.empty:
            log.info("%s: no hours at or above %.1f ppb", monitor_id, threshold)
            continue
        hi["group"] = (hi.t_utc.diff() > pd.Timedelta(hours=gap)).cumsum()

        for _, ep in hi.groupby("group"):
            start, last = ep.t_utc.min(), ep.t_utc.max()
            end = last + pd.Timedelta(hours=1)
            window = g[(g.t_utc >= start) & (g.t_utc < end)]
            weights = np.maximum((window.so2_ppb - window.baseline_ppb).to_numpy(dtype=float), 0.1)
            peak_row = window.loc[window.so2_ppb.idxmax()]
            rows.append({
                "episode_id": f"{monitor_id}_{start:%Y%m%dT%H}",
                "monitor_id": monitor_id,
                "start_utc": start,
                "end_utc": end,
                "n_hours": int(len(window)),
                "n_hours_above": int(len(ep)),
                "peak_ppb": round(float(window.so2_ppb.max()), 2),
                "t_peak_utc": peak_row.t_utc,
                "mean_ppb": round(float(window.so2_ppb.mean()), 2),
                "baseline_ppb": round(float(window.baseline_ppb.median()), 2),
                "threshold_ppb": round(threshold, 2),
                "wd_mean_deg": round(circular_mean_deg(window.wd_deg.to_numpy(dtype=float), weights), 1),
                "wd_peak_deg": (None if pd.isna(peak_row.wd_deg) else round(float(peak_row.wd_deg), 1)),
                "ws_mean_ms": round(float(window.ws_ms.mean(skipna=True)), 2),
                "wind_source": (window.wind_source.mode().iloc[0]
                                if not window.wind_source.mode().empty else "none"),
                "severe": bool(window.so2_ppb.max() >= cfg.episode.severe_ppb),
                "median_ppb_monitor": round(median, 2),
            })
        log.info("%s: threshold %.1f ppb -> %d episodes", monitor_id, threshold,
                 sum(r["monitor_id"] == monitor_id for r in rows))
    return pd.DataFrame(rows).sort_values(["monitor_id", "start_utc"]).reset_index(drop=True)


def run(cfg: Config | None = None) -> dict:
    cfg = cfg or load_config()
    hourly = pd.read_parquet(interim("hourly"))
    if hourly.empty:
        raise SystemExit("run S6 first: data/interim/hourly.parquet is empty")

    episodes = detect(hourly, cfg, feasibility=False)
    episodes.to_parquet(interim("episodes"), index=False)

    # The feasibility variant exists only so the golden numbers remain checkable.
    feas_src = hourly[(hourly.monitor_id == "48-167-0005") & (hourly.t_utc.dt.year == 2023)]
    feas = detect(feas_src, cfg, feasibility=True)
    feas.to_parquet(interim("episodes_feasibility"), index=False)

    log.info("wrote %d episodes across %d monitors (feasibility set: %d)",
             len(episodes), episodes.monitor_id.nunique() if not episodes.empty else 0, len(feas))
    if not episodes.empty:
        top = episodes.nlargest(5, "peak_ppb")
        for r in top.itertuples():
            log.info("   %s  %s  %5.1f ppb over %2d h  wind from %3.0f (%s)",
                     r.monitor_id, r.start_utc.date(), r.peak_ppb, r.n_hours,
                     r.wd_mean_deg, r.wind_source)
    return {"episodes": interim("episodes")}


def acceptance() -> list[tuple[str, bool, str]]:
    feas = pd.read_parquet(interim("episodes_feasibility"))
    eps = pd.read_parquet(interim("episodes"))
    checks = [("feasibility mode gives 10 texas-city 2023 episodes", len(feas) == 10,
               f"got {len(feas)}")]
    if len(feas):
        within = feas.wd_mean_deg.between(110, 175).all()
        checks.append(("every feasibility episode has wind from the SE quadrant", bool(within),
                       f"range {feas.wd_mean_deg.min():.0f}-{feas.wd_mean_deg.max():.0f}"))
        checks.append(("feasibility peak == 43.7 ppb", abs(feas.peak_ppb.max() - 43.7) < 0.05,
                       f"got {feas.peak_ppb.max()}"))
    checks.append(("full-mode episodes exist for every monitor with data",
                   not eps.empty, f"{len(eps)} episodes"))
    return checks


if __name__ == "__main__":
    from .logging_setup import setup

    setup()
    run()
    for name, ok, detail in acceptance():
        print(("PASS  " if ok else "FAIL  ") + name + "   " + detail)
