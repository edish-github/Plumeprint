"""Filesystem layout. Everything is resolved from the repo root, never the CWD."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(os.environ.get("PLUMEPRINT_ROOT", Path(__file__).resolve().parent.parent))
CONFIG_DIR = ROOT / "config"
DATA = ROOT / "data"

RAW = DATA / "raw"
RAW_AQS = RAW / "aqs"
RAW_OPENMETEO = RAW / "openmeteo"
RAW_AEER = RAW / "aeer"
RAW_AEER_SEARCH = RAW_AEER / "search"
RAW_AEER_DETAIL = RAW_AEER / "detail"
RAW_GEOCODE = RAW / "geocode"

INTERIM = DATA / "interim"
GOLDEN = DATA / "golden"

WEB = ROOT / "web"
WEB_DATA = WEB / "public" / "data"

_ALL = [
    RAW_AQS, RAW_OPENMETEO, RAW_AEER_SEARCH, RAW_AEER_DETAIL, RAW_GEOCODE,
    INTERIM, GOLDEN, WEB_DATA,
]


def ensure_dirs() -> None:
    for d in _ALL:
        d.mkdir(parents=True, exist_ok=True)


def interim(name: str) -> Path:
    """Path of an interim parquet, e.g. interim('so2') -> data/interim/so2.parquet"""
    INTERIM.mkdir(parents=True, exist_ok=True)
    return INTERIM / f"{name}.parquet"
