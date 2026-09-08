# ADR-0018 — The person chooses the language; the server checks the answer against it

- **Status:** Accepted
- **Date:** 2026-09-05
- **Relates to:** [ADR-0017](./ADR-0017-assistant-that-advises.md)

## Context

CLAUDE.md says the app is bilingual and that neither language is a translation layer over
the other. Neither half of that was true in the code.

The interface was Turkish — 171 lines of hard-coded strings across 22 files, with no
mechanism for a second language at all. The *assistant's* language was inferred: a word
list in `agent/language.py` guessed which language a question was in, and the model's
instruction said to answer "in the same language as the question". Nothing checked that
it had.

It drifted, and the drift was measured rather than suspected. Adding advice instructions
to phase two's prompt took a full evaluation run from 20/20 to 12/20, and three of the
failures were Turkish scenarios answered in English:

```
UNSAFE  0%  tr-best-time-plain    language: asked tr, answered en
UNSAFE  0%  tr-vague              language: asked tr, answered en
UNSAFE  0%  beyond-horizon        language: asked tr, answered en
```

Bisected: reverting only `COMPOSE_SYSTEM`'s opening removed all three. The prompt is the
frame that holds a 4B model both on task and in language, and every addition costs some
of the second — which makes "answer in the language of the question" an instruction the
prompt cannot be relied on to carry.

The deeper problem is that there was nothing to check *against*. A guess cannot be a gate:
the same word list that chose the language would have been judging whether the answer
matched it, and measuring a rule with the rule it measures proves nothing.

## Decision

**The language is a preference, set in Sen, sent with every question.** The interface and
the assistant both use it. The server names it in the model's instruction ("written in
Turkish" rather than "in the same language as the question") and adds a `right_language`
gate that rejects an answer positively detected as the wrong language, with a repair
attempt that names the language to answer in.

The interface is translated through a typed dictionary in `apps/mobile/src/lib/i18n.ts`,
with no i18n library. `en` is typed as `typeof tr`, so a missing key is a compile error.

The `language` field on `/ask` is nullable. Omitted, the server infers it as before — the
endpoint is public and a caller that is not the app should not have to know about a
settings screen.

## Consequences

**Positive**

- Every language failure in the evaluation suite went to zero, with the advice work from
  ADR-0017 left in place: 3 unsafe → 0, on the same prompt that produced them.
- A person who wants English gets English, which is the thing CLAUDE.md claimed and the
  code did not do.
- The gate is a real check rather than a hope, because the language is now a fact the
  client asserted rather than a guess the server made.
- The prompt got *more* concrete, not longer. "Written in Turkish" replaces a clause that
  asked the model to do two things: identify the language, then write in it.

**Negative**

- **Two halves to keep in step, forever.** Every string added from here needs both. The
  type system catches an omission but cannot catch a bad translation, and there is nobody
  on this project to review the English the way there is for the Turkish.
- **The detector is still crude, and now it gates.** `_spoken` returns `None` for a
  sentence in neither vocabulary, so a short correct answer is never rejected — the cost
  is the other direction: a wrong-language answer using none of the listed words passes.
  It is a coarse filter for a coarse failure.
- **Dates and units are not translations.** "5 Eylül" is "September 5", "%20" is "20%".
  These are written as functions in the dictionary rather than templates, which works and
  is more verbose than a formatting library would be.
- One more field on the request, and one more thing a stale client can fail to send.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep detecting, and fix the prompt | The cheapest option, and it nearly worked — the bisect showed a specific sentence caused the drift, and reverting it restored 20/20. Rejected because it leaves the app monolingual, and because it makes correctness in the second language a property of one paragraph's phrasing. The next prompt change would have to re-establish it, and one already did not. |
| An i18n library (`i18next`, `i18n-js`) | Plural rules, interpolation and lazy loading, none of which this needs for two languages and a few hundred strings. It would find a missing key at runtime, on a device, in front of someone; a typed object finds it at compile time. Worth revisiting if a third language arrives. |
| Detect, but check the answer against the *question* | No preference to store and no settings row to add. Rejected for the reason in Context: the check and the thing it checks would share a word list, so the gate could only confirm the detector's own opinion. |
| A "system" option alongside Turkish and English | A third state to reason about everywhere. The device's locale is already what the first launch picks; this screen exists for the person who disagrees with it, and two options make that a decision rather than a setting. |

## Still open

- The English copy has not been read by anyone who writes English natively.
- The date format follows each language's own order but nothing else is localised —
  numbers use the device's default, and Turkish decimal commas appear only where they
  were written by hand.
- Nothing tests the mobile side. The dictionary's completeness is enforced by the type
  system; nothing enforces that a screen actually reads from it, and a string added
  straight into a component would not be noticed.

## When to revisit

If a third language is asked for. The dictionary shape holds for two and would be awkward
for five, and that is the point at which a library's lazy loading and plural rules start
paying for themselves.
