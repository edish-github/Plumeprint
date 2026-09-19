"""Unit tests for the two modules every verdict depends on: time and geometry."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from pipeline.config import WindCfg, load_config
from pipeline.geo import (
    alpha_deg, ang_diff, bearing_deg, circular_mean_deg, destination, haversine_m,
    hour_score, hour_score_arr, is_upwind, sigma_for, wedge_coords,
)
from pipeline.timeutil import aeer_local_to_utc, aeer_series_to_utc, aqs_gmt_to_utc, iso_z

W = WindCfg(sigma_measured=15.0, sigma_modelled=25.0, sigma_light=45.0, light_ms=1.5, calm_ms=0.5)


# ---------------------------------------------------------------- time

def test_cdt_conversion_matches_the_verified_alignment():
    # Incident 399287 began 04/20/2023 08:00 AM local, and the monitor's 43.7 ppb peak
    # carries AQS GMT 13:00 the same day. If this drifts, every match drifts with it.
    assert str(aeer_local_to_utc("04/20/2023 08:00 AM")) == "2023-04-20 13:00:00"


def test_cst_conversion_uses_the_winter_offset():
    assert str(aeer_local_to_utc("01/15/2023 08:00 AM")) == "2023-01-15 14:00:00"


def test_ambiguous_autumn_hour_takes_the_first_pass():
    # 01:30 happens twice on 5 Nov 2023; the first pass is still CDT (UTC-5).
    assert str(aeer_local_to_utc("11/05/2023 01:30 AM")) == "2023-11-05 06:30:00"


def test_nonexistent_spring_hour_shifts_forward():
    # 02:30 does not exist on 12 Mar 2023; shifting forward lands at 03:30 CDT = 08:30 UTC.
    assert str(aeer_local_to_utc("03/12/2023 02:30 AM")) == "2023-03-12 08:30:00"


def test_blank_and_none_timestamps_survive():
    assert aeer_local_to_utc(None) is None
    assert aeer_local_to_utc("   ") is None


def test_series_conversion_agrees_with_the_scalar():
    s = pd.Series(["04/20/2023 08:00 AM", "01/15/2023 08:00 AM", "06/27/2023 11:20 AM"])
    got = aeer_series_to_utc(s)
    want = [aeer_local_to_utc(x) for x in s]
    assert [str(x) for x in got] == [str(x) for x in want]


def test_aqs_gmt_columns_parse_as_utc():
    t = aqs_gmt_to_utc(pd.Series(["2023-04-20"]), pd.Series(["13:00"]))
    assert str(t.iloc[0]) == "2023-04-20 13:00:00"


def test_iso_z_formats_for_the_json_contract():
    assert iso_z(pd.Timestamp("2023-04-20 13:00:00")) == "2023-04-20T13:00:00Z"
    assert iso_z(None) is None


# ---------------------------------------------------------------- geometry

def test_angle_difference_wraps_around_north():
    assert ang_diff(350, 10) == pytest.approx(20)
    assert ang_diff(10, 350) == pytest.approx(20)
    assert ang_diff(0, 180) == pytest.approx(180)


def test_bearing_due_east_is_ninety():
    assert bearing_deg(29.0, -95.0, 29.0, -94.0) == pytest.approx(90, abs=0.5)


def test_bearing_due_north_is_zero():
    assert bearing_deg(29.0, -95.0, 30.0, -95.0) == pytest.approx(0, abs=0.01)


def test_destination_round_trips_with_haversine():
    lat, lon = destination(29.385, -94.93, 145.0, 3000.0)
    assert haversine_m(29.385, -94.93, lat, lon) == pytest.approx(3000, rel=1e-3)
    assert bearing_deg(29.385, -94.93, lat, lon) == pytest.approx(145, abs=0.1)


def test_alpha_grows_as_a_plant_gets_closer():
    assert alpha_deg(700, 3000) == pytest.approx(math.degrees(math.asin(700 / 3000)), abs=1e-9)
    assert alpha_deg(800, 1550) > alpha_deg(700, 3000)


def test_alpha_saturates_when_the_monitor_sits_inside_the_footprint():
    assert alpha_deg(1000, 500) == pytest.approx(90.0)


def test_hour_score_is_one_inside_the_facility_span():
    assert hour_score(145, 5.0, 133, 13.0, "openmeteo", W) == pytest.approx(1.0)


def test_hour_score_falls_off_at_one_sigma():
    # 25 degrees beyond the span, with modelled sigma of 25, is exactly one sigma out.
    assert hour_score(145 + 25, 5.0, 145, 0.0, "openmeteo", W) == pytest.approx(math.exp(-0.5), abs=1e-6)


def test_measured_wind_is_judged_more_strictly_than_modelled():
    assert sigma_for(5.0, "aqs", W) == 15.0
    assert sigma_for(5.0, "openmeteo", W) == 25.0
    assert sigma_for(1.0, "aqs", W) == 45.0        # light wind widens regardless of source
    measured = hour_score(145 + 20, 5.0, 145, 0.0, "aqs", W)
    modelled = hour_score(145 + 20, 5.0, 145, 0.0, "openmeteo", W)
    assert measured < modelled


def test_calm_hours_are_nan_not_zero():
    # Counting a calm hour as zero would quietly punish a facility for windless nights.
    assert math.isnan(hour_score(145, 0.2, 145, 0.0, "aqs", W))
    assert math.isnan(hour_score(None, 5.0, 145, 0.0, "aqs", W))
    assert math.isnan(hour_score(float("nan"), 5.0, 145, 0.0, "aqs", W))


def test_vectorised_scores_match_the_scalar():
    wd = np.array([145.0, 170.0, 300.0, np.nan, 145.0])
    ws = np.array([5.0, 5.0, 5.0, 5.0, 0.2])
    src = np.array(["openmeteo"] * 5)
    got = hour_score_arr(wd, ws, 145.0, 10.0, src, W)
    want = [hour_score(a, b, 145.0, 10.0, "openmeteo", W) for a, b in zip(wd, ws)]
    for g, w in zip(got, want):
        assert (math.isnan(g) and math.isnan(w)) or g == pytest.approx(w)


def test_is_upwind_rejects_nan():
    assert is_upwind(0.9) and not is_upwind(0.2) and not is_upwind(float("nan"))


def test_circular_mean_crosses_north_correctly():
    assert circular_mean_deg(np.array([350.0, 10.0])) == pytest.approx(0, abs=0.01)
    assert circular_mean_deg(np.array([0.0, 90.0]), np.array([1.0, 0.0])) == pytest.approx(0, abs=0.01)
    assert math.isnan(circular_mean_deg(np.array([np.nan])))


def test_wedge_ring_is_closed_and_ordered_lon_lat():
    ring = wedge_coords(29.385, -94.93, 120, 160, 3000, steps=6)
    assert ring[0] == ring[-1] == [-94.93, 29.385]
    assert all(-180 <= lon <= 180 and -90 <= lat <= 90 for lon, lat in ring)


def test_wedge_handles_a_span_that_crosses_north():
    ring = wedge_coords(29.385, -94.93, 350, 10, 2000, steps=4)
    assert ring[0] == ring[-1]


# ---------------------------------------------------------------- config

def test_config_exposes_sites_and_tunables():
    cfg = load_config()
    site = cfg.site("texas-city")
    assert site.primary.id == "48-167-0005"
    assert site.primary.county == "167"
    assert "GALVESTON" in site.aeer_counties
    assert cfg.episode.abs_min_ppb == 5.0
    assert cfg.wind.sigma_modelled > cfg.wind.sigma_measured
    assert "48-201-1039" in cfg.all_monitor_ids       # context monitors are ingested too
