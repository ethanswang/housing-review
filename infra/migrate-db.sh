#!/usr/bin/env bash
# Applies server/migrations to the production database.
#
#   infra/migrate-db.sh                 # apply pending migrations
#   infra/migrate-db.sh up --dry-run    # show what would run, change nothing
#   infra/migrate-db.sh down            # revert the most recent one
#
# Runs node-pg-migrate from server/ inside a node:24 container, through the
# tunnel in lib/db-tunnel.sh, as the master user: migrations create tables,
# roles and grants, which the API's own login deliberately cannot.
#
# Needs server/node_modules installed (cd server && npm ci). node-pg-migrate
# and pg are plain JavaScript, so the host's install runs in the Linux image.
set -euo pipefail
cd "$(dirname "$0")/.."
. infra/lib/db-tunnel.sh

[ -x server/node_modules/.bin/node-pg-migrate ] \
  || { echo "run 'cd server && npm ci' first" >&2; exit 1; }
[ $# -eq 0 ] && set -- up

db_tunnel_open

# Built here and passed by name, so the password is never on a command line.
# sslrootcert makes node-postgres verify against the RDS bundle, by hostname.
export DATABASE_URL
DATABASE_URL="postgres://${PGUSER}:$(jq -rn --arg p "$PGPASSWORD" '$p|@uri')@${DB_HOST}:${DB_TUNNEL_PORT}/${PGDATABASE}?sslmode=verify-full&sslrootcert=/certs/rds-ca.pem"

db_docker -e DATABASE_URL -v "$PWD/server:/app:ro" -w /app node:24-alpine \
  node node_modules/node-pg-migrate/bin/node-pg-migrate.js "$@"
