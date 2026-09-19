"""One logging style for every stage, so a full run reads as a transcript."""

from __future__ import annotations

import logging
import os
import sys

_FMT = "%(asctime)s  %(levelname)-5s  %(name)-22s  %(message)s"


def setup(level: str | None = None) -> None:
    lvl = (level or os.environ.get("PLUMEPRINT_LOG", "INFO")).upper()
    logging.basicConfig(level=lvl, format=_FMT, datefmt="%H:%M:%S", stream=sys.stderr, force=True)
    logging.getLogger("urllib3").setLevel(logging.WARNING)


def get(name: str) -> logging.Logger:
    return logging.getLogger(name)
