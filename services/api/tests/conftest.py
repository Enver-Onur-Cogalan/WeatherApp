"""Test-wide setup.

`Settings` requires a JWT secret with no default, so the service refuses to start
without one (docs/07). Tests need a value, and it must be obviously fake — a plausible
looking secret in a test file is the kind of thing that gets copied into a deployment.
"""

from __future__ import annotations

import os

os.environ.setdefault("JWT_SECRET", "test-secret-not-for-use-anywhere-real-0123456789")
os.environ.setdefault("ENVIRONMENT", "test")

# The auth tests talk to a real Postgres. SQLite would run anywhere and would also be a
# different database: `uuid`, `timestamptz` and `ON DELETE CASCADE` all behave differently
# or not at all, and a suite that passes against an engine the service never uses proves
# less than it appears to. CI runs a Postgres service container for the same reason.
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://weather:weather@localhost:5432/weather_test"
)

import uuid
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.db.base import Base


@pytest.fixture(scope="session")
def schema() -> None:
    """Build the test schema once, in a loop of its own.

    Deliberately not an async fixture. asyncpg binds a connection to the event loop that
    opened it, and pytest-asyncio gives each test a fresh loop — so a session-scoped async
    fixture hands every test a connection from a loop that is no longer running, and the
    failure is `attached to a different loop` from deep inside the protocol, several
    layers away from anything that looks like the cause.

    `asyncio.run` here opens a loop, builds the schema, and closes both. Each test then
    creates its own engine inside its own loop, and nothing is shared across the boundary
    except the tables themselves.

    `create_all` rather than Alembic: docs/12 forbids `create_all` for the *service*,
    because a schema that drifts from its migrations is how a deploy fails. This database
    is created and dropped in the same breath, so what is under test is the models. The
    cost is that this suite cannot catch a migration disagreeing with them — `alembic
    upgrade head` in CI is what covers that, and it is named here so the gap is not a
    surprise later.
    """
    import asyncio

    from app.auth import models  # noqa: F401  (registers the tables)

    async def build() -> None:
        engine = create_async_engine(os.environ["DATABASE_URL"])
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)
        await engine.dispose()

    asyncio.run(build())


@pytest_asyncio.fixture
async def session(schema: None) -> AsyncIterator[AsyncSession]:
    """A session whose writes are rolled back when the test ends.

    Every test gets a clean database without rebuilding the schema: the outer transaction
    is never committed, so a `session.commit()` inside a test lands on a savepoint and
    disappears at teardown.
    """
    engine = create_async_engine(os.environ["DATABASE_URL"])
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            maker = async_sessionmaker(
                bind=connection,
                expire_on_commit=False,
                join_transaction_mode="create_savepoint",
            )
            async with maker() as db:
                yield db
            await transaction.rollback()
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def client(session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """An HTTP client wired to the app, sharing the test's transaction.

    Overriding the session dependency rather than letting the app open its own is what
    keeps a request's writes visible to the test that made it, and rolled back afterwards.
    """
    from app.core.deps import get_rate_limiter
    from app.db.session import get_session
    from app.main import app

    async def _session() -> AsyncIterator[AsyncSession]:
        """Mimic the real dependency, including the rollback.

        An earlier version just yielded the session. That quietly made every test more
        forgiving than production: a handler that raised still had its writes visible,
        because nothing rolled anything back. It hid a real defect — the theft response
        revokes a token family and then raises 401, and in the live service the rollback
        threw the revocation away while the test happily saw it.
        """
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

    class _NoLimit:
        async def check(self, key: str, limit: int, window_seconds: int) -> None:
            return None

    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_rate_limiter] = lambda: _NoLimit()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http
    app.dependency_overrides.clear()


@pytest.fixture
def unique_email() -> str:
    return f"user-{uuid.uuid4().hex[:12]}@example.com"
