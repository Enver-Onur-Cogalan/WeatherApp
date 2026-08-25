# ADR-0014 — The planner's output is the main screen

- **Status:** Accepted
- **Date:** 2026-08-25

## Context

The assistant is this project's differentiator, which creates a pull toward putting it in
front: open the app into a chat, or at least keep a question box permanently on screen.
Several AI products do exactly that.

Two things argue the other way. The planner's output — ranked windows — is *already*
structured data that renders better as a screen than as a paragraph. And the routing
architecture ([ADR-0008](./ADR-0008-tiered-request-routing.md)) exists precisely to keep
most requests away from the model, which a permanent question box would quietly undo.

## Decision

**Ranked windows live on the main screen.** The assistant is a separate tab, for questions
the main screen does not already answer.

## Consequences

**Positive**

- The planner is not hidden behind a conversation. A user who never opens Sor still gets
  the product's core value on launch.
- The interface matches the architecture: the deterministic tier is the default path, and
  the model is the escape hatch.
- Common questions answer in milliseconds, because they are answered by a screen that is
  already rendered rather than by a request.
- With the assistant unreachable, the main screen is unaffected. If chat were the front
  door, the app would be dead without a model.

**Negative**

- The differentiator is one tap less visible. A person evaluating the app in thirty
  seconds might not register that there is an assistant at all.
- Two ways to ask the same thing — chips and windows on İz, free text in Sor — which need
  to agree. A window ranked first on İz and a different answer in Sor would be a bug the
  user sees before we do.

**Mitigation for the first point:** onboarding puts the model in front within the first
minute, when profile extraction happens in natural language. The assistant introduces
itself by doing something useful, rather than by occupying a tab bar slot.

## Alternatives considered

| Option | Why not |
|---|---|
| **Permanent question bar on İz** | Makes the assistant more visible and more impressive in a demo. Rejected: it invites every question to the model, including the ones routing answers in 50 ms, and spends the model's error budget on questions that had a deterministic answer. |
| **Chat as the primary screen** | The boldest framing. Rejected: someone checking tomorrow's weather would have to type, every time, and the local model's latency would land on every interaction. Daily use would be exhausting. |
| **Assistant as a floating button** | Neither committed nor invisible. Would sit over the trace, which is the one element that must stay unobstructed. |
