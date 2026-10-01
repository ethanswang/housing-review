#!/usr/bin/env bash
# Dumps the production database to backups/ on this machine.
#
#   infra/export-db.sh
#
# Reaches the private database through the tunnel in lib/db-tunnel.sh and runs
# pg_dump there, with TLS verified in full.
#
# The dump is the copy that survives the AWS account. RDS snapshots, including
# the final snapshot taken on deletion, live inside the account and go with it.
set -euo pipefail
cd "$(dirname "$0")/.."
. infra/lib/db-tunnel.sh

OUT_DIR="backups"
db_tunnel_open

mkdir -p "$OUT_DIR"
FILE="housing-$(date -u +%Y%m%dT%H%M%SZ).dump"

# pg_dump from postgres:17, matching the server. A newer local pg_dump can write
# an archive that the Postgres 17 tools on a new host refuse.
pg() {
  db_docker --user "$(id -u):$(id -g)" -v "$PWD/$OUT_DIR:/out" "$DB_PG_IMAGE" "$@"
}

pg pg_dump --format=custom --file="/out/$FILE"
# Holds user email addresses: readable by this account only.
chmod 600 "$OUT_DIR/$FILE"

# Proves the archive is readable, and records what it should contain so a
# restore can be checked against it.
ENTRIES=$(pg pg_restore --list "/out/$FILE" | grep -vc '^;')
echo "Row counts at export:"
pg psql -X -A -t -F ' ' -c "
  select 'users', count(*) from users union all
  select 'management_companies', count(*) from management_companies union all
  select 'properties', count(*) from properties union all
  select 'reviews', count(*) from reviews union all
  select 'review_reports', count(*) from review_reports" | sed 's/^/  /'

echo "Wrote $OUT_DIR/$FILE ($(du -h "$OUT_DIR/$FILE" | cut -f1), $ENTRIES archive entries)"
