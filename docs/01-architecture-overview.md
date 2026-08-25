# 01 — Architecture Overview

## The system in one picture

```
┌──────────────────────────┐
│   Expo application       │
│   ─────────────────      │
│   UI · animation         │
│   SQLite cache           │  offline-capable; renders without the backend
│   secure token store     │
└───────────┬──────────────┘
            │  HTTPS · JSON · SSE
            ▼
┌──────────────────────────┐
│   FastAPI service        │
│   ─────────────────      │
│   auth · rate limiting   │
│   request router  ───────┼──► fast path (no model involved)
│   scoring engine         │
│   agent orchestrator     │
└─────┬──────────────┬─────┘
      │              │
      ▼              ▼
┌───────────┐  ┌──────────────┐
│  Redis    │  │   Ollama     │
│  cache    │  │   Gemma 4    │  runs on the host on Apple Silicon,
└───────────┘  └──────────────┘  in a container on Linux
      │
      ▼
┌──────────────────────────┐
│   Open-Meteo             │  public forecast API, no key required
└──────────────────────────┘
```

## Repository layout

```
WeatherApp/
├── apps/mobile/          Expo application (TypeScript)
├── services/api/         FastAPI service and agent (Python)
├── packages/schema/      Shared contract: JSON Schema → Pydantic + Zod
├── evals/                Agent evaluation scenarios
├── docs/                 This folder
└── docker-compose.yml
```

### Why a monorepo

The mobile client and the service share one contract — the shape of a plan response.
Keeping them in separate repositories means that contract lives in two places and
drifts. Here it lives in `packages/schema` and is generated into both languages, so a
backend change that breaks the client fails the client's type check immediately.

This is the only reason for the monorepo. We are not chasing a shared build system.

## The three layers of the backend

The service is deliberately split so that **the model occupies the smallest possible
surface**.

| Layer | Responsibility | Language model involved? |
|---|---|---|
| **Data layer** | Fetch, cache, and normalise forecast data | No |
| **Domain layer** | Score hours against activity constraints; find windows | No |
| **Agent layer** | Interpret intent, select tools, phrase the answer | Yes |

Every number the user sees is produced by the domain layer. The agent may *describe*
a window, but it never *computes* one. This separation is the central architectural
commitment of the project and is recorded in
[ADR-0007](./adr/ADR-0007-deterministic-scoring-engine.md).

## Request lifecycle

A request for a plan travels through five stages:

```
1. Authenticate         JWT check, rate limit, request id assigned
2. Route                Which tier can answer this? (see doc 06)
3. Gather               Forecast data fetched in parallel, served from cache when warm
4. Score                Deterministic engine ranks hours against the activity profile
5. Respond              Either a templated answer, or a model-phrased one streamed via SSE
```

Stages 3 and 4 are pure functions over their inputs, which makes them trivially
testable. Stage 5 is the only non-deterministic part of the system, and it is the only
part that can fail in interesting ways — so it is the part the evaluation suite targets.

## Failure behaviour

The system is designed to lose capability rather than availability.

| What breaks | What the user experiences |
|---|---|
| Ollama not running | Everything works except natural-language questions; the app says so plainly |
| Backend unreachable | Cached forecast is shown with a visible "last updated" timestamp |
| Open-Meteo unreachable | Cached forecast is shown; the plan engine works on stale data and marks it |
| Model returns invalid output | Validation catches it, one retry, then a templated fallback answer |

There is no state in which the user is shown a spinner with no explanation, and no
state in which the user is shown a number the system is not confident about.

## Related decisions

- [ADR-0001 — React Native with Expo](./adr/ADR-0001-react-native-expo.md)
- [ADR-0002 — Python and FastAPI for the service](./adr/ADR-0002-python-fastapi-backend.md)
- [ADR-0003 — Open-Meteo as the forecast source](./adr/ADR-0003-open-meteo-data-source.md)
- [ADR-0007 — Deterministic scoring engine](./adr/ADR-0007-deterministic-scoring-engine.md)
