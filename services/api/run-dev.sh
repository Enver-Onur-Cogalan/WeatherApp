#!/usr/bin/env bash
# The API, bound where a phone can reach it.
#
# Two things go wrong when this is run by hand, and both look like the app being broken
# rather than the server being misconfigured:
#
#   uvicorn binds 127.0.0.1 by default, which is the Mac's own loopback. The app then
#   reports "sunucuya ulaşılamıyor" and everything about the phone looks wrong — same
#   Wi-Fi, correct address, no answer.
#
#   JWT_SECRET has a minimum length and the service refuses to start without one. The
#   failure is a Pydantic validation error inside a lifespan handler, which is a long
#   way from saying "set this variable".
#
# `docker compose up` handles both and is the documented path; this is for the tighter
# loop where the service is being edited.
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

if [ -z "${JWT_SECRET:-}" ]; then
  echo "JWT_SECRET is not set; generating an ephemeral one for this run."
  echo "Sessions will not survive a restart. Copy .env.example to .env for a stable one."
  JWT_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  export JWT_SECRET
fi

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
LAN="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '')"

echo "API on http://${HOST}:${PORT}"
[ -n "$LAN" ] && echo "From the phone: http://${LAN}:${PORT}  (the app derives this from Metro)"

exec .venv/bin/python -m uvicorn app.main:app --host "$HOST" --port "$PORT" --reload
