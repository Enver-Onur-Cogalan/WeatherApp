# 04 — AI Agent Design

This document describes the part of the system that uses a language model, and — more
importantly — the boundary drawn around it.

## The central principle

> **The model interprets and explains. It does not fetch, and it does not calculate.**

Every figure the user sees originates in the scoring engine (`planning/`), which is
ordinary Python operating on forecast data. The model's job is to understand what was
asked and to phrase what the engine found.

This is not a stylistic preference. A 4B-parameter model asked to average twelve
temperatures will produce a number that looks right and is wrong, and there is no way
for the user to tell. Removing arithmetic from the model's responsibilities removes an
entire class of failure that no amount of prompting would have fixed.

See [ADR-0007](./adr/ADR-0007-deterministic-scoring-engine.md).

## The planner

The headline feature is not "ask about the weather" but **"tell me when to do the thing
I care about"**.

### Activity profiles

A user describes themselves once, in natural language:

> *"I run in the mornings, I won't go out above 26 degrees, and I hate wind."*

The model performs a single structured extraction into an `ActivityProfile`:

```
ActivityProfile
├── activity: str                 "running"
├── temperature_range: [int,int]  [5, 26]
├── wind_max_kmh: int             15
├── precipitation_max_pct: int    20
├── preferred_hours: [int,int]    [6, 10]
└── uv_max: int | null            null
```

This is the *only* place the model touches the user's preferences, and it happens once,
not per request. The extraction is reviewed by the user before being saved — a
mis-parsed profile would otherwise quietly poison every future plan.

### The window engine

Given a profile and hourly forecast data, finding good windows is a scoring problem,
not a reasoning problem:

```
for each hour in the forecast horizon:
    score = weighted penalty against every constraint in the profile
    hard violations (freezing rain, storm warning) → hour excluded outright

group contiguous hours above the score threshold into windows
rank windows by mean score, length, and proximity to preferred hours
```

Pure functions, fully unit-tested, no model involved. The output is a ranked list of
windows with their scores and the reason each lost points.

**A warning from the first run.** Scoring the committed fixture with only the comfort
terms — temperature, wind, precipitation, UV — declared 03:00 the best hour of the week
for a run. Nights are cool and calm, so they score perfectly. `preferred_hours` was
present in `ActivityProfile` and absent from the formula: the schema was right and the
engine was incomplete.

The lesson is not about that one term. Every field in the profile needs a corresponding
term in the scoring function, and the only way to know one is missing is to run the engine
over real data and read the answer.

### Synthesis

Only at the end does the model receive the ranked windows and produce prose:

> *"Saturday between 07:00 and 09:30 is your best window — 14 °C, light wind, and dry.
> Sunday morning looks similar but the wind picks up to 22 km/h, which is above your
> limit."*

Note that every fact in that sentence came from the engine. The model contributed the
sentence, not the facts.

## Two-phase execution

Research published this year ("Constraint Tax in Open-Weight LLMs") shows that
**forcing a schema constraint and tool calling in the same request degrades both** on
open-weight models. Small models are hit hardest.

We therefore split the work:

```
Phase 1 — tool calling          no schema constraint
          The model chooses tools and gathers what it needs.

Phase 2 — structured output     grammar-constrained decoding
          The model fills a fixed schema. No tools available.
```

Ollama compiles a JSON Schema into a GBNF grammar and restricts the sampler to tokens
that keep the output valid, so Phase 2 cannot produce malformed JSON. What the grammar
cannot guarantee is that the *values* are true — which is why the validation layer
below exists.

See [ADR-0006](./adr/ADR-0006-two-phase-tool-and-schema.md).

## Tool surface

Tools are deliberately few and narrowly described. Small models degrade sharply as the
tool list grows and as descriptions get longer than a couple of lines.

| Tool | Purpose |
|---|---|
| `get_forecast` | Hourly and daily forecast for a location and date range |
| `get_activity_windows` | Ranked windows for the user's stored profile |
| `compare_days` | Difference between two days for a location |

Anything else — geocoding, unit conversion, timezone handling — happens in code before
the model is ever called. If a capability can be triggered deterministically from the
request, it is not a tool.

## Validation and fallback

Every model output passes three gates before reaching the user:

1. **Schema** — guaranteed by constrained decoding, verified again on our side.
2. **Groundedness** — every number appearing in the response text is checked against the
   forecast data that was actually retrieved. An unmatched figure fails the response.
   This is our hallucination detector, and it is deterministic.
3. **Scope** — the response must concern weather. A model that starts giving medical or
   travel advice is out of bounds.

On failure: one retry with the validation error fed back. On a second failure, the
system falls back to a **templated answer** built directly from the engine output —
less fluent, but correct. The user is never shown a broken response, and never told
"something went wrong" when we have a perfectly good answer available.

## Thinking mode

Gemma 4 supports a configurable thinking mode. We use it selectively:

| Task | Thinking | Why |
|---|---|---|
| Intent extraction | off | Single-step classification; thinking adds latency, not accuracy |
| Profile extraction | off | Structured extraction from a short sentence |
| Multi-day planning synthesis | on | Genuinely multi-step; quality difference is measurable |

Latency is a first-class concern with a local model, and thinking is expensive. Turning
it on everywhere would be the easy choice and the wrong one.

## What building it changed (2026-08-30)

Five things the design did not anticipate, each found by running the real model rather
than by reasoning about it.

**The model does not read `role: "tool"`.** Handing results back under the documented
role, Gemma 4 answered "no specific information was provided" — the request succeeds and
the model behaves as though it were given nothing. Split across two user messages it read
the data but answered a Turkish question in English. Folded into a single user message
with the question it read the data and kept the language. Three shapes, one that works,
and the two failures are silent.

**The model does not choose the window either.** ADR-0007 removed arithmetic from it; the
first build still let it emit `best_window`, and it answered `null` while the engine had
ranked seven. The window is attached from the engine now, and the model is constrained to
a narrower schema — judgement and prose, nothing computable.

**Groundedness has to be unit-aware.** A flat set of retrieved numbers accepted "15°C" on
a day whose temperatures were 22–26, because 15 was in the set as an *hour*. Facts are
bucketed by unit and a figure is checked against the unit it was stated in.

**Not every invented claim contains a digit.** The model warned of thunderstorms on a
forecast with none, and numeric grounding passed it without a word — the sentence held no
figures. Named conditions are now checked against the WMO codes actually present.

**A verdict can contradict the data it was given.** The model answered "there is not
enough information" beside seven ranked windows, and marked `bad` next to one the engine
scored 95. The judgement stays the model's; contradicting the numbers does not.

## What we are uncertain about

Written down honestly, to be revisited once the evaluation suite produces numbers:

- Whether Gemma 4 E4B's tool-calling reliability is sufficient for Phase 1, or whether
  we should replace tool calling with a deterministic dispatcher and use the model only
  for intent classification and synthesis.
- Whether groundedness checking on free-form prose is precise enough, or whether the
  model should be required to emit numbers only in structured fields, with prose
  templated around them.

Both questions are empirical. The evaluation suite ([doc 08](./08-evaluation-strategy.md))
exists to answer them.
