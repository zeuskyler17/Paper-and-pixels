#!/bin/sh
# One-time setup of the online copy: Supabase database + Vercel settings.
# Reads the Supabase connection from .env.supabase (never printed, never committed).
#   ./scripts/cloud-setup.sh db    create/update the tables for all three branches (safe: migrate deploy only)
#   ./scripts/cloud-setup.sh env   put the database URLs and a new AUTH_SECRET into the Vercel project (production)
# Branches share one Supabase database, one schema each: Paper & Pixels = public, Keoni = keoni, Ky = ky.
set -eu
cd "$(dirname "$0")/.."
[ -f .env.supabase ] || { echo "Missing .env.supabase"; exit 1; }
set -a; . ./.env.supabase; set +a
[ -n "${SUPABASE_URL:-}" ] || { echo "Paste the Session pooler connection string into .env.supabase first."; exit 1; }
case "$SUPABASE_URL" in *YOUR-PASSWORD*) echo "Replace [YOUR-PASSWORD] in .env.supabase with your database password."; exit 1;; esac

# The app talks to Supabase through the session pooler so each branch keeps its own schema (raw SQL relies on search_path).
url_for() { case "$SUPABASE_URL" in *\?*) sep='&';; *) sep='?';; esac; printf '%s%sschema=%s%s' "$SUPABASE_URL" "$sep" "$1" "${2:-}"; }

case "${1:-}" in
  db)
    for s in public keoni ky; do
      echo "== $s"
      DATABASE_URL="$(url_for "$s")" npx prisma migrate deploy
    done
    # Keep Supabase's public Data API away from the shop's tables (the app connects as the owner, which RLS does not limit).
    npx prisma db execute --url "$(url_for public)" --stdin <<'SQL'
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public', 'keoni', 'ky') LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.schemaname, t.tablename);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
SQL
    echo "Database ready."
    ;;
  env)
    add() { printf '%s' "$2" | npx --yes vercel@latest env add "$1" production --force >/dev/null && echo "set $1"; }
    add DATABASE_URL "$(url_for public '&connection_limit=3')"
    add DATABASE_URL_KEONI "$(url_for keoni '&connection_limit=3')"
    add DATABASE_URL_KY "$(url_for ky '&connection_limit=3')"
    add AUTH_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
    ;;
  *) echo "usage: $0 db | env"; exit 1;;
esac
