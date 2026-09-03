"""The things an account owns.

Two tables, and one difference from docs/12 worth stating rather than leaving to be
noticed. That document gives `user_id` as nullable, "null while the account is a guest" —
which is the **device's** schema. On the server a guest has no rows at all: their data
stays on the phone until there is an account to attach it to (ADR-0009). So here the
column is `NOT NULL`, and docs/12's own opening sentence is the licence for that — the
two stores "are not the same schema, and pretending otherwise is how sync bugs start".

Making it nullable on this side would create a second, unreachable kind of row that
nothing owns and no query filters by, which is precisely the confusion guest mode is
designed to avoid.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    ARRAY,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampTz, UuidPk


class SavedProfile(Base):
    """A named set of limits, belonging to a person.

    The scoring weights are deliberately not here. How many points a degree over the
    limit costs is an engine constant, identical for everyone (docs/12) — a per-profile
    weight would be a tuning knob nobody can reasonably set and would make two people's
    scores incomparable.
    """

    __tablename__ = "saved_profiles"

    # Not server-generated. The id arrives with the request, because a guest creates
    # profiles with no network and signing up must not renumber them (ADR-0015).
    id: Mapped[UuidPk]
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    name: Mapped[str] = mapped_column(String(60), nullable=False)
    activity: Mapped[str] = mapped_column(String(32), nullable=False)

    temp_min: Mapped[int] = mapped_column(Integer, nullable=False)
    temp_max: Mapped[int] = mapped_column(Integer, nullable=False)
    wind_max_kmh: Mapped[int] = mapped_column(Integer, nullable=False)
    precip_max_pct: Mapped[int] = mapped_column(Integer, nullable=False)
    uv_max: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Columns rather than a JSON blob, so the database can hold the invariants and a
    # future query can filter on them. `preferred_hours` stays an array because it is one
    # value — a range — and splitting it into two columns invites them to disagree.
    preferred_hours: Mapped[list[int]] = mapped_column(ARRAY(Integer), nullable=False)

    created_at: Mapped[TimestampTz]
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        # The one cross-field rule the JSON Schema cannot express, held where it cannot be
        # bypassed by a handler that forgets. `/plan` already checks it per request; this
        # is what stops a stored profile being impossible in the first place.
        CheckConstraint("temp_min <= temp_max", name="ck_saved_profiles_temp_range"),
        CheckConstraint(
            "array_length(preferred_hours, 1) = 2", name="ck_saved_profiles_hours_pair"
        ),
        Index("ix_saved_profiles_user_id", "user_id"),
    )


class SavedLocation(Base):
    __tablename__ = "saved_locations"

    id: Mapped[UuidPk]
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    label: Mapped[str] = mapped_column(String(60), nullable=False)

    # `numeric(8,5)` rather than a float: five decimals is about a metre, and it is exact.
    # A float would make two clients disagree in the last digit and call it a conflict.
    latitude: Mapped[float] = mapped_column(Numeric(8, 5), nullable=False)
    longitude: Mapped[float] = mapped_column(Numeric(8, 5), nullable=False)

    # The IANA name, never a fixed offset — an offset is wrong twice a year (docs/12).
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)

    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[TimestampTz]
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        # "At most one" is an invariant, so the database holds it. A partial unique index
        # is the exact shape of the rule: many rows with `is_current = false`, at most one
        # with `true`, per account. Enforcing it in a handler instead would mean every
        # future writer has to remember, and one that forgets leaves two current
        # locations and a screen that picks whichever came back first.
        # `text(...)` rather than the mapped attribute. Inside `__table_args__` the class
        # does not exist yet, so `is_current` is still a `MappedColumn` — SQLAlchemy
        # accepts it, and Alembic then renders its `repr()` into the migration, producing
        # a file that is not valid Python. The failure appears at `alembic upgrade`, well
        # away from the line that caused it.
        Index(
            "uq_saved_locations_one_current",
            "user_id",
            unique=True,
            postgresql_where=text("is_current"),
        ),
        Index("ix_saved_locations_user_id", "user_id"),
    )
