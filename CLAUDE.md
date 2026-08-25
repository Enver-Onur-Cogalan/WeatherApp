# WeatherApp

A weather app whose planning agent runs entirely on a **local** model. No hosted
provider, no API key. Portfolio project, open source, built to be read.

**Read `docs/` before changing anything.** `docs/README.md` is the index; the numbered
documents explain how parts work, and `docs/adr/` records why each decision went the way
it did. The reasoning is not in the code.

## Language

- **Conversation with the user: Turkish.** Full orthography — ğ, ı, İ, ş, ç, ö, ü.
- **Everything committed: English.** Docs, ADRs, code, comments, commit messages.
- **The app's UI is bilingual** (Turkish and English), neither a translation layer over
  the other. Sample content in specs and mockups is Turkish.

## Architecture rules that are not negotiable

| Rule | Why |
|---|---|
| The model never computes a number the user sees | `docs/adr/ADR-0007` — scoring is tested Python, not a 4B model's arithmetic |
| `planning/` imports nothing from `agent/` | The scoring engine must work and be testable with no model present |
| Tool calling and schema-constrained output are **separate model calls** | `ADR-0006` — combined, tool calling drops to 0%. Measured, not assumed |
| GGUF model builds, never `-mlx` | `ADR-0011` — the MLX engine silently ignores `format` |
| No secrets in the mobile bundle | It is trivially extractable; this is part of why the backend exists |
| Canonical units and UTC in storage | Convert at render. `docs/12` |

## Working conventions

**ADRs are immutable once accepted.** To change a decision, write a new ADR that
supersedes the old one and add a note at the top of the old one. Never edit the original
reasoning away — seeing that a decision was reversed, and why, is the point. Use the `adr`
skill.

**Measure before building on an external guarantee.** Two documented capabilities in this
project turned out to be absent or actively harmful, and both would have failed silently.
Prefer a small reproducible script in `benchmarks/` over citing a bug report. Keep negative
results committed and labelled.

**Write uncertainty down.** A doc that says "we do not know this yet" is more useful than
one that pretends. Every doc ends with a "Still open" section; keep it honest.

**Numbers are dated and sourced.** Benchmarks age fast; an undated benchmark is a rumour.

## Commit messages

English, plain prose, no bullet-point summaries of the diff. Explain what changed and
**why it changed** — especially anything that surprised us or reversed an earlier
decision. Body wrapped at 76 characters.

## Stack

| | |
|---|---|
| Mobile | React Native + Expo, TypeScript, `expo-router`, TanStack Query, Zustand, Drizzle, Reanimated, Skia |
| Backend | Python, FastAPI, Pydantic v2, `uv`, httpx, Redis, PostgreSQL, Alembic |
| Model | Ollama, `gemma4:e4b` (GGUF), `think: false` unless the task is genuinely multi-step |
| Data | Open-Meteo, no API key |
| Quality | ruff, mypy, pytest on the server; the eval suite in `evals/` for the agent |

## Repository

```
apps/mobile/      Expo app
services/api/     FastAPI service and agent
packages/schema/  JSON Schema → Pydantic + Zod. One definition, three consumers
benchmarks/       Local model measurements (see benchmarks/README.md)
evals/            Agent evaluation scenarios
docs/             Narrative documents and ADRs
```

`packages/schema` exists so the API contract and the model's constrained-decoding contract
cannot drift apart. Change the schema there, not in either consumer.

## Local model

Ollama runs on the **host** on Apple Silicon (containers have no Metal access) and in a
container on Linux. The whole difference is `OLLAMA_BASE_URL`. See `ADR-0010`.

```bash
ollama serve                     # if not already running
python3 benchmarks/run.py gemma4:e4b --repeat 3
python3 benchmarks/report.py --write
```
