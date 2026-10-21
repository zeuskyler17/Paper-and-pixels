#!/bin/bash
# Stop the app and shut the database down cleanly.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
PIDS="$(app_pids) $(proxy_pids)"
if [ -n "$PIDS" ]; then echo "Stopping app…"; kill $PIDS 2>/dev/null; sleep 2; fi
db_stop
echo "Paper & Pixels is stopped."
