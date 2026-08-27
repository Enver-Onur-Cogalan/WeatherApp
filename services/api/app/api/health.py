"""Liveness and readiness.

`/health` says the process is up. `/ready` says its dependencies are reachable — and
reports the assistant separately, because the app is designed to work without it.
"""

from __future__ import annotations

from typing import Literal

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import get_settings

router = APIRouter(tags=["health"])


class Health(BaseModel):
    status: Literal["ok"]
    environment: str


class Dependency(BaseModel):
    reachable: bool
    detail: str | None = None


class Readiness(BaseModel):
    status: Literal["ready", "degraded"]
    assistant: Dependency
    model: str


@router.get("/health", response_model=Health)
async def health() -> Health:
    return Health(status="ok", environment=get_settings().environment)


@router.get("/ready", response_model=Readiness)
async def ready() -> Readiness:
    settings = get_settings()
    assistant = Dependency(reachable=False)

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{settings.ollama_base_url}/api/tags")
            response.raise_for_status()
            names = {model["name"] for model in response.json().get("models", [])}
            if settings.ollama_model in names:
                assistant = Dependency(reachable=True)
            else:
                assistant = Dependency(
                    reachable=False,
                    detail=f"{settings.ollama_model} is not pulled",
                )
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        assistant = Dependency(reachable=False, detail=type(exc).__name__)

    # A missing assistant is degraded, not down: forecasts and windows still work.
    return Readiness(
        status="ready" if assistant.reachable else "degraded",
        assistant=assistant,
        model=settings.ollama_model,
    )
