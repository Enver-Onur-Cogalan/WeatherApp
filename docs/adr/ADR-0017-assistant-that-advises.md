# ADR-0017 — The assistant converses and advises, within the engine's numbers

- **Status:** Accepted
- **Date:** 2026-09-05
- **Partially supersedes:** [ADR-0014](./ADR-0014-planner-on-main-screen.md)

## Context

Sor was built as an escape hatch: a place for the questions the trace could not answer,
deliberately not a chat surface ([ADR-0014](./ADR-0014-planner-on-main-screen.md)). Used
on a device, that framing produced something that reads as a rules engine with a language
model attached rather than an assistant.

Three concrete observations, all reproduced against the running service.

**The card contradicts the answer.** Asked *"Hafta sonu piknik yapılır mı?"* the prose
names Saturday and the card shows a window on a different day. Asked *"Yarın sabah koşabilir
miyim?"* the prose names Sunday — and the card shows the *same* window as the previous
question. The engine attaches its globally best window to every answer regardless of what
was asked, so the card is identical no matter the question and disagrees with the sentence
above it.

**Nothing is ever advised.** `warnings` is in the schema, the tools now return UV, wind and
precipitation, and the field comes back empty on every answer. The assistant states
conditions and never draws a conclusion from them: it will say the UV index is 8 and not
that a hat is a good idea.

**Small talk is refused.** "Merhaba" is answered with a statement of scope. Correct, and
not what an assistant sounds like.

The underlying question ADR-0014 asked — *is this a weather app with an assistant, or an
assistant that knows about weather?* — was answered "the first" and is being answered "the
second" here, for the assistant tab only.

## Decision

**Sor is a conversational assistant that reasons about weather.** It converses, it
advises, and it chooses which window it is talking about — but every number it states
still comes from the scoring engine, and every gate still stands.

Specifically: the model selects a window from the engine's ranked list rather than having
one attached; it is asked for advice and not only for description; and it may answer
without a tool call when the conversation gives it enough to answer from.

## Consequences

**Positive**

- The card follows the answer, so a person is not told two different things at once.
- Advice is the thing a forecast is *for*. "UV 8" is data; "take a hat" is the reason
  anyone asked.
- Small talk gets a reply, which costs nothing and is what makes something feel like an
  assistant rather than a form.

**Negative**

- **More surface for the model to be wrong on.** Advice is a judgement, and a judgement
  cannot be checked by the groundedness gates the way a figure can. "Do not run at noon"
  is unfalsifiable by anything in `validation.py` — the gates can only confirm that the
  UV figure behind it is real. This is a genuine loosening and it is the main cost, and
  it showed up immediately: asked *"Yarın sabah koşabilir miyim?"* the model produced an
  entirely grounded sentence — twenty-three degrees, three percent chance of rain — and
  then advised taking an umbrella. Three percent is not rain. `conditions_grounded`
  caught it, correctly, and rejected the whole answer with it.

  So warnings are now pruned before the gates run rather than judged with the sentence:
  each is checked on its own, an unfounded one is dropped and logged, and `reason` is
  still judged whole. Nothing false reaches the person either way; the difference is that
  a correct sentence is no longer thrown away because of the advice attached to it. This
  is a real weakening of the "reject the answer" rule and is written down as one — the
  model's bad judgement is now silently removed rather than surfaced, and the only record
  that it happened is a log line.
- **The prompt grows, and the prompt is fragile.** [Doc 04](../04-ai-agent-design.md)
  records a rewrite that cost four scenarios: this model's instruction is also the frame
  that holds it on task and in language. Every change here needs the evaluation suite, and
  a device session is not evidence. The advice work proved the point twice — the first
  attempt took the suite from 20/20 to 12/20 with three Turkish scenarios answered in
  English, which is what [ADR-0018](./ADR-0018-language-is-chosen-not-detected.md) exists
  to make impossible rather than unlikely.
- **Latency grows with the words.** A 46% increase in answer length bought a 46% increase
  in latency once already ([doc 08](../08-evaluation-strategy.md)). Advice is more words.
- ADR-0014's framing of Sor as an escape hatch no longer holds. The rest of it — the
  planner's output being the main screen, the trace answering common questions without a
  model — stands unchanged, which is why this supersedes it only in part.

## Alternatives considered

| Option | Why not |
|---|---|
| Leave it as an escape hatch | What ADR-0014 decided, and defensible: the deterministic path is faster, always right, and works with no model. Rejected because the assistant tab exists to be an assistant, and one that refuses to converse and never advises is a worse version of the trace screen rather than a different thing. |
| Let the model compute the advice's numbers too | Would remove the awkwardness of the model selecting a window whose figures it did not compute. Rejected outright: [ADR-0007](./ADR-0007-deterministic-scoring-engine.md) is the project's spine, and a 4B model doing arithmetic a person reads is the failure it exists to prevent. |
| A separate "advice" endpoint | Keeps the conversational path away from the planning path, so a regression in one cannot touch the other. Rejected as two things to keep in step for a distinction users do not have — they ask one assistant one question. |
| Drawer with named conversations (D2) | The larger version of this, and still not decided. This ADR is about what the assistant *does* within one thread; how many threads there are is a separate question, and answering it was not necessary to fix what was actually wrong. |

## When to revisit

If the eval suite's unsafe count moves off zero and cannot be brought back without
narrowing what the assistant says, this decision is what to reconsider first — advice is
the part that cannot be checked.
