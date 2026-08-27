# WeatherApp

A weather app that answers a different question: **not what the weather is, but when to go.**

Describe what you do outdoors in your own words — *"I run in the mornings, I won't go out
above 26 degrees, I hate wind"* — and it finds the hours that clear your limits, with the
reason every other hour lost points.

The assistant that reads that sentence runs **entirely on your own machine**. No hosted
model, no API key, no request that leaves the device it runs on.

## Why it is built this way

A weather app that fetches JSON and renders a list demonstrates nothing, so the
interesting parts are deliberately elsewhere:

- **The model never computes a number you see.** Scoring, comparison and window
  selection are ordinary tested Python. The model interprets your sentence and phrases
  the answer — that is all. It removes a whole class of confident, invisible errors
  ([ADR-0007](docs/adr/ADR-0007-deterministic-scoring-engine.md)).
- **Tool calling and structured output are separate model calls.** Combined in one
  request, tool calling drops from 75% to 0% on a 4B model. We measured that rather
  than assuming it ([ADR-0006](docs/adr/ADR-0006-two-phase-tool-and-schema.md)).
- **Most requests never reach the model at all.** A three-tier router answers common
  questions deterministically in milliseconds, which is faster, more reliable, and
  still works when the assistant is off ([doc 06](docs/06-request-routing.md)).
- **One schema, three consumers.** The API contract, the client types, and the model's
  constrained-decoding format are generated from the same JSON Schema, so they cannot
  drift apart.

## Running it

Ollama runs on the **host** on Apple Silicon — containers on macOS have no Metal access,
and an Ollama container there is slow enough to feel broken
([ADR-0010](docs/adr/ADR-0010-ollama-on-host-for-apple-silicon.md)).

```bash
# macOS
brew install ollama && ollama serve
ollama pull gemma4:e4b

cp .env.example .env      # set JWT_SECRET — the service will not start without one
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

## Layout

```
apps/mobile/       Expo app (React Native, TypeScript)
services/api/      FastAPI service, scoring engine, planning agent
packages/schema/   JSON Schema → Pydantic + Zod. One definition, three consumers
benchmarks/        Local model measurements
docs/              How it works, and why each decision went the way it did
```

## Documentation

`docs/` is the reasoning, not a summary of the code. Start at
[docs/README.md](docs/README.md).

The numbered documents explain how each part works; `docs/adr/` records the decisions
with the alternatives that lost. Several of them are more interesting than the code:

- [Local LLM research](docs/05-local-llm-research.md) — why a 4B model, and what breaks
  at that size
- [Request routing](docs/06-request-routing.md) — deciding when *not* to call a model
- [Evaluation strategy](docs/08-evaluation-strategy.md) — how we know the agent works
- [Design language](docs/10-design-language.md) — the instrument direction

## Benchmarks

`benchmarks/` measures what this application needs from a model, not general capability.
Both findings below would have failed silently in production:

| Measurement | Result |
|---|---|
| Schema enforced, GGUF engine | 100% |
| Schema enforced, MLX engine | **0%** — `format` is dropped with no error |
| Tool calling, tools only | 75% |
| Tool calling, tools **and** schema together | **0%** |

Reproduce them yourself:

```bash
python3 benchmarks/engine_check.py gemma4:e4b --repeat 3
python3 benchmarks/run.py gemma4:e4b --repeat 3
```

## Status

Design and skeleton. The scoring engine is real and tested; the agent, the API surface
and the app screens are not written yet.

## Licence

MIT.
