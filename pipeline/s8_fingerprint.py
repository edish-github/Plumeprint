"""Stage S8: the directional fingerprint.

For each wind-direction bin, the share of hours in that bin that land in the monitor's own
top percentile. One trajectory can be wrong; a year of hours pointing the same way is a
pattern. This is the conditional probability function used in receptor modelling, and it is
the statistically defensible half of the audit.

Calm hours are dropped (direction is meaningless below min_ws_ms) and thin bins are held
back rather than shown as spikes.

Uncertainty comes from a day-block bootstrap: whole calendar days are resampled, because
consecutive hours share weather and treating them as independent would make every interval
look far tighter than it is.

Output  data/interim/fingerprint.parquet   one row per (monitor, year-or-all, bin)
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import Config, load_config
from .logging_setup import get
from .paths import interim

log = get("s8.fingerprint")

ALL_YEARS = 0      # the 'year' value standing for the whole record


def _bootstrap_ci(days: np.ndarray, bins: np.ndarray, high: np.ndarray, n_bins: int,
                  cfg: Config, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Day-block bootstrap of the per-bin conditional probability."""
    unique_days, day_index = np.unique(days, return_inverse=True)
    by_day: list[tuple[np.ndarray, np.ndarray]] = [
        (bins[day_index == i], high[day_index == i]) for i in range(len(unique_days))
    ]
    draws = np.full((cfg.fingerprint.bootstrap_n, n_bins), np.nan)
    n_days = len(by_day)
    for k in range(cfg.fingerprint.bootstrap_n):
        pick = rng.integers(0, n_days, n_days)
        b = np.concatenate([by_day[i][0] for i in pick])
        h = np.concatenate([by_day[i][1] for i in pick])
        counts = np.bincount(b, minlength=n_bins).astype(float)
        hits = np.bincount(b, weights=h, minlength=n_bins)
        with np.errstate(invalid="ignore", divide="ignore"):
            draws[k] = np.where(counts > 0, hits / counts, np.nan)
    lo, hi = cfg.fingerprint.ci
    return (np.nanquantile(draws, lo, axis=0), np.nanquantile(draws, hi, axis=0))


def _lobe(cpf: np.ndarray, cfg: Config) -> tuple[int | None, list[int]]:
    """Peak bin and the contiguous bins around it that stay above lobe_frac of the peak."""
    if np.all(np.isnan(cpf)):
        return None, []
    filled = np.nan_to_num(cpf, nan=0.0)
    n = len(filled)
    smooth = np.array([np.nanmean([filled[(i - 1) % n], filled[i], filled[(i + 1) % n]])
                       for i in range(n)])
    peak = int(np.argmax(smooth))
    if smooth[peak] <= 0:
        return None, []
    cut = cfg.fingerprint.lobe_frac * smooth[peak]
    lobe = [peak]
    for step in (1, -1):
        i = peak
        while True:
            i = (i + step) % n
            if i in lobe or smooth[i] < cut:
                break
            lobe.append(i)
    return peak, sorted(lobe)


