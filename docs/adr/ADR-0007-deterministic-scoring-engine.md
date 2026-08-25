# ADR-0007 — Scoring and arithmetic stay out of the model

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

The planner's core question — *when is a good time to do this activity?* — could be
answered by handing the model a forecast and a set of preferences and asking it to
reason. That is the shortest path to a working demo.

It is also the path that produces confidently wrong numbers. A 4B model asked to
average twelve temperatures, or to check whether 22 km/h exceeds a 15 km/h limit across
forty hours, will sometimes get it wrong, and the answer will read exactly like a
correct one.

## Decision

**All scoring, comparison, aggregation, and window selection happen in ordinary Python.**
The model may interpret a request and phrase an answer. It never computes a value the
user sees.

## Consequences

**Positive**

- The rules are unit-tested, deterministic, and identical on every run.
- An entire class of hallucination is structurally impossible rather than merely
  discouraged. Prompting cannot achieve this; architecture can.
- The scoring engine works with no model present, which is what makes Tier 0 routing
  and the templated fallback possible.
- Rules can be tuned, explained, and shown to the user — *"Sunday lost points because
  wind reaches 22 km/h against your 15 limit"* — which a model's internal reasoning
  could never be trusted to report accurately.
- Groundedness checking ([doc 08](../08-evaluation-strategy.md)) becomes possible: there
  is an authoritative set of numbers to check the prose against.

**Negative**

- Preference rules must be expressed explicitly. The engine cannot infer that a
  photographer cares about golden hour; someone has to encode it.
- Less flexible than open-ended reasoning for requests nobody anticipated.
- More code to write and maintain than a prompt.

## Alternatives considered

| Option | Why not |
|---|---|
| Model reasons over raw forecast data | The failure mode is silent and unverifiable. Unacceptable in an application whose entire output is numbers. |
| Model computes, code verifies | Verification requires computing the answer anyway. If the code already knows, the model call is pure risk. |
| Model writes code, code executes | Interesting, and genuinely used elsewhere — but a 4B model writing correct scoring code per request is less reliable than scoring code written once and tested. |
