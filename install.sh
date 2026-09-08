#!/usr/bin/env bash
# One command, from a clean server to an answering API.
#
# This exists because "docker compose up" was never actually one command. It refuses to
# start without a JWT_SECRET, the bundled Ollama comes up with no model in it, and the
# API has to be told to look at the container rather than the host — three steps that a
# reader had to find in three different files, each of which fails in a way that looks
# like something else. A missing model reports the service as degraded; the wrong Ollama
# address reports every question as falling back to the engine.
#
#   ./install.sh              everything in containers, model included (Linux)
#   ./install.sh --host-model Ollama runs on the host (macOS — ADR-0010)
#
# Idempotent: run it again to upgrade. It never rewrites secrets it has already written.
set -euo pipefail
cd "$(dirname "$0")"

BUNDLED=1
[ "${1:-}" = "--host-model" ] && BUNDLED=0

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

command -v docker >/dev/null || { echo "docker is not installed."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "docker compose v2 is required."; exit 1; }

# ── Secrets, generated once and never regenerated ───────────────────────────────────
#
# Rewriting JWT_SECRET would sign every existing session out, and rewriting the database
# password would lock the service out of its own volume. Both are therefore written only
# when absent, which is also what makes this safe to re-run.
if [ ! -f .env ]; then
  say "Writing .env"
  cp .env.example .env
fi

set_once() {
  local key="$1" value="$2"
  if grep -qE "^${key}=.+" .env; then return; fi
  # A key with an empty value exists in .env.example; replace it in place rather than
  # appending a duplicate that the later one would win.
  if grep -qE "^${key}=" .env; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
  echo "  ${key} generated"
}

secret() { openssl rand -base64 36 2>/dev/null | tr -d '\n/+=' | cut -c1-48; }

set_once JWT_SECRET "$(secret)"
set_once POSTGRES_PASSWORD "$(secret)"

MODEL=$(grep -E '^OLLAMA_MODEL=' .env | cut -d= -f2-)
MODEL=${MODEL:-gemma4:e4b}

FILES=(-f docker-compose.yml)

if [ "$BUNDLED" = "1" ]; then
  # The one value compose cannot vary by profile, so it is set here instead.
  sed -i.bak 's|^OLLAMA_BASE_URL=.*|OLLAMA_BASE_URL=http://ollama:11434|' .env && rm -f .env.bak
  PROFILE=(--profile bundled)

  # Only when the host actually has one. A devices reservation is refused outright on a
  # machine without the NVIDIA toolkit, so this cannot live in the main compose file —
  # and without it a GPU server runs the model on its CPUs and merely feels slow, which
  # is the failure that does not announce itself (ADR-0010).
  if command -v nvidia-smi >/dev/null 2>&1; then
    FILES+=(-f docker-compose.gpu.yml)
    echo "  NVIDIA GPU detected; the model will use it."
  else
    echo "  No NVIDIA GPU detected; the model will run on the CPU and answers will be slow."
  fi
else
  sed -i.bak 's|^OLLAMA_BASE_URL=.*|OLLAMA_BASE_URL=http://host.docker.internal:11434|' .env && rm -f .env.bak
  PROFILE=()
fi

# ── Bring it up ─────────────────────────────────────────────────────────────────────
say "Building and starting"
docker compose "${FILES[@]}" "${PROFILE[@]}" up -d --build

if [ "$BUNDLED" = "1" ]; then
  say "Pulling ${MODEL}"
  echo "  Several gigabytes, once. The volume keeps it across restarts."
  # Waiting for the container rather than assuming: `up -d` returns as soon as the
  # process starts, and ollama is not listening yet.
  for _ in $(seq 1 60); do
    docker compose "${FILES[@]}" exec -T ollama ollama list >/dev/null 2>&1 && break
    sleep 2
  done
  docker compose "${FILES[@]}" exec -T ollama ollama pull "$MODEL"
fi

# ── Say whether it worked ───────────────────────────────────────────────────────────
#
# /ready rather than /health: the first says the process is up, the second says its
# dependencies are. A service that answers /health with no model is exactly the state
# this script exists to stop somebody shipping without noticing.
say "Waiting for the service"
for _ in $(seq 1 45); do
  BODY=$(curl -fsS -m 3 http://localhost:8000/ready 2>/dev/null || true)
  case "$BODY" in *'"status":"ready"'*) break ;; esac
  sleep 2
done

echo
case "$BODY" in
  *'"status":"ready"'*)
    printf '\033[32mReady.\033[0m  http://localhost:8000\n'
    echo "  Point the app at this host with EXPO_PUBLIC_API_URL."
    ;;
  *'"status":"degraded"'*)
    printf '\033[33mUp, without the assistant.\033[0m  http://localhost:8000\n'
    echo "  Forecasts and windows work; questions fall back to the scoring engine."
    echo "  ${BODY}"
    ;;
  *)
    printf '\033[31mThe service did not answer.\033[0m\n'
    echo "  docker compose logs api"
    exit 1
    ;;
esac
