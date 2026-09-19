"""Pipeline runner.

    python -m pipeline.cli all                      every stage, in order
    python -m pipeline.cli s1 s3 s6                 selected stages
    python -m pipeline.cli all --years 2023         one year, for a fast loop
    python -m pipeline.cli check                    acceptance checks only
    python -m pipeline.cli s4 --site texas-city     one site (S4 only)

Stages are addressed by their spec ids so the doc and the code stay in step.
"""

from __future__ import annotations

import argparse
import importlib
import sys
import time

from .logging_setup import get, setup
from .paths import ensure_dirs

log = get("cli")

STAGES: list[tuple[str, str, str]] = [
    ("s1", "pipeline.s1_ingest_aqs", "EPA AQS bulk SO2 and on-site wind"),
    ("s3", "pipeline.s3_ingest_openmeteo", "Open-Meteo modelled wind"),
    ("s4", "pipeline.s4_scrape_aeer", "TCEQ self-reported emission events"),
    ("s5", "pipeline.s5_facilities", "Facility registry and geocoding"),
    ("s6", "pipeline.s6_normalize", "One UTC hour index, one wind source"),
    ("s7", "pipeline.s7_episodes", "Episode detection"),
    ("s8", "pipeline.s8_fingerprint", "Directional fingerprint"),
    ("s9", "pipeline.s9_reconcile", "Two-way reconciliation and verdicts"),
    ("s10", "pipeline.s10_coverage", "Monitor coverage and blind spots"),
    ("s11", "pipeline.s11_export", "JSON contract for the web app"),
    ("s12", "pipeline.s12_validate", "Golden-number validation"),
]
BY_ID = {sid: (mod, desc) for sid, mod, desc in STAGES}


def _load(stage_id: str):
    mod_name, _ = BY_ID[stage_id]
    try:
        return importlib.import_module(mod_name)
    except ModuleNotFoundError as exc:
        if exc.name == mod_name:
            return None
        raise


def run_stage(stage_id: str, **kwargs) -> bool:
    mod = _load(stage_id)
    if mod is None:
        log.warning("%s not implemented yet, skipping", stage_id)
        return True
    fn = getattr(mod, "run", None)
    if fn is None:
        log.warning("%s has no run(), skipping", stage_id)
        return True

    import inspect

    accepted = inspect.signature(fn).parameters
    passed = {k: v for k, v in kwargs.items() if k in accepted and v is not None}
    started = time.time()
    log.info("=== %s  %s", stage_id, BY_ID[stage_id][1])
    fn(**passed)
    log.info("=== %s done in %.1fs", stage_id, time.time() - started)
    return check_stage(stage_id)


def check_stage(stage_id: str) -> bool:
    mod = _load(stage_id)
    if mod is None or not hasattr(mod, "acceptance"):
        return True
    ok_all = True
    for name, ok, detail in mod.acceptance():
        print(f"  {'PASS' if ok else 'FAIL'}  {stage_id}  {name}   {detail}")
        ok_all &= ok
    return ok_all


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="pipeline")
    ap.add_argument("stages", nargs="+", help="stage ids, 'all', or 'check'")
    ap.add_argument("--years", type=int, nargs="+", default=None)
    ap.add_argument("--site", dest="sites", nargs="+", default=None)
    ap.add_argument("--force", action="store_true", help="ignore caches and refetch")
    ap.add_argument("--skip-osm", action="store_true",
                    help="S5: skip the Overpass footprint lookup (it is often overloaded)")
    ap.add_argument("--keep-going", action="store_true", help="continue past a failed check")
    ap.add_argument("--log", default=None)
    args = ap.parse_args(argv)

    setup(args.log)
    ensure_dirs()

    if args.stages == ["check"]:
        return 0 if all(check_stage(sid) for sid, _, _ in STAGES) else 1

    wanted = [sid for sid, _, _ in STAGES] if "all" in args.stages else args.stages
    unknown = [s for s in wanted if s not in BY_ID]
    if unknown:
        ap.error(f"unknown stages {unknown}; choose from {list(BY_ID)}")

    failed = []
    for sid in wanted:
        if not run_stage(sid, years=args.years, sites=args.sites, force=args.force,
                         skip_osm=args.skip_osm or None):
            failed.append(sid)
            if not args.keep_going:
                log.error("acceptance failed at %s; stopping (use --keep-going to continue)", sid)
                return 1
    if failed:
        log.error("acceptance failed: %s", ", ".join(failed))
        return 1
    log.info("all requested stages passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
