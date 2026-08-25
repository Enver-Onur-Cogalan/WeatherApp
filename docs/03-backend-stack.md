# 03 — Backend Stack

## Language and framework

Python with **FastAPI**. The reasoning is in
[ADR-0002](./adr/ADR-0002-python-fastapi-backend.md): the AI tooling ecosystem is
Python-first, and Pydantic gives us schema validation and OpenAPI generation from the
same type definitions.

## Dependencies

| Concern | Choice | Note |
|---|---|---|
| Web framework | FastAPI | Async, native SSE support, OpenAPI out of the box |
| Validation | Pydantic v2 | Also the source of the JSON Schema we hand to the model |
| HTTP client | httpx | Async; forecast endpoints are fetched concurrently |
| Package manager | uv | Fast, lockfile-based, produces small Docker layers |
| Cache | Redis | Forecast responses and agent outputs, with different TTLs |
| Database | PostgreSQL | Accounts, activity profiles, saved locations |
| Migrations | Alembic | Schema changes are versioned, not applied by hand |
| Lint / types / tests | ruff, mypy, pytest | All three run in CI on every pull request |

## Service layout

```
services/api/
├── app/
│   ├── api/            HTTP routes; thin, no logic
│   ├── auth/           Token issuing, rotation, password hashing
│   ├── weather/        Open-Meteo client, normalisation, cache
│   ├── planning/       Scoring engine — pure functions, no I/O
│   ├── agent/          Orchestrator, tool registry, providers
│   ├── routing/        Tier selection (see doc 06)
│   └── core/           Config, logging, dependencies
├── tests/
└── alembic/
```

The rule enforced by this layout: **`planning/` imports nothing from `agent/`.** The
scoring engine must remain usable, and testable, with no model present at all.

## Caching policy

Two caches with different reasoning behind their lifetimes:

| Cached item | TTL | Rationale |
|---|---|---|
| Forecast for a coordinate | 10 minutes | Open-Meteo updates hourly; 10 minutes is well inside that and keeps the app responsive |
| Agent response | 30 minutes, keyed by profile + location + day | The same question asked twice in an afternoon should not re-run the model |

Cache keys are built from rounded coordinates (2 decimal places, roughly 1 km). Users
standing on opposite sides of a street share a cache entry, which is correct — the
forecast is identical.

## Observability

- **Structured logging** with a request id propagated from the client, so a user report
  can be traced through the whole pipeline.
- **`/health`** — process is alive. **`/ready`** — dependencies reachable.
- **`/metrics`** — request counts by routing tier, latency percentiles, cache hit rate,
  model invocation count, validation failure and retry counts.

The routing-tier breakdown in `/metrics` is not only operational data; it is the
evidence for the claim made in [doc 06](./06-request-routing.md), that most requests
never need a language model.

## Rate limiting

Per-account and per-IP, enforced in Redis. This is a self-hosted service with a local
model behind it, and the model is the scarce resource: one user asking many open-ended
questions can starve everyone else on the same machine. Rate limiting here is about
fairness, not abuse.
