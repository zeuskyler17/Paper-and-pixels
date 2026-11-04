#!/bin/sh
# Ask for the Supabase database password (hidden) and put it into .env.supabase, encoded for the URL.
set -eu
cd "$(dirname "$0")/.."
export PATH="$(cd .. && pwd)/tools/node/bin:$PATH"
printf 'Supabase database password (nothing shows while you type): '
stty -echo 2>/dev/null || true; IFS= read -r PW; stty echo 2>/dev/null || true; echo
[ -n "$PW" ] || { echo "No password entered — nothing changed."; exit 1; }
printf '%s' "$PW" | node -e '
const fs = require("fs");
const pw = encodeURIComponent(fs.readFileSync(0, "utf8"));
const f = ".env.supabase";
const s = fs.readFileSync(f, "utf8");
const line = /^SUPABASE_URL="postgresql:\/\/(postgres\.[a-z0-9]+):[^@]*@(.*)"$/m;
if (!line.test(s)) { console.error("Could not find the SUPABASE_URL line in .env.supabase"); process.exit(1); }
fs.writeFileSync(f, s.replace(line, (_, u, rest) => `SUPABASE_URL="postgresql://${u}:${pw}@${rest}"`));
console.log("Saved. You can close this tab.");'
