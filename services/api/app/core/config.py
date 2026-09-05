"""Runtime configuration.

Every value comes from the environment. `.env.example` documents them all with blank
values; nothing here carries a usable default for a secret.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    log_level: str = "INFO"

    # No default. The service refuses to start without one rather than running on a
    # value an attacker can read in this file.
    jwt_secret: str = Field(min_length=32)
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 30

    database_url: str = "postgresql+asyncpg://weather:weather@localhost:5432/weather"
    redis_url: str = "redis://localhost:6379/0"

    # The whole host-versus-container difference collapses into this one value.
    # See ADR-0010: containers on macOS have no Metal access, so Ollama runs on the host.
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "gemma4:e4b"
    ollama_timeout_seconds: int = 120

    open_meteo_base_url: str = "https://api.open-meteo.com/v1"
    # A different host from the forecast API, and keyless like it. Proxied rather than
    # called from the phone so the app talks to one server, and so a place can be looked
    # up the same way whether or not the device can reach the open internet.
    open_meteo_geocoding_url: str = "https://geocoding-api.open-meteo.com/v1"
    forecast_cache_ttl_seconds: int = 600
    agent_cache_ttl_seconds: int = 1800

    # Turning routing off forces every request through the agent. This exists so the
    # evaluation suite can measure what routing is worth. See doc 06.
    routing_enabled: bool = True

    rate_limit_per_minute: int = 60


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
