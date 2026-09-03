"""Fixed-window rate limiting, backed by Redis.

A fixed window rather than a sliding one or a token bucket. It admits up to twice the
nominal rate across a window boundary, which for the thing being defended — someone
grinding a password list — is a distinction without a difference, and it costs one
`INCR` and one `EXPIRE` instead of a sorted set per key.

**Redis being down does not lock anyone out.** docs/07 puts rate limiting in the
proportionate-security bucket: this is a self-hosted household app, and failing open
degrades one defence, while failing closed takes the whole service down with the cache.
The choice is stated here rather than left to whoever reads the `except`.
"""

from __future__ import annotations

from collections.abc import Awaitable
from typing import Any, Protocol

from fastapi import HTTPException, status

from app.core.logging import get_logger

logger = get_logger(__name__)


class Counter(Protocol):
    """The two Redis commands this needs, and nothing else.

    Declared here rather than by widening `weather.cache.RedisLike`, which says in its own
    docstring that it is only what that module uses. The same two traps apply: parameters
    are positional-only because redis-py names its first one `name`, and the methods are
    sync-returning-`Awaitable` rather than `async def`, because that is how redis-py types
    them and a protocol the real client cannot satisfy describes nothing.
    """

    def incr(self, key: str, /) -> Awaitable[Any]: ...
    def expire(self, key: str, seconds: int, /) -> Awaitable[Any]: ...


class RateLimiter:
    def __init__(self, redis: Counter | None) -> None:
        self._redis = redis

    async def check(self, key: str, limit: int, window_seconds: int) -> None:
        """Count one hit against `key`, or raise 429 if the window is full."""
        if self._redis is None:
            return

        namespaced = f"ratelimit:{key}"
        try:
            count = await self._redis.incr(namespaced)
            if count == 1:
                await self._redis.expire(namespaced, window_seconds)
        except Exception as exc:
            logger.warning("ratelimit.unavailable", error=str(exc))
            return

        if count > limit:
            logger.warning("ratelimit.exceeded", key=key, count=count)
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Wait a few minutes and try again.",
                headers={"Retry-After": str(window_seconds)},
            )
