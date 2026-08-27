"""Types the weather layer produces.

`ForecastHour` itself lives in `planning`, which is the leaf: it imports nothing and can
be tested with no network, no database and no model. The weather layer depends on it, not
the other way round.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from app.planning.models import ForecastHour


@dataclass(frozen=True, slots=True)
class Location:
    """A place, with the timezone its forecast hours are expressed in."""

    latitude: float
    longitude: float
    timezone: str

    @property
    def cache_key(self) -> str:
        """Coordinates rounded to ~1 km.

        Two people on opposite sides of a street share an entry, which is correct — the
        forecast is identical. Full precision is kept on the stored value; only the key
        is rounded (docs/12).

        Always build this from the location that was **requested**. A `Forecast` carries
        the location Open-Meteo resolved, which is snapped to its model grid and rounds
        to a different key — see `ForecastCache.set`.
        """
        return f"{self.latitude:.2f},{self.longitude:.2f}"


@dataclass(frozen=True, slots=True)
class Forecast:
    """A location's hours, and when they were retrieved.

    `fetched_at` is not decoration. Staleness is computed from it at render time, and a
    forecast without a time on it is a lie (docs/02).
    """

    location: Location
    hours: tuple[ForecastHour, ...]
    fetched_at: datetime

    def age_seconds(self, now: datetime | None = None) -> float:
        return ((now or datetime.now(UTC)) - self.fetched_at).total_seconds()

    def is_stale(self, ttl_seconds: int, now: datetime | None = None) -> bool:
        return self.age_seconds(now) > ttl_seconds
