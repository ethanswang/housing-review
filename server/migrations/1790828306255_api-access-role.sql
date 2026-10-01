-- Up Migration
--
-- The privileges the API needs at runtime, and nothing more, held by a group
-- role with no login. The login the API actually uses is created outside
-- migrations (infra/provision-api-role.sh), because its password must not live
-- in this repository; it is a member of this role and inherits these grants.
--
-- The point is the blast radius. Connected as the master user, an SQL
-- injection or a compromised container could drop tables, read anything, or
-- make anyone an admin. Through this role it can only do what the API's own
-- queries do. Grants are column-level where it matters: the API can never
-- write users.role, a review's is_sample or created_at, or a report's status.
--
-- Not covered: properties and management_companies are written by the catalog
-- importer, an operator tool that runs with the master login.
--
-- Every future migration that adds a table or a column the API writes must
-- grant it here too; nothing is granted by default.

do $$
begin
  if not exists (select from pg_roles where rolname = 'api_access') then
    create role api_access nologin;
  end if;
end
$$;

grant usage on schema public to api_access;

grant select on management_companies, properties, reviews, users, review_reports to api_access;
grant select on property_stats, company_stats to api_access;

-- upsertUser: insert on first sign-in, refresh the email afterwards.
grant insert (id, email) on users to api_access;
grant update (email) on users to api_access;

-- createReview, updateReview, and deleteReview (which sets status = 'removed').
grant insert (property_id, author_id, maintenance, communication, value, overall, body, lease_term)
  on reviews to api_access;
grant update (maintenance, communication, value, overall, body, lease_term, status)
  on reviews to api_access;

-- createReport.
grant insert (review_id, reporter_id, reason, details) on review_reports to api_access;

-- Down Migration

revoke all on management_companies, properties, reviews, users, review_reports from api_access;
revoke all on property_stats, company_stats from api_access;
revoke usage on schema public from api_access;
-- Roles are cluster-wide, so another database on the same server may still
-- grant to it; drop only if that leaves nothing behind.
do $$
begin
  drop role if exists api_access;
exception when dependent_objects_still_exist then
  raise notice 'api_access still holds privileges elsewhere; left in place';
end
$$;
