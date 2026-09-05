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

### B2 — White flash when the keyboard opens — **fixed 2026-09-05**
**Where:** Sor, composer.

The area the keyboard occupies flashes white before the keyboard draws. The app commits
to one dark visual world (docs/10), so a white frame is jarring rather than merely
unstyled — likely a window background that was never set, beneath React's view tree.

**That guess was right.** `app.json` had no `backgroundColor`, so the frame the keyboard
uncovered was the platform default. It is the one place a colour literal lives outside
`theme.ts` and cannot not be: the native window background is read before any JavaScript
runs, so it cannot import anything. `theme.ts` carries a note that the two must stay
equal.

---

## Polish

### P1 — A loading state that belongs to this app — **done 2026-09-03**
**Where:** Sor, while the assistant is thinking.

Currently a system spinner and "Cihazda düşünüyor…". The wait is fifteen to forty-seven
seconds, so it is a large part of the screen's life and deserves better than a default.

There is an obvious source: the app already draws weather in Skia. Something drawn from
the same vocabulary would make the wait feel like part of the product rather than a stall
in it.

**First built as the instrument itself**: a Campbell–Stokes recorder burning its trace
into a ruled card, which is precisely the state being shown — running, with nothing to
report yet.

**Replaced 2026-09-05, because the week cards took that drawing.** Once the calendar drew
recorder cards with real days on them, a loading state that looked the same stopped
reading as *working* and started reading as *here is a day* — a lie held for
twenty-seven seconds. A loading state must not resemble the content it is loading.

It is the other thing an instrument produces now: a pressure chart. Contours over a field
that keeps rewriting itself, which is what a forecast is — a surface being solved. Blue
and quiet, with one amber contour stepping outward through the set so the eye has
somewhere to sit during a wait that is otherwise uniform. Unmistakably meteorological
without being a picture of weather, and nothing else in the app looks like it.

One detail falls out of the maths rather than being drawn: contours crowd where the field
is steep and spread where it is flat, exactly as isobars do. Nobody will read it that way,
and it is why the picture looks right.

Reduced motion holds a still frame rather than stopping dead.

The wait now also shows its elapsed seconds, after five. The animation is deliberately
indeterminate: the agent's two phases are not streamed to the client, so a progress bar
would be fiction. docs/08 measured the median at 27 seconds, which is what made the
default spinner wrong — that long, it reads as a hang.

### P2 — The answer card appears abruptly — **done 2026-09-05**
**Where:** Sor.

It cuts in. An entrance would place it, and the wait beforehand makes the arrival worth
marking. Under 300ms, ease-out, and it goes away under reduced motion.

**Done at 220ms.** The entrance is on the *turn* rather than the card, so a question and
its answer arrive as one thing — which is what they are. Under reduced motion the opacity
survives and the movement does not: the fade still says something arrived, and the
translation is the part that causes trouble.

### P3 — A delete animation — **done 2026-09-05**
**Where:** Sor, once deleting exists (F1, F2).

Removal without motion reads as a glitch. Pairs with the delete work rather than being
separate.

**140ms, faster than the arrival.** Waiting on something you have already decided to
remove reads as lag rather than as polish.

---

## Features

### F1 — Delete an exchange — **done 2026-09-05**
**Where:** Sor.

Nothing can currently be removed. Related: history does not survive a launch either
(docs/11), so today everything disappears on restart, which is deletion by accident
rather than by choice.

**Both halves are done.** History persists (docs/12) and an exchange can be deleted
deliberately.

### F2 — Long-press menu on a card — **done 2026-09-05**
**Where:** Sor.

Copy, edit, delete. Icons alone are enough — no labels needed.

**Copy and delete on the answer; copy and edit on the question.** Editing an *answer* is
still not a thing that can be true — but editing the *question* is, and it is what a person
reaches for when they meant something slightly different. It re-asks in place: the turn
keeps its id, shows the wait where it already is, and is replaced on success. A failure
leaves the original exactly where it was, which is the whole reason the row is kept rather
than removed and re-added.

Editing happens in the bubble rather than in the composer. The composer is where new
questions go, and borrowing it to change one halfway up the thread leaves a person typing
in one place while watching another.

**Drawn rather than native, and that is a compromise.** docs/02's rule is native where a
component would only say the platform's name, and a context menu is exactly that. But
`@expo/ui`'s menus are native views that do not exist in Expo Go, which is where this app
currently runs — there is no development build. So it is the same in-place reveal the
profile rows use. If a dev build ever lands, this is the first thing that should become
native.

**Icons, on a surface, over the card.** The first version was three words in a row *under*
the card, which was wrong twice: it read as body text that happened to be tappable, and
sitting below it belonged to whatever came next as readily as to what came before. It is
laid on top now, with the card dimmed behind — position says what it acts on, and the
dimming says it again for anyone who does not read position as meaning.

Every icon carries an accessible label even though none is shown. An icon-only control
with no accessible name is a button a screen reader announces as nothing at all.

The editing controls stay in flow rather than floating: nothing is being pointed at, the
field is the subject, and an overlay would cover the text being typed.

### F3 — Say which place the answer is about — **done 2026-09-05**
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

