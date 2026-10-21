#!/usr/bin/env bash
# Paper & Pixels — daily database backup.
#
#   ./scripts/backup.sh
#
# Dumps the whole PostgreSQL database (orders, payments, inventory, job photos, receipts…)
# into backups/paperpixels-YYYY-MM-DD_HHMM.dump and keeps the newest 30 dumps.
# Needs pg_dump (PostgreSQL client tools) of the same or newer major version as the server.
#
# Cron (every day 11:30 PM Manila time):
#   CRON_TZ=Asia/Manila
#   30 23 * * * cd /path/to/paper-and-pixels && ./scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
KEEP="${KEEP:-30}"

# Load DATABASE_URL from .env when it is not already set in the environment.
if [[ -z "${DATABASE_URL:-}" && -f "$APP_DIR/.env" ]]; then
  DATABASE_URL="$(grep -E '^[[:space:]]*DATABASE_URL=' "$APP_DIR/.env" | tail -n 1 | sed -E 's/^[[:space:]]*DATABASE_URL=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set (and not found in $APP_DIR/.env)." >&2
  exit 1
fi
# pg_dump does not understand Prisma's ?schema=public parameter — strip it.
PG_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')"

mkdir -p "$BACKUP_DIR"
STAMP="$(TZ=Asia/Manila date +%Y-%m-%d_%H%M)"
FILE="$BACKUP_DIR/paperpixels-$STAMP.dump"
TMP="$FILE.partial"

# Write to a temp file first so a failed dump never looks like a good backup.
pg_dump --format=custom --no-owner --file="$TMP" "$PG_URL"
mv "$TMP" "$FILE"

# Keep only the newest $KEEP dumps.
ls -1t "$BACKUP_DIR"/paperpixels-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while IFS= read -r old; do
  rm -f -- "$old"
done

echo "$(TZ=Asia/Manila date '+%Y-%m-%d %H:%M') Backup saved: $FILE ($(du -h "$FILE" | cut -f1))"

# Optional: copy the dump off this server (strongly recommended). Set up rclone once with
# `rclone config` (remote name "gdrive", type Google Drive), then uncomment:
# rclone copy "$FILE" gdrive:PaperPixelsBackups/ && \
#   rclone delete --min-age 60d gdrive:PaperPixelsBackups/