def compute(hourly: pd.DataFrame, cfg: Config, seed: int = 20260917) -> pd.DataFrame:
    fp = cfg.fingerprint
    n_bins = 360 // fp.bin_deg
    rng = np.random.default_rng(seed)
    rows = []

    for monitor_id, g in hourly.groupby("monitor_id", sort=False):
        usable_all = g[(g.ws_ms >= fp.min_ws_ms) & g.wd_deg.notna() & g.so2_ppb.notna()]
        if usable_all.empty:
            continue
        # One threshold per monitor, from the full record, so yearly panels stay comparable.
        threshold = float(usable_all.so2_ppb.quantile(fp.top_pct))

        periods = [(ALL_YEARS, usable_all)]
        for year, gy in usable_all.groupby(usable_all.t_utc.dt.year):
            periods.append((int(year), gy))

        for year, d in periods:
            if len(d) < fp.min_hours_per_bin:
                continue
            bins = (np.floor(d.wd_deg.to_numpy(dtype=float) / fp.bin_deg).astype(int)) % n_bins
            high = (d.so2_ppb.to_numpy(dtype=float) > threshold).astype(float)
            counts = np.bincount(bins, minlength=n_bins).astype(float)
            hits = np.bincount(bins, weights=high, minlength=n_bins)
            with np.errstate(invalid="ignore", divide="ignore"):
                cpf = np.where(counts >= fp.min_hours_per_bin, hits / counts, np.nan)

            if year == ALL_YEARS:
                days = d.t_utc.dt.floor("D").to_numpy()
                lo, hi = _bootstrap_ci(days, bins, high, n_bins, cfg, rng)
            else:
                lo = hi = np.full(n_bins, np.nan)

            peak, lobe = _lobe(cpf, cfg)
            for b in range(n_bins):
                rows.append({
                    "monitor_id": monitor_id, "year": year, "bin_deg": b * fp.bin_deg,
                    "cpf": None if np.isnan(cpf[b]) else round(float(cpf[b]), 4),
                    "ci_low": None if np.isnan(lo[b]) else round(float(lo[b]), 4),
                    "ci_high": None if np.isnan(hi[b]) else round(float(hi[b]), 4),
                    "n_hours": int(counts[b]),
                    "n_high": int(hits[b]),
                    "in_lobe": b in lobe,
                    "is_peak": peak is not None and b == peak,
                    "threshold_ppb": round(threshold, 2),
                    "wind_source_share_aqs": round(float((d.wind_source == "aqs").mean()), 3),
                })
    return pd.DataFrame(rows)


def run(cfg: Config | None = None) -> dict:
    cfg = cfg or load_config()
    hourly = pd.read_parquet(interim("hourly"))
    if hourly.empty:
        raise SystemExit("run S6 first: data/interim/hourly.parquet is empty")

    fp = compute(hourly, cfg)
    fp.to_parquet(interim("fingerprint"), index=False)

    # Feasibility variant: 2023, Texas City, modelled wind only, as on 17 Sep 2026.
    feas_src = hourly[(hourly.monitor_id == "48-167-0005") & (hourly.t_utc.dt.year == 2023)]
    feas = compute(feas_src, cfg)
    feas.to_parquet(interim("fingerprint_feasibility"), index=False)

    log.info("wrote %d fingerprint rows", len(fp))
    for monitor_id, g in fp[fp.year == ALL_YEARS].groupby("monitor_id"):
        peak = g[g.is_peak]
        if peak.empty:
            continue
        r = peak.iloc[0]
        lobe = g[g.in_lobe].bin_deg.tolist()
        log.info("   %s peak %3d-%3d deg  cpf %.2f [%.2f-%.2f]  lobe %d bins  measured wind %.0f%%",
                 monitor_id, r.bin_deg, r.bin_deg + cfg.fingerprint.bin_deg, r.cpf or 0,
                 r.ci_low or 0, r.ci_high or 0, len(lobe), 100 * r.wind_source_share_aqs)
    return {"fingerprint": interim("fingerprint")}


def acceptance() -> list[tuple[str, bool, str]]:
    feas = pd.read_parquet(interim("fingerprint_feasibility"))
    fp = pd.read_parquet(interim("fingerprint"))
    checks = []
    peak = feas[feas.is_peak & (feas.year == 2023)]
    if len(peak):
        r = peak.iloc[0]
        checks += [
            ("feasibility peak bin is 130-140 deg", int(r.bin_deg) == 130, f"got {int(r.bin_deg)}"),
            ("feasibility peak cpf ~ 0.27", abs(float(r.cpf) - 0.27) < 0.04, f"got {r.cpf}"),
        ]
    tc = fp[(fp.monitor_id == "48-167-0005") & (fp.year == ALL_YEARS)]
    if len(tc):
        lobe = tc[tc.in_lobe].bin_deg.tolist()
        checks.append(("texas-city lobe is a single contiguous sector", 0 < len(lobe) <= 12,
                       f"{len(lobe)} bins: {lobe[:6]}"))
    covered = fp[fp.year == ALL_YEARS].groupby("monitor_id").is_peak.any()
    checks.append(("every monitor has a peak direction", bool(covered.all()),
                   f"{int(covered.sum())} of {len(covered)}"))
    return checks


if __name__ == "__main__":
    from .logging_setup import setup

    setup()
    run()
    for name, ok, detail in acceptance():
        print(("PASS  " if ok else "FAIL  ") + name + "   " + detail)