**The larger half is done.** Places are searched, saved, selected and deleted — on the
server for an account, on the device for a guest, through one component. The constant is
gone from everything except a fallback that exists so a first launch shows a forecast
instead of an empty state demanding setup. See docs/11.

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

### P4 — 00:00 and 23:00 were nearly untouchable — **fixed 2026-09-05**
**Where:** İz, the 24-hour trace.

Found on a device. The trace was plotted edge to edge, which read well and was close to
unusable at both ends.

The arithmetic says why. Twenty-four hours across a 390dp screen is a step of about 17dp,
and the two outermost hours own only *half* a step each — so 00:00 was an 8dp target
pressed against the bezel, inside the band where Android's back gesture and iOS's
screen-edge pan live. It was not a matter of taste; the target was smaller than a
fingertip and in the worst possible place.

The plot is inset 24dp at each end now. Twenty-four rather than a round twenty because it
is Android's own system gesture inset, so the first data point sits exactly outside the
band the platform reserves. With the gesture's clamp, 00:00 captures everything from the
screen edge inward — a band of about 31dp, three and a half times what it had. During a
drag the ends are effectively infinite targets, since anything past the last point holds
there; the number matters for a cold tap, which was the case that was hard.

It costs 12% of the width and the full-bleed the design liked. A spine you cannot touch at
either end is worse than a spine with margins.

Rejected on the way: a non-linear x mapping that would have kept the bleed and widened the
end bands. It buys reachability by making the time axis non-uniform, and a time series
whose x-axis lies about time is a worse trade than a margin.

**The 7-day view is untouched** — a different idea for it is coming.

### P5 — Forty seconds with nothing happening — **done 2026-09-05**
**Where:** Sor, while the assistant is thinking.

P1 gave the wait a drawing. It still said one thing for the whole of it, and the whole of
it is around forty seconds.

The two halves are not equal, which is the finding that made this worth building. Measured
on one question: **gathering the data took 28 seconds, composing the sentence took 6.**
A single "thinking…" spends most of its time describing the wrong half.

`/ask/stream` reports the phases the agent actually goes through, as newline-delimited
JSON — no fraction, because the agent does not know one and a progress bar built from a
guess is the fiction this document ruled out for D1's sibling problem. NDJSON rather than
Server-Sent Events: SSE buys reconnection and event ids, neither of which applies to a
single request that is worthless if resumed halfway.

`repairing` is the interesting phase. It means a gate rejected the answer and the model is
being asked again — a wait getting longer because the thing is being *checked*, not
because it is stuck, and worth saying out loud.

The plain `/ask` stays. The eval suite drives the agent directly and the endpoint is the
simpler contract for anything that is not a phone.

## Decisions

These cannot be built until something is decided, and two of them argue with decisions
already recorded. Recorded here as questions rather than resolved quietly.

### D1 — Should the answer be formatted? — **decided 2026-09-05: the client formats**

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

**Built as the middle path**, and the reasoning above held. `reason` stays a plain string,
the model still fills judgement and prose only, and the structure comes from the schema:
the window's temperature, wind and rain are computed by the scoring engine, attached to
the answer, and rendered by the client as labelled readings. The same argument that took
the window away from the model takes the formatting away from it — a temperature is a
number with a unit, not a phrase to be parsed back out of a sentence.

No markdown reaches the model. It was never going to be worth a new failure mode inside
constrained decoding.

### D3 — The answers did not sound like a weather assistant

Noticed on a device, alongside D1, and the cause was not the prompt.

A real answer read: *"Bu hafta koşu için uygun zamanlar; Pazartesi günü altı ile on bir
arasında, Cumartesi günü altı ile öğle arasında…"* — a list of times with no weather in
it. It reads like a scheduling assistant because that is exactly what it was.

`get_activity_windows` returned `day`, `weekday`, `start_hour`, `end_hour` and `score`, and
nothing else. **The model had never been given a temperature, a wind speed or a rain
chance for any window it recommended.** The groundedness gate then kept it that way, doing
its job perfectly: a figure the model was never given is a figure it cannot state. Two
correct mechanisms combined into an answer that said nothing about the weather.

The tool returns the conditions over each window now, computed by the engine from the same
hours it scored. Measured immediately after, on the same question:

> *"Cumartesi günü altı ile on bir arasında hava sıcaklığı yirmi bir ile yirmi yedi derece
> arasında olacak, rüzgar en fazla sekiz ve yağış yok."*

The engine's own fallback sentence says it too, for the same reason: someone who lands
there should not be able to tell that the model failed, only that the prose is plainer.

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
- Everything except the two decisions is done. B1 and P1 landed early; the rest went in
  one pass on 2026-09-05.
- **D1 and D2 are still open, and both need a call rather than an implementation.** They
  are the only items left in this document.
- P1 turned up a latent defect of its own: a shader that fails to compile returns `null`,
  and `<Shader>` accepts null silently, so a typo draws nothing and reports nothing. All
  four shaders now go through `compileShader()`, which throws, and CI compiles them
  through CanvasKit on a Linux runner — SkSL is invisible to TypeScript, ESLint and the
  bundler alike.
