"""The weather layer's front door.

Ties the client and the cache together, and owns the one behaviour that matters when
things go wrong: **serve stale rather than nothing**.

docs/01 sets the rule — the system loses capability, not availability. If Open-Meteo is
unreachable and we hold an expired entry, the expired entry is worth far more than an
error screen, provided the caller is told how old it is. `Forecast.fetched_at` carries
that, and the UI is required to show it.
"""

from __future__ import annotations

from app.core.logging import get_logger

from .cache import ForecastCache
from .client import ForecastUnavailableError, OpenMeteoClient
from .models import Forecast, Location

logger = get_logger(__name__)


class WeatherService:
    def __init__(
        self,
        client: OpenMeteoClient,
        cache: ForecastCache,
        ttl_seconds: int = 600,
    ) -> None:
        self._client = client
        self._cache = cache
        self._ttl = ttl_seconds

    @property
    def ttl_seconds(self) -> int:
        """How old an entry may be before it counts as stale.

        Exposed so a response can tell the client what it is looking at, rather than
        the client guessing at a freshness rule the server owns.
        """
        return self._ttl

    async def get_forecast(self, location: Location, days: int = 7) -> Forecast:
        """Fresh if we have it, refetched if we can, stale if that is all there is."""
        cached = await self._cache.get(location, days)

        if cached is not None and not cached.is_stale(self._ttl):
            logger.debug("forecast.cache_hit", location=location.cache_key)
            return cached

        try:
            fresh = await self._client.fetch(location, days=days)
        except ForecastUnavailableError as exc:
            if cached is not None:
                logger.warning(
                    "forecast.serving_stale",
                    location=location.cache_key,
                    age_seconds=round(cached.age_seconds()),
                    error=str(exc),
                )
                return cached
            logger.error("forecast.unavailable", location=location.cache_key, error=str(exc))
            raise

        await self._cache.set(location, fresh, days)
        logger.debug("forecast.fetched", location=location.cache_key, hours=len(fresh.hours))
        return fresh
