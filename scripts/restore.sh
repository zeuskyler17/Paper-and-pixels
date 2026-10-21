#!/usr/bin/env bash
# Paper & Pixels — restore a backup made by scripts/backup.sh.
#
#   ./scripts/restore.sh backups/paperpixels-2026-10-16_2330.dump
#
# WARNING: this REPLACES everything in the database at $DATABASE_URL with the backup.
# Stop the app first (e.g. `pm2 stop paperpixels`) and start it again afterwards.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "Usage: $0 <backup-file.dump>" >&2
  echo "Available backups:" >&2
  ls -1t "$APP_DIR"/backups/*.dump 2>/dev/null | head -n 10 >&2 || echo "  (none found in $APP_DIR/backups)" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" && -f "$APP_DIR/.env" ]]; then
  DATABASE_URL="$(grep -E '^[[:space:]]*DATABASE_URL=' "$APP_DIR/.env" | tail -n 1 | sed -E 's/^[[:space:]]*DATABASE_URL=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set (and not found in $APP_DIR/.env)." >&2
  exit 1
fi
PG_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')"
# Show the target without the password.
TARGET="$(printf '%s' "$PG_URL" | sed -E 's#//([^:/@]+):[^@]*@#//\1:****@#')"

echo "About to restore:"
echo "  backup : $FILE"
echo "  into   : $TARGET"
echo "ALL CURRENT DATA in that database will be replaced by the backup."
read -r -p "Type RESTORE to continue: " answer
if [[ "$answer" != "RESTORE" ]]; then
  echo "Cancelled."
  exit 1
fi

pg_restore --clean --if-exists --no-owner -d "$PG_URL" "$FILE"
echo "Restore finished. Start the app again and check the latest orders and payments."
