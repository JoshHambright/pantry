#!/usr/bin/env bash
#
# Start a local PostgreSQL for development and tests, without Docker.
#
# Why this exists: this project is developed in Claude Code cloud sessions,
# where the docker CLI is present but there is no daemon behind it. The
# documented workflow in docs/DEPLOY.md (`docker compose ... up -d db`) is the
# right one on your own machine; this is the fallback for a container that
# cannot run containers.
#
# Usage:
#   ./scripts/dev-db.sh start     # initdb if needed, then start on $PGPORT
#   ./scripts/dev-db.sh stop
#   ./scripts/dev-db.sh status
#   ./scripts/dev-db.sh reset     # drop and recreate both databases
#
# It prints the DATABASE_URL and TEST_DATABASE_URL to export.

set -euo pipefail

PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-pantry}"
# Must be somewhere the postgres system user can traverse — a scratch directory
# under /tmp is typically 0700 for another user and initdb fails on it.
PGDATA="${PGDATA:-/var/lib/postgresql/pantry-dev}"

find_bindir() {
  if command -v pg_ctl >/dev/null 2>&1; then
    dirname "$(command -v pg_ctl)"
    return
  fi
  local candidate
  candidate=$(find /usr/lib/postgresql -maxdepth 2 -name bin -type d 2>/dev/null | sort -V | tail -1)
  if [ -n "$candidate" ]; then
    echo "$candidate"
    return
  fi
  echo "postgres is not installed. Try: apt-get install -y postgresql" >&2
  exit 1
}

BINDIR="$(find_bindir)"
export PATH="$BINDIR:$PATH"

# postgres refuses to run as root, so everything goes through the postgres user
# when we are root. On a normal dev machine we are already unprivileged.
as_postgres() {
  if [ "$(id -u)" -eq 0 ] && id postgres >/dev/null 2>&1; then
    su postgres -s /bin/sh -c "PATH=$PATH $1"
  else
    sh -c "PATH=$PATH $1"
  fi
}

url_for() { echo "postgres://${PGUSER}@127.0.0.1:${PGPORT}/$1"; }

print_urls() {
  echo
  echo "export DATABASE_URL=$(url_for pantry)"
  echo "export TEST_DATABASE_URL=$(url_for pantry_test)"
}

ensure_cluster() {
  if [ -s "$PGDATA/PG_VERSION" ]; then
    return
  fi
  echo "initialising a cluster in $PGDATA"
  mkdir -p "$PGDATA"
  if [ "$(id -u)" -eq 0 ] && id postgres >/dev/null 2>&1; then
    chown -R postgres:postgres "$(dirname "$PGDATA")"
  fi
  chmod 700 "$PGDATA"
  # trust auth: this listens on loopback only and holds nothing but test data.
  as_postgres "initdb -D $PGDATA -U $PGUSER --auth=trust -E UTF8" >/dev/null
}

start() {
  if is_running; then
    echo "already running on :$PGPORT"
    print_urls
    return
  fi
  ensure_cluster
  as_postgres "pg_ctl -D $PGDATA -o '-p $PGPORT -k /tmp -c listen_addresses=127.0.0.1' -l $PGDATA/server.log start" >/dev/null

  for _ in $(seq 1 30); do
    if is_running; then break; fi
    sleep 1
  done
  is_running || { echo "failed to start; see $PGDATA/server.log" >&2; exit 1; }

  for db in pantry pantry_test; do
    if ! psql -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" -d postgres -tAc \
      "select 1 from pg_database where datname='$db'" | grep -q 1; then
      createdb -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" "$db"
      echo "created database $db"
    fi
  done

  echo "postgres is up on :$PGPORT"
  print_urls
}

stop() {
  if [ -s "$PGDATA/postmaster.pid" ]; then
    as_postgres "pg_ctl -D $PGDATA -m fast stop" >/dev/null || true
    echo "stopped"
  else
    echo "not running"
  fi
}

is_running() { pg_isready -h 127.0.0.1 -p "$PGPORT" -q 2>/dev/null; }

reset() {
  is_running || { echo "start it first" >&2; exit 1; }
  for db in pantry pantry_test; do
    dropdb -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" --if-exists "$db"
    createdb -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" "$db"
  done
  echo "both databases recreated — run pnpm db:migrate next"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) is_running && { echo "running on :$PGPORT"; print_urls; } || echo "not running" ;;
  reset) reset ;;
  *) echo "usage: $0 {start|stop|status|reset}" >&2; exit 1 ;;
esac
