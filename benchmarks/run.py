#!/usr/bin/env python3
"""
Local model benchmark for WeatherApp.

Measures three things on an Ollama-served model:

  A. Tool selection      -- given a tool surface, does it call the right tool?
  B. Structured output   -- under grammar-constrained decoding, is the output usable?
  C. Constraint tax      -- does asking for tools AND a schema in one call
                            suppress tool calling? (see docs/adr/ADR-0006)

No third-party dependencies: standard library only.

Usage:
    python3 run.py gemma4:e4b-mlx
    python3 run.py gemma4:e4b-mlx gemma4:12b-mlx --repeat 3
"""

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
OLLAMA = "http://localhost:11434/api/chat"
TIMEOUT = 300

SYSTEM = (
    "You are a weather planning assistant. Use the provided tools to answer. "
    "Always answer in the same language as the user."
)


def chat(model, messages, tools=None, fmt=None, think=False, timeout=TIMEOUT):
    """One non-streaming call to Ollama. Returns (response_dict, elapsed_seconds)."""
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0},
        "think": think,
    }
    if tools:
        payload["tools"] = tools
    if fmt:
        payload["format"] = fmt

    req = urllib.request.Request(
        OLLAMA,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read())
    except (urllib.error.URLError, TimeoutError) as exc:
        return {"error": str(exc)}, time.perf_counter() - started
    return body, time.perf_counter() - started


def called_tools(response):
    """Tool names the model asked for, if any."""
    message = response.get("message", {})
    return [
        call.get("function", {}).get("name")
        for call in message.get("tool_calls", []) or []
    ]


def looks_turkish(text):
    """Crude language check: Turkish-specific characters or common words."""
    if any(ch in text for ch in "çğıöşüÇĞİÖŞÜ"):
        return True
    lowered = f" {text.lower()} "
    return any(w in lowered for w in (" için ", " hava ", " gün ", " saat ", " en iyi "))


# ---------------------------------------------------------------- test A


def test_tool_selection(model, cases, tools, repeat, think):
    """Tools declared, no schema constraint. The baseline for phase 1."""
    results = []
    for case in cases:
        outcomes, latencies = [], []
        for _ in range(repeat):
            response, elapsed = chat(
                model,
                [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": case["prompt"]},
                ],
                tools=tools,
                think=think,
            )
            latencies.append(elapsed)
            names = called_tools(response)
            outcomes.append(
                {
                    "called": names,
                    "correct": names[:1] == [case["expect_tool"]],
                    "called_anything": bool(names),
                }
            )
        results.append(
            {
                "id": case["id"],
                "lang": case["lang"],
                "expected": case["expect_tool"],
                "correct_rate": sum(o["correct"] for o in outcomes) / repeat,
                "call_rate": sum(o["called_anything"] for o in outcomes) / repeat,
                "median_latency": statistics.median(latencies),
                "samples": outcomes,
            }
        )
    return results


# ---------------------------------------------------------------- test B


def test_structured_output(model, cases, schema, forecast_digest, repeat, think):
    """Schema constrained, no tools. The baseline for phase 2."""
    results = []
    for case in cases:
        outcomes, latencies = [], []
        for _ in range(repeat):
            response, elapsed = chat(
                model,
                [
                    {"role": "system", "content": SYSTEM},
                    {
                        "role": "user",
                        "content": f"{case['prompt']}\n\n{forecast_digest}",
                    },
                ],
                fmt=schema,
                think=think,
            )
            latencies.append(elapsed)
            content = response.get("message", {}).get("content", "")
            valid, hours_ok = False, False
            try:
                parsed = json.loads(content)
                valid = all(
                    k in parsed
                    for k in ("verdict", "best_window", "reason", "warnings")
                )
                window = parsed.get("best_window", {})
                hours_ok = (
                    isinstance(window.get("start_hour"), int)
                    and isinstance(window.get("end_hour"), int)
                    and 0 <= window["start_hour"] <= 23
                    and 0 <= window["end_hour"] <= 23
                    and window["start_hour"] < window["end_hour"]
                )
            except (json.JSONDecodeError, TypeError):
                pass
            outcomes.append(
                {"valid_json": valid, "sane_hours": hours_ok, "raw": content[:400]}
            )
        results.append(
            {
                "id": case["id"],
                "lang": case["lang"],
                "valid_rate": sum(o["valid_json"] for o in outcomes) / repeat,
                "sane_hours_rate": sum(o["sane_hours"] for o in outcomes) / repeat,
                "median_latency": statistics.median(latencies),
                "samples": outcomes,
            }
        )
    return results


# ---------------------------------------------------------------- test C


def test_constraint_tax(model, cases, tools, schema, repeat, think):
    """Tools AND schema in the same call. Compared against test A's call rate."""
    results = []
    for case in cases:
        outcomes, latencies = [], []
        for _ in range(repeat):
            response, elapsed = chat(
                model,
                [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": case["prompt"]},
                ],
                tools=tools,
                fmt=schema,
                think=think,
            )
            latencies.append(elapsed)
            names = called_tools(response)
            outcomes.append(
                {
                    "called": names,
                    "correct": names[:1] == [case["expect_tool"]],
                    "called_anything": bool(names),
                }
            )
        results.append(
            {
                "id": case["id"],
                "correct_rate": sum(o["correct"] for o in outcomes) / repeat,
                "call_rate": sum(o["called_anything"] for o in outcomes) / repeat,
                "median_latency": statistics.median(latencies),
                "samples": outcomes,
            }
        )
    return results


