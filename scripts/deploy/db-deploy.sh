#!/usr/bin/env bash
# Reversible database deploy (Hashim, Nov 20, 2026). Used by "Database deploy - Test" and "- Live".
#
#   1. Account links check, before (read-only; file ids and counts).
#   2. BACKUP: a dated copy of every table in public (scripts/deploy/backup.sql).
#   3. CHANGE: supabase db push (dry run shown first).
#   4. CHECK: the account links check again; it must be 0 rows.
#   5. If the change fails or the check is not 0: RESTORE from the backup in this same run, prove every
#      table matches the backup, and stop with a failure. Nothing else runs.
#   6. If all is well: FILES CHANGED, a count and a Studio link to each file, by comparing with the backup.
#   The backup is kept until Hashim confirms; then the "drop_backup" run of the workflow removes it.
#
# Needs: DB_URL, DEPLOY_ENV (test or live), STUDIO_URL. Test only: REHEARSE=true adds a deliberate bad
# change after the real one, to prove the restore. File ids and counts only in the log, never names.
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${DB_URL:?}" "${DEPLOY_ENV:?}" "${STUDIO_URL:?}"
REHEARSE="${REHEARSE:-false}"
if [[ "$REHEARSE" == "true" && "$DEPLOY_ENV" != "test" ]]; then echo "The restore rehearsal runs on Test only." >&2; exit 1; fi

SUPABASE="${SUPABASE:-supabase}"
PSQL=(psql "$DB_URL" -X -v ON_ERROR_STOP=1 -P pager=off)
CHECK=scripts/checks/account-links-check.sql
BK="deploy_backup_$(date -u +%Y%m%d_%H%M%S)"
SHA="${GITHUB_SHA:-local}"

say() { echo; echo "=== $* ==="; }
problems() { "${PSQL[@]}" -At -f "$CHECK" | grep -c . || true; }

restore_and_stop() {
  trap - ERR
  say "RESTORE from $BK ($1)"
  if ! "${PSQL[@]}" -v bk="$BK" -f scripts/deploy/restore.sql; then
    echo "RESTORE FAILED: nothing was put back (the restore is all or nothing). The database is as the change left it."
    echo "Backup $BK is kept. Do not use Closebook until this is fixed."
    exit 1
  fi
  say "Account links check, after the restore"
  "${PSQL[@]}" -f "$CHECK"
  echo "STOPPED: the database is back as it was before this deploy. Backup $BK is kept."
  exit 1
}

say "Migration order"
# Every migration this deploy will apply must sort after the last one the database has recorded; one that
# sorts before would be refused (or skipped). Stop before the backup, with nothing changed.
REMOTE_LAST=$("${PSQL[@]}" -At -c "select coalesce(max(version), '') from supabase_migrations.schema_migrations")
APPLIED=$("${PSQL[@]}" -At -c "select version from supabase_migrations.schema_migrations")
ORDER_BAD=0
for f in supabase/migrations/*.sql; do
  v=$(basename "$f" | cut -c1-14)
  grep -qx "$v" <<<"$APPLIED" && continue
  if [[ "$v" < "$REMOTE_LAST" ]]; then echo "OUT OF ORDER: $(basename "$f") sorts before $REMOTE_LAST, the last migration on this database."; ORDER_BAD=1
  else echo "to apply: $(basename "$f")"; fi
done
echo "Last migration on this database: $REMOTE_LAST"
[[ $ORDER_BAD -eq 0 ]] || { echo "STOPPED before any change: renumber the migration(s) above after $REMOTE_LAST."; exit 1; }

say "Account links check, before"
"${PSQL[@]}" -f "$CHECK"

say "BACKUP"
"${PSQL[@]}" -v bk="$BK" -v sha="$SHA" -f scripts/deploy/backup.sql
# From here, any step that fails restores the backup and stops.
trap 'restore_and_stop "a step failed"' ERR

say "Changes that will be applied"
$SUPABASE db push --remote="$DB_URL" --dry-run || restore_and_stop "the dry run failed"

say "CHANGE"
$SUPABASE db push --remote="$DB_URL" --yes || restore_and_stop "the change failed"

if [[ "$REHEARSE" == "true" ]]; then
  say "REHEARSAL (Test only): a deliberate bad change"
  "${PSQL[@]}" -f scripts/deploy/rehearsal-break.sql
fi

say "CHECK: account links check, after"
"${PSQL[@]}" -f "$CHECK"
N=$(problems)
echo "CHECK result: $N problem row(s)."
[[ "$N" == "0" ]] || restore_and_stop "the check after the change is $N, not 0"

trap - ERR
say "FILES CHANGED"
"${PSQL[@]}" -v bk="$BK" -v studio="$STUDIO_URL" -f scripts/deploy/changed-files.sql

echo
echo "DONE. Backup $BK is kept until Hashim confirms. To remove it: run this workflow by hand with drop_backup = $BK."
