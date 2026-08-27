"""Forecast cache.

Open-Meteo updates hourly, so a ten-minute entry is well inside the data's own
resolution while keeping the app responsive (docs/03).

Every method here fails open. A cache is an optimisation, and an optimisation that can
take the service down with it is a liability — if Redis is unreachable the app gets
slower, not broken.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable
from datetime import UTC, datetime
from typing import Any, Protocol

from app.core.logging import get_logger
from app.planning.models import ForecastHour

from .models import Forecast, Location

logger = get_logger(__name__)

CACHE_VERSION = 1
"""Bumped when the serialised shape changes.

Old entries then miss rather than deserialising into the wrong shape — a stale cache
that parses is far more dangerous than one that does not.
"""


class RedisLike(Protocol):
    """Only what this module uses, so tests need no Redis and no mocking library.

    Two details make the real `redis.asyncio.Redis` satisfy this, and both are easy to
    get wrong. The parameters are positional-only, because redis-py names its first one
    `name` and a protocol the actual client cannot implement describes nothing. And the
    methods are declared sync-returning-`Awaitable` rather than `async def`: redis-py
    types them that way, and `async def` in a protocol demands a `Coroutine`
    specifically — every coroutine is an awaitable, but not the other way round.
    """

    def get(self, key: str, /) -> Awaitable[Any]: ...
    def set(self, key: str, value: str, /, *, ex: int | None = None) -> Awaitable[Any]: ...


def _encode(forecast: Forecast) -> str:
    return json.dumps(
        {
            "v": CACHE_VERSION,
            "fetched_at": forecast.fetched_at.isoformat(),
            "location": {
                "latitude": forecast.location.latitude,
                "longitude": forecast.location.longitude,
                "timezone": forecast.location.timezone,
            },
            "hours": [
                {
                    "hour_utc": hour.hour_utc.isoformat(),
                    "local_hour": hour.local_hour,
                    "temperature_c": hour.temperature_c,
                    "precip_prob_pct": hour.precip_prob_pct,
                    "precip_mm": hour.precip_mm,
                    "wind_kmh": hour.wind_kmh,
                    "uv_index": hour.uv_index,
                    "cloud_cover_pct": hour.cloud_cover_pct,
                    "weather_code": hour.weather_code,
                }
                for hour in forecast.hours
            ],
        },
        separators=(",", ":"),
    )


def _decode(raw: str) -> Forecast | None:
    payload = json.loads(raw)
    if payload.get("v") != CACHE_VERSION:
        return None

    location = Location(
        latitude=payload["location"]["latitude"],
        longitude=payload["location"]["longitude"],
        timezone=payload["location"]["timezone"],
    )
    hours = tuple(
        ForecastHour(
            hour_utc=datetime.fromisoformat(hour["hour_utc"]),
            local_hour=hour["local_hour"],
            temperature_c=hour["temperature_c"],
            precip_prob_pct=hour["precip_prob_pct"],
            precip_mm=hour["precip_mm"],
            wind_kmh=hour["wind_kmh"],
            uv_index=hour["uv_index"],
            cloud_cover_pct=hour["cloud_cover_pct"],
            weather_code=hour["weather_code"],
        )
        for hour in payload["hours"]
    )
    return Forecast(
        location=location,
        hours=hours,
        fetched_at=datetime.fromisoformat(payload["fetched_at"]).astimezone(UTC),
    )


class ForecastCache:
    def __init__(self, redis: RedisLike | None, ttl_seconds: int = 600) -> None:
        self._redis = redis
        self._ttl = ttl_seconds

    @staticmethod
    def key(location: Location, days: int) -> str:
        return f"forecast:{location.cache_key}:{location.timezone}:{days}"

    async def get(self, location: Location, days: int) -> Forecast | None:
        if self._redis is None:
            return None
        try:
            raw = await self._redis.get(self.key(location, days))
        except Exception as exc:
            logger.warning("cache.get_failed", error=str(exc))
            return None
        if raw is None:
            return None

        try:
            return _decode(raw.decode() if isinstance(raw, bytes) else raw)
        except (KeyError, ValueError, TypeError) as exc:
            # A corrupt entry is a miss, not an error. Refetching costs a request;
            # raising would cost the user their screen.
            logger.warning("cache.decode_failed", error=str(exc))
            return None

    async def set(self, location: Location, forecast: Forecast, days: int) -> None:
        """Store under the **requested** location, not the one in the response.

        Open-Meteo snaps coordinates to its model grid — ask for 41.0082, 28.9784 and
        the response says 41.0, 29.0. Keying the write off `forecast.location` therefore
        wrote to a key no lookup would ever build, and the cache silently never hit: no
        error, no warning, just every request going upstream.
        """
        if self._redis is None:
            return
        try:
            await self._redis.set(self.key(location, days), _encode(forecast), ex=self._ttl)
        except Exception as exc:
            logger.warning("cache.set_failed", error=str(exc))
