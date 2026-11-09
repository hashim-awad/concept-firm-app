#!/usr/bin/env bash
# Runs the database tests on a local Postgres (developers only).
# Each test file gets a fresh database: shim, all migrations, helpers, then the test.
# Usage: PGHOST=/path/to/socket PGPORT=5432 PGUSER=postgres supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=cfa_migration_test
export PGOPTIONS="-c client_min_messages=warning"
for t in supabase/tests/*_test.sql; do
  echo "== $t"
  psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
  psql -q -d $DB -v ON_ERROR_STOP=1 -f supabase/tests/local_shim.sql
  for f in supabase/migrations/*.sql; do
    psql -q -d $DB -v ON_ERROR_STOP=1 --single-transaction -f "$f"
  done
  psql -q -d $DB -v ON_ERROR_STOP=1 -f supabase/tests/helpers.sql
  psql -q -At -d $DB -v ON_ERROR_STOP=1 -f "$t"
done
psql -q -d postgres -c "drop database $DB"
echo "All database tests passed."
