#!/usr/bin/env bash
# Creates the login the API connects as, or resets its password.
#
#   infra/provision-api-role.sh
#
# The login and its password come from the API's secret (tofu output
# api_secret_arn), which OpenTofu generates; this makes the database agree with
# it. It joins api_access, the role a migration creates with the API's runtime
# grants, so run infra/migrate-db.sh first. Safe to re-run: re-running after the
# secret's password changes is how the password is rotated.
#
# The password itself never reaches the database. This computes its SCRAM
# verifier here and sends that, as psql's \password does, so neither a failed
# statement logged to CloudWatch nor anything else on the server can contain it.
#
# Requires python3 (standard library only) in addition to db-tunnel.sh's tools.
set -euo pipefail
cd "$(dirname "$0")/.."
. infra/lib/db-tunnel.sh

command -v python3 >/dev/null || { echo "missing: python3" >&2; exit 1; }
api_secret_arn=$(tofu -chdir=infra output -raw api_secret_arn)
db_tunnel_open

api_secret=$(aws secretsmanager get-secret-value --region "${AWS_REGION:-us-east-2}" \
  --secret-id "$api_secret_arn" --query SecretString --output text)
export API_DB_USER API_DB_PASSWORD API_DB_VERIFIER
API_DB_USER=$(printf '%s' "$api_secret" | jq -er .db_username)
API_DB_PASSWORD=$(printf '%s' "$api_secret" | jq -er .db_password)

# SCRAM-SHA-256 verifier in Postgres's stored format (RFC 5802/7677). The
# generated password is ASCII, which SASLprep leaves unchanged.
API_DB_VERIFIER=$(python3 - <<'PY'
import base64, hashlib, hmac, os
password = os.environ["API_DB_PASSWORD"].encode()
salt, iterations = os.urandom(16), 4096
salted = hashlib.pbkdf2_hmac("sha256", password, salt, iterations)
client_key = hmac.new(salted, b"Client Key", "sha256").digest()
stored_key = hashlib.sha256(client_key).digest()
server_key = hmac.new(salted, b"Server Key", "sha256").digest()
b64 = lambda b: base64.b64encode(b).decode()
print(f"SCRAM-SHA-256${iterations}:{b64(salt)}${b64(stored_key)}:{b64(server_key)}")
PY
)
unset API_DB_PASSWORD

# psql reads the values from the container's environment with \set and
# backticks, so neither appears as an argument. Identifiers and literals are
# quoted by format(%I, %L), not by string concatenation. NOSUPERUSER is not
# named: on Postgres 16+ only a true superuser may name it, which the RDS master
# is not, and a role created here never has it — the check below shows it.
db_docker -i -e API_DB_USER -e API_DB_VERIFIER postgres:17-alpine \
  psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
\set login `printenv API_DB_USER`
\set verifier `printenv API_DB_VERIFIER`
select format('create role %I login', :'login')
  where not exists (select from pg_roles where rolname = :'login') \gexec
select format('alter role %I with login nocreaterole nocreatedb password %L', :'login', :'verifier') \gexec
grant api_access to :"login";
\pset footer off
select rolname as login, rolsuper as superuser, rolcreaterole as createrole,
       pg_has_role(rolname, 'api_access', 'member') as in_api_access
from pg_roles where rolname = :'login';
SQL
