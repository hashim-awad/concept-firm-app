#!/usr/bin/env bash
# Starts the built app with the test-only screen page switched on, runs the screen parity test,
# then stops the app. Needs "next build" first. Uses no secrets and touches no database.
set -euo pipefail
PORT="${PORT:-3100}"
STUDIO_HARNESS=1 npx next start -p "$PORT" > /tmp/screen-parity-app.log 2>&1 &
APP_PID=$!
trap 'kill $APP_PID 2>/dev/null || true' EXIT
for i in $(seq 1 60); do
  if curl -sf "http://localhost:$PORT/studio-harness/corporate" > /dev/null; then break; fi
  sleep 1
done
STUDIO_APP_URL="http://localhost:$PORT" node --test tests/studio/screens.test.mjs
