"""Generated from packages/schema/schemas. Do not edit — run `npm run schema`."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from .activity_profile import ActivityProfile


class SavedProfile(BaseModel):
    """A named profile belonging to an account. Identity and wording live here; what the scoring engine actually reads is the ActivityProfile inside it, defined once and shared with every request that carries one."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(
        description="UUIDv7, generated on the device so a guest can create one with no network and signing up later renumbers nothing (ADR-0015)."
    )
    name: str = Field(
        min_length=1,
        max_length=60,
        description='What the person calls it — "Sabah koşusu" — not the activity slug.',
    )
    constraints: ActivityProfile = Field(
        description="What a person wants from the weather before they will go outside. Extracted from natural language once, confirmed by the user, then read by the scoring engine on every request."
    )
    created_at: str
    updated_at: str = Field(
        description="The field conflicts are resolved on. Last write wins per record (ADR-0015), so a client sending an older value than the server holds is told about the newer one rather than overwriting it."
    )
