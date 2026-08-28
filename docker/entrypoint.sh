#!/bin/sh
set -e

DATA_DIR=$(dirname "${DB_PATH:-/app/data/bot.sqlite}")

if [ ! -d "$DATA_DIR" ]; then
  echo "FATAL: $DATA_DIR does not exist inside the container." >&2
  exit 1
fi

if ! touch "$DATA_DIR/.write-test" 2>/dev/null; then
  uid=$(id -u)
  gid=$(id -g)
  echo "FATAL: $DATA_DIR is not writable by uid $uid:$gid." >&2
  echo "The bot keeps its SQLite database there, so it cannot start." >&2
  echo "" >&2
  echo "On the host, give the mounted directory to that user:" >&2
  echo "  sudo chown -R $uid:$gid data" >&2
  echo "" >&2
  echo "Or run the container as whoever already owns it, in .env:" >&2
  echo "  DOCKER_UID=<owner uid>   # see: stat -c '%u:%g' data" >&2
  echo "  DOCKER_GID=<owner gid>" >&2
  echo "" >&2
  echo "Then: docker compose up -d --force-recreate" >&2
  exit 1
fi
rm -f "$DATA_DIR/.write-test"

exec "$@"
