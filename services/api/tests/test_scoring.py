"""Tests for the scoring engine.

The engine is the one part of the system that must be right without a model present, so
it is the one part with real coverage from the start.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.planning.models import Activity, ActivityProfile, ForecastHour
from app.planning.scoring import (
    WINDOW_THRESHOLD,
    dominant_blocker,
    find_windows,
    plan,
    rank_windows,
    score_hour,
    score_hours,
)

MORNING_RUNNER = ActivityProfile(
    activity=Activity.RUNNING,
    temp_min=5,
    temp_max=26,
    wind_max_kmh=15,
    precip_max_pct=20,
    preferred_hours=(6, 10),
    uv_max=6,
)

BASE = datetime(2026, 8, 21, 0, 0, tzinfo=UTC)


def hour(
    local_hour: int,
    *,
    temp: float = 20.0,
    wind: float = 5.0,
    precip: int = 0,
    uv: float = 0.0,
    code: int = 0,
    index: int | None = None,
) -> ForecastHour:
    """A benign hour, with only what a test cares about overridden."""
    offset = local_hour if index is None else index
    return ForecastHour(
        hour_utc=BASE + timedelta(hours=offset),
        local_hour=local_hour,
        temperature_c=temp,
        precip_prob_pct=precip,
        precip_mm=0.0,
        wind_kmh=wind,
        uv_index=uv,
        cloud_cover_pct=0,
        weather_code=code,
    )


class TestScoreHour:
    def test_ideal_hour_scores_full_marks(self) -> None:
        result = score_hour(hour(7, temp=18, wind=6), MORNING_RUNNER)
        assert result.score == 100.0
        assert result.penalties == {}

    def test_penalties_name_what_they_are(self) -> None:
        result = score_hour(hour(8, temp=32, wind=30, precip=60, uv=9), MORNING_RUNNER)
        assert set(result.penalties) == {"temperature", "wind", "precipitation", "uv"}

    def test_score_is_clamped_at_zero(self) -> None:
        result = score_hour(hour(8, temp=45, wind=90, precip=100), MORNING_RUNNER)
        assert result.score == 0.0

    def test_cold_is_penalised_like_heat(self) -> None:
        cold = score_hour(hour(7, temp=0), MORNING_RUNNER)
        hot = score_hour(hour(7, temp=31), MORNING_RUNNER)
        assert cold.score == hot.score

    def test_uv_is_ignored_when_the_person_did_not_say(self) -> None:
        indifferent = ActivityProfile(
            activity=Activity.RUNNING,
            temp_min=5,
            temp_max=26,
            wind_max_kmh=15,
            precip_max_pct=20,
            preferred_hours=(6, 10),
            uv_max=None,
        )
        assert "uv" not in score_hour(hour(7, uv=11), indifferent).penalties


class TestHardExclusions:
    @pytest.mark.parametrize("code", [56, 57, 66, 67, 95, 96, 99])
    def test_severe_weather_excludes_an_otherwise_perfect_hour(self, code: int) -> None:
        result = score_hour(hour(7, temp=18, wind=4, code=code), MORNING_RUNNER)
        assert result.excluded
        assert result.score == 0.0

    def test_ordinary_rain_is_a_penalty_not_an_exclusion(self) -> None:
        result = score_hour(hour(7, precip=80, code=61), MORNING_RUNNER)
        assert not result.excluded
        assert "precipitation" in result.penalties


class TestTimeOfDay:
    """The regression this engine was built around.

    Scoring with only the comfort terms made 03:00 the best hour of the week: nights are
    cool and calm, so they scored perfectly. `preferred_hours` was in the profile and
    missing from the formula. See docs/04.
    """

    def test_a_perfect_night_never_beats_a_good_morning(self) -> None:
        night = score_hour(hour(3, temp=18, wind=2, uv=0), MORNING_RUNNER)
        morning = score_hour(hour(7, temp=22, wind=10, uv=3), MORNING_RUNNER)
        assert morning.score > night.score

    def test_the_small_hours_never_clear_the_window_threshold(self) -> None:
        for local_hour in [0, 1, 2, 3, 4, 5, 21, 22, 23]:
            result = score_hour(hour(local_hour, temp=18, wind=2), MORNING_RUNNER)
            assert result.score < WINDOW_THRESHOLD, f"{local_hour}:00 cleared the threshold"

    def test_preferred_hours_cost_nothing(self) -> None:
        for local_hour in range(6, 11):
            result = score_hour(hour(local_hour, temp=18, wind=4), MORNING_RUNNER)
            assert "time_of_day" not in result.penalties

    def test_penalty_grows_with_distance_from_the_preferred_range(self) -> None:
        near = score_hour(hour(12, temp=18, wind=4), MORNING_RUNNER)
        far = score_hour(hour(16, temp=18, wind=4), MORNING_RUNNER)
        assert near.score > far.score


class TestWindows:
    def test_a_single_good_hour_is_not_a_window(self) -> None:
        scored = score_hours(
            [hour(6, index=0), hour(15, temp=35, index=1), hour(7, index=2)], MORNING_RUNNER
        )
        assert find_windows(scored) == []

    def test_one_bad_hour_splits_a_window(self) -> None:
        hours = [
            hour(6, index=0),
            hour(7, index=1),
            hour(8, temp=40, index=2),
            hour(9, index=3),
            hour(10, index=4),
        ]
        windows = find_windows(score_hours(hours, MORNING_RUNNER))
        assert len(windows) == 2
        assert [w.length_hours for w in windows] == [2, 2]

    def test_an_excluded_hour_splits_a_window_even_at_a_high_score(self) -> None:
        hours = [
            hour(6, index=0),
            hour(7, index=1),
            hour(8, temp=18, wind=2, code=95, index=2),
            hour(9, index=3),
            hour(10, index=4),
        ]
        assert len(find_windows(score_hours(hours, MORNING_RUNNER))) == 2

    def test_a_window_reports_its_own_span(self) -> None:
        hours = [hour(6, index=0), hour(7, index=1), hour(8, index=2)]
        window = find_windows(score_hours(hours, MORNING_RUNNER))[0]
        assert (window.start_hour, window.end_hour) == (6, 8)
        assert window.day == "2026-08-21"


class TestRanking:
    def test_higher_mean_score_wins(self) -> None:
        good = [hour(6, index=0), hour(7, index=1)]
        better = [hour(8, temp=18, wind=2, index=2), hour(9, temp=18, wind=2, index=3)]
        windows = find_windows(score_hours([*good, hour(20, index=9), *better], MORNING_RUNNER))
        assert rank_windows(windows)[0].mean_score == max(w.mean_score for w in windows)

    def test_length_breaks_a_tie(self) -> None:
        short = [hour(6, index=0), hour(7, index=1)]
        gap = [hour(23, index=2)]
        long = [hour(8, index=3), hour(9, index=4), hour(10, index=5)]
        windows = find_windows(score_hours([*short, *gap, *long], MORNING_RUNNER))
        assert rank_windows(windows)[0].length_hours == 3


class TestDominantBlocker:
    def test_names_the_constraint_that_cost_the_most_hours(self) -> None:
        hours = [hour(h, wind=40, index=h) for h in range(6, 11)]
        hours.append(hour(11, temp=40, index=11))
        blocker = dominant_blocker(score_hours(hours, MORNING_RUNNER))
        assert blocker is not None
        name, count = blocker
        assert name == "wind"
        assert count == 5

    def test_returns_nothing_when_every_hour_clears(self) -> None:
        hours = [hour(h, index=h) for h in range(6, 11)]
        assert dominant_blocker(score_hours(hours, MORNING_RUNNER)) is None

    def test_never_reports_time_of_day(self) -> None:
        """The one penalty that is not weather.

        Over a whole week most hours are outside anyone's preferred range, so counting
        them makes `time_of_day` the honest answer every time — and "it was night" is
        not a finding a person can act on.
        """
        night = [hour(h, temp=18, wind=2, index=h) for h in range(0, 6)]
        windy_morning = [hour(h, wind=40, index=h) for h in range(6, 9)]
        blocker = dominant_blocker(score_hours([*night, *windy_morning], MORNING_RUNNER))
        assert blocker == ("wind", 3)

    def test_ignores_bad_weather_outside_the_hours_the_person_would_go_out(self) -> None:
        good_morning = [hour(h, index=h) for h in range(6, 11)]
        vile_afternoon = [hour(h, wind=70, temp=41, index=h) for h in range(13, 20)]
        assert (
            dominant_blocker(score_hours([*good_morning, *vile_afternoon], MORNING_RUNNER))
            is None
        )


class TestPlan:
    def test_returns_ranked_windows_and_the_blocker_together(self) -> None:
        """Both halves of an answer: what is open, and what closed the rest.

        The bad weather has to fall *inside* the preferred hours to count — weather at
        16:00 is not what stopped a person who only runs before 10.
        """
        good_day = [hour(h, index=h) for h in range(6, 11)]
        hot_day = [hour(h, temp=38, index=h + 24) for h in range(6, 11)]
        windows, blocker = plan([*good_day, *hot_day], MORNING_RUNNER)
        assert len(windows) == 1
        assert blocker is not None
        assert blocker[0] == "temperature"

    def test_no_windows_still_explains_itself(self) -> None:
        hours = [hour(h, wind=60, index=h) for h in range(24)]
        windows, blocker = plan(hours, MORNING_RUNNER)
        assert windows == []
        assert blocker is not None
        assert blocker[0] == "wind"
