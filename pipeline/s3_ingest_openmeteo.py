"""Stage S3: Open-Meteo archive wind for every monitor, one call per monitor-year.

Requested with timezone=GMT and wind_speed_unit=ms, so nothing needs converting later.
Values are instantaneous on the hour; S6 vector-averages consecutive hours to line them
up with the AQS hour-beginning convention.

Output  data/interim/wind_om.parquet   monitor_id, t_utc, wd_deg, ws_ms
"""

from __future__ import annotations

import json

import pandas as pd

from .config import Config, load_config
from .http import get_text
from .logging_setup import get
from .paths import RAW_OPENMETEO, interim

log = get("s3.openmeteo")

URL = "https://archive-api.open-meteo.com/v1/archive"
ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)"


def fetch(monitor_id: str, lat: float, lon: float, year: int, force: bool = False) -> dict | None:
    cache = RAW_OPENMETEO / f"{monitor_id}_{year}.json"
    params = {
        "latitude": round(float(lat), 5),
        "longitude": round(float(lon), 5),
        "start_date": f"{year}-01-01",
        "end_date": f"{year}-12-31",
        "hourly": "wind_speed_10m,wind_direction_10m",
        "timezone": "GMT",             # 'Etc/GMT+6' failed upstream during the feasibility run
        "wind_speed_unit": "ms",
    }
    text = get_text(URL, cache=cache, force=force, params=params, sleep=0.4)
    if text is None:
        return None
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        log.error("bad JSON for %s %s; clearing cache", monitor_id, year)
        cache.unlink(missing_ok=True)
        return None
    if "hourly" not in payload:
        log.error("no hourly block for %s %s: %s", monitor_id, year, str(payload)[:160])
        cache.unlink(missing_ok=True)
        return None
    return payload


def run(cfg: Config | None = None, years: list[int] | None = None, force: bool = False) -> dict:
    cfg = cfg or load_config()
    years = years or list(cfg.years)
    monitors = pd.read_parquet(interim("monitors_aqs"))
    if monitors.empty:
        raise SystemExit("run S1 first: data/interim/monitors_aqs.parquet is empty")

    frames = []
    for m in monitors.itertuples():
        for year in years:
            payload = fetch(m.monitor_id, m.lat, m.lon, year, force=force)
            if payload is None:
                log.warning("no wind for %s %s", m.monitor_id, year)
                continue
            h = payload["hourly"]
            df = pd.DataFrame({
                "monitor_id": m.monitor_id,
                "t_utc": pd.to_datetime(h["time"]),
                "ws_ms": h["wind_speed_10m"],
                "wd_deg": h["wind_direction_10m"],
            })
            df["grid_lat"] = payload.get("latitude")
            df["grid_lon"] = payload.get("longitude")
            frames.append(df)

    out = (pd.concat(frames, ignore_index=True) if frames
           else pd.DataFrame(columns=["monitor_id", "t_utc", "ws_ms", "wd_deg"]))
    out = out.drop_duplicates(["monitor_id", "t_utc"]).sort_values(["monitor_id", "t_utc"])
    out.reset_index(drop=True).to_parquet(interim("wind_om"), index=False)
    log.info("wrote %d modelled wind hours for %d monitors", len(out), out.monitor_id.nunique())
    return {"wind_om": interim("wind_om")}


def acceptance() -> list[tuple[str, bool, str]]:
    w = pd.read_parquet(interim("wind_om"))
    m = w[(w.monitor_id == "48-167-0005") & (w.t_utc.dt.year == 2023)]
    nulls = int(m.wd_deg.isna().sum() + m.ws_ms.isna().sum())
    return [
        ("texas-city 2023 modelled wind hours == 8760", len(m) == 8760, f"got {len(m)}"),
        ("no null wind values", nulls == 0, f"got {nulls}"),
    ]


if __name__ == "__main__":
    from .logging_setup import setup

    setup()
    run()
    for name, ok, detail in acceptance():
        print(("PASS  " if ok else "FAIL  ") + name + "   " + detail)
