#!/usr/bin/env python3
"""
Does Ollama actually enforce a JSON schema on this model?

Ollama's `format` parameter is documented to compile a JSON Schema into a grammar
and constrain the sampler. On the MLX engine (Apple Silicon, Ollama >= 0.19) it is
silently ignored — no error, no warning, just unconstrained prose.

This script measures that directly, so the project's architecture rests on a
measurement we made rather than on a bug report we read.

Usage:
    python3 engine_check.py llama3.2:1b gemma4:e4b-mlx --repeat 3
"""

import argparse
import json
import statistics
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
OLLAMA = "http://localhost:11434/api/chat"

SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["good", "mixed", "bad"]},
        "hour": {"type": "integer"},
    },
    "required": ["verdict", "hour"],
}

PROMPT = (
    "Istanbul at 6am: 21C, wind 10km/h, no rain. "
    "Good for running? Answer with verdict and hour."
)


def call(model, timeout=300):
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": PROMPT}],
        "stream": False,
        "options": {"temperature": 0},
        "format": SCHEMA,
        "think": False,
    }
    req = urllib.request.Request(
        OLLAMA,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    started = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read()), time.perf_counter() - started


def evaluate(content):
    """Did the schema actually constrain the output?"""
    try:
        parsed = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return {"parses": False, "conforms": False}
    return {
        "parses": True,
        "conforms": parsed.get("verdict") in ("good", "mixed", "bad")
        and isinstance(parsed.get("hour"), int),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("models", nargs="+")
    parser.add_argument("--repeat", type=int, default=3)
    args = parser.parse_args()

    report = {"schema": SCHEMA, "prompt": PROMPT, "repeat": args.repeat, "models": {}}

    print(f"\n{'model':<22} {'schema enforced':>16} {'median latency':>16}")
    print("-" * 58)

    for model in args.models:
        samples, latencies = [], []
        for _ in range(args.repeat):
            response, elapsed = call(model)
            content = response.get("message", {}).get("content", "")
            result = evaluate(content)
            result["raw"] = content[:200]
            samples.append(result)
            latencies.append(elapsed)

        rate = sum(s["conforms"] for s in samples) / args.repeat
        median = statistics.median(latencies)
        report["models"][model] = {
            "conform_rate": rate,
            "median_latency": median,
            "samples": samples,
        }
        print(f"{model:<22} {rate:>15.0%} {median:>15.1f}s")

    out = HERE / "results" / "engine-schema-enforcement.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"\nwritten to {out.relative_to(HERE.parent)}\n")


if __name__ == "__main__":
    main()
