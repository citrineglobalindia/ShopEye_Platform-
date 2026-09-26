#!/usr/bin/env bash
# Fresh DB → migrations → seed → UAT suite → concurrency test. Exit non-zero on any failure.
set -euo pipefail
URL=${URL:-postgresql://claude:x@localhost}; DB=${DB:-shopeye}
./scripts/apply_local.sh
psql "$URL/$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/10_harness_seed.sql >/dev/null
psql "$URL/$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/20_uat_tests.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //' | grep -v 'does not exist, skipping'
./scripts/test_concurrency.sh
