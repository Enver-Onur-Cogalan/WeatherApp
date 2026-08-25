# ADR-0006 — Separate tool-calling and structured-output phases

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

The agent needs two things from the model in a single logical turn: choose and call
tools, then return an answer matching a fixed schema. The obvious implementation asks
for both in one request — tools declared, schema constrained, one call.

Research published this year ("Constraint Tax in Open-Weight LLMs") finds that applying
structured-output constraints **suppresses tool calling** in open-weight models. The
effect is most severe on small models, which is exactly our situation. Grammar-constrained
decoding restricts the sampler to tokens that keep the JSON valid; a tool call is not
valid JSON under that grammar, so the path to calling a tool is narrowed at the sampler
level.

## Decision

Split the turn into **two model calls**:

```
Phase 1   tools declared · no schema constraint · model gathers what it needs
Phase 2   schema constrained · no tools · model fills the structure
```

## Consequences

**Positive**

- Each phase asks the model for one thing. Small models are markedly better at narrow
  tasks than at compound ones.
- Phase 2 output cannot be malformed — the grammar makes invalid JSON unreachable.
- The two phases can use different settings: Phase 1 may think, Phase 2 does not need to.
- Each phase is independently testable and independently replaceable. If Phase 1 proves
  unreliable, it can be swapped for a deterministic dispatcher without touching Phase 2.

**Negative**

- Two round trips instead of one. On a local model that is roughly double the latency
  for Tier 2 requests — a real cost, partly offset by routing most traffic away from
  Tier 2 entirely ([ADR-0008](./ADR-0008-tiered-request-routing.md)).
- More orchestration code, and state to carry between the phases.

## Alternatives considered

| Option | Why not |
|---|---|
| Single call with both | The documented failure mode we are avoiding. |
| Tools only, parse prose afterwards | Reintroduces parsing fragility that constrained decoding exists to eliminate. |
| Schema only, no tools at all | Viable and simpler, and it remains the fallback if Phase 1 measures poorly. Not chosen first because tool calling is what makes the planner extensible. |

## Measured on our own stack (2026-08-25)

The published finding is now confirmed by our own measurement, and the effect is far
stronger than "degraded". `gemma4:e4b` (GGUF), 8 cases, 3 repeats, temperature 0:

| Condition | Called a tool |
|---|---|
| Tools declared, no schema | **75 %** |
| Tools declared **and** schema applied | **0 %** |

**Constraint tax: 75 points. Not degradation — total suppression.** All 24 runs of the
constrained condition returned zero tool calls, including the four cases that selected
the correct tool every time without the constraint.

Each capability works in isolation. Schema-only produced valid, Turkish, schema-conformant
JSON in 100 % of runs. Tools-only selected correctly in 75 %. Combined, tool calling
disappears entirely.

The mechanism is visible in the result: grammar-constrained decoding restricts the
sampler to tokens that keep the output valid against the schema, and a tool call is not
a valid document under that grammar. The model is not choosing not to call a tool — the
tokens that would begin one are unreachable.

An earlier attempt to measure this produced a flat 0 % tax and looked like a clean null
result. It was measuring nothing: the MLX engine was silently discarding the schema, so
both conditions were identical ([ADR-0011](./ADR-0011-gguf-engine-over-mlx.md)).

This ADR is therefore **confirmed empirically**, not merely by citation. Combining the
two phases would not have degraded the agent; it would have disabled it.

## Source

- [Constraint Tax in Open-Weight LLMs: Tool Calling Suppression Under Structured Output Constraints](https://arxiv.org/pdf/2606.25605)
