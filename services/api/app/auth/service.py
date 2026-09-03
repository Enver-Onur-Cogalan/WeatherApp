"""Registering, logging in, and rotating.

The interesting part is `refresh`. Everything else is bookkeeping around it.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import RefreshToken, User
from app.auth.passwords import hash_password, needs_rehash, verify_password
from app.auth.tokens import create_access_token, hash_refresh_token, issue_refresh_token
from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class EmailTakenError(Exception):
    """That address already has an account."""


class BadCredentialsError(Exception):
    """The email or the password was wrong. Deliberately not which."""


class InvalidRefreshError(Exception):
    """The refresh token was unknown, expired, already used, or revoked."""


@dataclass(frozen=True, slots=True)
class Tokens:
    access_token: str
    refresh_token: str
    expires_in: int


def normalise_email(email: str) -> str:
    """Lowercased and trimmed.

    Addresses are compared case-insensitively by every mail system anyone uses, so
    `Ali@example.com` and `ali@example.com` must not be two accounts. Done here rather than
    with a citext column, which is an extension a stock Postgres may not have.
    """
    return email.strip().lower()


async def register(session: AsyncSession, email: str, password: str) -> tuple[User, Tokens]:
    user = User(email=normalise_email(email), password_hash=hash_password(password))
    session.add(user)

    try:
        # Flushed rather than committed: the unique constraint is what decides whether the
        # address is taken, and asking the database is the only answer that survives two
        # registrations racing. A `SELECT` first would leave a window between the check
        # and the insert.
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise EmailTakenError(email) from exc

    logger.info("auth.registered", user_id=str(user.id))
    return user, await _issue(session, user)


async def login(session: AsyncSession, email: str, password: str) -> tuple[User, Tokens]:
    user = await session.scalar(select(User).where(User.email == normalise_email(email)))

    if user is None:
        # Hash anyway. Returning early for an unknown address makes the response
        # measurably faster than one for a known address with a wrong password, which
        # turns login into an oracle for which addresses have accounts.
        hash_password(password)
        raise BadCredentialsError()

    if not verify_password(password, user.password_hash):
        raise BadCredentialsError()

    # The parameters in `passwords.py` are meant to be raised as hardware gets faster.
    # Doing it here means an existing account upgrades the next time its owner logs in,
    # rather than staying on the old cost forever.
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
        logger.info("auth.rehashed", user_id=str(user.id))

    logger.info("auth.logged_in", user_id=str(user.id))
    return user, await _issue(session, user)


async def refresh(session: AsyncSession, token: str) -> Tokens:
    """Exchange a refresh token for a new pair, or detect that one was stolen.

    Rotation makes replay visible. A legitimate client presents each refresh token exactly
    once, so a second presentation means two parties hold the same secret — the token
    leaked. There is no way to tell the thief from the victim at that point, so the whole
    family is revoked and both are made to log in again. That is the safe direction to be
    wrong in: revoking only the replayed token would leave the thief's newer token working
    and log out the victim instead.
    """
    row = await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(token))
    )
    if row is None:
        raise InvalidRefreshError("unknown token")

    now = datetime.now(UTC)

    if row.used_at is not None:
        logger.warning(
            "auth.refresh_replayed",
            user_id=str(row.user_id),
            family_id=str(row.family_id),
        )
        await revoke_family(session, row.family_id, now)

        # Committed here, before raising. The request is about to fail, and the session
        # dependency rolls back on the way out — which would take the revocation with it
        # and leave the stolen token working. The whole point of detecting a replay is
        # the write that follows it, so that write cannot share the fate of the response.
        #
        # This was green in the test suite and broken in the running service, because the
        # test's session override yielded without ever rolling back. The override now
        # mirrors the real dependency.
        await session.commit()
        raise InvalidRefreshError("token was already used")

    if row.revoked_at is not None:
        raise InvalidRefreshError("token was revoked")

    if row.expires_at <= now:
        raise InvalidRefreshError("token expired")

    user = await session.get(User, row.user_id)
    if user is None:
        # The account was deleted while a token was outstanding. The cascade should have
        # taken the row with it, so this is a broken invariant rather than a login failure.
        logger.error("auth.orphan_refresh_token", user_id=str(row.user_id))
        raise InvalidRefreshError("account no longer exists")

    row.used_at = now
    return await _issue(session, user, family_id=row.family_id, now=now)


async def revoke_family(
    session: AsyncSession, family_id: uuid.UUID, now: datetime | None = None
) -> None:
    """Retire every token descended from one login.

    A bulk update rather than a loop: this runs on the theft path, and it should not take
    longer the more times the token was rotated.
    """
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now or datetime.now(UTC))
    )


async def logout(session: AsyncSession, token: str) -> None:
    """End the session the token belongs to.

    An unknown token is not an error. Logging out is the one operation that must always
    appear to succeed — a client that has lost track of its token still needs to be able
    to reach a logged-out state, and reporting a failure would strand it.
    """
    row = await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(token))
    )
    if row is not None:
        await revoke_family(session, row.family_id)
        logger.info("auth.logged_out", user_id=str(row.user_id))


async def _issue(
    session: AsyncSession,
    user: User,
    family_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> Tokens:
    issued = issue_refresh_token(family_id=family_id, now=now)
    session.add(
        RefreshToken(
            user_id=user.id,
            family_id=issued.family_id,
            token_hash=issued.token_hash,
            expires_at=issued.expires_at,
        )
    )
    return Tokens(
        access_token=create_access_token(user.id, now=now),
        refresh_token=issued.token,
        expires_in=get_settings().access_token_ttl_minutes * 60,
    )
