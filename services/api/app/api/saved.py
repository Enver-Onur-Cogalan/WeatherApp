"""Profiles and locations: the two things an account owns.

`PUT` rather than `POST` for creation, because the client generates the id (ADR-0015).
That is what PUT is for — the caller names the resource and says what should be there —
and it makes a retry after a dropped response harmless instead of a duplicate.

Every route is account-only. A guest keeps their profiles on the device and has nothing
to synchronise; that is the design, not a gap (ADR-0009).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.db.session import get_session
from app.saved import service
from app.saved.models import SavedLocation, SavedProfile
from app.schemas.activity_profile import ActivityProfile
from app.schemas.saved_location import SavedLocation as LocationSchema
from app.schemas.saved_profile import SavedProfile as ProfileSchema

router = APIRouter(tags=["saved"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


class ProfileWrite(BaseModel):
    """What a client sends. The id is in the path, and the timestamps decide conflicts."""

    name: str
    constraints: ActivityProfile
    updated_at: datetime


class LocationWrite(BaseModel):
    label: str
    latitude: float
    longitude: float
    timezone: str
    is_current: bool = False
    sort_order: int = 0
    updated_at: datetime


def _profile_out(row: SavedProfile) -> ProfileSchema:
    return ProfileSchema(
        id=str(row.id),
        name=row.name,
        constraints=ActivityProfile(
            activity=row.activity,  # type: ignore[arg-type]
            temp_min=row.temp_min,
            temp_max=row.temp_max,
            wind_max_kmh=row.wind_max_kmh,
            precip_max_pct=row.precip_max_pct,
            uv_max=row.uv_max,
            preferred_hours=list(row.preferred_hours),
        ),
        created_at=row.created_at.isoformat(),
        updated_at=row.updated_at.isoformat(),
    )


def _location_out(row: SavedLocation) -> LocationSchema:
    return LocationSchema(
        id=str(row.id),
        label=row.label,
        latitude=float(row.latitude),
        longitude=float(row.longitude),
        timezone=row.timezone,
        is_current=row.is_current,
        sort_order=row.sort_order,
        created_at=row.created_at.isoformat(),
        updated_at=row.updated_at.isoformat(),
    )


# ------------------------------------------------------------------ profiles


@router.get("/profiles", response_model=list[ProfileSchema], summary="Every saved profile")
async def list_profiles(user: CurrentUser, session: SessionDep) -> list[ProfileSchema]:
    rows = await service.list_profiles(session, user.id)
    return [_profile_out(row) for row in rows]


@router.put(
    "/profiles/{profile_id}",
    response_model=ProfileSchema,
    summary="Create or replace a profile",
    responses={
        409: {"description": "The server holds a newer version; it is returned instead"},
        422: {"description": "temp_min is above temp_max"},
    },
)
async def put_profile(
    profile_id: uuid.UUID,
    body: ProfileWrite,
    user: CurrentUser,
    session: SessionDep,
    response: Response,
) -> ProfileSchema:
    if body.constraints.temp_min > body.constraints.temp_max:
        # The one cross-field rule JSON Schema cannot express. The database holds it too;
        # this is here so the client gets a 422 rather than a constraint violation.
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="temp_min must not be above temp_max",
        )

    try:
        written = await service.upsert(
            session,
            SavedProfile,
            user.id,
            profile_id,
            body.updated_at,
            {
                "name": body.name,
                "activity": body.constraints.activity,
                "temp_min": body.constraints.temp_min,
                "temp_max": body.constraints.temp_max,
                "wind_max_kmh": body.constraints.wind_max_kmh,
                "precip_max_pct": body.constraints.precip_max_pct,
                "uv_max": body.constraints.uv_max,
                "preferred_hours": list(body.constraints.preferred_hours),
            },
        )
    except service.IdTakenError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="That id is already in use"
        ) from exc

    # 409 with the winning record, not a bare error. The client sent an edit that lost,
    # and the useful thing to hand back is what it lost to — otherwise it will keep
    # resending a write that can never land.
    response.status_code = (
        status.HTTP_201_CREATED
        if written.created
        else status.HTTP_409_CONFLICT
        if written.stale
        else status.HTTP_200_OK
    )
    assert isinstance(written.record, SavedProfile)
    return _profile_out(written.record)


@router.delete(
    "/profiles/{profile_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a profile, for real",
    responses={404: {"description": "No such profile for this account"}},
)
async def delete_profile(profile_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> None:
    try:
        await service.delete_owned(session, SavedProfile, user.id, profile_id)
    except service.NotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such profile") from exc


# ----------------------------------------------------------------- locations


@router.get("/locations", response_model=list[LocationSchema], summary="Every saved place")
async def list_locations(user: CurrentUser, session: SessionDep) -> list[LocationSchema]:
    rows = await service.list_locations(session, user.id)
    return [_location_out(row) for row in rows]


@router.put(
    "/locations/{location_id}",
    response_model=LocationSchema,
    summary="Create or replace a place",
    responses={
        409: {"description": "The server holds a newer version; it is returned instead"}
    },
)
async def put_location(
    location_id: uuid.UUID,
    body: LocationWrite,
    user: CurrentUser,
    session: SessionDep,
    response: Response,
) -> LocationSchema:
    if body.is_current:
        # A partial unique index allows one current location per account, so a second one
        # would fail on the constraint rather than take over. The client always means
        # "this one is current now", so the previous holder is stood down first, in the
        # same transaction.
        await service.clear_other_current(session, user.id, keep=location_id)

    try:
        written = await service.upsert(
            session,
            SavedLocation,
            user.id,
            location_id,
            body.updated_at,
            {
                "label": body.label,
                "latitude": body.latitude,
                "longitude": body.longitude,
                "timezone": body.timezone,
                "is_current": body.is_current,
                "sort_order": body.sort_order,
            },
        )
    except service.IdTakenError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="That id is already in use"
        ) from exc

    response.status_code = (
        status.HTTP_201_CREATED
        if written.created
        else status.HTTP_409_CONFLICT
        if written.stale
        else status.HTTP_200_OK
    )
    assert isinstance(written.record, SavedLocation)
    return _location_out(written.record)


@router.delete(
    "/locations/{location_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a place, for real",
    responses={404: {"description": "No such place for this account"}},
)
async def delete_location(
    location_id: uuid.UUID, user: CurrentUser, session: SessionDep
) -> None:
    try:
        await service.delete_owned(session, SavedLocation, user.id, location_id)
    except service.NotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such place") from exc
