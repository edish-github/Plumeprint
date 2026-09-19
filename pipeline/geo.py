"""Geometry for the bearing test (implementation spec section 5.5, diagram 16).

Wind direction is meteorological throughout: the direction the wind comes FROM.
A facility is "upwind" for an hour when the wind arrives from its direction, allowing
for the plant's own angular width and the uncertainty of the wind measurement.
"""

from __future__ import annotations

import math

import numpy as np

from .config import WindCfg

EARTH_R_M = 6_371_008.8


def ang_diff(a: float, b: float) -> float:
    """Smallest absolute angle between two bearings, in degrees (0..180)."""
    return abs((a - b + 180.0) % 360.0 - 180.0)


def ang_diff_arr(a: np.ndarray, b: float) -> np.ndarray:
    return np.abs((a - b + 180.0) % 360.0 - 180.0)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R_M * math.asin(min(1.0, math.sqrt(h)))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial great-circle bearing from point 1 to point 2, degrees clockwise from north."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def destination(lat: float, lon: float, bearing: float, dist_m: float) -> tuple[float, float]:
    """Point reached from (lat, lon) travelling dist_m along a bearing."""
    d = dist_m / EARTH_R_M
    p1, b = math.radians(lat), math.radians(bearing)
    l1 = math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b))
    l2 = l1 + math.atan2(
        math.sin(b) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2)
    )
    return math.degrees(p2), (math.degrees(l2) + 540.0) % 360.0 - 180.0


def alpha_deg(radius_m: float, dist_m: float) -> float:
    """Half the angular width a facility of radius_m subtends at dist_m.

    A plant whose footprint contains the monitor subtends the full 90 degrees.
    """
    if dist_m <= 0 or radius_m <= 0:
        return 0.0
    return math.degrees(math.asin(min(1.0, radius_m / max(dist_m, 1.0))))


def sigma_for(ws_ms: float, wind_source: str, w: WindCfg) -> float:
    """Angular uncertainty of one hour's wind direction, in degrees."""
    if ws_ms < w.light_ms:
        return w.sigma_light
    return w.sigma_measured if wind_source == "aqs" else w.sigma_modelled


def hour_score(
    wd_deg: float | None,
    ws_ms: float | None,
    beta_deg: float,
    alpha: float,
    wind_source: str,
    w: WindCfg,
) -> float:
    """How well one hour's wind points from a facility to the monitor, 0..1.

    NaN means the hour carries no directional information (calm or missing) and must be
    excluded from averages rather than counted as zero.
    """
    if wd_deg is None or ws_ms is None:
        return float("nan")
    if not np.isfinite(wd_deg) or not np.isfinite(ws_ms):
        return float("nan")
    if ws_ms < w.calm_ms:
        return float("nan")
    sigma = sigma_for(ws_ms, wind_source, w)
    delta = max(0.0, ang_diff(wd_deg, beta_deg) - alpha)
    return float(math.exp(-0.5 * (delta / sigma) ** 2))


def hour_score_arr(
    wd: np.ndarray, ws: np.ndarray, beta_deg: float, alpha: float, sources: np.ndarray, w: WindCfg
) -> np.ndarray:
    """Vectorised hour_score over a run of hours."""
    wd = np.asarray(wd, dtype=float)
    ws = np.asarray(ws, dtype=float)
    sigma = np.where(
        ws < w.light_ms,
        w.sigma_light,
        np.where(np.asarray(sources) == "aqs", w.sigma_measured, w.sigma_modelled),
    )
    delta = np.maximum(0.0, ang_diff_arr(wd, beta_deg) - alpha)
    out = np.exp(-0.5 * (delta / sigma) ** 2)
    bad = ~np.isfinite(wd) | ~np.isfinite(ws) | (ws < w.calm_ms)
    return np.where(bad, np.nan, out)


def is_upwind(score: float, threshold: float = 0.5) -> bool:
    return bool(np.isfinite(score) and score >= threshold)


def circular_mean_deg(deg: np.ndarray, weights: np.ndarray | None = None) -> float:
    """Weighted circular mean of bearings. Bearings do not average arithmetically."""
    deg = np.asarray(deg, dtype=float)
    ok = np.isfinite(deg)
    if weights is None:
        wts = np.ones_like(deg)
    else:
        wts = np.asarray(weights, dtype=float)
        ok &= np.isfinite(wts)
    if not ok.any():
        return float("nan")
    r = np.radians(deg[ok])
    wts = wts[ok]
    return float((math.degrees(math.atan2((wts * np.sin(r)).sum(), (wts * np.cos(r)).sum())) + 360.0) % 360.0)


def wedge_coords(
    lat: float, lon: float, b0: float, b1: float, r_m: float, steps: int = 12
) -> list[list[float]]:
    """Closed GeoJSON ring [lon, lat] for a wind wedge, used by the map and the rose."""
    if b1 < b0:
        b1 += 360.0
    ring = [[lon, lat]]
    for i in range(steps + 1):
        b = b0 + (b1 - b0) * i / steps
        plat, plon = destination(lat, lon, b % 360.0, r_m)
        ring.append([plon, plat])
    ring.append([lon, lat])
    return ring
