#!/usr/bin/env bash
# Moderation against the production database (docs/MODERATION.md).
#
#   infra/moderate.sh reports                              open reports, by review
#   infra/moderate.sh recent [count]                       the newest reviews
#   infra/moderate.sh hide|restore|dismiss <review-id>     dry run
#   infra/moderate.sh hide|restore|dismiss <review-id> --apply
#
# Runs server/src/moderate.ts in a node:24-alpine container through the tunnel in
# lib/db-tunnel.sh, as the master user: the API's own login cannot change a
# review's status. Needs server/node_modules (cd server && npm ci).
set -euo pipefail

cd "$(dirname "$0")/.."
. infra/lib/db-tunnel.sh
[ -d server/node_modules/pg ] || { echo "run 'cd server && npm ci' first" >&2; exit 1; }

db_tunnel_open
export DATABASE_URL
DATABASE_URL=$(db_master_url)

db_docker -e DATABASE_URL -v "$PWD/server:/app:ro" -w /app "$DB_NODE_IMAGE" node src/moderate.ts "$@"
