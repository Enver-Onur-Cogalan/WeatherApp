# Benchmarks

A small harness that measures whether a locally-served model is good enough to run the
planning agent — and by how much our design choices help.

It is not a general model benchmark. It asks four questions that matter to *this*
application, using *this* application's tool surface and schema.

## What it measures

| Test | Question | Why we care |
|---|---|---|
| **A. Tool selection** | Given three tools, does the model call the right one? | The baseline for phase 1 of the agent |
| **B. Structured output** | Under grammar-constrained decoding, is the output usable? | The baseline for phase 2 |
| **C. Constraint tax** | Does declaring tools *and* a schema together suppress tool calling? | Direct evidence for or against [ADR-0006](../docs/adr/ADR-0006-two-phase-tool-and-schema.md) |
| **D. Language** | Does a Turkish question get a Turkish answer? | Turkish is a first-class language here, not an afterthought |

Test C is the interesting one. [Published research](https://arxiv.org/pdf/2606.25605)
reports that structured-output constraints suppress tool calling in open-weight models,
and our two-phase architecture is built on that claim. This harness checks whether the
effect actually shows up on the model we ship — because designing around a finding we
have not reproduced would be cargo-culting.

## Running

Requires Ollama on `localhost:11434` and the model pulled. No Python dependencies.

```bash
python3 run.py gemma4:e4b-mlx
python3 run.py gemma4:e4b-mlx gemma4:12b-mlx --repeat 5
```

Results land in `results/<model>.json`, including every raw sample so a surprising
number can be traced back to the exact response that produced it.

## Method notes

- **Temperature 0.** We are measuring capability, not creativity.
- **Repeated runs.** A model that passes once and fails once in five has not passed.
  Every figure is a rate, never a single outcome.
- **Real fixture data.** `fixtures/istanbul.json` is a genuine Open-Meteo response,
  saved once. Live data would make results irreproducible.
- **First-call-only scoring** for tool selection. If the model calls the right tool
  second, after a wrong one, that is a miss — an agent loop would already have acted on
  the first call.
- **Turkish and English cases in equal measure.** A model that only works in English
  fails this application.

## Interpreting results

There is no passing grade. The numbers feed two decisions:

1. **Which model ships by default** ([ADR-0005](../docs/adr/ADR-0005-gemma4-e4b.md)).
2. **Whether phase 1 keeps tool calling at all.** If tool selection is poor enough,
   the fallback is a deterministic dispatcher with the model reduced to intent
   classification and synthesis. That decision is empirical, and this is the
   measurement that makes it.
