"""Cached, polite HTTP.

Every external fetch lands on disk on first success, so a re-run works offline and the
demo never depends on a live service. One Open-Meteo call in roughly six timed out during
the feasibility run, so retries are mandatory, not optional.
"""

from __future__ import annotations

import time
from pathlib import Path

import requests

from .logging_setup import get

log = get("http")

USER_AGENT = (
    "PlumePrint/0.1 (student hackathon project, NextStep Hacks 2026; "
    "contact: set PLUMEPRINT_CONTACT)"
)
DEFAULT_TIMEOUT = 90
# (connect, read) for streamed files. A stalled mirror can trickle bytes for minutes
# without ever tripping a single long timeout, so the read leg is kept short and the
# retry opens a fresh connection instead.
STREAM_TIMEOUT = (15, 45)
RETRIES = 4
BACKOFF_S = 3.0


def session(extra_headers: dict[str, str] | None = None) -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, **(extra_headers or {})})
    return s


def get_text(
    url: str,
    *,
    cache: Path | None = None,
    force: bool = False,
    sess: requests.Session | None = None,
    params: dict | None = None,
    sleep: float = 0.0,
    retries: int = RETRIES,
) -> str | None:
    """GET a page, using `cache` when it already exists."""
    if cache and cache.exists() and cache.stat().st_size > 0 and not force:
        return cache.read_text(encoding="utf-8", errors="ignore")
    s = sess or session()
    for attempt in range(1, retries + 1):
        try:
            if sleep:
                time.sleep(sleep)
            r = s.get(url, params=params, timeout=DEFAULT_TIMEOUT)
            if r.status_code == 404:
                log.warning("404 %s", url)
                return None
            r.raise_for_status()
            if cache:
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(r.text, encoding="utf-8")
            return r.text
        except Exception as exc:  # noqa: BLE001 - retry anything transient
            log.warning("attempt %d/%d failed for %s: %s", attempt, retries, url, exc)
            if attempt == retries:
                return None
            time.sleep(BACKOFF_S * attempt)
    return None


def post_text(
    url: str,
    body: str,
    *,
    sess: requests.Session,
    cache: Path | None = None,
    force: bool = False,
    referer: str | None = None,
    retries: int = RETRIES,
) -> str | None:
    """POST a pre-encoded form body.

    The body is passed already encoded because the TCEQ search form has a field whose
    name contains '=', which a naive encoder mangles into a server error (spec 3.2).
    """
    if cache and cache.exists() and cache.stat().st_size > 0 and not force:
        return cache.read_text(encoding="utf-8", errors="ignore")
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    if referer:
        headers["Referer"] = referer
    for attempt in range(1, retries + 1):
        try:
            r = sess.post(url, data=body, headers=headers, timeout=DEFAULT_TIMEOUT)
            r.raise_for_status()
            if cache:
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(r.text, encoding="utf-8")
            return r.text
        except Exception as exc:  # noqa: BLE001
            log.warning("POST attempt %d/%d failed for %s: %s", attempt, retries, url, exc)
            if attempt == retries:
                return None
            time.sleep(BACKOFF_S * attempt)
    return None


def download(url: str, dest: Path, *, force: bool = False, retries: int = 5) -> Path | None:
    """Stream a binary file to `dest`, skipping the fetch when it is already there."""
    if dest.exists() and dest.stat().st_size > 0 and not force:
        log.debug("cached %s", dest.name)
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, retries + 1):
        try:
            with session().get(url, stream=True, timeout=STREAM_TIMEOUT) as r:
                if r.status_code == 404:
                    log.warning("404 %s", url)
                    return None
                r.raise_for_status()
                with tmp.open("wb") as fh:
                    for chunk in r.iter_content(1 << 20):
                        fh.write(chunk)
            tmp.replace(dest)
            log.info("downloaded %s (%.1f MB)", dest.name, dest.stat().st_size / 1e6)
            return dest
        except Exception as exc:  # noqa: BLE001
            log.warning("download attempt %d/%d failed for %s: %s", attempt, retries, url, exc)
            tmp.unlink(missing_ok=True)
            if attempt == retries:
                return None
            time.sleep(BACKOFF_S * attempt)
    return None
