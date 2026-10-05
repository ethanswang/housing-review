#!/usr/bin/env bash
# Removes the demonstration reviews and sample buildings from the production
# database (server/src/sample-data.ts says exactly which).
#
#   infra/remove-sample-data.sh           # dry run: reports, deletes nothing
#   infra/remove-sample-data.sh --apply   # deletes
#
# Runs in a node:24-alpine container through the tunnel in lib/db-tunnel.sh, as
# the master user, like infra/import-catalog.sh. Needs server/node_modules.
set -euo pipefail

cd "$(dirname "$0")/.."
. infra/lib/db-tunnel.sh
[ -d server/node_modules/pg ] || { echo "run 'cd server && npm ci' first" >&2; exit 1; }

db_tunnel_open
export DATABASE_URL
DATABASE_URL=$(db_master_url)

db_docker -e DATABASE_URL -v "$PWD/server:/app:ro" -w /app "$DB_NODE_IMAGE" node src/remove-sample-data.ts "$@"
