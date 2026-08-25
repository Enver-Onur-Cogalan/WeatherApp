# 08 — Evaluation Strategy

## Why this document exists

An agent without an evaluation suite is a demo. It works when you show it, and nobody
knows what happens otherwise.

This is doubly true here: we chose a 4B model precisely because it is *not* comfortably
capable, and the value of the project rests on the claim that careful engineering makes
it reliable. That claim needs evidence.

## What we measure

Three classes of check, in descending order of how much we trust them:

### 1. Deterministic checks — trusted completely

Pass or fail, no judgement involved:

- Does the output validate against the schema?
- Was the correct tool selected for the request?
- Were the tool arguments well-formed and within range?
- Is the response in the same language as the request?
- Did the request take the expected routing tier?

### 2. Groundedness checks — trusted completely

Also deterministic, and the most important category. Every numeric value in the
response is extracted and matched against the forecast data retrieved for that request.
An unmatched number is a hallucination, and it fails the scenario.

This is the check that makes a small model defensible. Fluency we can live without;
invented numbers we cannot.

### 3. Quality judgement — optional, not trusted alone

Is the answer actually helpful? Genuinely subjective, and we do not have a strong model
available locally to judge it — a 4B model grading its own output is not evidence.

Therefore quality judging is **opt-in**: a developer with access to a capable model can
run it, and CI is green without it. The suite's headline score comes from categories 1
and 2 only.

This is a limitation of the local-only constraint, and we record it rather than paper
over it.

## Scenario format

Scenarios are YAML, version-controlled, and readable by someone who is not a Python
developer:

```yaml
id: cycling-window-weekend
request: "hafta sonu bisiklete binebilir miyim?"
profile: cycling-moderate
fixture: istanbul-2026-08-22
expect:
  tier: 2
  tools_called: [get_activity_windows]
  schema: PlanResponse
  language: tr
  grounded: true
forbid:
  - invents_numbers
  - recommends_excluded_hours
```

Forecast data comes from **recorded fixtures**, not live API calls. Evaluations must be
reproducible; a suite whose results change with the weather is not a suite.

## Running

| When | What runs | Duration target |
|---|---|---|
| Every pull request | Core scenarios, deterministic + groundedness | under 5 minutes |
| Nightly | Full suite, repeated runs for variance | unbounded |
| On demand | Full suite plus optional quality judging | — |

Repetition matters: a model that passes once and fails once in five is not passing.
Nightly runs report a pass *rate*, not a pass.

## What we publish

The README carries the current headline score. If it drops, that is visible, and that
is the point — a score that can only go up is a marketing number, not a measurement.

## Comparative evaluation

Because the model is swappable, the same suite runs against different models. The
resulting table — E4B against 12B against 26B MoE, and against the same models without
our countermeasures — is the empirical core of the project.

The most interesting row is the last one: **the same model, with and without two-phase
execution, constrained decoding, and a narrowed tool surface.** That difference is the
engineering, expressed as a number.
