# ADR-0012 — Instrument as the visual direction

- **Status:** Accepted
- **Date:** 2026-08-25

## Context

Weather applications have a strong visual convention: a full-bleed gradient sky, a large
current temperature, a horizontal strip of hours. Following it produces something
competent and forgettable. Abandoning it entirely produces something confusing.

The deciding question was what this product actually outputs. The scoring engine does not
return a scalar; it returns an **interval** with a reason attached to every hour. A design
led by a large temperature number would be describing a different product.

Three directions were drawn up and compared.

## Decision

**Instrument.** Time is the primary axis, and the hero is a span rather than a number.
The visual language is borrowed from meteorology's time-recording instruments — the
barograph's continuous trace, the Campbell–Stokes recorder's scorch mark — taking their
logic and leaving their texture.

Full specification: [doc 10](../10-design-language.md).

## Consequences

**Positive**

- The design states the same thing as the architecture: conclusion first, evidence one
  glance away.
- The trace is both the hero graphic and the navigation, so the most memorable element is
  also the most used one.
- Switching activity redraws the trace into a different landscape — the product's thesis
  demonstrated rather than asserted.
- Still exercises Skia and Reanimated hard, so nothing is given up on the mobile side.

**Negative**

- A user arriving to check the temperature meets a score curve first. Mitigated by the
  readout row directly beneath, but it is a real half-second of adjustment.
- The trace is only meaningful once an activity profile exists, which puts weight on
  onboarding. A user who skips profile creation sees a less useful main screen.
- Precision is unforgiving. Hairline grids and tabular figures expose sloppy spacing in a
  way a soft gradient design would hide.

## Alternatives considered

| Direction | Why not |
|---|---|
| **Atmospheric** — full-bleed animated sky, particles, the demo-reel choice | The most crowded corner of the genre. Executed well it still reads as *another weather app*, and it pushes the planner into the background. Its best idea was kept and subordinated — see [ADR-0013](./ADR-0013-data-driven-atmosphere.md). |
| **Editorial** — magazine typography, generous whitespace, numbered lists | The most natural home for the agent's prose, but it is one of the shapes AI-generated design falls into by default, and it leaves little for Skia to do. |
| **Card utility** — the modern standard | Safe, and the most forgettable option available. |

## Note

The atmospheric direction was rejected as a *direction*, not as a *capability*. Weather
animation survives as a layer inside this one, on the condition that it carries data.
