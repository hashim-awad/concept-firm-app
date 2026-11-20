#!/usr/bin/env bash
# Local dev: bring everything up in one command, so a session restart costs one command, not a failed run
# (UI1 lessons, Hashim, Nov 20, 2026). Local and dummy data only: never points at Live.
#
#   bash scripts/dev/up.sh            # Docker, local Supabase, and the app on port 3301 (builds if there is no build)
#   bash scripts/dev/up.sh --build    # the same, with a fresh production build first
#   PORT=3300 bash scripts/dev/up.sh  # another port
#
# Every build made through this script uses the same local Server Actions key (scripts/dev/.actions-key, not in git),
# so action ids stay the same from build to build and the function-parity scripts can compare a "before" and an "after".
# The key is for local builds only; Vercel and Live builds never read it.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${PORT:-3301}"
BUILD=0; [ "${1:-}" = "--build" ] && BUILD=1
say() { printf '%s\n' "$*"; }

# 1. Docker.
if ! docker info >/dev/null 2>&1; then
  pgrep -x dockerd >/dev/null || (nohup dockerd >/tmp/dockerd.log 2>&1 &)
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
fi
docker info >/dev/null 2>&1 || { say "Docker did not start (see /tmp/dockerd.log)."; exit 1; }
say "Docker: up"

# 2. Local Supabase (dummy data).
db() { PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -Atc "$1" 2>/dev/null; }
if ! db "select 1" >/dev/null; then
  npx supabase start >/tmp/supabase-start.log 2>&1 || true
  for _ in $(seq 1 60); do db "select 1" >/dev/null && break; sleep 3; done
fi
db "select 1" >/dev/null || { say "Local Supabase did not start (see /tmp/supabase-start.log)."; exit 1; }
say "Database: up (127.0.0.1:54322)"

# 3. The fixed local Server Actions key.
KEYFILE=scripts/dev/.actions-key
[ -s "$KEYFILE" ] || head -c 32 /dev/urandom | base64 > "$KEYFILE"
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(cat "$KEYFILE")"

# 4. Build when asked, or when there is no build. A running server on this folder is stopped first.
stop_app() { for p in $(pgrep -f next-server || true); do [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$PWD" ] && kill "$p" || true; done; sleep 1; }
if [ "$BUILD" = 1 ] || [ ! -f .next/BUILD_ID ]; then
  stop_app
  rm -rf .next
  npm run build >/tmp/next-build.log 2>&1 || { say "Build failed (see /tmp/next-build.log)."; exit 1; }
  say "Build: done"
fi

# 5. The app.
if ! curl -sf -o /dev/null "http://localhost:$PORT/login"; then
  (nohup npx next start -p "$PORT" >/tmp/next-start.log 2>&1 &)
  for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$PORT/login" && break; sleep 2; done
fi
curl -sf -o /dev/null "http://localhost:$PORT/login" || { say "The app did not start (see /tmp/next-start.log)."; exit 1; }
curl -s -o /dev/null "http://localhost:$PORT/closebook/files" || true   # warm the first page, so the first check is not cold
say "App: up on http://localhost:$PORT (build $(cat .next/BUILD_ID))"
