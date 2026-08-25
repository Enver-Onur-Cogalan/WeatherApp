# ADR-0002 — Python and FastAPI for the backend service

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

A backend is required regardless of language: to keep the model off the device, to hold
the scoring engine, to cache, and to run evaluations. The choice is between staying in
TypeScript for a single-language repository, or using Python for the AI half.

## Decision

Build the service in **Python with FastAPI**.

## Consequences

**Positive**

- The local-model tooling — Ollama's client, schema-constrained generation, evaluation
  libraries — is Python-first. Using anything else means reimplementing or wrapping.
- Pydantic serves three purposes from one type definition: request validation, OpenAPI
  documentation, and the JSON Schema handed to the model for constrained decoding.
  That last one is not incidental; it is why the model's output contract and the API's
  output contract cannot drift apart.
- Python is the language a reader expects an AI engineer to be fluent in. The signal
  matters for a portfolio project.

**Negative**

- Two languages in one repository: two toolchains, two CI paths, two dependency files.
- The shared contract between client and service must be generated rather than shared
  directly, which is why `packages/schema` exists.

## Alternatives considered

| Option | Why not |
|---|---|
| TypeScript (Hono / Fastify) | Single language, simpler repository — but the AI ecosystem is thinner, and it weakens the AI-engineering signal the project is built to send. |
| Go | Fast and deployable, but the same ecosystem problem, more severely. |
| No backend, model on device | Rejected: bundling a multi-gigabyte model into a mobile app, with no shared cache and no server-side evaluation, is not viable. |
