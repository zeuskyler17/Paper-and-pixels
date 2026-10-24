#!/bin/bash
# Reset a login's password (e.g. a forgotten admin password). Asks for branch, username and the new password.
#   ./scripts/reset-password.sh
set -e
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$APP_DIR"
db_start
set -a; source .env; set +a
node scripts/reset-password.mjs
