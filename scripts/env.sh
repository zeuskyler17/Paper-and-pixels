#!/bin/bash
# Shared paths for the local (this Mac) start / stop / backup scripts.
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$APP_DIR/.." && pwd)"
TOOLS="$ROOT_DIR/tools"
export PATH="$TOOLS/node/bin:$TOOLS/postgres/bin:$PATH"
export NEXT_TELEMETRY_DISABLED=1
PGDATA="$APP_DIR/.pgdata"
PGPORT=5433
LOG_DIR="$APP_DIR/.logs"
mkdir -p "$LOG_DIR"

db_running() { pg_ctl -D "$PGDATA" status >/dev/null 2>&1; }
db_start() {
  if db_running; then return 0; fi
  echo "Starting database…"
  pg_ctl -D "$PGDATA" -l "$LOG_DIR/postgres.log" -o "-p $PGPORT -k '' -c listen_addresses=localhost -c timezone=UTC" -w start >/dev/null
}
db_stop() {
  if db_running; then echo "Stopping database…"; pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null; fi
}
app_pids() { lsof -nP -iTCP:3000 -sTCP:LISTEN -t 2>/dev/null; }
proxy_pids() { lsof -nP -iTCP:3443 -sTCP:LISTEN -t 2>/dev/null; }
lan_ip() { ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1; }
# HTTPS front door for phones (certs/ via make-cert.sh). Runs in the background; stop.sh ends it.
proxy_start() {
  bash "$APP_DIR/scripts/make-cert.sh" || return 0
  [ -n "$(proxy_pids)" ] && return 0
  nohup node "$APP_DIR/scripts/https-proxy.mjs" >> "$LOG_DIR/https-proxy.log" 2>&1 &
}
