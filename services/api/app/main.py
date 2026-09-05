"""Application entry point."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response

from app.api import ask, auth, geocode, health, plan, saved
from app.core import deps
from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger, request_id_var

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level, json_output=settings.environment != "development")
    await deps.startup(settings)
    logger.info(
        "service.start",
        environment=settings.environment,
        model=settings.ollama_model,
        routing_enabled=settings.routing_enabled,
    )
    yield
    await deps.shutdown()
    logger.info("service.stop")


app = FastAPI(
    title="WeatherApp API",
    description="Forecast, scoring engine, and a planning agent that runs locally.",
    version="0.1.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def attach_request_id(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Carry the client's request id through, or mint one.

    Propagating the client's own id is what makes a user report traceable from the tap
    that caused it all the way to the model call.
    """
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    token = request_id_var.set(request_id)
    try:
        response = await call_next(request)
    finally:
        request_id_var.reset(token)
    response.headers["x-request-id"] = request_id
    return response


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(plan.router)
app.include_router(ask.router)
app.include_router(saved.router)
app.include_router(geocode.router)
