"""Stage S1: EPA AQS bulk hourly files -> tidy SO2 and on-site wind tables.

The yearly CSVs are large (the 2023 SO2 file is 790 MB unzipped) and pandas' chunked
reader raised an internal error on the full file, so rows are filtered as raw text by
state prefix before any parsing happens. See spec section 3.1.

Inputs   https://aqs.epa.gov/aqsweb/airdata/hourly_{PARAM}_{YEAR}.zip
Outputs  data/interim/so2.parquet          monitor_id, t_utc, so2_ppb, poc, lat, lon
         data/interim/wind_aqs.parquet     monitor_id, t_utc, wd_deg, ws_ms
         data/interim/monitors_aqs.parquet monitor_id, lat, lon, county_name, n_hours...
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pandas as pd

from .config import Config, load_config
from .http import download
from .logging_setup import get
from .paths import RAW_AQS, interim
from .timeutil import aqs_gmt_to_utc

log = get("s1.aqs")

BASE = "https://aqs.epa.gov/aqsweb/airdata"
KNOTS_TO_MS = 0.514444

WIND_SPEED_PARAM = "61103"   # Wind Speed - Resultant, knots
WIND_DIR_PARAM = "61104"     # Wind Direction - Resultant, degrees the wind comes FROM

COLUMNS = [
    "State Code", "County Code", "Site Num", "Parameter Code", "POC", "Latitude", "Longitude",
    "Datum", "Parameter Name", "Date Local", "Time Local", "Date GMT", "Time GMT",
    "Sample Measurement", "Units of Measure", "MDL", "Uncertainty", "Qualifier", "Method Type",
    "Method Code", "Method Name", "State Name", "County Name", "Date of Last Change",
]


def _zip_url(param: str, year: int) -> str:
    return f"{BASE}/hourly_{param}_{year}.zip"


def _cache_path(param: str, year: int) -> Path:
    return RAW_AQS / f"hourly_{param}_{year}.zip"


def _states_of(monitor_ids: list[str]) -> set[str]:
    return {m.split("-")[0] for m in monitor_ids}


def _filter_zip_by_state(zip_path: Path, states: set[str]) -> pd.DataFrame:
    """Read one AQS zip, keeping only rows whose State Code is in `states`.

    Filtering as bytes keeps peak memory near the size of the kept rows, not the file.
    """
    prefixes = tuple(f'"{s}",'.encode() for s in sorted(states))
    kept: list[bytes] = []
    with zipfile.ZipFile(zip_path) as zf:
        name = zf.namelist()[0]
        with zf.open(name) as fh:
            header = fh.readline()
            for line in fh:
                if line.startswith(prefixes):
                    kept.append(line)
    if not kept:
        return pd.DataFrame(columns=COLUMNS)
    buf = io.BytesIO(header + b"".join(kept))
    df = pd.read_csv(buf, dtype=str, low_memory=False)
    df["value"] = pd.to_numeric(df["Sample Measurement"], errors="coerce")
    df["monitor_id"] = df["State Code"] + "-" + df["County Code"] + "-" + df["Site Num"]
    df["t_utc"] = aqs_gmt_to_utc(df["Date GMT"], df["Time GMT"])
    return df


def _pick_poc(df: pd.DataFrame) -> pd.DataFrame:
    """One series per monitor: keep the POC with the most valid hours."""
    if df.empty:
        return df
    counts = df.dropna(subset=["value"]).groupby(["monitor_id", "POC"]).size().rename("n").reset_index()
    best = counts.sort_values("n", ascending=False).drop_duplicates("monitor_id")[["monitor_id", "POC"]]
    return df.merge(best, on=["monitor_id", "POC"], how="inner")


def run(cfg: Config | None = None, years: list[int] | None = None, force: bool = False) -> dict[str, Path]:
    cfg = cfg or load_config()
    years = years or list(cfg.years)
    wanted = set(cfg.all_monitor_ids)
    states = _states_of(cfg.all_monitor_ids)
    log.info("monitors=%d states=%s years=%s", len(wanted), sorted(states), years)

    so2_frames: list[pd.DataFrame] = []
    wind_frames: list[pd.DataFrame] = []

    for year in years:
        # --- pollutant ---
        p = cfg.pollutant.aqs_param
        zp = _cache_path(p, year)
        if download(_zip_url(p, year), zp, force=force) is None:
            log.warning("no %s file for %s, skipping year", cfg.pollutant.name, year)
        else:
            df = _filter_zip_by_state(zp, states)
            df = df[df.monitor_id.isin(wanted)]
            df = _pick_poc(df)
            if not df.empty:
                so2_frames.append(
                    df[["monitor_id", "t_utc", "value", "POC", "Latitude", "Longitude",
                        "County Name", "Date Local", "Time Local"]]
                    .rename(columns={"value": "so2_ppb", "POC": "poc", "Latitude": "lat",
                                     "Longitude": "lon", "County Name": "county_name",
                                     "Date Local": "date_local", "Time Local": "time_local"})
                )
                log.info("%s %s: %d rows across %d monitors", cfg.pollutant.name, year,
                         len(df), df.monitor_id.nunique())

        # --- on-site wind ---
        zw = _cache_path("WIND", year)
        if download(_zip_url("WIND", year), zw, force=force) is None:
            log.warning("no WIND file for %s, skipping year", year)
            continue
        w = _filter_zip_by_state(zw, states)
        w = w[w.monitor_id.isin(wanted) & w["Parameter Code"].isin([WIND_SPEED_PARAM, WIND_DIR_PARAM])]
        if w.empty:
            continue
        w = _pick_poc(w)
        spd = (w[w["Parameter Code"] == WIND_SPEED_PARAM]
               .groupby(["monitor_id", "t_utc"])["value"].first().rename("ws_knots"))
        dr = (w[w["Parameter Code"] == WIND_DIR_PARAM]
              .groupby(["monitor_id", "t_utc"])["value"].first().rename("wd_deg"))
        ww = pd.concat([spd, dr], axis=1).reset_index()
        ww["ws_ms"] = ww.ws_knots * KNOTS_TO_MS
        wind_frames.append(ww[["monitor_id", "t_utc", "wd_deg", "ws_ms"]])
        log.info("WIND %s: %d hours across %d monitors", year, len(ww), ww.monitor_id.nunique())

    so2 = (pd.concat(so2_frames, ignore_index=True) if so2_frames
           else pd.DataFrame(columns=["monitor_id", "t_utc", "so2_ppb"]))
    wind = (pd.concat(wind_frames, ignore_index=True) if wind_frames
            else pd.DataFrame(columns=["monitor_id", "t_utc", "wd_deg", "ws_ms"]))

    so2 = so2.dropna(subset=["t_utc"]).drop_duplicates(["monitor_id", "t_utc"]).sort_values(
        ["monitor_id", "t_utc"]).reset_index(drop=True)
    wind = wind.dropna(subset=["t_utc"]).drop_duplicates(["monitor_id", "t_utc"]).sort_values(
        ["monitor_id", "t_utc"]).reset_index(drop=True)

    monitors = pd.DataFrame()
    if not so2.empty:
        so2["lat"] = pd.to_numeric(so2.lat, errors="coerce")
        so2["lon"] = pd.to_numeric(so2.lon, errors="coerce")
        monitors = (so2.groupby("monitor_id")
                    .agg(lat=("lat", "median"), lon=("lon", "median"),
                         county_name=("county_name", "first"), n_hours=("so2_ppb", "size"),
                         n_valid=("so2_ppb", "count"), first_utc=("t_utc", "min"),
                         last_utc=("t_utc", "max"), max_ppb=("so2_ppb", "max"))
                    .reset_index())
        monitors["has_onsite_wind"] = monitors.monitor_id.isin(set(wind.monitor_id))

    out = {
        "so2": interim("so2"),
        "wind_aqs": interim("wind_aqs"),
        "monitors_aqs": interim("monitors_aqs"),
    }
    so2.drop(columns=["county_name"], errors="ignore").to_parquet(out["so2"], index=False)
    wind.to_parquet(out["wind_aqs"], index=False)
    monitors.to_parquet(out["monitors_aqs"], index=False)
    log.info("wrote so2=%d wind=%d monitors=%d", len(so2), len(wind), len(monitors))
    return out


def acceptance(cfg: Config | None = None) -> list[tuple[str, bool, str]]:
    """Spec section 5: 48-167-0005 has 7,998 SO2 hours in 2023 and a max of 43.7 ppb."""
    cfg = cfg or load_config()
    so2 = pd.read_parquet(interim("so2"))
    m = so2[(so2.monitor_id == "48-167-0005") & (so2.t_utc.dt.year == 2023)]
    # The AQS year file is calendar-local, so a 2023 file spans a few hours into 2024 UTC;
    # count on the local date instead, which is what the golden number was measured on.
    if "date_local" in so2.columns:
        m = so2[(so2.monitor_id == "48-167-0005") & (so2.date_local.str.startswith("2023"))]
    n = int(m.so2_ppb.notna().sum())
    mx = float(m.so2_ppb.max()) if len(m) else float("nan")
    return [
        ("texas-city 2023 SO2 hours == 7998", n == 7998, f"got {n}"),
        ("texas-city 2023 max == 43.7 ppb", abs(mx - 43.7) < 0.05, f"got {mx}"),
    ]


if __name__ == "__main__":
    from .logging_setup import setup

    setup()
    run()
    for name, ok, detail in acceptance():
        print(("PASS  " if ok else "FAIL  ") + name + "   " + detail)
