"""Stage S6: one row per monitor-hour, on one clock, with one chosen wind source.

Two jobs:

  1. Reindex every monitor onto a gap-free hourly UTC index, so "no data" is a real row
     and never a silently skipped hour. A missed hour is the difference between an unseen
     release and an unmonitored one.
  2. Choose a wind vector per hour. Measured on-site wind wins where it exists; modelled
     wind fills the rest, and `wind_source` records which, because the bearing test widens
     its uncertainty for modelled hours.

Output  data/interim/hourly.parquet
        monitor_id, t_utc, so2_ppb, baseline_ppb, wd_deg, ws_ms, wind_source
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import Config, load_config
from .logging_setup import get
from .paths import interim

log = get("s6.normalize")

BASELINE_WINDOW_H = 24 * 31     # rolling median window for the local background
BASELINE_MIN_H = 24 * 7


def _vector_average(df: pd.DataFrame) -> pd.DataFrame:
    """Open-Meteo values are instantaneous; average t and t+1h as vectors.

    Directions cannot be averaged arithmetically (350 and 10 average to 0, not 180), so
    the pair is converted to u/v components, averaged, and converted back.
    """
    out = []
    for monitor_id, g in df.groupby("monitor_id", sort=False):
        g = g.sort_values("t_utc").copy()
        rad = np.radians(g.wd_deg.to_numpy(dtype=float))
        ws = g.ws_ms.to_numpy(dtype=float)
        u, v = -ws * np.sin(rad), -ws * np.cos(rad)
        u2 = (u + np.roll(u, -1)) / 2.0
        v2 = (v + np.roll(v, -1)) / 2.0
        u2[-1], v2[-1] = u[-1], v[-1]      # last hour has no successor
        g["wd_deg"] = (np.degrees(np.arctan2(-u2, -v2)) + 360.0) % 360.0
        g["ws_ms"] = np.hypot(u2, v2)
        out.append(g)
    return pd.concat(out, ignore_index=True) if out else df


def run(cfg: Config | None = None) -> dict:
    cfg = cfg or load_config()
    so2 = pd.read_parquet(interim("so2"))
    wind_aqs = pd.read_parquet(interim("wind_aqs"))
    try:
        wind_om = pd.read_parquet(interim("wind_om"))
    except FileNotFoundError:
        wind_om = pd.DataFrame(columns=["monitor_id", "t_utc", "wd_deg", "ws_ms"])

    if so2.empty:
        raise SystemExit("run S1 first: data/interim/so2.parquet is empty")
    if not wind_om.empty:
        wind_om = _vector_average(wind_om)

    frames = []
    for monitor_id, g in so2.groupby("monitor_id", sort=False):
        g = g.sort_values("t_utc")
        index = pd.date_range(g.t_utc.min(), g.t_utc.max(), freq="h")
        base = (g.set_index("t_utc")[["so2_ppb"]].reindex(index)
                .rename_axis("t_utc").reset_index())
        base["monitor_id"] = monitor_id

        a = wind_aqs[wind_aqs.monitor_id == monitor_id][["t_utc", "wd_deg", "ws_ms"]]
        o = wind_om[wind_om.monitor_id == monitor_id][["t_utc", "wd_deg", "ws_ms"]]
        base = base.merge(a.rename(columns={"wd_deg": "wd_a", "ws_ms": "ws_a"}), on="t_utc", how="left")
        base = base.merge(o.rename(columns={"wd_deg": "wd_o", "ws_ms": "ws_o"}), on="t_utc", how="left")

        use_aqs = base.wd_a.notna() & base.ws_a.notna()
        base["wd_deg"] = np.where(use_aqs, base.wd_a, base.wd_o)
        base["ws_ms"] = np.where(use_aqs, base.ws_a, base.ws_o)
        base["wind_source"] = np.where(use_aqs, "aqs",
                                       np.where(base.wd_o.notna(), "openmeteo", "none"))
        base["baseline_ppb"] = (base.so2_ppb
                                .rolling(BASELINE_WINDOW_H, center=True, min_periods=BASELINE_MIN_H)
                                .median())
        base["baseline_ppb"] = base.baseline_ppb.fillna(base.so2_ppb.median())
        frames.append(base[["monitor_id", "t_utc", "so2_ppb", "baseline_ppb",
                            "wd_deg", "ws_ms", "wind_source"]])

    hourly = pd.concat(frames, ignore_index=True).sort_values(["monitor_id", "t_utc"])
    hourly = hourly.reset_index(drop=True)
    hourly.to_parquet(interim("hourly"), index=False)

    share = hourly.groupby("monitor_id").wind_source.value_counts(normalize=True).unstack(fill_value=0)
    log.info("wrote %d monitor-hours for %d monitors", len(hourly), hourly.monitor_id.nunique())
    for monitor_id, row in share.iterrows():
        log.info("  %s wind: %s", monitor_id,
                 ", ".join(f"{k} {v:.0%}" for k, v in row.items() if v > 0))
    return {"hourly": interim("hourly")}


def acceptance() -> list[tuple[str, bool, str]]:
    """The alignment check: the 2023 peak hour must line up with incident 399287."""
    h = pd.read_parquet(interim("hourly"))
    m = h[(h.monitor_id == "48-167-0005") & (h.t_utc.dt.year == 2023)]
    checks = [("texas-city 2023 hourly rows == 8760", len(m) in (8760, 8761), f"got {len(m)}")]
    if not m.empty and m.so2_ppb.notna().any():
        peak = m.loc[m.so2_ppb.idxmax()]
        checks += [
            ("2023 peak == 43.7 ppb", abs(float(peak.so2_ppb) - 43.7) < 0.05, f"got {peak.so2_ppb}"),
            ("2023 peak at 2023-04-20 13:00 UTC", str(peak.t_utc) == "2023-04-20 13:00:00",
             f"got {peak.t_utc}"),
            ("peak-hour wind from 118-163 deg", 118 <= float(peak.wd_deg) <= 163,
             f"got {peak.wd_deg:.0f}"),
        ]
    return checks


if __name__ == "__main__":
    from .logging_setup import setup

    setup()
    run()
    for name, ok, detail in acceptance():
        print(("PASS  " if ok else "FAIL  ") + name + "   " + detail)
