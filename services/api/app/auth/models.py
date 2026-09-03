"""Accounts and the tokens that stand in for them.

`RefreshToken` is server-only and deliberately absent from `packages/schema` (docs/12):
it never crosses the wire as a shape, only as an opaque string.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampTz, UuidPk


class User(Base):
    __tablename__ = "users"

    id: Mapped[UuidPk]

    # Citext would be tidier, but it is an extension a self-hosted Postgres may not have
    # installed, and this project should run on a stock database. Addresses are lowercased
    # on the way in instead, which is the same guarantee enforced one layer up.
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)

    # Argon2id, never the password. Long enough for the encoded form plus its parameters,
    # which grow when the parameters are retuned.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    created_at: Mapped[TimestampTz]
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    tokens: Mapped[list[RefreshToken]] = relationship(
        back_populates="user",
        # docs/12: deletion is real deletion. A privacy claim the code does not honour is
        # worse than no claim, so the cascade is on the database rather than in a handler
        # someone might forget to call.
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class RefreshToken(Base):
    """One issued refresh token, and the family it belongs to.

    Rotation means each refresh mints a new token and retires the one presented. The
    `family_id` is what makes theft detectable: every descendant of a single login shares
    it, so when a token that has already been used is presented again — which a legitimate
    client never does — the whole family can be revoked at once. Revoking only the replayed
    token would leave the thief's newer one working and log out the victim instead.
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[UuidPk]
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    family_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    # The token is stored hashed. A database dump is then not a set of working
    # credentials — the same reason the password is not stored either. SHA-256 rather than
    # Argon2id because this value is already 256 bits of entropy from a CSPRNG: it is not
    # guessable, so there is nothing for a slow hash to defend against, and refresh runs on
    # every request cycle where 100 ms would be felt.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Set when this token is exchanged. Presenting a used token is the theft signal.
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Set when the family is revoked, by logout or by that signal.
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[TimestampTz]

    user: Mapped[User] = relationship(back_populates="tokens")

    __table_args__ = (
        # Revoking a family is the hot path of the theft response, and it looks up by
        # family rather than by id.
        Index("ix_refresh_tokens_family_id", "family_id"),
        Index("ix_refresh_tokens_user_id", "user_id"),
    )

    @property
    def active(self) -> bool:
        return self.used_at is None and self.revoked_at is None


# Guest mode has no row here, deliberately. A guest is not a user with a flag — it is the
# absence of a user (ADR-0009), and their data stays on the device until an account exists
# to attach it to. An `is_guest` column would invite queries that treat the two as the same
# kind of thing, which is the confusion the two-path design is paying complexity to avoid.
