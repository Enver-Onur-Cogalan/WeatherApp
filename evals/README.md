# Evaluations

Whether the planning agent works, as a number rather than an impression.

An agent without an evaluation suite is a demo: it works when you show it, and nobody
knows what happens otherwise. That matters more here than usual, because the model was
chosen for *not* being comfortably capable — the project's claim is that careful
engineering makes a 4B model reliable, and a claim needs evidence.

## Running

Requires Ollama on `localhost:11434` with the model pulled.

```bash
python3 evals/run.py                  # every scenario, 3 repeats
python3 evals/run.py --repeat 5
python3 evals/run.py --only tr-       # scenarios whose id starts with this
python3 evals/run.py --model gemma4:12b
```

Results land in `results/<model>.json`, including every answer produced, so a surprising
rate can be traced back to the sentences behind it.

## What it measures

| Class | Trusted | What it checks |
|---|---|---|
| **Deterministic** | Completely | An answer exists, is in the language it was asked in, names no internal machinery, calls the expected tool, carries a well-formed window |
| **Groundedness** | Completely | Every figure, condition and day name against the data the tools returned |
| **Quality** | Not measured | Whether the answer is *useful* — see the limitation below |

Groundedness is not re-implemented here. The agent already rejects an ungrounded answer
and falls back, so the suite reads that outcome rather than checking the rule twice: it
measures the shipped behaviour, not a copy of it.

## Safe failures and unsafe ones

The distinction the report is built around, and the reason CI gates on one number rather
than the headline:

- A **fallback** is the system working. The model produced something ungrounded, a gate
  caught it, and the engine answered instead. The user got a correct answer in a plainer
  sentence.
- An **unsafe run** is a defect. Something wrong reached the user: a leaked identifier, an
  answer in the wrong language, a forbidden term, a malformed window.

CI fails on any unsafe run and tolerates fallbacks. A suite that fails on every flake gets
switched off rather than fixed; one that ignores a leak is worse than no suite at all.

The same principle decided how the language check treats an answer it cannot classify.
It fails only on a **positive** detection of the wrong language, never on the absence of
evidence — the first version failed on "unknown" too, and reported *"Tomorrow, Tuesday,
you have an activity window from six to sixteen."* as unsafe, which is unmistakable
English that happens to contain none of the function words the detector looked for. A
detector that cries wolf on correct output is the reason suites get switched off. The
undetermined count is printed instead, so a detector going blind stays visible rather
than passing everything by default.

## Method

- **Recorded fixtures.** Scenarios run against saved Open-Meteo responses. An evaluation
  whose results move with the weather is not an evaluation.
- **Repeats, and rates.** Every figure is a rate over repeated runs. A model that passes
  once and fails once in five has not passed, and a single outcome would hide that.
- **Turkish and English in equal measure.** A model that only works in English fails this
  application.
- **Temperature 0.** Capability is what is being measured, not variety.

## Scenarios

`scenarios/*.yaml`, version-controlled and readable by someone who is not a Python
developer:

```yaml
- id: tr-indirect-picnic
  question: "Hafta sonu piknik yapmayı düşünüyoruz, ne dersin?"
  language: tr
  expect:
    from_model: true
```

`planning.yaml` covers the questions the assistant exists for. `refusal.yaml` covers the
ones it should decline to answer as though it knew — a confident answer outside its
competence is worse than no answer.

## The limitation, stated rather than papered over

**Quality is not measured.** Whether an answer is genuinely helpful is subjective, and
grading it needs a model more capable than the one being graded. There is no hosted model
to borrow: local-only is a decision, not an oversight
([ADR-0004](../docs/adr/ADR-0004-local-only-llm.md)), and a 4B model marking its own work
is not evidence.

So the headline rests on deterministic checks and groundedness only. That is a real cost
of the local-only constraint, and it is written down rather than hidden behind a number
that sounds more complete than it is.

## When a number changes a decision

Write an ADR and update `docs/08-evaluation-strategy.md` with the measurement, dated.
Keep superseded result files — a negative result is the evidence for the decision it
caused, the same convention `benchmarks/` follows.
