# 00 — Vision and Goals

## What this project is

WeatherApp is a mobile weather application whose distinguishing feature is a
**local-only planning agent**: it answers questions like *"can I ride my bike on
Saturday?"* by reasoning over forecast data, and it does so without sending a single
byte to a hosted language model.

It is a portfolio project, built in the open, and deliberately over-engineered in the
places where engineering is worth showing.

## Why a weather app

Weather applications are a well-worn genre, and that is precisely the point. The domain
is familiar enough that a reader does not have to learn it before judging the
engineering. Nothing here is impressive because the problem is exotic; if something is
impressive, it is because of how it was built.

The risk of the genre is equally clear: a weather app that fetches JSON and renders a
list demonstrates nothing. The project is therefore designed around the parts that are
*not* obvious — the agent boundary, the offline story, the evaluation harness, and the
deployment model.

## Goals

### 1. Demonstrate two skill sets at their intersection

The author works as a **mobile developer** (React Native) and as an **AI engineer**.
Most portfolio projects show one or the other. This one is built so that neither half
can be dismissed as decoration:

- The mobile application is not a thin client. It is offline-capable, animated at
  60 fps, and degrades gracefully when the backend is unreachable.
- The AI service is not a wrapper around a chat endpoint. It runs a small model under
  tight constraints, validates everything it produces, and is measured by a test suite.

### 2. Run entirely on hardware the reader owns

There is no hosted model, no API key, and no per-request cost. `docker compose up`
plus a local model is the whole installation. This is a constraint we chose, and it is
the source of most of the interesting problems in the project — see
[ADR-0004](./adr/ADR-0004-local-only-llm.md).

### 3. Be readable

The repository is meant to be *read*, not just run. That is why this folder exists.

## Non-goals

| Not doing | Reason |
|---|---|
| Publishing to the App Store / Play Store | Store review, privacy policies, and release management add process, not engineering signal |
| Competing on forecast accuracy | We consume a public forecast API; the meteorology is not ours |
| Supporting hosted model providers | Explicitly rejected — the constraint is the point |
| Building a general-purpose chatbot | The agent is scoped to weather planning and refuses to drift |

## What "done" looks like

The project is finished when all of the following are true:

- [ ] A first-time reader can clone the repository and have it running in under ten minutes.
- [ ] The application is useful with the backend switched off entirely.
- [ ] The agent's output is validated against a schema, and every number it states can be
      traced back to a value in the forecast data.
- [ ] The evaluation suite runs in CI and its score is visible in the README.
- [ ] The reasoning behind every significant decision is written down in this folder.

## Audience

Three readers, in priority order:

1. **A hiring engineer** skimming for ten minutes, looking for evidence of judgement.
2. **A developer** who wants to run it locally and perhaps borrow an idea.
3. **The authors**, six months from now, trying to remember why something is the way it is.

Everything in this folder is written for reader (3), which turns out to serve (1) and
(2) well.
