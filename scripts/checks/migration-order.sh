#!/usr/bin/env bash
# Migration order check (Hashim, Nov 21, 2026). Runs in CI on every push.
#
# Supabase applies migrations in the order of their numbers and records each number on the database. A
# new migration numbered before the last one already applied is refused by "supabase db push" (or, with
# --include-all, applied out of order). So:
#   1. every file is named <14-digit number>_<name>.sql, and no number is used twice;
#   2. every migration this branch adds sorts after the last migration on main (main is what Live has:
#      the Live deploy runs only from main).
# The numbers are an order, not a date: the next migration takes the next number after the last one,
# even when that number is ahead of the calendar.
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE="${BASE_REF:-origin/main}"
fail=0

bad=$(ls supabase/migrations | grep -v -E '^[0-9]{14}_[a-z0-9_]+\.sql$' || true)
if [[ -n "$bad" ]]; then echo "Migration names must be <14-digit number>_<name>.sql:"; echo "$bad"; fail=1; fi

dups=$(ls supabase/migrations | cut -c1-14 | sort | uniq -d)
if [[ -n "$dups" ]]; then echo "Migration numbers used twice: $dups"; fail=1; fi

if git rev-parse --verify -q "$BASE" >/dev/null; then
  last=$(git ls-tree --name-only "$BASE" supabase/migrations/ | xargs -n1 basename | grep -E '^[0-9]{14}_' | sort | tail -1 | cut -c1-14)
  added=$(comm -13 <(git ls-tree --name-only "$BASE" supabase/migrations/ | xargs -n1 basename | sort) <(ls supabase/migrations | sort))
  echo "Last migration on $BASE: $last"
  for m in $added; do
    if [[ "${m:0:14}" > "$last" ]]; then echo "  new, in order: $m"
    else echo "  OUT OF ORDER: $m sorts before or equal to $last, the last migration on $BASE. Renumber it after $last."; fail=1; fi
  done
  [[ -z "$added" ]] && echo "  no new migrations"
  # A migration already on main must not be renamed or removed: Live has recorded its number.
  gone=$(comm -23 <(git ls-tree --name-only "$BASE" supabase/migrations/ | xargs -n1 basename | sort) <(ls supabase/migrations | sort))
  if [[ -n "$gone" ]]; then echo "Migrations on $BASE that are missing or renamed here (Live has them): $gone"; fail=1; fi
else
  echo "No $BASE to compare with: checked names and numbers only."
fi

if [[ $fail -ne 0 ]]; then echo "MIGRATION ORDER CHECK FAILED"; exit 1; fi
echo "Migration order check passed."
