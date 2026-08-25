# ADR-0004 — Local-only language model, no hosted provider

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

The planning agent needs a language model. The default choice in 2026 is a hosted
frontier model: more capable, trivially integrated, and priced per token.

Three things argued against it for this project. It puts an API key between a reader
and a running application. It puts a running cost between the author and a public demo.
And it makes the interesting engineering — constraining a weak model into reliability —
disappear, because a frontier model does not need constraining.

## Decision

Run **only** a local model, through Ollama. No hosted provider, no fallback to one, no
code path that expects one.

## Consequences

**Positive**

- Zero marginal cost and no key. Anyone can run the whole system.
- Genuine privacy: no user question leaves the machine the service runs on. This is a
  claim we can make without qualification, which is rare.
- The hard problems become the project's content. Every countermeasure in
  [doc 05](../05-local-llm-research.md) exists because the model is weak, and each one
  is a thing worth showing.
- It forces good architecture. A weak model cannot be trusted with arithmetic, so the
  arithmetic moves into tested code ([ADR-0007](./ADR-0007-deterministic-scoring-engine.md)) —
  which is where it belonged anyway.

**Negative**

- Lower ceiling on answer quality, particularly on unusual phrasings.
- Requires the reader to run Ollama and download several gigabytes.
- **The evaluation suite loses its judge.** A 4B model cannot reliably grade its own
  output, so quality judging becomes opt-in and the headline score rests on
  deterministic checks only ([doc 08](../08-evaluation-strategy.md)). This is a real
  cost of this decision, not a detail.
- No graceful upgrade path to better answers without changing hardware.

## Alternatives considered

| Option | Why not |
|---|---|
| Hosted model only | A key requirement kills the "clone and run" property; running costs kill the public demo. |
| Hybrid, local with hosted fallback | Superficially the best of both. Rejected: the fallback path would silently become the real path, the local path would rot untested, and the privacy claim would be gone. Half a constraint is no constraint. |
| Hosted model for evaluation judging only | Considered and kept as an *optional* developer tool, but never required by CI. |
