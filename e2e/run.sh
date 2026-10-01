#!/usr/bin/env bash
# Runs the end-to-end suite the way CI does:
#
#   e2e/run.sh                 # all tests
#   e2e/run.sh -g "search"     # extra arguments go to `playwright test`
#
# Starts the Supabase stand-in in e2e/stack from scratch, so it always has the
# current supabase/schema.sql and seed, then runs Playwright, which builds the
# site against it (replacing .next). Nothing here touches a real project.
# First time: `npx playwright install chromium`.
set -euo pipefail
cd "$(dirname "$0")/.."

stack=(docker compose -f e2e/stack/docker-compose.yml -p housing-e2e)
"${stack[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
"${stack[@]}" up -d --wait

# PostgREST has no healthcheck of its own; wait until it answers through the
# gateway with the seed loaded, and stop with its logs if it never does.
key=$(node e2e/stack/anon-key.mjs)
ready=
for _ in $(seq 1 60); do
  if curl -fs -o /dev/null "http://localhost:54321/rest/v1/properties?select=id&limit=1" \
    -H "apikey: $key" -H "Authorization: Bearer $key"; then
    ready=1
    break
  fi
  sleep 1
done
if [ -z "$ready" ]; then
  echo "The Supabase stand-in did not answer within a minute." >&2
  "${stack[@]}" logs postgrest gateway >&2
  exit 1
fi

npx playwright test "$@"
