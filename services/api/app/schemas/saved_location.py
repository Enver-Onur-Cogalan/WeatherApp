"""Generated from packages/schema/schemas. Do not edit — run `npm run schema`."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class SavedLocation(BaseModel):
    """A place an account asks about. The label is what the person calls it, not what a geocoder returned."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(description="UUIDv7, generated on the device (ADR-0015).")
    label: str = Field(
        min_length=1, max_length=60, description="What the person calls this place."
    )
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    timezone: str = Field(
        min_length=1,
        max_length=64,
        description="IANA name, e.g. Europe/Istanbul. Never a fixed offset, which would be wrong twice a year.",
    )
    is_current: bool | None = Field(
        default=None,
        description="The device's own position. At most one per account, enforced by the database rather than by whoever writes the next handler.",
    )
    sort_order: int | None = Field(
        default=None, ge=0, le=9999, description="Where it sits in the user's own ordering."
    )
    created_at: str
    updated_at: str = Field(description="The field conflicts are resolved on (ADR-0015).")
