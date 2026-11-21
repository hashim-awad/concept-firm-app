#!/usr/bin/env bash
# CB2-0 v7 item 11: which engine to run, read from Live (read only). Live's last applied migration says which code Live
# runs: the newest commit on main whose newest migration is that one. Prints nothing about any client.
#   before: Live must not have this run's migrations yet; checks out src and supabase/migrations as Live runs them.
#   after:  Live must have every migration in this run's code.
# Needs DB_URL (Live, masked) and PHASE.
set -euo pipefail
: "${DB_URL:?}" "${PHASE:?}"
last() { ls "$1" 2>/dev/null | grep -E '^[0-9]{14}_' | sort | tail -1 | cut -c1-14; }
LIVE=$(psql "$DB_URL" -X -At -c "select coalesce(max(version), '') from supabase_migrations.schema_migrations")
HERE=$(last supabase/migrations)
echo "Live's last database change: $LIVE. This run's last database change: $HERE."
if [ "$PHASE" = "after" ]; then
  [ "$LIVE" = "$HERE" ] || { echo "The Live database deploy has not finished yet. Approve it, wait for it to go green, then run this again."; exit 1; }
  exit 0
fi
[ "$LIVE" != "$HERE" ] || { echo "Live already has this code's database changes, so a before check would compare nothing. Run it after the merge and before you approve the Live database deploy."; exit 1; }
for C in $(git rev-list --first-parent HEAD); do
  V=$(git ls-tree --name-only "$C" supabase/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | sort | tail -1 | cut -c1-14)
  if [ "$V" = "$LIVE" ]; then
    rm -rf src supabase/migrations
    git checkout "$C" -- src supabase/migrations
    echo "Engine Live runs today: commit ${C:0:7}."
    exit 0
  fi
done
echo "No commit on main matches Live's last database change. Nothing was checked."; exit 1
