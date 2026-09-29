#!/usr/bin/env bash
# Dumps the production database to backups/ on this machine.
#
#   infra/export-db.sh
#
# The database sits in private subnets with no public address, so this opens a
# Session Manager tunnel through the API instance — no inbound port, audited in
# CloudTrail — and runs pg_dump against the local end of it.
#
# The dump is the copy that survives the AWS account. RDS snapshots, including
# the final snapshot taken on deletion, live inside the account and go with it.
#
# Requires: aws (signed in), session-manager-plugin, docker, jq, tofu.
set -euo pipefail

cd "$(dirname "$0")/.."

REGION="${AWS_REGION:-us-east-2}"
LOCAL_PORT="${LOCAL_PORT:-15432}"
OUT_DIR="backups"

for tool in aws session-manager-plugin docker jq tofu; do
  command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }
done

INSTANCE_ID=$(tofu -chdir=infra output -raw api_instance_id)
DB_HOST=$(tofu -chdir=infra output -raw database_endpoint)
SECRET_ARN=$(tofu -chdir=infra output -raw database_secret_arn)

WORK=$(mktemp -d)
TUNNEL_PID=""
cleanup() {
  if [ -n "$TUNNEL_PID" ]; then
    kill "$TUNNEL_PID" 2>/dev/null || true
    # Reaping it here keeps bash from printing "Terminated" for the job.
    wait "$TUNNEL_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# RDS enforces TLS (rds.force_ssl). Through a tunnel the server is reached as
# localhost, so its certificate can never match the hostname: verify-full is
# impossible here. verify-ca still proves the certificate chains to Amazon's
# RDS roots, which is what stops anything else answering on the tunnel.
curl -fsS --retry 3 -o "$WORK/rds-ca.pem" \
  "https://truststore.pki.rds.amazonaws.com/$REGION/$REGION-bundle.pem"

echo "Opening tunnel to $DB_HOST through $INSTANCE_ID on localhost:$LOCAL_PORT"
aws ssm start-session --region "$REGION" --target "$INSTANCE_ID" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$DB_HOST\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"$LOCAL_PORT\"]}" \
  >"$WORK/tunnel.log" 2>&1 &
TUNNEL_PID=$!

for _ in $(seq 1 30); do
  nc -z 127.0.0.1 "$LOCAL_PORT" >/dev/null 2>&1 && break
  kill -0 "$TUNNEL_PID" 2>/dev/null || { cat "$WORK/tunnel.log" >&2; exit 1; }
  sleep 1
done
nc -z 127.0.0.1 "$LOCAL_PORT" >/dev/null 2>&1 || { echo "tunnel did not open" >&2; cat "$WORK/tunnel.log" >&2; exit 1; }

SECRET=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$SECRET_ARN" \
  --query SecretString --output text)
export PGUSER PGPASSWORD PGDATABASE
PGUSER=$(jq -r .username <<<"$SECRET")
PGPASSWORD=$(jq -r .password <<<"$SECRET")
PGDATABASE=$(jq -r .dbname <<<"$SECRET")

# pg_dump from a postgres:17 container, matching the server. A newer local
# pg_dump can write an archive that the Postgres 17 tools on a new host refuse.
# Docker Desktop reaches the host's loopback as host.docker.internal; on Linux
# the container shares the host network instead.
if [ "$(uname)" = Linux ]; then
  NET=(--network host); PGHOST=127.0.0.1
else
  NET=(); PGHOST=host.docker.internal
fi

mkdir -p "$OUT_DIR"
FILE="housing-$(date -u +%Y%m%dT%H%M%SZ).dump"

# The password reaches the container through the environment by name only
# (-e PGPASSWORD), so it never appears in a process listing.
pg() {
  docker run --rm ${NET[@]+"${NET[@]}"} --user "$(id -u):$(id -g)" \
    -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGHOST="$PGHOST" -e PGPORT="$LOCAL_PORT" \
    -e PGSSLMODE=verify-ca -e PGSSLROOTCERT=/certs/rds-ca.pem \
    -v "$WORK:/certs:ro" -v "$PWD/$OUT_DIR:/out" \
    postgres:17-alpine "$@"
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
