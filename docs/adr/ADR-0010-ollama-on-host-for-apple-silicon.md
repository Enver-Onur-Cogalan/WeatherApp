# ADR-0010 — Ollama on the host on Apple Silicon

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

The natural shape for this project is a single `docker compose up` bringing up every
service, model included. That works on Linux.

It does not work on Apple Silicon. Containers on macOS have no access to Metal, so an
Ollama container falls back to CPU inference. The difference is not marginal — it is the
difference between an application that feels responsive and one that appears broken.

The reference development machine is an M3 Mac, so this is not an edge case for us. It
is the primary case.

## Decision

Ollama runs **natively on the host** on macOS; the API container reaches it via
`host.docker.internal`. On Linux, a `bundled` compose profile runs Ollama in a container
with GPU access.

## Consequences

**Positive**

- Full Metal acceleration on the development machine. Ollama 0.19's MLX engine is
  roughly twice as fast at decoding, and that only happens on the host.
- Linux server deployment stays a genuine one-command install.
- The whole difference collapses into one environment variable, `OLLAMA_BASE_URL`. The
  application code has no idea where the model is.

**Negative**

- macOS installation is two steps, not one: install Ollama, pull a model, then compose up.
- The README needs two installation paths, which is more documentation than we would like.
- `host.docker.internal` is a Docker Desktop convenience; on Linux without Docker
  Desktop it requires explicit configuration — one of the reasons the bundled profile
  exists.

## Alternatives considered

| Option | Why not |
|---|---|
| Ollama in a container everywhere | Uniform and unusably slow on the development machine. |
| Ollama on the host everywhere | Loses the one-command Linux install, which is the deployment story we want to tell. |
| Detect the platform in one compose file | Compose cannot branch on the host platform. Two explicit profiles are honest; a clever workaround would not be. |

## Documentation requirement

The README must **state the reason**, not just the steps. A reader who does not know
about the Metal limitation will otherwise assume the project is slow, or that the
two-path installation is carelessness.
