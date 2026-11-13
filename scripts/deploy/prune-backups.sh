#!/usr/bin/env bash
# Removes deploy backups older than 7 days, as the last step of a good deploy (Hashim, Nov 23, 2026), so
# no separate removal run needs approving. The backup this deploy just took is never removed. A backup's
# age comes from its name (deploy_backup_YYYYMMDD_HHMMSS, UTC). What was removed, and what is kept, goes
# to the log and to the GitHub run summary.
# Needs: DB_URL. Optional: KEEP (the backup this deploy took), DAYS (default 7), NOW (for tests, UTC
# "YYYY-MM-DD HH:MM:SS").
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DB_URL:?}"
DAYS="${DAYS:-7}"
KEEP="${KEEP:-}"
NOW="${NOW:-$(date -u '+%Y-%m-%d %H:%M:%S')}"
CUTOFF=$(date -u -d "$NOW UTC $DAYS days ago" '+%Y%m%d_%H%M%S')

removed=(); kept=()
for b in $(psql "$DB_URL" -X -At -c "select nspname from pg_namespace where nspname ~ '^deploy_backup_[0-9]{8}_[0-9]{6}\$' order by nspname"); do
  stamp="${b#deploy_backup_}"
  if [[ "$b" != "$KEEP" && "$stamp" < "$CUTOFF" ]]; then
    BK="$b" DB_URL="$DB_URL" bash scripts/deploy/drop-backup.sh >/dev/null
    removed+=("$b")
  else
    kept+=("$b")
  fi
done

say_list() { if [[ $# -eq 0 ]]; then echo "none"; else printf '%s, ' "$@" | sed 's/, $//'; fi; }
echo "BACKUPS older than $DAYS days removed: $(say_list "${removed[@]}")"
echo "BACKUPS kept: $(say_list "${kept[@]}")"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Backups"
    echo "- Removed (older than $DAYS days): $(say_list "${removed[@]}")"
    echo "- Kept: $(say_list "${kept[@]}")"
  } >> "$GITHUB_STEP_SUMMARY"
fi
