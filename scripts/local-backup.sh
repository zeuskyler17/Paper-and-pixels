#!/bin/bash
# Local backup for this Mac: briefly stops the database, zips its data folder into backups/, restarts it.
# Keeps the newest 30 backups. Copy the backups folder to Google Drive / a USB drive regularly.
set -e
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
mkdir -p "$APP_DIR/backups"
WAS_RUNNING=0; db_running && WAS_RUNNING=1
db_stop
FILE="$APP_DIR/backups/paperpixels-db-$(date +%Y-%m-%d_%H%M).zip"
ditto -c -k --keepParent "$PGDATA" "$FILE"
[ "$WAS_RUNNING" = 1 ] && db_start
ls -1t "$APP_DIR"/backups/paperpixels-db-*.zip 2>/dev/null | tail -n +31 | xargs -I{} rm -f "{}"
echo "Backup saved: $FILE ($(du -h "$FILE" | cut -f1))"
