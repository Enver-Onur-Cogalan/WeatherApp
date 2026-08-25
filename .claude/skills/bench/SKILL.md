---
name: bench
description: Run the local model benchmark for WeatherApp and regenerate the comparison table. Use when evaluating a new model, checking whether a model change broke tool calling or schema enforcement, or verifying a claim about what a local model can do before building on it.
---

# Running the model benchmark

`benchmarks/` measures what this application actually needs from a model — not general
capability. Read `benchmarks/README.md` for what each test means.

## Preflight

```bash
curl -s http://localhost:11434/api/version || (nohup ollama serve > /tmp/ollama-serve.log 2>&1 &)
ollama list
```

If the model is not present, `ollama pull <tag>`. Pulls are multi-gigabyte — run them in
the background and tell the user the size before starting.

## The two scripts

```bash
# Does this engine actually enforce a JSON schema? Run this FIRST for any new model.
python3 benchmarks/engine_check.py <model> --repeat 3

# Full run: tool selection, structured output, constraint tax, language.
python3 benchmarks/run.py <model> --repeat 3
python3 benchmarks/report.py --write        # regenerates results/COMPARISON.md
```

`run.py` takes several minutes per model on GGUF builds. Run it in the background.

## Reading the results

- **Schema valid 0%** almost certainly means the engine is dropping `format`, not that the
  model failed. Confirm with `engine_check.py` before concluding anything about the model.
  This is exactly what `ADR-0011` was written about.
- **Constraint tax ≈ 0** is only meaningful if schema enforcement is working. On an engine
  that ignores `format`, both conditions are identical and the test measures nothing.
- **Tool call misses**: check whether the model chose the *wrong* tool or *no* tool. No
  tool is a safe failure that routing absorbs; wrong tool corrupts an answer.
- Raw per-sample responses are in `benchmarks/results/*.json` — trace any surprising number
  back to the response that produced it before believing it.

## When the numbers change a decision

Write an ADR (use the `adr` skill) and update `docs/05-local-llm-research.md` with the
measurement, dated. Keep superseded result files — a negative result is the evidence for
the decision it caused.
