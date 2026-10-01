#!/usr/bin/env bash
# Loads a catalog of companies and properties into the production database.
#
#   infra/import-catalog.sh server/data/catalog.json            # dry run: counts, writes nothing
#   infra/import-catalog.sh server/data/catalog.json --apply    # writes
#
# Runs server/src/import-catalog.ts in a node:24-alpine container through the
# tunnel in lib/db-tunnel.sh, as the master user: the importer writes properties
# and companies, which the API's own login deliberately cannot. See
# docs/DATABASE.md, "Loading the property list", for what the importer does.
#
# Needs server/node_modules installed (cd server && npm ci).
set -euo pipefail
cd "$(dirname "$0")/.."
. infra/lib/db-tunnel.sh

[ $# -ge 1 ] || { echo "usage: infra/import-catalog.sh <catalog.json> [--apply]" >&2; exit 2; }
file=$1
shift
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 1; }
[ -d server/node_modules/pg ] || { echo "run 'cd server && npm ci' first" >&2; exit 1; }
catalog="$(cd "$(dirname "$file")" && pwd)/$(basename "$file")"

db_tunnel_open
export DATABASE_URL
DATABASE_URL=$(db_master_url)

db_docker -e DATABASE_URL -v "$PWD/server:/app:ro" -v "$catalog:/catalog.json:ro" -w /app \
  node:24-alpine node src/import-catalog.ts /catalog.json "$@"
