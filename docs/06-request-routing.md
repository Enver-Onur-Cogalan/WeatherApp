# 06 — Request Routing

## The idea

Most weather questions do not need a language model. Routing is the component that
decides which ones do.

This is the least glamorous part of the system and arguably the most valuable. Anyone
can put a model behind an endpoint; knowing where *not* to put one is the harder skill.

## Why routing matters more with a local model, not less

The usual argument for routing is cost: send cheap requests to a cheap model. We have
no per-request cost — the model is local and free. The argument here is different and
stronger.

| Concern | Effect of routing |
|---|---|
| **Latency** | A templated answer returns in tens of milliseconds. The local model takes seconds. Most questions deserve the former. |
| **Reliability** | A 4B model has a real error rate. Every request that avoids it avoids that error rate entirely. |
| **Availability** | If Ollama is not running, routed-away requests still succeed. The app remains useful. |
| **Contention** | One local model instance is a shared, serialised resource. Not queueing behind it is a feature. |

## The three tiers

```
Request
   │
   ├─ Tier 0 — deterministic       "weather in Istanbul", "will it rain tomorrow"
   │            no model            pattern match → engine → template
   │            ~50 ms
   │
   ├─ Tier 1 — light model         intent unclear, phrasing unusual
   │            thinking off        single constrained call, no tools
   │            ~1 s
   │
   └─ Tier 2 — full agent          "best window for cycling next week?"
                thinking on         tool loop + synthesis, streamed
                ~3–6 s
```

### Tier 0 — deterministic

Handled by pattern matching over a small grammar of known request shapes: current
conditions, a named day, a named location, a simple yes/no about precipitation. The
answer is assembled from the scoring engine and a localised template.

The expected majority of traffic. Never touches the model.

### Tier 1 — light model

The request did not match a known shape, but it is still a single-step question. The
model is called once, thinking disabled, with a constrained schema and no tools, purely
to map the phrasing onto a known intent. Execution then continues deterministically.

### Tier 2 — full agent

Genuinely open-ended planning. The full two-phase pipeline from
[doc 04](./04-ai-agent-design.md) runs, and the answer is streamed so the user sees
progress rather than a spinner.

## Implementation

Rule-based to begin with: a compact set of patterns and a confidence threshold below
which a request escalates to the next tier. Roughly a hundred lines.

We are explicitly *not* starting with a learned classifier. A learned router would be
harder to debug, would need training data we do not have, and would add a second model
to a system whose whole point is running one small one carefully. If evaluation shows
the rules leaking, the escalation path is data-driven refinement of the rules first, a
classifier second.

## Escalation and de-escalation

Routing is not final. Two safety valves:

- **Escalate** — Tier 0 refuses a request it cannot answer confidently rather than
  guessing; it moves up a tier.
- **De-escalate** — if Ollama is unreachable, Tiers 1 and 2 fall back to Tier 0
  behaviour and the response carries a flag the client renders as *"answered without
  the assistant"*. Reduced capability, never an error screen.

## Measurement

`/metrics` reports the tier distribution and per-tier latency percentiles. This turns
the claim behind this document into a number we can publish rather than an assertion —
and if the distribution turns out to be different from what we assumed, that is a
finding worth writing down too.

See [ADR-0008](./adr/ADR-0008-tiered-request-routing.md).
