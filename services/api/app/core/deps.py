"""Shared dependencies.

Clients are built once and reused. A new `httpx.AsyncClient` per request throws away the
connection pool, and a new Redis connection per request is worse — both turn into
latency nobody can find later.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

import httpx
import redis.asyncio as aioredis
from fastapi import Depends

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.weather.cache import ForecastCache, RedisLike
from app.weather.client import OpenMeteoClient
from app.weather.service import WeatherService

logger = get_logger(__name__)

_http_client: httpx.AsyncClient | None = None
_redis: aioredis.Redis | None = None


async def startup(settings: Settings) -> None:
    global _http_client, _redis
    _http_client = httpx.AsyncClient(timeout=10.0)
    try:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
        await _redis.ping()
        logger.info("redis.connected")
    except Exception as exc:
        # Redis is an optimisation. Starting without it is slower, not broken —
        # `ForecastCache` treats a missing client as a permanent miss.
        logger.warning("redis.unavailable", error=str(exc))
        _redis = None


async def shutdown() -> None:
    global _http_client, _redis
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None
    if _redis is not None:
        await _redis.aclose()
        _redis = None


async def get_weather_service() -> AsyncIterator[WeatherService]:
    settings = get_settings()
    client = OpenMeteoClient(settings.open_meteo_base_url, client=_http_client)
    cache = ForecastCache(
        _redis if _redis is not None else None,
        ttl_seconds=settings.forecast_cache_ttl_seconds,
    )
    yield WeatherService(client, cache, ttl_seconds=settings.forecast_cache_ttl_seconds)


WeatherDep = Annotated[WeatherService, Depends(get_weather_service)]


def _typecheck_redis(client: aioredis.Redis) -> RedisLike:
    """Pin the assumption that the real Redis client satisfies our narrow protocol.

    `ForecastCache` deliberately depends on two methods rather than on Redis itself, so
    its tests need no server. This keeps that from drifting into a lie.
    """
    return client
