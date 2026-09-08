# ADR-0019 — The atmosphere may run on a specimen, outside the forecast surface

- **Status:** Accepted
- **Date:** 2026-09-09
- **Extends:** [ADR-0013](./ADR-0013-data-driven-atmosphere.md)

## Context

[ADR-0013](./ADR-0013-data-driven-atmosphere.md) kept the atmosphere layer on one
condition: it must carry data. That decision was made about the screen the forecast is
on, and it is the reason the layer is a second reading of the same numbers rather than a
sky behind a chart.

The onboarding tour raised a case the decision did not anticipate. Its job is to show
what the product does, and the most distinctive thing this product does is draw weather
that responds to real values — but a tour runs before a place has been chosen, so there
is no forecast for it to encode. Read strictly, ADR-0013 forbids the one surface whose
entire purpose is demonstrating the layer.

The strict reading was applied first, and produced a tour of three text pages naming the
three tabs. It was accurate, disciplined and dead, and it undersold the app to the person
least likely to give it a second chance.

Two things were already settled and are not reopened here. The gate has no atmosphere,
because it is a screen a person is trying to get *past* and drawing weather there earns
nothing. And nothing anywhere draws a trace that could be mistaken for a real one —
[`thinking.tsx`](../../apps/mobile/src/components/thinking.tsx) records why, having
learned it from a loading state that started reading as a forecast.

## Decision

**The atmosphere layer may run on fixed specimens on a surface whose subject is the
layer itself.** Today that is the tour and nothing else.

A specimen is a complete set of the same five inputs the real screen passes — hour,
weather code, precipitation, wind, cloud — chosen to be obviously not a forecast. The
three in use are snow at midday, a thunderstorm at midnight, and a clear evening: a set
that cannot all be true on one day anywhere.

The rule ADR-0013 established still holds everywhere it was aimed. On the trace screen
the layer encodes the scrubbed hour's real values and nothing else, and no surface may
show a sky that stands for nothing.

## Consequences

**Positive**

- The tour shows the product working instead of describing it, using the code that
  actually runs rather than a drawing of it.
- The specimens exercise nearly the whole layer — falling bodies, cloud, wind, lightning,
  stars, and the full travel of the sun — which makes the tour a place regressions in it
  are visible.
- A demonstration surface now has a rule, so the next one does not have to argue the
  case again.

**Negative**

- **The line is thinner than it looks.** "A surface whose subject is the layer" is a
  judgement, and a later screen could claim it dishonestly. The test that matters is
  whether a person could mistake what they see for a forecast of somewhere; if they
  could, this does not license it.
- **Three shader stacks run at once** while the tour is open, on top of a cost ADR-0013
  already flagged and still nobody has profiled. The quality tier that ADR left open is
  now more overdue, not less.
- Specimens are a second set of weather values to keep working. Nothing tests them, and a
  change to the layer can leave the tour drawing something wrong without any check
  failing.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep the strict reading | What was built first, and it honours ADR-0013 exactly. Rejected because it produced a tour that explained the navigation — the one thing a person finds in two taps — while the app's most distinctive capability sat unmentioned behind it. A rule that forbids demonstrating the thing it protects is being read too literally. |
| Draw the tour's weather by hand | Illustrations owe nothing to any decision and cannot drift into looking like data. Rejected because the drawing would then be a claim about what the app looks like, maintained separately from the app, and wrong the first time the layer changed. |
| Use the person's real forecast in the tour | Honest, data-carrying, and available a moment later. Rejected on two counts: the tour runs before a place is chosen and possibly before the server is reachable, and one real sky demonstrates one condition — the layer's range is the thing being shown. |
| Show recorded screenshots | The conventional answer, and it would cost nothing at runtime. Rejected because screenshots go stale silently, and because a still frame cannot show a layer whose whole argument is that it moves with the data. |

## When to revisit

If a second surface asks for a specimen. One exception with a written reason is a
decision; two is a pattern, and a pattern should be named rather than granted case by
case.
