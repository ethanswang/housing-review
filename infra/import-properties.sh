#!/usr/bin/env bash
# Imports buildings from public data into the production database.
#
#   infra/import-properties.sh --dry-run          # reports, writes nothing
#   infra/import-properties.sh                    # writes
#   infra/import-properties.sh --radius-km 2 ...  # any server/src/import-properties.ts option
#
# Runs server/src/import-properties.ts in a node:24-alpine container through the
# tunnel in lib/db-tunnel.sh, as the master user: the importer writes properties,
# which the API's own login deliberately cannot. The report lands in
# server/import-reports/. See docs/DATABASE.md, "Importing buildings from public data".
#
# Needs server/node_modules installed (cd server && npm ci).
set -euo pipefail

cd "$(dirname "$0")/.."
. infra/lib/db-tunnel.sh
[ -d server/node_modules/pg ] || { echo "run 'cd server && npm ci' first" >&2; exit 1; }
mkdir -p server/import-reports

db_tunnel_open
export DATABASE_URL
DATABASE_URL=$(db_master_url)

db_docker -e DATABASE_URL -v "$PWD/server:/app:ro" -v "$PWD/server/import-reports:/app/import-reports" -w /app \
  "$DB_NODE_IMAGE" node src/import-properties.ts "$@"
