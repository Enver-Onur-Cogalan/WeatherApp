"""The engine and the request-scoped session.

One engine per process, built lazily. An engine created at import time would make every
importer need a database — the test suite, Alembic, and `--help` all import this module
without wanting a connection.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    return create_async_engine(
        settings.database_url,
        # SQL in the logs is a development affordance and a liability everywhere else:
        # bound parameters here include password hashes and refresh tokens.
        echo=False,
        pool_pre_ping=True,
    )


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        get_engine(),
        # The default expires every loaded object the moment the transaction commits, so
        # reading an attribute afterwards fires a fresh query — against a session the
        # request has already finished with.
        expire_on_commit=False,
    )


async def get_session() -> AsyncIterator[AsyncSession]:
    """One session per request, committed on the way out.

    Committing here rather than in each endpoint means a handler that raises leaves
    nothing half-written, and a handler that returns does not have to remember to.
    """
    async with get_sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
