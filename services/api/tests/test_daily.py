"""Tests for the daily summaries and the resolution of "now"."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.planning.daily import current_index, local_date, summarise_days
from app.planning.models import ForecastHour

# Istanbul is UTC+3, so local midnight is 21:00 UTC the day before — the case that
# breaks anything grouping by the UTC date.
BASE_UTC = datetime(2026, 8, 26, 21, 0, tzinfo=UTC)


def hour(offset: int, *, temp: float = 20.0, code: int = 0, precip: int = 0) -> ForecastHour:
    utc = BASE_UTC + timedelta(hours=offset)
    return ForecastHour(
        hour_utc=utc,
        local_hour=(utc.hour + 3) % 24,
        temperature_c=temp,
        precip_prob_pct=precip,
        precip_mm=0.0,
        wind_kmh=5.0,
        uv_index=0.0,
        cloud_cover_pct=0,
        weather_code=code,
    )


class TestLocalDate:
    def test_local_midnight_belongs_to_the_local_day(self) -> None:
        """21:00 UTC is already tomorrow in Istanbul."""
        assert local_date(hour(0)) == "2026-08-27"
        assert hour(0).hour_utc.date().isoformat() == "2026-08-26"

    def test_a_day_is_twenty_four_consecutive_hours(self) -> None:
        dates = {local_date(hour(i)) for i in range(24)}
        assert dates == {"2026-08-27"}
        assert local_date(hour(24)) == "2026-08-28"


class TestSummariseDays:
    def test_one_summary_per_local_day(self) -> None:
        days = summarise_days([hour(i) for i in range(72)])
        assert [d.date for d in days] == ["2026-08-27", "2026-08-28", "2026-08-29"]

    def test_high_and_low_come_from_the_day_they_belong_to(self) -> None:
        hours = [hour(i, temp=20.0) for i in range(48)]
        hours[5] = hour(5, temp=31.5)  # 02:00 local on day one
        hours[30] = hour(30, temp=8.0)  # day two
        days = summarise_days(hours)

        assert days[0].temp_max_c == 31.5
        assert days[0].temp_min_c == 20.0
        assert days[1].temp_min_c == 8.0

    def test_precipitation_is_the_day_maximum(self) -> None:
        hours = [hour(i) for i in range(24)]
        hours[12] = hour(12, precip=80)
        assert summarise_days(hours)[0].precip_prob_max_pct == 80


class TestHeadlineCode:
    def test_the_most_significant_daylight_condition_wins(self) -> None:
        hours = [hour(i, code=1) for i in range(24)]
        hours[12] = hour(12, code=61)  # rain at 15:00 local
        assert summarise_days(hours)[0].weather_code == 61

    def test_night_weather_does_not_headline_the_day(self) -> None:
        """Fog that clears before dawn is not what the day was like."""
        hours = [hour(i, code=1) for i in range(24)]
        hours[0] = hour(0, code=45)  # 00:00 local
        hours[2] = hour(2, code=45)  # 02:00 local
        assert summarise_days(hours)[0].weather_code == 1

    def test_a_day_with_no_daylight_hours_still_reports_something(self) -> None:
        """A forecast can start mid-evening; the day should not come back blank."""
        hours = [hour(i, code=3) for i in range(20, 24)]
        assert summarise_days(hours)[0].weather_code == 3


class TestCurrentIndex:
    def test_finds_the_hour_in_progress(self) -> None:
        hours = [hour(i) for i in range(24)]
        assert current_index(hours, BASE_UTC + timedelta(hours=5, minutes=42)) == 5

    def test_the_boundary_belongs_to_the_hour_it_opens(self) -> None:
        hours = [hour(i) for i in range(24)]
        assert current_index(hours, BASE_UTC + timedelta(hours=6)) == 6

    def test_returns_none_before_the_forecast_starts(self) -> None:
        hours = [hour(i) for i in range(24)]
        assert current_index(hours, BASE_UTC - timedelta(hours=1)) is None

    def test_returns_none_after_the_forecast_ends(self) -> None:
        hours = [hour(i) for i in range(24)]
        assert current_index(hours, BASE_UTC + timedelta(days=3)) is None

    def test_returns_none_for_an_empty_forecast(self) -> None:
        assert current_index([], BASE_UTC) is None
