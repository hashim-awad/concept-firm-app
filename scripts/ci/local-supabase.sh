#!/usr/bin/env bash
# CI only: start a throwaway local Supabase with this branch's migrations, add the dummy owner the answer keys sign in
# as, and write .env.local pointing the app code at it. Never points at Test or Live. Used by .github/workflows/checks.yml
# (answer keys) and live-check.yml (the before and after figures).
set -euo pipefail
cd "$(dirname "$0")/../.."
npx --yes supabase@3.2.0 start -x studio,imgproxy,inbucket,mailpit,edge-runtime,logflare,vector,realtime,storage-api,postgres-meta,supavisor >/tmp/supabase-start.log 2>&1 \
  || { tail -40 /tmp/supabase-start.log; exit 1; }
eval "$(npx --yes supabase@3.2.0 status -o env | sed 's/^/export SB_/')"
KEY="${SB_PUBLISHABLE_KEY:-$SB_ANON_KEY}"
printf 'NEXT_PUBLIC_SUPABASE_URL=%s\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=%s\n' "$SB_API_URL" "$KEY" > .env.local
# The dummy owner (local only).
curl -sf -X POST "$SB_API_URL/auth/v1/admin/users" -H "apikey: $SB_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SB_SERVICE_ROLE_KEY" \
  -H 'Content-Type: application/json' -d '{"email":"owner.dummy@example.test","password":"dummy-pass-123","email_confirm":true}' >/dev/null
psql "$SB_DB_URL" -X -q -v ON_ERROR_STOP=1 -c "select private.bootstrap_owner('owner.dummy@example.test', 'Dummy Owner')" >/dev/null
echo "LOCAL_DB_URL=$SB_DB_URL" >> "${GITHUB_ENV:-/dev/null}"
echo "Local Supabase is up (dummy data only)."
