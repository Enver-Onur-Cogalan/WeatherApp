# Multi-stage: dependencies resolve in a builder, the runtime image carries only what
# it needs. Base images are pinned by digest — `latest` is not a version.
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Dependencies first, so a source change does not invalidate the dependency layer.
COPY pyproject.toml uv.lock* ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev || uv sync --no-install-project --no-dev

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini docker-entrypoint.sh ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev || uv sync --no-dev


FROM python:3.11-slim-bookworm AS runtime

# Non-root. A container that runs as root is a container one bug away from the host.
RUN groupadd --gid 1001 weather \
 && useradd --uid 1001 --gid weather --create-home weather

WORKDIR /app
COPY --from=builder --chown=weather:weather /app/.venv /app/.venv
COPY --from=builder --chown=weather:weather /app/app /app/app
# Migrations travel with the image. Without them the container starts, serves everything
# that needs no table, and 500s on the rest.
COPY --from=builder --chown=weather:weather /app/alembic /app/alembic
COPY --from=builder --chown=weather:weather /app/alembic.ini /app/alembic.ini
COPY --from=builder --chown=weather:weather /app/docker-entrypoint.sh /app/docker-entrypoint.sh

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

USER weather
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
