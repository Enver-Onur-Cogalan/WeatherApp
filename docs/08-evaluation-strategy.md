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

**Fixtures must cover bad weather.** The first one — an August week in Istanbul — turned
out to be bone dry: 72 hours without a single drop of rain. An agent exercised only in
fair weather is untested for exactly the cases users most need it in, and the gap was
invisible until something tried to render precipitation and found none.
`fixtures/rize.json` was added for rain and heavy cloud. Wind, freezing, and heatwave
fixtures are still missing, and the suite is incomplete until they exist.

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

## First measured baseline

`gemma4:e4b`, 10 scenarios × 3 repeats, recorded fixtures, temperature 0, on Apple
Silicon. Measured 2026-09-02, `evals/results/gemma4_e4b.json`.

| | |
|---|---|
| Runs passing every check | **30/30 (100%)** |
| Answered by the model | 24/30 (80%) |
| Reached the user wrong | **0/30 (0%)** |
| Median latency | 27.2s |

The six runs the model did not answer are the two out-of-scope scenarios, three repeats
each. The model declines to call a tool for a medical question and the engine answers
instead — the designed behaviour, not a shortfall.

The headline is not the 100%. It is what the first run found.

### What the suite caught on its first run

Three defects, all of them shipped, none of them visible in the six device sessions
before it — because every one needed a specific path that manual use had not taken.

**An English question answered in Turkish.** The model is told to match the question's
language; the engine's fallback has no model to tell, and it was written with Turkish
strings inline. Only an English question that *also* fell back would show it, which had
never happened by hand. `app/agent/language.py` now decides, and the fallback has both
forms. The detection is deliberately duplicated in the suite: measuring a rule with the
rule it measures proves nothing.

**A correct answer rejected for citing the date.** `2026-08-27` was already stripped
before grounding, because the year read as an ungrounded figure. The same defect was
still present in the form people actually write — "27 Ağustos Perşembe" offered 27 as a
measurement — so the gate that exists to catch invented numbers was rejecting the
truth. Long-form dates in both languages are now stripped too.

**Both phases shared one prompt.** Phase one's prompt insists the model has no data of
its own and that every figure must come from a tool result. That prompt was also being
sent in phase two, at the moment the model was asked to write a sentence for a person —
which duly produced *"Tool result (get_activity_windows) kullanılarak cevap
verilmiştir."* The machinery gate caught it and the answer fell back every time: safe,
and absurd, since we asked for the plumbing and then rejected the answer for mentioning
it. Two prompts now, because the phases want opposite things — phase one insists on
tools, phase two must not know they exist.

Fixing the last two moved the model's share of answers from 60% to 80%. That is the
measurable part; the first one never showed up in a rate at all, because a Turkish
sentence is a perfectly good answer by every check except the one that was missing.

### What the suite got wrong about itself

Worth recording separately, because it is the failure mode this document warns about.

After the prompt was split, the model wrote *"Tomorrow, Tuesday, you have an activity
window from six to sixteen."* — and the suite reported it as **unsafe**. The English
detector held seven function words, that sentence contains none of them, and an answer
matching neither list was being counted as a defect.

The rule was wrong, not just the word list. The check now fails only on a **positive**
detection of the wrong language: absence of evidence is not evidence of the wrong
language. The undetermined count is printed on its own line so a detector going blind
stays visible rather than silently passing everything.

A suite that reports correct output as a defect is how suites get switched off. It is
the same argument that made CI gate on unsafe runs rather than on the pass rate, applied
to the suite's own instruments.

### Still open

- **Quality is still not measured**, and the 100% should be read with that in the
  sentence. Every one of these checks is deterministic; whether the answers are *useful*
  is not among them.
- **Ten scenarios is thin.** Wind, freezing and heatwave fixtures do not exist yet, and
  neither do the scenarios that would need them.
- **80% is one model on one fixture set.** The comparative table above is unmeasured.
- The 27-second median is a real product problem, not just a number. docs/13 already
  carries the loading state it argues for.
