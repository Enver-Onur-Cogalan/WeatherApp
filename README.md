# WeatherApp

A weather app that answers a different question: **not what the weather is, but when to go.**

Describe what you do outdoors in your own words — *"I run in the mornings, I won't go out
above 26 degrees, I hate wind"* — and it finds the hours that clear your limits, with the
reason every other hour lost points.

The assistant that reads that sentence runs **entirely on your own machine**. No hosted
model, no API key, no request that leaves the server you run it on.

<!-- Screenshots: drop the four files into docs/screens/ with exactly these names. -->

| | | |
|---|---|---|
| ![İz — the day's comfort trace](docs/screens/iz.png) | ![Seven days as recorder cards](docs/screens/week.png) | ![Sor — the on-device assistant](docs/screens/sor.png) |
| **İz** — the day, scrubbable hour by hour, with the sky behind it reading the same forecast | **7 gün** — each day burned onto a card from the instrument | **Sor** — the assistant, running on your own hardware, and saying so |

## Why it is built this way

A weather app that fetches JSON and renders a list demonstrates nothing, so the
interesting parts are deliberately elsewhere.

- **The model never computes a number you see.** Scoring, comparison and window selection
  are ordinary tested Python. The model interprets your sentence and phrases the answer —
  that is all. It removes a whole class of confident, invisible errors
  ([ADR-0007](docs/adr/ADR-0007-deterministic-scoring-engine.md)).
- **Tool calling and structured output are separate model calls.** Combined in one
  request, tool calling drops from 75% to 0% on a 4B model. Measured, not assumed
  ([ADR-0006](docs/adr/ADR-0006-two-phase-tool-and-schema.md)).
- **Six gates stand between the model and you.** An answer that names a figure the tools
  never returned, invents a condition, gets a weekday wrong, contradicts its own verdict or
  leaks an internal identifier is rejected. It gets one chance to repair; then the scoring
  engine answers instead, in plainer words, and you are not told anything went wrong
  because nothing you need went wrong.
- **Most requests never reach the model at all.** A three-tier router answers common
  questions deterministically in milliseconds, which is faster, more reliable, and still
  works when the assistant is off ([doc 06](docs/06-request-routing.md)).
- **One schema, three consumers.** The API contract, the client types and the model's
  constrained-decoding format are generated from the same JSON Schema, so they cannot
  drift apart ([packages/schema](packages/schema)).
- **It works without an account, and without a network.** Guest mode is the design rather
  than a trial: profiles live on the device until you ask for them to live anywhere else
  ([ADR-0009](docs/adr/ADR-0009-jwt-auth-with-guest-mode.md)). The last answer to each
  question is cached on the phone, so the app opens and draws with the server asleep
  ([ADR-0016](docs/adr/ADR-0016-cache-the-scored-plan.md)).
- **The sky is a second reading of the same forecast.** Precipitation sets its density,
  wind the angle it falls at, cloud cover flattens the light, and the sun's real elevation
  moves the gradient. It is not decoration, and it is held to that
  ([ADR-0013](docs/adr/ADR-0013-data-driven-atmosphere.md)).

## What is measured

Two suites, and both keep their negative results.

**The agent**, over recorded fixtures at temperature 0, in Turkish and English
([doc 08](docs/08-evaluation-strategy.md)):

| | |
|---|---|
| Runs passing every check | 20/20 |
| Answered by the model | 80% — the rest are refusals, which is the designed behaviour |
| **Reached the user wrong** | **0** |
| Median answer time | 39.6s, on an M-series laptop, for a question that reaches the model |

CI gates on the last row rather than on the headline. A fallback is the system working; a
wrong answer reaching a person is a defect at any rate. A suite that fails on every flake
gets switched off rather than fixed.

**The model**, for what this application needs from it rather than for general capability
([benchmarks/](benchmarks)). Both findings below would have failed silently in production:

| Measurement | Result |
|---|---|
| Schema enforced, GGUF engine | 100% |
| Schema enforced, MLX engine | **0%** — `format` is dropped with no error |
| Tool calling, tools only | 75% |
| Tool calling, tools **and** schema together | **0%** |

Reproduce them:

```bash
python3 benchmarks/engine_check.py gemma4:e4b --repeat 3
python3 benchmarks/run.py gemma4:e4b --repeat 3
python3 evals/run.py --repeat 3
```

## Running it

Ollama runs on the **host** on Apple Silicon — containers on macOS have no Metal access,
and an Ollama container there is slow enough to feel broken
([ADR-0010](docs/adr/ADR-0010-ollama-on-host-for-apple-silicon.md)).

```bash
# macOS
brew install ollama && ollama serve
ollama pull gemma4:e4b

cp .env.example .env      # set JWT_SECRET — compose refuses to start without one
docker compose up
```

```bash
# Linux with a GPU — one command, nothing on the host
docker compose --profile bundled up
docker compose exec ollama ollama pull gemma4:e4b
```

Then the app:

```bash
npm install
npm run mobile
```

The phone finds the API by itself: with no `EXPO_PUBLIC_API_URL` set, it borrows the
address of whichever machine is serving the bundle.

For a tighter loop on the service, `npm run api` runs it outside Docker. It binds every
interface, because `uvicorn` otherwise listens on loopback only and the app then cannot
reach it from a phone on the same network — which looks exactly like the app being broken.
It reads `services/api/.env` if there is one and falls back to the root `.env`, so the same
secret can serve both paths.

## Layout

```
apps/mobile/       Expo app — React Native, TypeScript, Skia, Reanimated, Drizzle
services/api/      FastAPI service, scoring engine, planning agent, accounts
packages/schema/   JSON Schema → Pydantic + Zod. One definition, three consumers
benchmarks/        Local model measurements
evals/             Agent evaluation scenarios
docs/              How it works, and why each decision went the way it did
```

## Documentation

`docs/` is the reasoning, not a summary of the code. Start at
[docs/README.md](docs/README.md).

The numbered documents explain how each part works; `docs/adr/` records the decisions with
the alternatives that lost. Several of them are more interesting than the code:

- [Local LLM research](docs/05-local-llm-research.md) — why a 4B model, and what breaks at
  that size
- [Request routing](docs/06-request-routing.md) — deciding when *not* to call a model
- [Evaluation strategy](docs/08-evaluation-strategy.md) — how we know the agent works, and
  the three defects the suite found on its first run
- [Design language](docs/10-design-language.md) — the instrument direction, and why the
  ink follows the light
- [Data model](docs/12-data-model.md) — two stores that are deliberately not the same
  schema

Every document ends with a "Still open" section, and they are kept honest.

## Status

Working end to end, and not finished.

**Built:** the scoring engine and its tests; the planning agent with its gates, repair and
fallback; the evaluation suite; the API including accounts, rotating refresh tokens and
rate limiting; the mobile app — the trace, the week, the assistant, the account screen and
the gate — with a device database, offline plans, guest mode and the handoff into an
account.

**Not built:** notification rules. Password reset, which needs mail infrastructure a self-hosted instance
may not have and is
[documented rather than half-implemented](docs/07-auth-and-security.md). And there are no
tests on the mobile side at all — types, lint, a shader compile check and a migration check
are the whole safety net, and none of them would notice a screen rendering the wrong thing.

## Licence

MIT.
