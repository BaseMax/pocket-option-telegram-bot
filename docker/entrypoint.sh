#!/bin/sh
set -e

DATA_DIR=$(dirname "${DB_PATH:-/app/data/bot.sqlite}")

if [ ! -d "$DATA_DIR" ]; then
  echo "FATAL: $DATA_DIR does not exist inside the container." >&2
  exit 1
fi

if ! touch "$DATA_DIR/.write-test" 2>/dev/null; then
  echo "FATAL: $DATA_DIR is not writable by uid $(id -u):$(id -g)." >&2
  echo "The bot keeps its SQLite database there, so it cannot start." >&2
  echo "Set DOCKER_UID and DOCKER_GID in .env to the owner of ./data:" >&2
  echo "  echo \"DOCKER_UID=\$(id -u)\" >> .env && echo \"DOCKER_GID=\$(id -g)\" >> .env" >&2
  echo "then run: docker compose up -d --force-recreate" >&2
  exit 1
fi
rm -f "$DATA_DIR/.write-test"

exec "$@"
