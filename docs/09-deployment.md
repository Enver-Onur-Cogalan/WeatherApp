# 09 — Deployment

## Design constraint

Someone who clones this repository should have it running with one command and no
account anywhere. That constraint drove the choice of a keyless forecast API and a
local model, and it drives the container topology here.

## Installing on a server

```
./install.sh                  everything in containers, model included
./install.sh --host-model     Ollama runs on the host (macOS — ADR-0010)
```

**`docker compose up` was never actually one command**, and each of the three steps it
was missing fails in a way that looks like something else. The service refuses to start
without a `JWT_SECRET` — a Pydantic error inside a lifespan handler, a long way from
"set this variable". The bundled Ollama starts with no model in it, so `/ready` reports
the assistant as degraded and every question falls back to the scoring engine. And the
API has to be told to look at the container rather than the host, which compose cannot
express per profile: the file carried a comment claiming it did, and nothing did, so
`--profile bundled` started an Ollama container and then ignored it.

The script does those three things, waits for `/ready` rather than `/health`, and says
which of the two it got. It is idempotent — run it again to upgrade — and it never
rewrites a secret it has already written, because regenerating `JWT_SECRET` signs every
session out and regenerating the database password locks the service out of its own
volume.

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

## Migrations run with the image, not beside it

Found 2026-09-05, by running the documented path for the first time.

`docker compose up` built, started, reported healthy, and answered `/health`, `/ready` and
`/plan` perfectly. Every account endpoint returned 500: `relation "users" does not exist`.
Nothing had ever applied a migration to the container's fresh volume, and the Dockerfile
did not even copy `alembic/` into the image — so it could not have been done by hand
either.

Everything that needed no table worked, which is exactly why it looked fine.

The image now carries its migrations and an entrypoint that applies them before starting
the server, with `set -e` so a failed migration stops the container rather than serving
against a schema it does not match. A crash loop is loud; the alternative is quiet.

Verified afterwards on the macOS path, container to host Ollama (ADR-0010): migrations
applied, registration 201, profiles listed, `/plan` 200, and `/ask` answered from the model
in 36 seconds.


## Still open

- **`install.sh` has not been run end to end on a real server.** Its `.env` handling was
  tested in isolation, including that a second run leaves existing secrets alone, and the
  container path was verified on macOS against a host Ollama. The Linux bundled path —
  GPU, model pull, container-to-container — has been reasoned about and not executed.
- **No TLS, and port 8000 is published on every interface.** That is right for a laptop
  on a home network and wrong for anything with a public address; a reverse proxy is
  assumed and not provided. The bundled Ollama is bound to loopback, since an open 11434
  is an unauthenticated inference endpoint.
- **Nothing backs up the database volume.** Profiles and places live there, and the
  handoff from guest to account exists precisely so they survive a phone — surviving the
  server is a separate promise nobody has made yet.
- **`ENVIRONMENT` still defaults to `development`.** Nothing reads it in a way that
  matters yet, which is exactly how it will be wrong the first time something does.
- **No resource limits.** The model is the largest thing on the machine and nothing
  stops it competing with Postgres for memory.
