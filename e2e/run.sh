#!/usr/bin/env bash
# Runs the end-to-end suite the way CI does:
#
#   e2e/run.sh                 # all tests
#   e2e/run.sh -g "search"     # extra arguments go to `playwright test`
#
# Starts the Supabase stand-in in e2e/stack, builds the site against it (this
# replaces .next), and runs Playwright. Nothing here touches a real project.
# First time: `npx playwright install chromium`.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose -f e2e/stack/docker-compose.yml -p housing-e2e up -d --wait

export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$(node e2e/stack/anon-key.mjs)
export NEXT_PUBLIC_SUPABASE_ANON_KEY

# PostgREST has no healthcheck of its own; wait until it answers through the
# gateway with the seed loaded.
for _ in $(seq 1 60); do
  curl -fs -o /dev/null "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/properties?select=id&limit=1" \
    -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY" && break
  sleep 1
done

npx next build
npx playwright test "$@"
