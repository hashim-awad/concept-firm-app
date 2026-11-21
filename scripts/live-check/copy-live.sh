#!/usr/bin/env bash
# CB2-0 v7 item 11: copy Live's Closebook data (cb_ tables and clients) into the throwaway LOCAL database on the runner,
# read only: pg_dump only reads. The copy never leaves the runner and is deleted at the end of the job. Prints no data.
# Needs DB_URL (Live, masked) and LOCAL_DB_URL (local Supabase, from scripts/ci/local-supabase.sh).
set -euo pipefail
: "${DB_URL:?}" "${LOCAL_DB_URL:?}"
case "$LOCAL_DB_URL" in *@127.0.0.1:*|*@localhost:*) ;; *) echo "The copy goes to the local database only."; exit 1 ;; esac
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT
docker run --rm --network host -v "$DIR:/out" postgres:17 pg_dump "$DB_URL" --data-only --no-owner --no-privileges \
  --table='public.cb_*' --table=public.clients -f /out/live.sql
# Empty the local copies of those tables (migrations seed some), then load Live's rows as they are.
TABLES=$(psql "$LOCAL_DB_URL" -X -tA -c "select string_agg(format('public.%I', tablename), ', ') from pg_tables where schemaname = 'public' and (tablename like 'cb\_%' or tablename = 'clients')")
psql "$LOCAL_DB_URL" -X -q -v ON_ERROR_STOP=1 -c "set session_replication_role = replica; truncate $TABLES cascade;"
PGOPTIONS="-c session_replication_role=replica" psql "$LOCAL_DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$DIR/live.sql" >/dev/null
echo "Live's Closebook data copied to the local database ($(psql "$LOCAL_DB_URL" -X -tA -c 'select count(*) from public.cb_files') files)."
