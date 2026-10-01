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
set -euo pipefail
cd "$(dirname "$0")/.."
. infra/lib/db-tunnel.sh

api_secret_arn=$(tofu -chdir=infra output -raw api_secret_arn)
db_tunnel_open

api_secret=$(aws secretsmanager get-secret-value --region "${AWS_REGION:-us-east-2}" \
  --secret-id "$api_secret_arn" --query SecretString --output text)
export API_DB_USER API_DB_PASSWORD
API_DB_USER=$(jq -r .db_username <<<"$api_secret")
API_DB_PASSWORD=$(jq -r .db_password <<<"$api_secret")

# psql reads the values from the container's environment with \set and
# backticks, so neither appears as an argument. Identifiers and the password
# are quoted by format(%I, %L), not by string concatenation.
db_docker -i -e API_DB_USER -e API_DB_PASSWORD postgres:17-alpine \
  psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
\set login `printenv API_DB_USER`
\set password `printenv API_DB_PASSWORD`
select format('create role %I login', :'login')
  where not exists (select from pg_roles where rolname = :'login') \gexec
select format('alter role %I with login nosuperuser nocreaterole nocreatedb password %L', :'login', :'password') \gexec
grant api_access to :"login";
\pset footer off
select rolname as login, rolsuper as superuser, rolcreaterole as createrole,
       pg_has_role(rolname, 'api_access', 'member') as in_api_access
from pg_roles where rolname = :'login';
SQL
