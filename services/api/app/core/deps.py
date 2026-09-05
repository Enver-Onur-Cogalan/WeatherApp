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
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.orchestrator import PlanningAgent
from app.agent.provider import OllamaProvider
from app.auth.limiter import Counter, RateLimiter
from app.auth.models import User
from app.auth.tokens import TokenError, read_access_token
from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.db.session import get_session
from app.weather.cache import ForecastCache, RedisLike
from app.weather.client import OpenMeteoClient
from app.weather.geocoding import GeocodingClient
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


async def get_geocoding() -> GeocodingClient:
    settings = get_settings()
    return GeocodingClient(settings.open_meteo_geocoding_url, client=_http_client)


GeocodingDep = Annotated[GeocodingClient, Depends(get_geocoding)]


async def get_agent() -> AsyncIterator[PlanningAgent]:
    """The planning agent, sharing the process-wide HTTP client.

    Built per request but holding no state: the provider is a thin wrapper over one
    connection pool, and the agent's own state lives entirely inside a single `answer`.
    """
    settings = get_settings()
    yield PlanningAgent(
        provider=OllamaProvider(
            base_url=settings.ollama_base_url,
            model=settings.ollama_model,
            timeout_seconds=settings.ollama_timeout_seconds,
            client=_http_client,
        )
    )


AgentDep = Annotated[PlanningAgent, Depends(get_agent)]


def _typecheck_redis(client: aioredis.Redis) -> RedisLike:
    """Pin the assumption that the real Redis client satisfies our narrow protocol.

    `ForecastCache` deliberately depends on two methods rather than on Redis itself, so
    its tests need no server. This keeps that from drifting into a lie.
    """
    return client


# ---------------------------------------------------------------- authentication


async def get_rate_limiter() -> RateLimiter:
    return RateLimiter(_redis if _redis is not None else None)


RateLimiterDep = Annotated[RateLimiter, Depends(get_rate_limiter)]

# `auto_error=False` so that a request with no credentials reaches the dependency rather
# than being rejected in the middleware. Guest mode needs to be able to tell "no token"
# from "bad token", and only one of those is an error (ADR-0009).
_bearer = HTTPBearer(auto_error=False)

CredentialsDep = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
AuthSessionDep = Annotated[AsyncSession, Depends(get_session)]


async def get_optional_user(
    credentials: CredentialsDep, session: AuthSessionDep
) -> User | None:
    """The signed-in user, or `None` for a guest.

    A guest is the absence of a user, not a user with a flag — so this returns `None` and
    the endpoints that accept both branch on it. A malformed or expired token also
    resolves to `None` here: an endpoint open to guests should serve a guest rather than
    fail, and the endpoints that genuinely require an account use `get_current_user`,
    which raises.
    """
    if credentials is None:
        return None

    try:
        user_id = read_access_token(credentials.credentials)
    except TokenError:
        return None

    return await session.get(User, user_id)


async def get_current_user(user: Annotated[User | None, Depends(get_optional_user)]) -> User:
    """The signed-in user, or 401.

    Built on the optional form so there is one place that reads a token, and one place
    that decides an absent one is fatal.
    """
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to use this",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


def _typecheck_counter(client: aioredis.Redis) -> Counter:
    """Same pin as `_typecheck_redis`, for the two commands the limiter uses."""
    return client
