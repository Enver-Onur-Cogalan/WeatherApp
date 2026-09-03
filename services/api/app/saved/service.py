"""Reading and writing what an account owns.

The whole file is one idea applied twice: the client generates the id, so every write is
an upsert, and when two writes disagree the newer `updated_at` wins (ADR-0015).

Last-write-wins has a cost the ADR states plainly and this code cannot soften: two devices
editing the same record while both offline means one edit disappears. What it must not do
is disappear *silently on the server's side of the wire* — so a write that loses is
answered with the record that won, and the client is told which one it is holding.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import TypeVar

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.saved.models import SavedLocation, SavedProfile

logger = get_logger(__name__)

Owned = TypeVar("Owned", SavedProfile, SavedLocation)


class NotFoundError(Exception):
    """No such record for this account."""


class IdTakenError(Exception):
    """That id already belongs to a different account.

    Ids are globally unique because they are the primary key, but lookups are scoped by
    owner — so a write to someone else's id finds nothing of its own, tries to insert,
    and collides. Without this the collision surfaced as a 500 from deep inside the
    driver, which is both an unhelpful answer and a usable signal that the id exists.

    UUIDv7 makes an accidental collision impossible in practice, so reaching this means a
    bug or a deliberate probe. Neither deserves a stack trace.
    """


@dataclass(frozen=True, slots=True)
class Written:
    """What happened to a write, and what the account now holds.

    `stale` is the interesting flag: the write was rejected because the server had a
    newer version, and `record` is that newer version rather than what was sent. A client
    that ignores it will keep resending an edit that never lands.
    """

    record: SavedProfile | SavedLocation
    created: bool
    stale: bool


async def list_profiles(session: AsyncSession, user_id: uuid.UUID) -> list[SavedProfile]:
    result = await session.scalars(
        select(SavedProfile)
        .where(SavedProfile.user_id == user_id)
        .order_by(SavedProfile.created_at)
    )
    return list(result)


async def list_locations(session: AsyncSession, user_id: uuid.UUID) -> list[SavedLocation]:
    result = await session.scalars(
        select(SavedLocation)
        .where(SavedLocation.user_id == user_id)
        .order_by(SavedLocation.sort_order, SavedLocation.created_at)
    )
    return list(result)


async def get_owned(
    session: AsyncSession, model: type[Owned], user_id: uuid.UUID, record_id: uuid.UUID
) -> Owned | None:
    """One record, scoped to its owner.

    The `user_id` in the filter is not decoration. Looking a record up by id alone and
    checking ownership afterwards is the same query with an extra chance to forget, and
    forgetting it is how one account reads another's data.
    """
    # The explicit cast is for mypy: `session.scalar` is typed to return `Any` for a
    # generic select, and letting that flow out would erase the type for every caller.
    record: Owned | None = await session.scalar(
        select(model).where(model.id == record_id, model.user_id == user_id)
    )
    return record


async def upsert(
    session: AsyncSession,
    model: type[Owned],
    user_id: uuid.UUID,
    record_id: uuid.UUID,
    updated_at: datetime,
    values: dict[str, object],
) -> Written:
    """Create or replace a record, unless the server holds a newer one.

    Comparison is strictly greater-than, so a write carrying the same `updated_at` as the
    stored row is treated as stale rather than applied. Equal timestamps mean the client
    is resending what the server already has — replaying it would change nothing and
    reporting it as a fresh write would be a lie.
    """
    existing = await get_owned(session, model, user_id, record_id)

    if existing is None:
        record = model(id=record_id, user_id=user_id, updated_at=updated_at, **values)
        session.add(record)
        try:
            await session.flush()
        except IntegrityError as exc:
            # The id exists but belongs to somebody else — the owner-scoped lookup above
            # could not see it, and the primary key is global.
            await session.rollback()
            logger.warning(
                "saved.id_belongs_to_another_account",
                kind=model.__tablename__,
                record_id=str(record_id),
            )
            raise IdTakenError(str(record_id)) from exc

        logger.info("saved.created", kind=model.__tablename__, record_id=str(record_id))
        return Written(record=record, created=True, stale=False)

    if existing.updated_at >= updated_at:
        logger.info(
            "saved.write_ignored_as_stale",
            kind=model.__tablename__,
            record_id=str(record_id),
            held=existing.updated_at.isoformat(),
            offered=updated_at.isoformat(),
        )
        return Written(record=existing, created=False, stale=True)

    for field, value in values.items():
        setattr(existing, field, value)
    existing.updated_at = updated_at
    await session.flush()
    return Written(record=existing, created=False, stale=False)


async def delete_owned(
    session: AsyncSession, model: type[Owned], user_id: uuid.UUID, record_id: uuid.UUID
) -> None:
    """Remove a record, for real.

    docs/12: no soft delete, no tombstone. The cost is that a delete cannot be
    distinguished from a record that never synced, which is the price of the claim being
    true rather than decorative.
    """
    record = await get_owned(session, model, user_id, record_id)
    if record is None:
        raise NotFoundError(str(record_id))
    await session.delete(record)


async def clear_other_current(
    session: AsyncSession, user_id: uuid.UUID, keep: uuid.UUID
) -> None:
    """Make room for a new current location.

    A partial unique index enforces "at most one", which means a straight upsert of a
    second current location fails on the constraint rather than replacing the first. The
    client's intent is always "this one is current now", so the previous one is stood
    down first — in the same transaction, or the index would reject the pair.
    """
    others = await session.scalars(
        select(SavedLocation).where(
            SavedLocation.user_id == user_id,
            SavedLocation.is_current.is_(True),
            SavedLocation.id != keep,
        )
    )
    for other in others:
        other.is_current = False
    await session.flush()