# ---------------------------------------------------------------- test D


def test_language(model, repeat, think):
    """Does a Turkish question get a Turkish answer, with no tools or schema?"""
    prompt = "İstanbul'da bugün hava nasıl, kısaca anlat."
    outcomes, latencies = [], []
    for _ in range(repeat):
        response, elapsed = chat(
            model,
            [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": prompt},
            ],
            think=think,
        )
        latencies.append(elapsed)
        text = response.get("message", {}).get("content", "")
        outcomes.append({"turkish": looks_turkish(text), "raw": text[:300]})
    return {
        "turkish_rate": sum(o["turkish"] for o in outcomes) / repeat,
        "median_latency": statistics.median(latencies),
        "samples": outcomes,
    }


# ---------------------------------------------------------------- reporting


def build_forecast_digest():
    """A compact, honest slice of the fixture for the model to reason over."""
    data = json.loads((HERE / "fixtures" / "istanbul.json").read_text())
    hourly = data["hourly"]
    lines = ["Istanbul hourly forecast (next 48 hours):"]
    for i in range(0, 48, 3):
        lines.append(
            f"{hourly['time'][i]}  "
            f"temp {hourly['temperature_2m'][i]}C  "
            f"rain {hourly['precipitation_probability'][i]}%  "
            f"wind {hourly['wind_speed_10m'][i]}km/h  "
            f"uv {hourly['uv_index'][i]}"
        )
    return "\n".join(lines)


def mean(values):
    return sum(values) / len(values) if values else 0.0


def summarise(report):
    tool_correct = mean([r["correct_rate"] for r in report["tool_selection"]])
    tool_call = mean([r["call_rate"] for r in report["tool_selection"]])
    tax_call = mean([r["call_rate"] for r in report["constraint_tax"]])
    return {
        "tool_correct_rate": tool_correct,
        "tool_call_rate": tool_call,
        "schema_valid_rate": mean([r["valid_rate"] for r in report["structured_output"]]),
        "schema_sane_hours_rate": mean(
            [r["sane_hours_rate"] for r in report["structured_output"]]
        ),
        "constrained_call_rate": tax_call,
        "constraint_tax": tool_call - tax_call,
        "turkish_rate": report["language"]["turkish_rate"],
        "median_tool_latency": statistics.median(
            [r["median_latency"] for r in report["tool_selection"]]
        ),
    }


def print_report(model, summary, mode):
    print(f"\n{'=' * 62}")
    print(f"  {model}  [{mode}]")
    print(f"{'=' * 62}")
    rows = [
        ("A. correct tool selected", f"{summary['tool_correct_rate']:.0%}"),
        ("A. called any tool", f"{summary['tool_call_rate']:.0%}"),
        ("B. schema valid", f"{summary['schema_valid_rate']:.0%}"),
        ("B. plausible hour values", f"{summary['schema_sane_hours_rate']:.0%}"),
        ("C. tool calls with schema on", f"{summary['constrained_call_rate']:.0%}"),
        ("C. constraint tax", f"{summary['constraint_tax']:+.0%}"),
        ("D. answered in Turkish", f"{summary['turkish_rate']:.0%}"),
        ("median latency", f"{summary['median_tool_latency']:.1f}s"),
    ]
    for label, value in rows:
        print(f"  {label:<32} {value:>8}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("models", nargs="+")
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--think", action="store_true",
                        help="enable the model's thinking mode")
    args = parser.parse_args()

    cases = json.loads((HERE / "cases.json").read_text())
    digest = build_forecast_digest()

    for model in args.models:
        mode = "thinking" if args.think else "no-thinking"
        print(f"\nrunning {model} [{mode}] ({args.repeat} repeats per case)...", flush=True)
        report = {
            "model": model,
            "repeat": args.repeat,
            "think": args.think,
            "tool_selection": test_tool_selection(
                model, cases["tool_cases"], cases["tools"], args.repeat, args.think
            ),
            "structured_output": test_structured_output(
                model, cases["schema_cases"], cases["plan_schema"], digest, args.repeat, args.think
            ),
            "constraint_tax": test_constraint_tax(
                model,
                cases["tool_cases"],
                cases["tools"],
                cases["plan_schema"],
                args.repeat,
                args.think,
            ),
            "language": test_language(model, args.repeat, args.think),
        }
        report["summary"] = summarise(report)

        suffix = "think" if args.think else "nothink"
        out = HERE / "results" / f"{model.replace(':', '_').replace('/', '_')}.{suffix}.json"
        out.write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print_report(model, report["summary"], mode)
        print(f"\n  written to {out.relative_to(HERE.parent)}")


if __name__ == "__main__":
    sys.exit(main())
