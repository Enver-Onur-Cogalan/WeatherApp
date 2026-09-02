# 05 — Local LLM Research

*Research conducted 2026-08-21. Benchmarks age quickly; treat every number here as dated.*

## The question

We committed to running without a hosted model ([ADR-0004](./adr/ADR-0004-local-only-llm.md)).
That turns model selection into a hardware problem: what is the most capable model that
runs comfortably on a developer laptop **while an Expo dev server, an iOS simulator, and
Docker are also running**?

## Target hardware

The reference machine is the development machine:

```
Apple M3 · 16 GB unified memory · macOS 15.5
```

16 GB is the constraint that decides everything. With the simulator and dev tooling
resident, the realistic budget for the model is **4–6 GB**. This rules out the larger
open-weight models regardless of how well they benchmark.

## Landscape

Google's **Gemma 4** family (released 2026) was the deciding factor. It ships with
native function calling, configurable thinking, and edge-sized variants — a combination
that did not exist in the previous generation.

τ2-bench measures agentic tool use. The generational jump is dramatic:

| Model | τ2-bench | Ollama size | Verdict for us |
|---|---|---|---|
| Gemma 3 27B | 6.6 % | — | Previous generation; tool calling effectively unusable |
| **Gemma 4 E4B** | **42.5 %** | 8.8 GB (MLX) | **Selected** — see below |
| Gemma 4 12B | — | 7.7 GB (MLX) | Worth benchmarking; smaller on disk than E4B |
| Gemma 4 26B (MoE) | 88.3 % | 18 GB | Excellent ratio — 3.8B active params — but needs 32 GB |
| Gemma 4 31B | 86.4 % | 19 GB | Out of reach |

Two observations worth recording:

1. **The 26B MoE is the interesting model.** It activates only 3.8B parameters per
   token, so it runs at roughly small-model speed while scoring near the dense 31B. On a
   32 GB machine it would be the obvious choice. We note this as the recommended
   configuration for anyone deploying to a larger machine.
2. **Size on disk is not proportional to parameter count** in this family — the 12B
   variant is *smaller* than E4B, presumably due to different quantisation. This is
   flagged for empirical testing rather than assumed.

## Where small models actually fail

The literature and community consensus are consistent about the failure modes of
sub-14B models on tool calling, and they shaped our design directly:

| Failure mode | Our countermeasure |
|---|---|
| Long tool descriptions confuse the model | Descriptions capped at two lines |
| Multiple tools in one request are mishandled | Three tools total; most capability lives in code |
| Unusual phrasing produces prose instead of a tool call | Router handles common phrasings before the model sees them |
| Complex parameter types yield invalid JSON | Constrained decoding; flat schemas only |
| Schema constraints suppress tool calling | Two-phase execution ([ADR-0006](./adr/ADR-0006-two-phase-tool-and-schema.md)) |

The general advice in the community is to start at 14B or above for agentic work. We
are deliberately going below that line, because making a 4B model reliable is a more
interesting engineering problem than making a 32B model comfortable — and because the
countermeasures above are the actual content of this project.

## Runtime

**Ollama 0.19** (March 2026) replaced its inference engine with **MLX** on Apple
Silicon, roughly doubling decode throughput. We use the `-mlx` model variants on macOS
for this reason.

Ollama's `format` parameter accepts a JSON Schema, compiles it to a GBNF grammar, and
constrains the sampler so output cannot deviate from the schema. Pydantic's
`model_json_schema()` feeds it directly, which means our API contract and our model
constraint are generated from the same type definition.

**The limit of that guarantee**, stated plainly because it matters: grammar constraints
ensure *structural* validity only. They do not ensure that values are accurate rather
than hallucinated. Groundedness checking ([doc 04](./04-ai-agent-design.md)) exists
precisely because constrained decoding does not solve it.

## Measured results (2026-08-25)

Thinking disabled, temperature 0, three repeats per case (`benchmarks/run.py`).
Full table: `benchmarks/results/COMPARISON.md`.

| Measurement | `gemma4:e4b` (GGUF) | `gemma4:e4b-mlx` (MLX) |
|---|---|---|
| Correct tool selected | 75 % | 75 % |
| Called any tool | 75 % | 75 % |
| Schema valid | **100 %** | **0 %** — engine defect |
| Plausible hour values | 100 % | 0 % |
| Tool calls with schema applied | **0 %** | 75 % (schema was ignored) |
| Constraint tax | **75 points** | not measurable |
| Answered Turkish in Turkish | 100 % | 100 % |
| Median latency | 1.9 s | 0.6 s |

