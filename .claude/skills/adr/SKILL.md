---
name: adr
description: Write a new Architecture Decision Record for WeatherApp, or supersede an existing one. Use whenever a decision is made that someone would later ask "why is it like that?" about — a library choice, an architectural rule, a rejected approach, or a reversal of an earlier ADR.
---

# Writing an ADR

ADRs live in `docs/adr/` as `ADR-NNNN-kebab-title.md`. One decision per file.

## Before writing

1. `ls docs/adr/` — take the next free number.
2. Check whether an existing ADR already covers this. If it does and the decision has
   **changed**, you are superseding, not writing fresh — see below.

## The format

```markdown
# ADR-NNNN — Decision, stated as a claim

- **Status:** Accepted
- **Date:** YYYY-MM-DD

## Context

What forced a decision. Include the constraints that made it non-obvious. If a
measurement drove it, give the numbers here with how they were produced.

## Decision

One or two sentences. State what was chosen, not how it works.

## Consequences

**Positive** — what this buys, in specifics.

**Negative** — what it costs. **This section is not optional and must not be padded
with fake concessions.** If a decision can lose user data, say so in those words.

## Alternatives considered

| Option | Why not |
|---|---|
| The obvious alternative | The real reason, including what it would have been good at |
```

Optional closing sections when they apply: **When to revisit** (name the signal that
should trigger reconsideration), **Open question** (what is undesigned), **Source**
(links, for anything from research).

## Rules

- **ADRs are immutable once accepted.** Never rewrite the reasoning in an accepted ADR.
- **To reverse a decision**, write a new ADR and add a note at the top of the old one:
  ```markdown
  - **Status:** Partially superseded by [ADR-NNNN](./ADR-NNNN-slug.md)
  - **Date:** original date

  > **Note (YYYY-MM-DD):** what still stands, and what does not, in one or two lines.
  ```
  The new ADR gets `- **Supersedes:** [ADR-NNNN](...)`.
- **Alternatives must be argued fairly.** An alternative dismissed in four words was never
  considered. Say what it would have been good at before saying why it lost.
- **Prefer a measurement to a citation.** If the decision rests on an external claim,
  reproduce it in `benchmarks/` first and put the number in Context.

## After writing

1. Add a row to the table in `docs/adr/README.md`, in number order.
2. Link the ADR from whichever numbered doc in `docs/` covers that area.
3. If it changed something already documented, update that doc too — a doc that contradicts
   an accepted ADR is worse than no doc.
