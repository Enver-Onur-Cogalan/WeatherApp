# ADR-0008 — Three-tier request routing

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

Every request could be sent to the agent. Most requests do not need it: *"weather in
Istanbul"* and *"will it rain tomorrow"* are pattern-matchable and answerable directly
from the scoring engine.

With a local model, the cost of an unnecessary model call is not money. It is seconds of
latency, a share of the model's error rate, and a slot in a serialised queue that other
users are waiting in.

## Decision

Route every request through **three tiers**: deterministic, light model, full agent.
Detail in [doc 06](../06-request-routing.md).

## Consequences

**Positive**

- Common questions answer in tens of milliseconds instead of seconds.
- Requests that never reach the model cannot be answered wrongly by it.
- With Ollama unavailable, Tier 0 still works — the application degrades instead of
  failing.
- The tier distribution is measurable and publishable, which turns a design argument
  into evidence.

**Negative**

- A routing layer to maintain, and a new failure mode: mis-routing. A request wrongly
  sent to Tier 0 gets a rigid answer to a nuanced question.
- Two response paths — templated and generated — that must feel like one application.
  Tone and formatting have to match, or the seam shows.
- The rules need updating as the request vocabulary grows.

## Alternatives considered

| Option | Why not |
|---|---|
| Everything through the agent | Simplest, and slow, less reliable, and useless without Ollama. |
| Learned classifier as router | Needs training data we do not have, is harder to debug, and adds a second model to a system whose point is running one carefully. Reconsider once real traffic exists. |
| Client-side routing | Would duplicate business rules in TypeScript, where they would drift from the Python. |

## Mitigation

Tier 0 escalates rather than guesses: below a confidence threshold, the request moves up
a tier. Mis-routing therefore costs latency, not correctness.