Four findings, in order of how much they changed the design.

### 1. Schema enforcement was absent, and silent

The MLX engine ignores the `format` parameter entirely. This invalidated the schema
test *and* the constraint-tax test, and it moved the project to GGUF builds —
[ADR-0011](./adr/ADR-0011-gguf-engine-over-mlx.md) carries the measurement and the
reasoning.

### 2. Thinking mode costs twenty times the latency

Same prompt, same model, one parameter changed:

| `think` | Latency | Output tokens |
|---|---|---|
| `true` (default) | 12.1 s | 347 |
| `false` | 0.6 s | 28 |

[Doc 04](./04-ai-agent-design.md) already argued for using thinking selectively. This is
the number behind that argument: leaving it on by default would make every request feel
broken, for no measured gain on single-step tasks.

### 3a. The 75% was a property of the prompt, not the model

Measured later, while building the agent (2026-08-30). Same model, same tools, same four
questions — only the system prompt changed:

| System prompt | Called a tool |
|---|---|
| "Use the tools to gather facts before answering." | **1 / 4** |
| "You have no weather data of your own. You MUST call a tool before answering." | **4 / 4** |

The benchmark's neutral prompt was measuring how willing the model was to volunteer, not
whether it could. Most of what looked like weak tool calling was the prompt declining to
insist. The benchmark figure stands as a number about *that* prompt; it is not a ceiling.

### 3. Tool calling works, and fails in the safe direction

75 % is unimpressive in isolation, but the *shape* of the failures matters more than the
rate. Both misses were **omissions, not errors** — the model returned prose instead of
calling a tool. It never selected the wrong tool.

The two failures were an indirect phrasing (*"we're thinking of having a picnic this
weekend"*) and a plain English forecast question. The second is a Tier 0 request that
should never reach the model at all, which means the router
([doc 06](./06-request-routing.md)) removes it from the model's workload rather than
requiring the model to improve.

A model that stays silent when unsure is far easier to build around than one that
guesses confidently. Omissions escalate a tier; wrong tool calls would corrupt an
answer.

### 4. The constraint tax is total, not partial

The single most consequential measurement in this project so far:

| Condition | Called a tool |
|---|---|
| Tools declared, no schema | 75 % |
| Tools declared **and** schema applied | **0 %** |

Both capabilities work alone. Together, one of them vanishes — in all 24 runs, without
exception. The published research describes tool calling being *suppressed*; on a 4B
model the suppression is complete.

[ADR-0006](./adr/ADR-0006-two-phase-tool-and-schema.md) split the agent's turn into two
phases on the strength of that paper, before we could test it. Had we combined them, the
agent would not have worked at all — and the failure would have been quiet, since the
model returns a well-formed, plausible-looking response with no tool call in it.

## Apple Silicon and Docker

Containers on macOS have no access to Metal. An Ollama container on this machine would
fall back to CPU inference and be unusably slow. The deployment topology therefore
differs by platform — Ollama runs on the host on macOS, in a container on Linux. This
is covered in [ADR-0010](./adr/ADR-0010-ollama-on-host-for-apple-silicon.md).

## Rejected alternative: Apple Foundation Models

Apple's on-device framework offers guided generation and built-in tool calling, which
is a close fit. Rejected for three reasons: it requires macOS/iOS 26 (the reference
machine runs 15.5), it is Apple-only, and reaching it from Expo would require a native
module. A cross-platform project cannot depend on it.

## Sources

- [Welcome Gemma 4 — Hugging Face](https://huggingface.co/blog/gemma4)
- [Function calling with Gemma 4 — Google AI for Developers](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4)
- [Ollama — Structured outputs](https://ollama.com/blog/structured-outputs)
- [Constraint Tax in Open-Weight LLMs (arXiv)](https://arxiv.org/pdf/2606.25605)
- [Best Local Models for Tool Calling in 2026](https://www.promptquorum.com/power-local-llm/best-local-models-tool-calling-2026)
- [Best Local LLMs to Run On Every Apple Silicon Mac in 2026](https://apxml.com/posts/best-local-llms-apple-silicon-mac)
- [Best Ollama Local Models for Tool Calling / Agent Tasks](https://clawdbook.org/blog/openclaw-best-ollama-models-2026)
