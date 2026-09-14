#!/bin/zsh
# Локальные тесты: nvm Node + портативный Postgres в client/node_modules/.cache
set -e
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/client/node_modules/.cache"
export PATH="$CACHE/pgsql/bin:$PATH"
export PGDATA="$CACHE/pgdata"
export PGHOST=127.0.0.1
export PGPORT=5432
export PGUSER="${PGUSER:-$USER}"

if [ ! -x "$CACHE/pgsql/bin/psql" ]; then
  echo "нет psql в $CACHE/pgsql — сначала скачай бинарник postgres" >&2
  exit 1
fi

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  initdb -D "$PGDATA" --auth=trust --no-instructions
  {
    echo "unix_socket_directories = '$CACHE'"
    echo "listen_addresses = '127.0.0.1'"
  } >> "$PGDATA/postgresql.conf"
fi

if ! pg_isready -q -h 127.0.0.1 -p 5432; then
  pg_ctl -D "$PGDATA" -l "$CACHE/pg.log" start
fi

cd "$ROOT/client"
npm test
