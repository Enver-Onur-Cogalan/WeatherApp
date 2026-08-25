# 09 — Deployment

## Design constraint

Someone who clones this repository should have it running with one command and no
account anywhere. That constraint drove the choice of a keyless forecast API and a
local model, and it drives the container topology here.

## Topology

```
docker compose up                     api + redis + postgres
                                      → connects to Ollama on the host

docker compose --profile bundled up   api + redis + postgres + ollama
                                      → for Linux hosts with a GPU
```

Two profiles exist because of a platform difference explained below.

## Apple Silicon: Ollama runs on the host

Containers on macOS cannot access Metal. An Ollama container on an M-series Mac falls
back to CPU inference, which is slow enough to make the application feel broken.

On macOS, Ollama therefore runs natively on the host, and the API container reaches it
through `host.docker.internal`. On Linux with a GPU, the bundled profile puts Ollama in
a container where it belongs.

This is documented in the README as two distinct installation paths rather than hidden
behind a compose file, because a reader who does not know about the Metal limitation
would otherwise conclude the project is slow.

See [ADR-0010](./adr/ADR-0010-ollama-on-host-for-apple-silicon.md).

## Container practices

- Multi-stage builds; `uv` resolves dependencies in a builder stage and the runtime
  image carries only what it needs.
- Non-root user.
- Healthchecks on every service, with the API's readiness gated on its dependencies.
- Pinned base image digests. `latest` is not a version.

## Configuration

Environment variables only, documented in `.env.example`. Notable ones:

| Variable | Purpose |
|---|---|
| `OLLAMA_BASE_URL` | Where the model lives; the whole host/container difference collapses into this |
| `OLLAMA_MODEL` | Model tag; how a 32 GB machine opts into the 26B MoE |
| `ROUTING_ENABLED` | Disable tiering to force everything through the agent — used by the evaluation suite |
| `JWT_SECRET` | No default. The service refuses to start without it |

`ROUTING_ENABLED` deserves a note: being able to turn routing off is how we measure
what routing is worth.

## Continuous integration

| Job | Runs on |
|---|---|
| Lint, type check, backend tests | every push |
| Mobile type check and tests | every push |
| Evaluation suite (core scenarios) | every pull request |
| Evaluation suite (full, repeated) | nightly |
| Secret scanning | every push |
| EAS build | tagged releases |

The nightly evaluation job needs a machine with a model on it, which a hosted CI runner
does not have. It runs on a self-hosted runner; where that is unavailable, the job is
skipped rather than faked.
