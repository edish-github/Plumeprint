"""Stage S12: the golden-number gate.

The numbers in data/golden/feasibility_2023.json were measured by hand on 17 Sep 2026,
before any of this code existed. They are the check that the pipeline still describes the
same world after every refactor.

Two kinds of check:

  exact       facts that must never move: the monitor's 2023 hour count, the peak and when
              it happened, the SO2 totals on specific filed reports.
  reproduced  the Texas City 2023 headline, recomputed in feasibility mode (fixed 5 ppb
              floor, modelled wind, time-and-pollutant matching only) so it is comparable
              with the hand analysis.

Full mode is expected to differ from feasibility mode, because it uses measured wind,
real facility coordinates and a bearing test. Where it differs, the difference is printed
rather than hidden, so the pitch can quote whichever number it actually stands behind.
"""

from __future__ import annotations

import json

import pandas as pd

from .config import Config, load_config
from .logging_setup import get
from .paths import GOLDEN, interim

log = get("s12.validate")

GOLDEN_FILE = GOLDEN / "feasibility_2023.json"

GOLDEN_NUMBERS = {
    "measured_on": "2026-09-17",
    "method": ("Hand analysis: EPA AQS 2023 hourly SO2, Open-Meteo modelled wind, TCEQ "
               "Galveston County reports. Episodes at a fixed 5 ppb floor, split on gaps "
               "over 4 h. Matching on time overlap (2 h either side) plus SO2 listed."),
    "monitor": "48-167-0005",
    "so2_hours_2023": 7998,
    "so2_hours_2023_basis": ("local standard time, matching how the AQS yearly file is "
                             "filtered; counting on UTC years gives 8003, because the 2022 "
                             "file's last local hours fall into 2023 UTC"),
    "p95_ppb": 1.20,
    "p99_ppb": 2.4,
    "max_ppb": 43.7,
    "max_at_utc": "2023-04-20T13:00:00Z",
    "hours_above_1_5_ppb": 228,
    "hours_at_or_above_5_ppb": 28,
    "cpf_se_sector": 0.234,
    "fingerprint_peak_bin_deg": 130,
    "fingerprint_peak_cpf": 0.27,
    "top25_wind_range_deg": [118, 163],
    "episodes": 10,
    "episodes_without_report": 6,
    "galveston_reports_2023": 48,
    "galveston_reports_with_so2": 37,
    "galveston_so2_lb_total": 159019,
    "reports_at_or_above_1000lb": 28,
    "reports_1000lb_peak_under_2ppb": 21,
    "incident_399287_so2_lb": 1675.85,
    "incident_398929_so2_lb": 3716.55,
    "incident_403267_so2_lb": 8830.73,
    "incident_403267_monitor_peak_ppb": 1.5,
    "incident_410224_so2_lb": 40994,
}


def write_golden() -> None:
    GOLDEN.mkdir(parents=True, exist_ok=True)
    GOLDEN_FILE.write_text(json.dumps(GOLDEN_NUMBERS, indent=2), encoding="utf-8")


def _near(got, want, tol) -> bool:
    try:
        return abs(float(got) - float(want)) <= tol
    except (TypeError, ValueError):
        return False


def run(cfg: Config | None = None) -> dict:
    cfg = cfg or load_config()
    write_golden()
    log.info("golden numbers pinned at %s", GOLDEN_FILE)

    hourly = pd.read_parquet(interim("hourly"))
    events = pd.read_parquet(interim("events"))
    episodes = pd.read_parquet(interim("episodes"))
    visibility = pd.read_parquet(interim("visibility"))

    tc = hourly[(hourly.monitor_id == "48-167-0005") & (hourly.t_utc.dt.year == 2023)]
    full_2023 = episodes[(episodes.monitor_id == "48-167-0005") &
                         (episodes.start_utc.dt.year == 2023)]
    inc_2023 = set(events[(events.county == "GALVESTON") &
                          (events.start_utc.dt.year == 2023)].incident)
    vis_2023 = visibility[visibility.incident.isin(inc_2023)]

    log.info("full mode, Texas City 2023: %d episodes %s",
             len(full_2023), full_2023.verdict.value_counts().to_dict())
    log.info("hand analysis, same slice:  10 episodes {'UNEXPLAINED': 6, 'MATCHED': 3, 'WEAK_MATCH': 1}")
    log.info("full mode wind: %s", tc.wind_source.value_counts().to_dict())
    if len(vis_2023):
        log.info("full mode report visibility 2023: %s", vis_2023.status.value_counts().to_dict())
    return {"golden": GOLDEN_FILE}


