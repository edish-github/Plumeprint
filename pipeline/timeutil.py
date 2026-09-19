"""One clock.

Three sources, three conventions (implementation spec section 5.1):

  EPA AQS      "Date/Time Local" is local STANDARD time all year; the file also carries
               GMT columns, so we use those. Values are hour-BEGINNING averages.
  TCEQ AEER    local CLOCK time, so DST applies. Converted with a real tz database.
  Open-Meteo   requested with timezone=GMT, so already UTC. Values are instantaneous.

Everything downstream works in naive UTC hours. Local time appears only at render.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pandas as pd

AEER_FMT = "%m/%d/%Y %I:%M %p"


def aeer_local_to_utc(s: str | None, tz: str = "America/Chicago") -> datetime | None:
    """'04/20/2023 08:00 AM' in America/Chicago -> naive UTC datetime.

    Ambiguous times (the repeated autumn hour) resolve to the first pass (fold=0).
    Nonexistent times (the skipped spring hour) are shifted forward by one hour.
    """
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None
    naive = datetime.strptime(s, AEER_FMT)
    zone = ZoneInfo(tz)
    aware = naive.replace(tzinfo=zone, fold=0)
    # A nonexistent local time keeps the pre-transition offset; normalising through UTC
    # and back reveals the mismatch, and shifting forward an hour lands in real time.
    if aware.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) != naive:
        aware = (naive + timedelta(hours=1)).replace(tzinfo=zone, fold=0)
    return aware.astimezone(timezone.utc).replace(tzinfo=None)


def aeer_series_to_utc(s: pd.Series, tz: str = "America/Chicago") -> pd.Series:
    """Vectorised form of aeer_local_to_utc for a column of AEER timestamps."""
    naive = pd.to_datetime(s, format=AEER_FMT, errors="coerce")
    localised = naive.dt.tz_localize(tz, ambiguous=True, nonexistent="shift_forward")
    return localised.dt.tz_convert("UTC").dt.tz_localize(None)


def aqs_gmt_to_utc(date_gmt: pd.Series, time_gmt: pd.Series) -> pd.Series:
    """AQS 'Date GMT' + 'Time GMT' -> naive UTC hour (hour-beginning)."""
    return pd.to_datetime(
        date_gmt.astype(str).str.strip() + " " + time_gmt.astype(str).str.strip(),
        format="%Y-%m-%d %H:%M",
        errors="coerce",
    )


def utc_to_local(s: pd.Series, tz: str) -> pd.Series:
    """Naive UTC -> naive local clock time. Display only."""
    return s.dt.tz_localize("UTC").dt.tz_convert(tz).dt.tz_localize(None)


def hour_range(start: datetime, end: datetime) -> pd.DatetimeIndex:
    """Every hour in [start, end), the index every hourly table is reindexed onto."""
    return pd.date_range(start=start, end=end, freq="h", inclusive="left")


def iso_z(t) -> str | None:
    """Naive UTC timestamp -> '2023-04-20T13:00:00Z' for the JSON contract."""
    if t is None or pd.isna(t):
        return None
    return pd.Timestamp(t).strftime("%Y-%m-%dT%H:%M:%SZ")
