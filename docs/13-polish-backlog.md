# 13 — Polish Backlog

Observations from using the app on a device, recorded rather than acted on. Batching a
polish pass produces a more coherent result than fixing things one at a time, and
observations go stale fast — so they get written down the day they are noticed.

Each item says what it is, because they are not the same kind of work: a **bug** is
something behaving wrongly, **polish** is taste applied to something that already works,
a **feature** is new behaviour, and a **decision** is something that cannot be built
until a question is answered.

Source: device session, 2026-09-02.

---

## Bugs

### B1 — A tool name leaks into the answer text — **fixed 2026-09-02**
**Where:** Sor, answer card.

The model appended `get_activity_windows` to the end of a sentence it wrote for a person.
Not the provenance line — that correctly shows `1 araç · 21,4 sn · cihazda` — but the
model's own prose.

This is a validation gap, not a display one. The gates check figures, conditions and day
names; nothing checks that the answer stays free of the machinery behind it. An internal
identifier in user-facing text is as much a defect as an invented number, and it is
caught by the same kind of deterministic rule.

Worth a check in `app/agent/validation.py`, not a string replace in the UI.

**Fixed, and the gate turned out to be the smaller half.** `free_of_machinery()` now
rejects the answer, which is the right response to a leak. But the evaluation suite then
showed the leak was not the model being careless — both phases shared phase one's
prompt, so at the moment it was asked to write for a person it was still being told that
every figure must come from a tool result. It was doing as it was told. Phase two has
its own prompt now (docs/08), and the gate is the backstop rather than the fix.

### B2 — White flash when the keyboard opens
**Where:** Sor, composer.

The area the keyboard occupies flashes white before the keyboard draws. The app commits
to one dark visual world (docs/10), so a white frame is jarring rather than merely
unstyled — likely a window background that was never set, beneath React's view tree.

---

## Polish

### P1 — A loading state that belongs to this app — **done 2026-09-03**
**Where:** Sor, while the assistant is thinking.

Currently a system spinner and "Cihazda düşünüyor…". The wait is fifteen to forty-seven
seconds, so it is a large part of the screen's life and deserves better than a default.

There is an obvious source: the app already draws weather in Skia. Something drawn from
the same vocabulary would make the wait feel like part of the product rather than a stall
in it.

**Built as the instrument itself.** A Campbell–Stokes recorder burns its trace into a
printed card as the drum turns — the card is ruled before anything is written on it, and
the scorch is laid by a moving point of focused light. That is precisely the state being
shown: running, with nothing to report yet. One SkSL pass draws the ruling and the burn
together, the head wraps so the loop has no restart, and reduced motion holds a still
frame rather than stopping dead — the card stays half-burnt, which still reads as work in
progress.

The wait now also shows its elapsed seconds, after five. The animation is deliberately
indeterminate: the agent's two phases are not streamed to the client, so a progress bar
would be fiction. docs/08 measured the median at 27 seconds, which is what made the
default spinner wrong — that long, it reads as a hang.

### P2 — The answer card appears abruptly
**Where:** Sor.

It cuts in. An entrance would place it, and the wait beforehand makes the arrival worth
marking. Under 300ms, ease-out, and it goes away under reduced motion.

### P3 — A delete animation
**Where:** Sor, once deleting exists (F1, F2).

Removal without motion reads as a glitch. Pairs with the delete work rather than being
separate.

---

## Features

### F1 — Delete an exchange
**Where:** Sor.

Nothing can currently be removed. Related: history does not survive a launch either
(docs/11), so today everything disappears on restart, which is deletion by accident
rather than by choice.

### F2 — Long-press menu on a card
**Where:** Sor.

Copy, edit, delete. Icons alone are enough — no labels needed.

### F3 — Say which place the answer is about — **half done 2026-09-03**
**Where:** Sor, and arguably the answer itself.

Nothing on the screen names the location. Someone in İzmir cannot tell whether the answer
concerns İzmir or somewhere else, and the assistant's confidence makes that worse rather
than better.

Partly blocked: there is no location management yet — İz has "İstanbul" hard-coded and
the Ask fixture is Rize. `Konumlar` is listed under Sen in docs/11 and unbuilt. The
smaller half — showing the place on the answer card — can land first.

**The smaller half landed with the API wiring.** Both screens now name the place, and it
comes from one constant that the requests are built from, so the label cannot disagree
with what was actually asked. The larger half still needs somewhere to store a place.

### F4 — Error state — **done 2026-09-03**
**Where:** Sor.

There is no failure path in the UI at all, because the fixture always answers. Once it
talks to `/ask` there are real ones: a 503 when the forecast cannot be retrieved, a
network failure, a timeout. docs/11 already says what the tone should be — explain what
happened and how to fix it, no apologies, no vagueness.

**Done, and it could not have waited.** Connecting to a real service is what creates the
failures, so this shipped in the same change rather than after it. Both screens share the
states, five failure kinds are named separately, and the retry is only offered when it
could plausibly help.

---

## Decisions

These cannot be built until something is decided, and two of them argue with decisions
already recorded. Recorded here as questions rather than resolved quietly.

### D1 — Should the answer be formatted?

Requested: bullet points, numbered lists, bold, possibly a small chart.

The tension: `reason` is a plain string, and the schema keeps the model's output as small
as it can be on purpose — it fills judgement and prose, nothing computable (ADR-0007).
Handing it markdown gives it a second thing to get wrong, and a 4B model producing
malformed markdown inside constrained decoding is a new failure mode.

A middle path exists and may be better than either: keep the model's prose plain, and let
the **client** render structure it can derive — the window as a component, warnings as a
list, figures emphasised because the app knows which numbers came from the engine. The
structure then comes from the schema rather than from the model's formatting, which is
the same argument that took the window away from it.

Needs a call before building.

### D2 — Drawer navigation with separate chat sessions

Requested: a drawer, multiple named conversations, delete a whole session at once.

This argues with two recorded decisions, so it needs to be an explicit reversal rather
than a drift:

- **ADR-0014** put the planner on the main screen and made Sor an escape hatch precisely
  so the product would not become a chat app with the weather as a side feature.
- **docs/11** caps history at twenty local exchanges, in its own words "not enough to
  become a chat app with a retention policy", and settles on three tabs with everything
  else one push deep. A drawer is a fourth navigation surface.

None of that makes the request wrong. Multiple conversations are genuinely useful if
people ask the assistant a lot. But if that is the direction, the honest move is a new
ADR superseding the relevant part of ADR-0014, not a drawer appearing quietly beside it.

The question underneath: **is this a weather app with an assistant, or an assistant that
knows about weather?** Everything so far answers the first. D2 is the second.

---

## Still open

- Nothing here is scheduled. The order is a separate decision from the list.
- B1 and P1 are done. B1 did not wait for the pass, and the eval suite found its root
  cause rather than just its symptom.
- P1 turned up a latent defect of its own: a shader that fails to compile returns `null`,
  and `<Shader>` accepts null silently, so a typo draws nothing and reports nothing. All
  four shaders now go through `compileShader()`, which throws, and CI compiles them
  through CanvasKit on a Linux runner — SkSL is invisible to TypeScript, ESLint and the
  bundler alike.
