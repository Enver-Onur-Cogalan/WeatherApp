#!/bin/sh
# Bring the schema up to date, then serve.
#
# The image used to start uvicorn directly, and `docker compose up` produced a service
# that answered /health and /plan perfectly and returned 500 on anything touching an
# account — `relation "users" does not exist`, because nothing had ever run a migration
# against the container's fresh volume. Every endpoint that did not need a table worked,
# which is why it looked fine.
#
# `set -e` so a failed migration stops the container instead of starting a service against
# a schema it does not match. A crash loop is loud; the alternative is quiet corruption.
set -e

echo "Applying migrations…"
alembic upgrade head

exec "$@"
