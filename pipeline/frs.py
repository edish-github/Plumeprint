"""Where a facility actually is, and how big it is.

The bearing test needs two things per facility: a centroid and a footprint radius. A
filed street address gives neither reliably, and inventing coordinates would quietly
corrupt every verdict, so both come from public records:

  centroid   EPA ECHO / FRS, resolved by the facility's own TCEQ RN number, so the join
             is exact rather than fuzzy. ECHO also reports its own coordinate accuracy.
  footprint  OpenStreetMap industrial polygons around that point. A refinery covering two
             kilometres subtends a far wider angle than a compressor station, and using a
             flat default would judge them identically.

Both are cached. Anything that fails to resolve is recorded as such, never guessed.
"""

from __future__ import annotations

import json
import math
import urllib.parse

from .geo import haversine_m
from .http import get_text, session
from .logging_setup import get
from .paths import RAW_GEOCODE

log = get("frs")

FRS_PROGRAM = "https://data.epa.gov/efservice/frs_program_facility/pgm_sys_id/{rn}/JSON"
ECHO_DFR = "https://echodata.epa.gov/echo/dfr_rest_services.get_dfr"
NOMINATIM = "https://nominatim.openstreetmap.org/search"

# The main Overpass endpoint refuses often enough that a mirror is the default.
OVERPASS_ENDPOINTS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
OVERPASS_RADIUS_M = 1500      # search window around the FRS point
MAX_FOOTPRINT_M = 3000        # a plausible ceiling for one industrial complex
MIN_FOOTPRINT_M = 60          # below this the "footprint" is noise
NEARBY_CENTROID_M = 1200      # how far a non-containing polygon may sit and still count

# A bare ["industrial"] clause makes Overpass scan an unindexed key and time out, so the
# query stays on the two tags that actually carry plant boundaries.
INDUSTRIAL_TAGS = [
    '["landuse"="industrial"]',
    '["man_made"="works"]',
]


# ----------------------------------------------------------------- EPA

def frs_registry_id(rn: str, force: bool = False) -> tuple[str | None, str | None]:
    """TCEQ RN number -> (FRS registry id, FRS primary name)."""
    cache = RAW_GEOCODE / f"frs_{rn}.json"
    # A missing RN answers 500 every time, so retrying only spends the clock.
    text = get_text(FRS_PROGRAM.format(rn=rn), cache=cache, force=force, sleep=0.3, retries=1)
    if not text:
        return None, None
    try:
        rows = json.loads(text)
    except json.JSONDecodeError:
        cache.unlink(missing_ok=True)
        return None, None
    if not rows:
        return None, None
    air = [r for r in rows if (r.get("pgm_sys_acrnm") or "").upper().startswith("TX")] or rows
    return air[0].get("registry_id"), air[0].get("primary_name")


def echo_coordinates(registry_id: str, force: bool = False) -> dict | None:
    """ECHO detailed facility report -> centroid and ECHO's own accuracy note."""
    cache = RAW_GEOCODE / f"echo_{registry_id}.json"
    text = get_text(ECHO_DFR, cache=cache, force=force, sleep=0.5, retries=2,
                    params={"output": "JSON", "p_id": registry_id})
    if not text:
        return None
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        cache.unlink(missing_ok=True)
        return None
    results = payload.get("Results") or {}
    spatial = results.get("SpatialMetadata") or {}
    lat = spatial.get("Latitude83") or (results.get("MapOutput") or {}).get("CenterLatitude")
    lon = spatial.get("Longitude83") or (results.get("MapOutput") or {}).get("CenterLongitude")
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    return {"lat": lat, "lon": lon,
            "accuracy": spatial.get("CalculatedAccuracy"),
            "method": spatial.get("CollectionMethod"),
            "source": "echo_frs"}


def nominatim(address: str, rn: str, force: bool = False) -> dict | None:
    """Last-resort centroid from the filed street address.

    Weaker than FRS: a street address is the plant's mailing point, not its centroid, and
    many small sites file driving directions instead of an address. Labelled accordingly
    so S9 can decline to award MATCHED on it alone.
    """
    if not address or len(address) > 120 or address.upper().startswith("FROM "):
        return None
    cache = RAW_GEOCODE / f"nom_{rn}.json"
    text = get_text(NOMINATIM, cache=cache, force=force, sleep=1.1, retries=2,
                    params={"q": address, "format": "json", "limit": 1, "countrycodes": "us"})
    if not text:
        return None
    try:
        hits = json.loads(text)
    except json.JSONDecodeError:
        cache.unlink(missing_ok=True)
        return None
    if not hits:
        return None
    return {"lat": float(hits[0]["lat"]), "lon": float(hits[0]["lon"]),
            "source": "nominatim_address"}


# ----------------------------------------------------------------- OSM

def _ring_metrics(points: list[tuple[float, float]]) -> tuple[float, float, float]:
    """(centroid lat, centroid lon, max distance from centroid to any vertex)."""
    clat = sum(p[0] for p in points) / len(points)
    clon = sum(p[1] for p in points) / len(points)
    radius = max(haversine_m(clat, clon, p[0], p[1]) for p in points)
    return clat, clon, radius


