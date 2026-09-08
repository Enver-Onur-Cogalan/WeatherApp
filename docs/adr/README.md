# Architecture Decision Records

Each file here records **one decision**: the situation that forced it, what we chose,
what that costs us, and what we rejected.

The format is deliberately short. An ADR that takes fifteen minutes to read does not
get written, and a decision that is not written down gets re-argued six months later by
people who no longer remember the reasoning.

## Format

```
Status      Proposed · Accepted · Superseded by ADR-XXXX
Context     What made a decision necessary
Decision    What we chose, stated in one sentence
Consequences  What we gain, and what we now have to live with
Alternatives  What we rejected, and why
```

An ADR is **immutable once accepted**. If we change our minds, we write a new ADR that
supersedes the old one; we do not edit history. Being able to see that a decision was
reversed — and why — is more valuable than a tidy folder.

## Index

| # | Decision | Status | Date |
|---|---|---|---|
| [0001](./ADR-0001-react-native-expo.md) | React Native with Expo for the mobile client | Accepted | 2026-08-21 |
| [0002](./ADR-0002-python-fastapi-backend.md) | Python and FastAPI for the backend service | Accepted | 2026-08-21 |
| [0003](./ADR-0003-open-meteo-data-source.md) | Open-Meteo as the forecast data source | Accepted | 2026-08-21 |
| [0004](./ADR-0004-local-only-llm.md) | Local-only language model, no hosted provider | Accepted | 2026-08-21 |
| [0005](./ADR-0005-gemma4-e4b.md) | Gemma 4 E4B as the default model | Partially superseded by 0011 | 2026-08-21 |
| [0006](./ADR-0006-two-phase-tool-and-schema.md) | Separate tool-calling and structured-output phases | Accepted | 2026-08-21 |
| [0007](./ADR-0007-deterministic-scoring-engine.md) | Scoring and arithmetic stay out of the model | Accepted | 2026-08-21 |
| [0008](./ADR-0008-tiered-request-routing.md) | Three-tier request routing | Accepted | 2026-08-21 |
| [0009](./ADR-0009-jwt-auth-with-guest-mode.md) | JWT authentication with a guest mode | Accepted | 2026-08-21 |
| [0010](./ADR-0010-ollama-on-host-for-apple-silicon.md) | Ollama on the host on Apple Silicon | Accepted | 2026-08-21 |
| [0011](./ADR-0011-gguf-engine-over-mlx.md) | GGUF engine over MLX, for schema enforcement | Accepted | 2026-08-25 |
| [0012](./ADR-0012-instrument-visual-direction.md) | Instrument as the visual direction | Accepted | 2026-08-25 |
| [0013](./ADR-0013-data-driven-atmosphere.md) | Atmosphere as a second reading, not decoration | Accepted | 2026-08-25 |
| [0014](./ADR-0014-planner-on-main-screen.md) | The planner's output is the main screen | Accepted | 2026-08-25 |
| [0015](./ADR-0015-client-ids-and-sync.md) | Client-generated ids, server authority, last-write-wins | Accepted | 2026-08-25 |
| [0016](./ADR-0016-cache-the-scored-plan.md) | The device caches the scored plan, not the raw forecast | Accepted | 2026-09-05 |
| [0017](./ADR-0017-assistant-that-advises.md) | The assistant converses and advises, within the engine's numbers | Accepted | 2026-09-05 |
| [0018](./ADR-0018-language-is-chosen-not-detected.md) | The person chooses the language; the server checks the answer against it | Accepted | 2026-09-05 |
