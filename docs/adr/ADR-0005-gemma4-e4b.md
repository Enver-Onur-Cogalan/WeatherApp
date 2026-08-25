# ADR-0005 — Gemma 4 E4B as the default model

- **Status:** Partially superseded by [ADR-0011](./ADR-0011-gguf-engine-over-mlx.md)
- **Date:** 2026-08-21

> **Note (2026-08-25):** the model *family and size* chosen here still stand.
> The **`-mlx` build variant** does not: benchmarking showed the MLX engine silently
> ignores schema constraints. The default is now the GGUF build, `gemma4:e4b`.
> See [ADR-0011](./ADR-0011-gguf-engine-over-mlx.md).

## Context

Having committed to a local model ([ADR-0004](./ADR-0004-local-only-llm.md)), the
selection is bounded by the reference machine: an Apple M3 with 16 GB of unified
memory, running an Expo dev server, an iOS simulator, and Docker at the same time. The
realistic budget for the model is 4–6 GB.

Full research and benchmark table: [doc 05](../05-local-llm-research.md).

## Decision

Default to **`gemma4:e4b-mlx`**, with the model tag configurable via `OLLAMA_MODEL`.

## Consequences

**Positive**

- Fits the reference machine while leaving room for the development toolchain.
- Native function calling and configurable thinking, neither of which the previous
  generation had at this size.
- MLX build; Ollama 0.19 moved to MLX on Apple Silicon and roughly doubled decode speed.
- τ2-bench 42.5 % is weak in absolute terms — and that is deliberate. Demonstrating that
  a model at this level can be made reliable is more interesting than demonstrating that
  a 32B model works.

**Negative**

- Tool-calling reliability is genuinely marginal. Every countermeasure in
  [doc 04](../04-ai-agent-design.md) exists because of this number.
- Unusual phrasing will sometimes produce prose where a tool call was needed. The
  router absorbs part of this; validation and fallback absorb the rest.
- If evaluation shows tool calling failing too often, the fallback position is to drop
  Phase 1 tool calling entirely and dispatch deterministically, leaving the model with
  intent classification and synthesis only. This is written down now so that it reads as
  a plan rather than a retreat.

## Alternatives considered

| Option | Why not |
|---|---|
| Gemma 4 26B MoE | τ2-bench 88.3 % with only 3.8B active parameters — the best ratio available. Needs ~18 GB. **Recommended default for 32 GB machines**, and reachable by changing one environment variable. |
| Gemma 4 12B | Smaller on disk than E4B, which is surprising enough to be worth benchmarking. Flagged for empirical comparison rather than assumed. |
| Gemma 4 E2B | Smaller and faster, but below the threshold where tool calling is workable at all. |
| Llama 3.2 3B | Adequate for classification, insufficient for multi-step planning. |
| Qwen3 7B | Strong at tool calling, but the memory budget on the reference machine does not accommodate it alongside the dev toolchain. |
