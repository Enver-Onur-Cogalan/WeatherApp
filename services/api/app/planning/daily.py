"""Per-day summaries, and where "now" falls in a forecast.

Pure derivations from the hours, beside the scoring engine for the same reason it lives
here: no I/O, no model, and the client never aggregates a forecast itself.

ADR-0007's rule outlives the language model. If the client computed a day's high from
whatever hours it happened to hold, two screens showing the same day could disagree —
and the wrong one would look exactly as confident as the right one.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from .models import ForecastHour

# What counts as daylight for a headline condition. Fog that clears by 05:00 should not
# be the label on an otherwise sunny day.
DAYLIGHT_FROM = 6
DAYLIGHT_TO = 20

ONE_HOUR = timedelta(hours=1)


@dataclass(frozen=True, slots=True)
class DaySummary:
    date: str
    temp_min_c: float
    temp_max_c: float
    weather_code: int
    precip_prob_max_pct: int


def local_date(hour: ForecastHour) -> str:
    """The calendar date this hour belongs to where it happens.

    Derived per hour rather than from one offset for the whole forecast, so a week that
    crosses a daylight-saving change still groups correctly: each hour carries its own
    `local_hour`, and the difference from its UTC hour is that hour's own offset.
    """
    offset = (hour.local_hour - hour.hour_utc.hour) % 24
    return (hour.hour_utc + timedelta(hours=offset)).date().isoformat()


def _headline_code(hours: list[ForecastHour]) -> int:
    """The day's most significant condition.

    WMO orders its codes roughly by severity — 0 clear, 3 overcast, 45 fog, 61 rain,
    95 thunderstorm — so the maximum across daylight hours is the one worth naming.
    Taking the most *frequent* code instead would headline a drizzly afternoon as
    "cloudy": true of most of the day, and useless for the part that matters.
    """
    daylight = [h for h in hours if DAYLIGHT_FROM <= h.local_hour <= DAYLIGHT_TO]
    return max((h.weather_code for h in (daylight or hours)), default=0)


def summarise_days(hours: list[ForecastHour]) -> list[DaySummary]:
    """Group hours by their **local** date and summarise each.

    Grouping by the UTC date would split the day at the wrong place everywhere that is
    not on UTC — in Istanbul it would cut at 03:00 local and file the result under
    yesterday.
    """
    buckets: dict[str, list[ForecastHour]] = {}
    order: list[str] = []

    for hour in hours:
        date = local_date(hour)
        if date not in buckets:
            buckets[date] = []
            order.append(date)
        buckets[date].append(hour)

    summaries: list[DaySummary] = []
    for date in order:
        day = buckets[date]
        summaries.append(
            DaySummary(
                date=date,
                temp_min_c=min(h.temperature_c for h in day),
                temp_max_c=max(h.temperature_c for h in day),
                weather_code=_headline_code(day),
                precip_prob_max_pct=max(h.precip_prob_pct for h in day),
            )
        )
    return summaries


def current_index(hours: list[ForecastHour], now: datetime | None = None) -> int | None:
    """Which hour is happening now, or None when the forecast does not reach it.

    Resolved on the server so no screen has to work out what "now" means in the
    location's timezone — which is a different question from what "now" means on the
    device, whenever a person is looking at a forecast for somewhere else.
    """
    moment = now or datetime.now(UTC)
    for index, hour in enumerate(hours):
        if hour.hour_utc <= moment < hour.hour_utc + ONE_HOUR:
            return index
    return None
