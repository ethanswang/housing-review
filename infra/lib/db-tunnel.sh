# Sourced, not run, by the infra/*.sh scripts that need the production database.
#
# The database sits in private subnets with no public address. db_tunnel_open
# reaches it through a Session Manager port forward via the API instance — no
# inbound port, audited in CloudTrail — and db_docker runs a command in a
# container that talks to it.
#
# TLS is verified in full, hostname included. Through a tunnel the server
# answers on localhost, which its certificate does not name, so the container
# is given an /etc/hosts entry mapping the real RDS hostname to the tunnel and
# connects by that name. The certificate is checked against Amazon's regional
# RDS roots, which no public trust store contains.
#
# After db_tunnel_open:
#   DB_HOST, DB_TUNNEL_PORT   where to connect, by the hostname on the certificate
#   PGUSER PGPASSWORD PGDATABASE   the master credentials, exported for db_docker
# An EXIT trap closes the tunnel and deletes the certificate bundle.
#
# Requires: aws (signed in), session-manager-plugin, docker, jq, tofu.

db_tunnel_open() {
  local region="${AWS_REGION:-us-east-2}"
  DB_TUNNEL_PORT="${LOCAL_PORT:-15432}"

  local tool
  for tool in aws session-manager-plugin docker jq tofu nc curl; do
    command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }
  done

  local instance_id secret_arn secret
  instance_id=$(tofu -chdir=infra output -raw api_instance_id)
  DB_HOST=$(tofu -chdir=infra output -raw database_endpoint)
  secret_arn=$(tofu -chdir=infra output -raw database_secret_arn)

  DB_WORK=$(mktemp -d)
  DB_TUNNEL_PID=""
  trap db_tunnel_close EXIT

  curl -fsS --retry 3 -o "$DB_WORK/rds-ca.pem" \
    "https://truststore.pki.rds.amazonaws.com/$region/$region-bundle.pem"

  # Something already listening there — another tool, or a forward a previous
  # run left behind — would answer the readiness probe below, and the run would
  # quietly use it instead of the tunnel it opened.
  if nc -z 127.0.0.1 "$DB_TUNNEL_PORT" >/dev/null 2>&1; then
    echo "localhost:$DB_TUNNEL_PORT is already in use; free it or set LOCAL_PORT" >&2
    exit 1
  fi

  echo "Opening tunnel to $DB_HOST through $instance_id on localhost:$DB_TUNNEL_PORT" >&2
  aws ssm start-session --region "$region" --target "$instance_id" \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters "{\"host\":[\"$DB_HOST\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"$DB_TUNNEL_PORT\"]}" \
    >"$DB_WORK/tunnel.log" 2>&1 &
  DB_TUNNEL_PID=$!

  local _
  for _ in $(seq 1 30); do
    nc -z 127.0.0.1 "$DB_TUNNEL_PORT" >/dev/null 2>&1 && break
    kill -0 "$DB_TUNNEL_PID" 2>/dev/null || { cat "$DB_WORK/tunnel.log" >&2; exit 1; }
    sleep 1
  done
  nc -z 127.0.0.1 "$DB_TUNNEL_PORT" >/dev/null 2>&1 \
    || { echo "tunnel did not open" >&2; cat "$DB_WORK/tunnel.log" >&2; exit 1; }

  secret=$(aws secretsmanager get-secret-value --region "$region" --secret-id "$secret_arn" \
    --query SecretString --output text)
  # Piped rather than <<<: bash 3.2 writes a here-string to a temporary file.
  # -e fails on a missing key instead of returning the string "null".
  export PGUSER PGPASSWORD PGDATABASE
  PGUSER=$(printf '%s' "$secret" | jq -er .username)
  PGPASSWORD=$(printf '%s' "$secret" | jq -er .password)
  PGDATABASE=$(printf '%s' "$secret" | jq -er .dbname)
}

db_tunnel_close() {
  if [ -n "${DB_TUNNEL_PID:-}" ]; then
    # The listener is session-manager-plugin, a child of the aws process, and
    # it survives its parent being killed. Stop it first.
    pkill -TERM -P "$DB_TUNNEL_PID" 2>/dev/null || true
    kill "$DB_TUNNEL_PID" 2>/dev/null || true
    # Reaping it here keeps bash from printing "Terminated" for the job.
    wait "$DB_TUNNEL_PID" 2>/dev/null || true
  fi
  rm -rf "${DB_WORK:-}"
}

# docker run, with the database reachable by its real hostname and libpq set to
# verify it. Passwords cross into the container by variable name only (-e NAME),
# so they never appear in a process listing. Extra docker flags, then the image
# and command, follow as arguments.
db_docker() {
  local net
  if [ "$(uname)" = Linux ]; then
    # The tunnel listens on the host's loopback, which only the host network reaches.
    net=(--network host --add-host "$DB_HOST:127.0.0.1")
  else
    # Docker Desktop routes host-gateway to the host's loopback.
    net=(--add-host "$DB_HOST:host-gateway")
  fi
  docker run --rm "${net[@]}" \
    -e PGUSER -e PGPASSWORD -e PGDATABASE \
    -e PGHOST="$DB_HOST" -e PGPORT="$DB_TUNNEL_PORT" \
    -e PGSSLMODE=verify-full -e PGSSLROOTCERT=/certs/rds-ca.pem \
    -v "$DB_WORK:/certs:ro" \
    "$@"
}