def _contains(points: list[tuple[float, float]], lat: float, lon: float) -> bool:
    """Ray casting in lat/lon space; adequate at the scale of one industrial site."""
    inside = False
    n = len(points)
    for i in range(n):
        y1, x1 = points[i]
        y2, x2 = points[(i + 1) % n]
        if (y1 > lat) != (y2 > lat):
            xint = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if lon < xint:
                inside = not inside
    return inside


_OVERPASS_FAILURES = 0
OVERPASS_GIVE_UP_AFTER = 3


def _overpass(query: str, cache_key: str, force: bool = False) -> dict | None:
    global _OVERPASS_FAILURES
    cache = RAW_GEOCODE / f"osm_{cache_key}.json"
    if cache.exists() and cache.stat().st_size > 0 and not force:
        try:
            return json.loads(cache.read_text())
        except json.JSONDecodeError:
            cache.unlink()
    if _OVERPASS_FAILURES >= OVERPASS_GIVE_UP_AFTER:
        return None            # every call costs a 75 s timeout; stop after a clear pattern
    body = urllib.parse.urlencode({"data": query})
    sess = session({"Content-Type": "application/x-www-form-urlencoded"})
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            r = sess.post(endpoint, data=body, timeout=(15, 75))
            if r.status_code != 200:
                log.warning("overpass %s -> HTTP %s", endpoint.split("/")[2], r.status_code)
                continue
            payload = r.json()
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(payload))
            return payload
        except Exception as exc:  # noqa: BLE001
            log.warning("overpass %s failed: %s", endpoint.split("/")[2], exc)
    _OVERPASS_FAILURES += 1
    if _OVERPASS_FAILURES == OVERPASS_GIVE_UP_AFTER:
        log.warning("overpass unavailable after %d attempts; footprints fall back to "
                    "class defaults for this run", _OVERPASS_FAILURES)
    return None


def osm_footprint(lat: float, lon: float, cache_key: str, force: bool = False) -> dict | None:
    """Radius of the industrial polygon this point sits in, from OpenStreetMap.

    Preference order: the largest polygon containing the point (a plant complex usually
    encloses its own sub-areas), then the nearest polygon whose centroid is close enough
    to be the same site.
    """
    clauses = "\n".join(
        f"  {kind}(around:{OVERPASS_RADIUS_M},{lat},{lon}){tag};"
        for tag in INDUSTRIAL_TAGS for kind in ("way", "relation")
    )
    payload = _overpass(f"[out:json][timeout:60];\n(\n{clauses}\n);\nout geom;", cache_key, force)
    if not payload:
        return None

    best_containing: dict | None = None
    best_nearby: dict | None = None
    for el in payload.get("elements", []):
        if "geometry" in el:
            pts = [(p["lat"], p["lon"]) for p in el["geometry"]]
        else:
            pts = [(p["lat"], p["lon"]) for m in el.get("members", []) for p in m.get("geometry", [])]
        if len(pts) < 3:
            continue
        clat, clon, radius = _ring_metrics(pts)
        if not math.isfinite(radius) or radius < MIN_FOOTPRINT_M:
            continue
        radius = min(radius, MAX_FOOTPRINT_M)
        cand = {"radius_m": round(radius, 1), "osm_id": f"{el['type']}/{el['id']}",
                "osm_name": (el.get("tags") or {}).get("name"),
                "centroid_lat": round(clat, 6), "centroid_lon": round(clon, 6),
                "n_points": len(pts)}
        if _contains(pts, lat, lon):
            if best_containing is None or radius > best_containing["radius_m"]:
                cand["fit"] = "contains_point"
                best_containing = cand
        else:
            dist = haversine_m(lat, lon, clat, clon)
            if dist <= NEARBY_CENTROID_M and (best_nearby is None or dist < best_nearby["_dist"]):
                cand["fit"] = "nearby"
                cand["_dist"] = dist
                best_nearby = cand

    chosen = best_containing or best_nearby
    if chosen:
        chosen.pop("_dist", None)
    return chosen


def resolve(rn: str, name: str, address: str | None = None, force: bool = False) -> dict:
    """Centroid resolution for one facility. Missing pieces stay missing."""
    out: dict = {"rn": rn, "lat": None, "lon": None, "radius_m": None,
                 "coord_source": "none", "footprint_source": "none",
                 "frs_registry_id": None, "frs_name": None, "osm_id": None,
                 "echo_accuracy": None}

    registry_id, frs_name = frs_registry_id(rn, force=force)
    out["frs_registry_id"], out["frs_name"] = registry_id, frs_name

    coords = echo_coordinates(registry_id, force=force) if registry_id else None
    if not coords:
        coords = nominatim(address or "", rn, force=force)
        if coords:
            log.info("%s (%s) placed from its filed address", rn, name)
    if not coords:
        log.warning("no coordinates for %s (%s)", rn, name)
        return out
    out.update(lat=coords["lat"], lon=coords["lon"], coord_source=coords["source"],
               echo_accuracy=coords.get("accuracy"))

    # Footprint is deliberately NOT resolved here: S5 owns that decision so it can be
    # skipped when Overpass is overloaded without touching the coordinate lookup.
    return out
