# WeatherApp — Engineering Documentation

This folder is the project's logbook. It records not only *what* we built, but *why*
we built it that way, *what we rejected*, and *what we were uncertain about*.

If you are reading this repository to evaluate the engineering behind it, start here
rather than in the source tree. The code shows the result; these documents show the
reasoning.

## How this documentation is organised

| Layer | Purpose | Where |
|---|---|---|
| **Narrative documents** | Explain a whole area of the system in prose | `docs/*.md` |
| **Decision records (ADRs)** | Capture one decision each, with its trade-offs | `docs/adr/*.md` |

A narrative document answers *"how does this part work?"*.
An ADR answers *"why is it like that and not otherwise?"*.

## Reading order

| # | Document | What it covers |
|---|---|---|
| 00 | [Vision and Goals](./00-vision-and-goals.md) | What this project is, who it is for, what "done" means |
| 01 | [Architecture Overview](./01-architecture-overview.md) | The system in one picture, and the request lifecycle |
| 02 | [Mobile Stack](./02-mobile-stack.md) | Expo application: libraries, state, offline strategy |
| 03 | [Backend Stack](./03-backend-stack.md) | FastAPI service: layout, dependencies, data sources |
| 04 | [AI Agent Design](./04-ai-agent-design.md) | The planner agent, tool surface, and the boundary we draw around the model |
| 05 | [Local LLM Research](./05-local-llm-research.md) | Model selection evidence, benchmarks, and hardware constraints |
| 06 | [Request Routing](./06-request-routing.md) | Deciding when *not* to call the model |
| 07 | [Authentication and Security](./07-auth-and-security.md) | Accounts, tokens, guest mode, secret handling |
| 08 | [Evaluation Strategy](./08-evaluation-strategy.md) | How we measure whether the agent actually works |
| 09 | [Deployment](./09-deployment.md) | Docker topology, and why Apple Silicon is a special case |
| 10 | [Design Language](./10-design-language.md) | The instrument direction: palette, type, the trace, thirteen weather states |
| 11 | [Screen Flows](./11-screen-flows.md) | Navigation graph, every screen, and how the app is entered from outside |
| 12 | [Data Model](./12-data-model.md) | Entities, the shared contract, sync semantics, migrations |
| — | [Decision Records](./adr/README.md) | The full index of ADRs |

## Documents planned but not yet written

These areas have not been decided yet. They will be added as the design settles.

- **Observability** — metrics, tracing, and what we expose publicly

## Conventions used in these documents

- **Present tense** for what the system does; **past tense** for what we decided.
- Every claim that came from research carries a source link.
- Uncertainty is written down, not hidden. A document that says
  *"we do not know this yet"* is more useful than one that pretends otherwise.
- Numbers are dated. Benchmarks age quickly; an undated benchmark is a rumour.
