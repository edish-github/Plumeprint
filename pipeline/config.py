"""Load config/sites.yaml into typed objects.

Every tunable lives in the YAML. Stages read these objects, never literals.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from .paths import CONFIG_DIR


@dataclass(frozen=True)
class Pollutant:
    name: str
    aqs_param: str
    report_label: str
    units: str


@dataclass(frozen=True)
class EpisodeCfg:
    abs_min_ppb: float
    pct: float
    merge_gap_h: int
    severe_ppb: float


@dataclass(frozen=True)
class FingerprintCfg:
    bin_deg: int
    top_pct: float
    min_ws_ms: float
    min_hours_per_bin: int
    bootstrap_n: int
    ci: tuple[float, float]
    lobe_frac: float


@dataclass(frozen=True)
class MatchCfg:
    lead_h: int
    lag_h: int
    min_time_share: float
    min_bearing: float
    long_report_days: int
    spec_hours: float
    spec_floor: float


@dataclass(frozen=True)
class VisibilityCfg:
    min_lb: float
    faint_delta_ppb: float
    min_data_share: float
    upwind_share: float


@dataclass(frozen=True)
class WindCfg:
    sigma_measured: float
    sigma_modelled: float
    sigma_light: float
    light_ms: float
    calm_ms: float


@dataclass(frozen=True)
class GeocodeCfg:
    max_km_from_monitor: float


@dataclass(frozen=True)
class FootprintCfg:
    default_m: float
    by_keyword: tuple[tuple[str, float], ...]

    def radius_for(self, name: str | None) -> tuple[float, str]:
        """(radius, source) for a facility name. First keyword hit wins."""
        low = (name or "").lower()
        for kw, radius in self.by_keyword:
            if kw in low:
                return radius, f"default_by_class:{kw}"
        return self.default_m, "default_generic"


@dataclass(frozen=True)
class RegionalCfg:
    top_pct: float
    min_share_hours: float
    min_monitors_share: float


@dataclass(frozen=True)
class Monitor:
    id: str
    role: str

    @property
    def state(self) -> str:
        return self.id.split("-")[0]

    @property
    def county(self) -> str:
        return self.id.split("-")[1]

    @property
    def site_num(self) -> str:
        return self.id.split("-")[2]


@dataclass(frozen=True)
class Site:
    id: str
    name: str
    tz: str
    aeer_counties: tuple[str, ...]
    monitors: tuple[Monitor, ...]
    context_monitors: tuple[str, ...]

    @property
    def primary(self) -> Monitor:
        for m in self.monitors:
            if m.role == "primary":
                return m
        return self.monitors[0]


@dataclass(frozen=True)
class Config:
    years: tuple[int, ...]
    pollutant: Pollutant
    episode: EpisodeCfg
    fingerprint: FingerprintCfg
    match: MatchCfg
    visibility: VisibilityCfg
    wind: WindCfg
    geocode: GeocodeCfg
    footprint: FootprintCfg
    regional: RegionalCfg
    sites: tuple[Site, ...]
    raw: dict[str, Any] = field(repr=False, default_factory=dict)

    def site(self, site_id: str) -> Site:
        for s in self.sites:
            if s.id == site_id:
                return s
        raise KeyError(f"unknown site {site_id!r}; have {[s.id for s in self.sites]}")

    def monitor_site(self, monitor_id: str) -> Site | None:
        """The site a monitor belongs to, if any (context monitors do not count)."""
        for s in self.sites:
            if any(m.id == monitor_id for m in s.monitors):
                return s
        return None

    @property
    def all_monitor_ids(self) -> list[str]:
        """Primary, secondary and context monitors, deduplicated, in config order."""
        out: list[str] = []
        for s in self.sites:
            for m in s.monitors:
                if m.id not in out:
                    out.append(m.id)
            for cid in s.context_monitors:
                if cid not in out:
                    out.append(cid)
        return out


@lru_cache(maxsize=4)
def load_config(path: str | Path | None = None) -> Config:
    p = Path(path) if path else CONFIG_DIR / "sites.yaml"
    raw = yaml.safe_load(p.read_text())
    d = raw["defaults"]
    sites = tuple(
        Site(
            id=s["id"],
            name=s["name"],
            tz=s["tz"],
            aeer_counties=tuple(c.upper() for c in s["aeer_counties"]),
            monitors=tuple(Monitor(id=m["id"], role=m.get("role", "secondary")) for m in s["monitors"]),
            context_monitors=tuple(s.get("context_monitors", []) or ()),
        )
        for s in raw["sites"]
    )
    return Config(
        years=tuple(d["years"]),
        pollutant=Pollutant(**d["pollutant"]),
        episode=EpisodeCfg(**d["episode"]),
        fingerprint=FingerprintCfg(**{**d["fingerprint"], "ci": tuple(d["fingerprint"]["ci"])}),
        match=MatchCfg(**d["match"]),
        visibility=VisibilityCfg(**d["visibility"]),
        wind=WindCfg(**d["wind"]),
        geocode=GeocodeCfg(**d["geocode"]),
        footprint=FootprintCfg(
            default_m=float(d["footprint"]["default_m"]),
            by_keyword=tuple((r["match"].lower(), float(r["radius_m"]))
                             for r in d["footprint"]["by_keyword"]),
        ),
        regional=RegionalCfg(**d["regional"]),
        sites=sites,
        raw=raw,
    )
