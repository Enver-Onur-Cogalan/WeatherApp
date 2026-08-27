"""Types the scoring engine works in.

Kept free of I/O and of anything the agent touches, so `planning` can be imported and
tested with no database, no network, and no model present.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class Activity(StrEnum):
    RUNNING = "running"
    CYCLING = "cycling"
    WALKING = "walking"
    PICNIC = "picnic"
    PHOTOGRAPHY = "photography"
    GARDENING = "gardening"
    SWIMMING = "swimming"
    OTHER = "other"


@dataclass(frozen=True, slots=True)
class ActivityProfile:
    """What a person wants before they will go outside.

    Every field here must have a corresponding term in `score_hour`. A field with no
    term is silently ignored, which is how `preferred_hours` once let the engine rank
    03:00 as the best hour of the week — see docs/04.
    """

    activity: Activity
    temp_min: int
    temp_max: int
    wind_max_kmh: int
    precip_max_pct: int
    preferred_hours: tuple[int, int]
    uv_max: int | None = None


@dataclass(frozen=True, slots=True)
class ForecastHour:
    """One normalised hour. Canonical units only: Celsius, km/h, millimetres, UTC."""

    hour_utc: datetime
    local_hour: int
    temperature_c: float
    precip_prob_pct: int
    precip_mm: float
    wind_kmh: float
    uv_index: float
    cloud_cover_pct: int
    weather_code: int


@dataclass(frozen=True, slots=True)
class HourScore:
    """A scored hour, carrying why it lost points.

    `penalties` is what lets an empty result name the constraint that cost the most
    hours, and what lets the agent explain a window without inventing a reason.
    """

    hour: ForecastHour
    score: float
    excluded: bool
    penalties: dict[str, float]

    @property
    def worst_penalty(self) -> str | None:
        if not self.penalties:
            return None
        return max(self.penalties, key=lambda name: self.penalties[name])


@dataclass(frozen=True, slots=True)
class Window:
    """A run of contiguous hours that clear the threshold."""

    start_index: int
    end_index: int
    hours: tuple[HourScore, ...]

    @property
    def mean_score(self) -> float:
        return sum(h.score for h in self.hours) / len(self.hours)

    @property
    def length_hours(self) -> int:
        return len(self.hours)

    @property
    def start_hour(self) -> int:
        return self.hours[0].hour.local_hour

    @property
    def end_hour(self) -> int:
        return self.hours[-1].hour.local_hour

    @property
    def day(self) -> str:
        return self.hours[0].hour.hour_utc.date().isoformat()
