#!/usr/bin/env bash
# Recreate a local database and apply all migrations (fails fast).
set -euo pipefail
DB=${DB:-shopeye}
URL=${URL:-postgresql://claude:x@localhost}
psql "$URL/postgres" -q -c "drop database if exists $DB with (force)" -c "create database $DB"
psql "$URL/$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/00_supabase_shim.sql
for f in $(ls supabase/migrations/*.sql | grep -v -e 000009 -e 000017 -e 000020 -e 000025 -e 000027); do
  echo "apply $(basename "$f")"
  psql "$URL/$DB" -q -v ON_ERROR_STOP=1 -f "$f"
done
