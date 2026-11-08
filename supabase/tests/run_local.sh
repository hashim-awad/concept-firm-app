#!/usr/bin/env bash
# Runs the database tests on a local Postgres (developers only).
# Usage: PGHOST=/path/to/socket PGPORT=5432 PGUSER=postgres supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=cfa_migration_test
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -d $DB -v ON_ERROR_STOP=1 -f supabase/tests/local_shim.sql
for f in supabase/migrations/*.sql; do
  psql -q -d $DB -v ON_ERROR_STOP=1 --single-transaction -f "$f" 2>&1 | grep -v NOTICE || true
done
for t in supabase/tests/*_test.sql; do
  echo "== $t"
  psql -q -At -d $DB -v ON_ERROR_STOP=1 -f "$t"
done
psql -q -d postgres -c "drop database $DB"
echo "All database tests passed."
