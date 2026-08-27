"""Open-Meteo client and the normalisation into our own types.

Open-Meteo needs no API key, which is the reason it was chosen: `docker compose up` is
the whole installation, with nothing to register for (ADR-0003).

Everything this module returns is in canonical units — Celsius, km/h, millimetres, UTC.
Conversion to whatever a person wants to read happens at render (docs/12).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.planning.models import ForecastHour

from .models import Forecast, Location

# Requested in this order every time. `weather_code` is not optional: WMO codes are the
# only field that distinguishes snow from rain and hail from a shower, which both the
# scoring engine's hard exclusions and the atmosphere layer depend on (docs/12).
HOURLY_FIELDS = (
    "temperature_2m",
    "precipitation_probability",
    "precipitation",
    "wind_speed_10m",
    "uv_index",
    "cloud_cover",
    "weather_code",
)

REQUIRED_KEYS = ("time", *HOURLY_FIELDS)


class ForecastUnavailableError(RuntimeError):
    """Open-Meteo could not be reached, or answered with something unusable.

    Raised rather than returning an empty forecast: an empty forecast renders as "no
    good windows this week", which is a different and much worse lie than "we could not
    reach the service".
    """


class OpenMeteoClient:
    """Fetches and normalises. Holds no cache and no state beyond its HTTP client."""

    def __init__(
        self,
        base_url: str,
        client: httpx.AsyncClient | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = client
        self._timeout = timeout

    async def fetch(self, location: Location, days: int = 7) -> Forecast:
        params = {
            "latitude": f"{location.latitude:.5f}",
            "longitude": f"{location.longitude:.5f}",
            "hourly": ",".join(HOURLY_FIELDS),
            "timezone": location.timezone,
            "forecast_days": str(days),
        }

        try:
            if self._client is not None:
                response = await self._client.get(f"{self._base_url}/forecast", params=params)
            else:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    response = await client.get(f"{self._base_url}/forecast", params=params)
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            raise ForecastUnavailableError(f"Open-Meteo request failed: {exc}") from exc
        except ValueError as exc:
            raise ForecastUnavailableError(
                "Open-Meteo returned a body that is not JSON"
            ) from exc

        return normalise(payload, location)


def normalise(payload: dict[str, Any], location: Location) -> Forecast:
    """Turn an Open-Meteo response into our own hours.

    The timezone handling here is the part worth reading. With a `timezone` parameter,
    Open-Meteo returns **naive local** timestamps plus `utc_offset_seconds`. Storing
    those strings as-is would produce times that are wrong by the offset, and silently
    wrong twice a year at a DST boundary. So the local time is kept for `local_hour`,
    which every query needs, and UTC is derived and treated as authoritative (docs/12).
    """
    hourly = payload.get("hourly")
    if not isinstance(hourly, dict):
        raise ForecastUnavailableError("Open-Meteo response has no hourly block")

    missing = [key for key in REQUIRED_KEYS if key not in hourly]
    if missing:
        raise ForecastUnavailableError(
            f"Open-Meteo response is missing fields: {', '.join(missing)}"
        )

    offset = payload.get("utc_offset_seconds")
    if not isinstance(offset, int):
        raise ForecastUnavailableError("Open-Meteo response has no utc_offset_seconds")

    # A location's own timezone name wins over the one we asked for: if Open-Meteo
    # resolved something different, storing our request would misrepresent the data.
    resolved = Location(
        latitude=float(payload.get("latitude", location.latitude)),
        longitude=float(payload.get("longitude", location.longitude)),
        timezone=str(payload.get("timezone", location.timezone)),
    )

    times = hourly["time"]
    hours: list[ForecastHour] = []

    for index, raw_time in enumerate(times):
        values = {field: hourly[field][index] for field in HOURLY_FIELDS}

        # Open-Meteo returns null for hours it has no value for, usually at the edge of
        # a model run. Dropping the hour is right: a gap in the trace is honest, and a
        # zero would be scored as though it were a measurement.
        if any(value is None for value in values.values()):
            continue

        local = datetime.fromisoformat(raw_time)
        hours.append(
            ForecastHour(
                hour_utc=(local - timedelta(seconds=offset)).replace(tzinfo=UTC),
                local_hour=local.hour,
                temperature_c=float(values["temperature_2m"]),
                precip_prob_pct=int(values["precipitation_probability"]),
                precip_mm=float(values["precipitation"]),
                wind_kmh=float(values["wind_speed_10m"]),
                uv_index=float(values["uv_index"]),
                cloud_cover_pct=int(values["cloud_cover"]),
                weather_code=int(values["weather_code"]),
            )
        )

    if not hours:
        raise ForecastUnavailableError("Open-Meteo returned no usable hours")

    return Forecast(location=resolved, hours=tuple(hours), fetched_at=datetime.now(UTC))
