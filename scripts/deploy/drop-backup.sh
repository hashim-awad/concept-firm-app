#!/usr/bin/env bash
# Removes one deploy backup, after Hashim confirms the deploy. Run by hand from the workflow ("drop_backup").
set -euo pipefail
: "${DB_URL:?}" "${BK:?}"
[[ "$BK" =~ ^deploy_backup_[0-9]{8}_[0-9]{6}$ ]] || { echo "Not a deploy backup name: $BK" >&2; exit 1; }
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -v bk="$BK" <<'SQL'
set client_min_messages = warning;
select exists (select 1 from pg_namespace where nspname = :'bk') as found \gset
\if :found
  drop schema :"bk" cascade;
  \echo Removed backup :bk
\else
  \echo No backup named :bk
\endif
SQL
