#!/bin/bash
# Start Paper & Pixels on this Mac: database, migrations, then the app on http://localhost:3000
set -e
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$APP_DIR"
command -v node >/dev/null || { echo "Node.js not found in $TOOLS/node"; exit 1; }

db_start
[ -d node_modules ] || { echo "Installing packages (first run)…"; npm ci --no-audit --no-fund; }
set -a; . ./.env; set +a
for url in "$DATABASE_URL" "$DATABASE_URL_KEONI" "$DATABASE_URL_KY"; do [ -n "$url" ] && DATABASE_URL="$url" npx prisma migrate deploy >/dev/null; done && echo "Databases are up to date (all branches)."

proxy_start
if [ -n "$(app_pids)" ]; then
  echo "Paper & Pixels is already running."
  [ -z "$NO_OPEN" ] && open "http://localhost:3000"
  exit 0
fi
echo "Starting Paper & Pixels at http://localhost:3000 … (keep this window open; close it or run Stop to quit)"
echo "Phones on the shop Wi-Fi: https://$(lan_ip):3443  (first time on a phone: open http://$(lan_ip):3000/phone-setup.html)"
[ -z "$NO_OPEN" ] && ( sleep 8; open "http://localhost:3000" ) &
exec node node_modules/next/dist/bin/next dev -p 3000
