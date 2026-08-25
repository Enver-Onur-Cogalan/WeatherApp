# ADR-0011 — GGUF engine over MLX, for schema enforcement

- **Status:** Accepted
- **Date:** 2026-08-25
- **Supersedes:** the model-variant part of [ADR-0005](./ADR-0005-gemma4-e4b.md)

## Context

[ADR-0005](./ADR-0005-gemma4-e4b.md) chose `gemma4:e4b-mlx`, the MLX build, because
Ollama 0.19 moved to MLX on Apple Silicon and roughly doubled decode throughput.

[ADR-0006](./ADR-0006-two-phase-tool-and-schema.md) then built the agent's second phase
on grammar-constrained decoding: hand Ollama a JSON Schema via `format`, and invalid
output becomes unreachable at the sampler.

Benchmarking revealed that the second assumption does not hold on the first choice.
**On the MLX engine, `format` is silently ignored.** No error, no warning, no field in
the response indicating it was dropped — the request succeeds and returns unconstrained
prose.

## Measurement

`benchmarks/engine_check.py`, same schema, same prompt, temperature 0, three runs each:

| Model | Engine | Schema enforced | Median latency |
|---|---|---|---|
| `llama3.2:1b` | GGUF | **100 %** (3/3) | 0.5 s |
| `gemma4:e4b-mlx` | MLX | **0 %** (0/3) | 0.6 s |

A **1B** model on GGUF returns schema-conformant JSON every time; a **4B** model on MLX
returns markdown prose every time. Model capability is not the variable. The engine is.

This reproduces [ollama/ollama#17013](https://github.com/ollama/ollama/issues/17013).
We measured it ourselves rather than citing it, because an architecture resting on a
bug report we have not reproduced is an architecture resting on hearsay.

## Decision

**Use GGUF builds.** The default model becomes `gemma4:e4b` rather than
`gemma4:e4b-mlx`. Schema enforcement is a correctness property; decode speed is a
comfort property. We do not trade the first for the second.

`OLLAMA_MODEL` remains configurable, and the harness is engine-agnostic, so this is
reversible the moment MLX gains grammar support.

## Consequences

**Positive**

- `format` works, so [ADR-0006](./ADR-0006-two-phase-tool-and-schema.md) phase 2 is
  buildable as designed.
- Structural validity is guaranteed by the sampler rather than hoped for and repaired.
- The constraint-tax hypothesis becomes measurable at all — under MLX, the "tools plus
  schema" condition was silently identical to "tools only", so the test measured nothing.

**Negative**

- Slower decode on Apple Silicon. Measured impact is smaller than feared: at
  `think: false` the two engines were within 0.1 s on this prompt.
- A second multi-gigabyte download for anyone who already pulled the MLX build.
- `benchmarks/results/*.mlx.json` measured schema behaviour that was never real. The
  files are kept, clearly labelled, because the negative result is the evidence for
  this decision.

## Alternatives considered

| Option | Why not |
|---|---|
| Stay on MLX, drop schema enforcement | Falls back to parsing prose and retrying — exactly the fragility constrained decoding exists to remove. Keeps a speed advantage measured at ~0.1 s. |
| Stay on MLX, validate and retry only | Already our safety net ([doc 04](../04-ai-agent-design.md)). A safety net is not a foundation. |
| Wait for MLX grammar support | Unscheduled upstream work. Not a plan. |

## Standing lesson

An advertised capability that fails **silently** is worse than one that fails loudly:
we would have built phase 2, watched it work in casual testing, and shipped an agent
whose central guarantee was absent. The benchmark harness caught it before a line of
agent code existed.

Every external guarantee this project depends on gets a test that proves it is real.