def acceptance() -> list[tuple[str, bool, str]]:
    g = GOLDEN_NUMBERS
    hourly = pd.read_parquet(interim("hourly"))
    events = pd.read_parquet(interim("events"))
    episodes = pd.read_parquet(interim("episodes"))
    feas = pd.read_parquet(interim("episodes_feasibility"))
    fp_feas = pd.read_parquet(interim("fingerprint_feasibility"))

    tc = hourly[(hourly.monitor_id == g["monitor"]) & (hourly.t_utc.dt.year == 2023)]
    valid = tc.so2_ppb.dropna()
    # The hand analysis counted a calendar year of the AQS file, which is local standard
    # time (UTC-6 in Texas) all year. Counting UTC years instead pulls in five hours from
    # the 2022 file, so the golden check is made on the same basis it was measured on.
    lst = hourly[hourly.monitor_id == g["monitor"]]
    lst_2023 = lst[(lst.t_utc - pd.Timedelta(hours=6)).dt.year == 2023].so2_ppb.dropna()
    peak_row = tc.loc[tc.so2_ppb.idxmax()] if valid.any() else None
    gal = events[(events.county == "GALVESTON") & (events.start_utc.dt.year == 2023)]

    checks = [
        ("2023 SO2 hours (local standard time basis)",
         len(lst_2023) == g["so2_hours_2023"],
         f"{len(lst_2023)} vs {g['so2_hours_2023']} (UTC-year basis gives {len(valid)})"),
        ("2023 p95", _near(valid.quantile(0.95), g["p95_ppb"], 0.05),
         f"{valid.quantile(0.95):.2f} vs {g['p95_ppb']}"),
        ("2023 p99", _near(valid.quantile(0.99), g["p99_ppb"], 0.05),
         f"{valid.quantile(0.99):.2f} vs {g['p99_ppb']}"),
        ("2023 max", _near(valid.max(), g["max_ppb"], 0.05), f"{valid.max()} vs {g['max_ppb']}"),
        ("hours above 1.5 ppb", int((valid > 1.5).sum()) == g["hours_above_1_5_ppb"],
         f"{int((valid > 1.5).sum())} vs {g['hours_above_1_5_ppb']}"),
        ("hours at or above 5 ppb", int((valid >= 5).sum()) == g["hours_at_or_above_5_ppb"],
         f"{int((valid >= 5).sum())} vs {g['hours_at_or_above_5_ppb']}"),
        ("galveston 2023 reports", len(gal) == g["galveston_reports_2023"],
         f"{len(gal)} vs {g['galveston_reports_2023']}"),
        ("galveston 2023 reports listing SO2",
         int((gal.pollutant_lb > 0).sum()) == g["galveston_reports_with_so2"],
         f"{int((gal.pollutant_lb > 0).sum())} vs {g['galveston_reports_with_so2']}"),
        ("galveston 2023 SO2 total", _near(gal.pollutant_lb.sum(), g["galveston_so2_lb_total"], 5),
         f"{gal.pollutant_lb.sum():.0f} vs {g['galveston_so2_lb_total']}"),
        ("reports at or above 1000 lb",
         int((gal.pollutant_lb >= 1000).sum()) == g["reports_at_or_above_1000lb"],
         f"{int((gal.pollutant_lb >= 1000).sum())} vs {g['reports_at_or_above_1000lb']}"),
        ("feasibility episodes", len(feas) == g["episodes"], f"{len(feas)} vs {g['episodes']}"),
    ]
    if peak_row is not None:
        checks.append(("2023 peak timestamp",
                       pd.Timestamp(peak_row.t_utc).strftime("%Y-%m-%dT%H:%M:%SZ") == g["max_at_utc"],
                       f"{peak_row.t_utc} vs {g['max_at_utc']}"))
    for incident, key in ((399287, "incident_399287_so2_lb"), (398929, "incident_398929_so2_lb"),
                          (403267, "incident_403267_so2_lb")):
        row = events[events.incident == incident]
        got = float(row.pollutant_lb.iloc[0]) if len(row) else float("nan")
        checks.append((f"incident {incident} SO2 lb", _near(got, g[key], 0.05), f"{got} vs {g[key]}"))

    peak = fp_feas[fp_feas.is_peak & (fp_feas.year == 2023)]
    if len(peak):
        checks.append(("fingerprint peak bin",
                       int(peak.bin_deg.iloc[0]) == g["fingerprint_peak_bin_deg"],
                       f"{int(peak.bin_deg.iloc[0])} vs {g['fingerprint_peak_bin_deg']}"))

    # The full-mode headline is expected to hold too: it is the claim the pitch makes.
    full = episodes[(episodes.monitor_id == g["monitor"]) & (episodes.start_utc.dt.year == 2023)]
    checks.append(("full mode reproduces the 2023 headline",
                   len(full) == g["episodes"] and
                   int((full.verdict == "UNEXPLAINED").sum()) == g["episodes_without_report"],
                   f"{len(full)} episodes, {int((full.verdict == 'UNEXPLAINED').sum())} unexplained "
                   f"vs {g['episodes']}/{g['episodes_without_report']}"))
    return checks


if __name__ == "__main__":
    from .logging_setup import setup

    setup()
    run()
    failures = 0
    for name, ok, detail in acceptance():
        print(("PASS  " if ok else "FAIL  ") + name + "   " + detail)
        failures += not ok
    raise SystemExit(1 if failures else 0)
