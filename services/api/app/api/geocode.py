"""Looking a place up by name.

The one endpoint that exists so the app can add a location without asking a person for
coordinates. It is a read of a public API with nothing of ours in it, so it is open to
guests — a guest's places live on their device and they still have to find them.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from app.core.deps import GeocodingDep, RateLimiterDep
from app.weather.geocoding import GeocodingUnavailableError

router = APIRouter(tags=["places"])


class Place(BaseModel):
    name: str
    latitude: float
    longitude: float
    timezone: str
    country: str | None = None


@router.get(
    "/places",
    response_model=list[Place],
    summary="Find a place by name",
    responses={503: {"description": "The geocoding service could not be reached"}},
)
async def search_places(
    geocoding: GeocodingDep,
    limiter: RateLimiterDep,
    q: Annotated[str, Query(min_length=2, max_length=80)],
) -> list[Place]:
    # Per query rather than per caller: this proxies somebody else's service, and the
    # thing worth limiting is how hard we lean on it. A popular query is also a cheap one
    # for them to answer.
    await limiter.check(f"places:{q.lower()}", limit=30, window_seconds=60)

    try:
        found = await geocoding.search(q)
    except GeocodingUnavailableError as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Place lookup is unavailable right now",
        ) from exc

    return [
        Place(
            name=place.name,
            latitude=place.latitude,
            longitude=place.longitude,
            timezone=place.timezone,
            country=place.country,
        )
        for place in found
    ]
