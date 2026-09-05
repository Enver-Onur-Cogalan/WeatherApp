"""Turning a place name into coordinates and a timezone.

Open-Meteo's geocoding API, which is keyless like its forecast API — the same reason
ADR-0003 chose the provider in the first place: nothing here needs an account, so a
self-hosted instance needs no configuration to work.

Proxied through this service rather than called from the phone. Not for secrecy — there is
no secret — but because the app should talk to one host, and because the timezone this
returns is the value everything else is reconciled through (docs/12). Getting it from the
same place the forecast comes from means the two cannot disagree.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class Place:
    name: str
    """What to call it. The admin area and country are folded in when they disambiguate."""
    latitude: float
    longitude: float
    timezone: str
    country: str | None


class GeocodingUnavailableError(Exception):
    """The geocoding service could not be reached."""


class GeocodingClient:
    def __init__(
        self,
        base_url: str,
        client: httpx.AsyncClient | None = None,
        timeout: float = 8.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = client
        self._timeout = timeout

    async def search(self, query: str, limit: int = 8) -> list[Place]:
        params = {
            "name": query,
            "count": str(min(max(limit, 1), 20)),
            # Turkish first, which is what this app's own interface is. Open-Meteo falls
            # back to the local name when it has no translation, so nothing disappears.
            "language": "tr",
            "format": "json",
        }

        try:
            client = self._client or httpx.AsyncClient(timeout=self._timeout)
            response = await client.get(f"{self._base_url}/search", params=params)
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("geocoding.unavailable", error=str(exc))
            raise GeocodingUnavailableError(str(exc)) from exc

        return [place for raw in payload.get("results") or [] if (place := _place(raw))]


def _place(raw: dict[str, Any]) -> Place | None:
    """One result, or nothing if it is unusable.

    A result without a timezone is dropped rather than defaulted. Every hour this app
    stores is reconciled through a location's IANA name (docs/12), and guessing one would
    put a place's whole forecast an unknown number of hours out.
    """
    timezone = raw.get("timezone")
    latitude = raw.get("latitude")
    longitude = raw.get("longitude")
    name = raw.get("name")

    if not (timezone and name) or latitude is None or longitude is None:
        return None

    # "Beşiktaş, İstanbul" rather than two identical "Beşiktaş" rows. The admin area is
    # only added when it says something the name does not.
    region = raw.get("admin1")
    label = f"{name}, {region}" if region and region != name else name

    return Place(
        name=label,
        latitude=float(latitude),
        longitude=float(longitude),
        timezone=str(timezone),
        country=raw.get("country"),
    )
