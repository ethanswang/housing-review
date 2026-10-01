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
-- queries do. Grants are column-level where it matters: the API cannot write
-- users.role, a review's is_sample, created_at or status, or a report's
-- status. The one status change the API makes, an author withdrawing their
-- own published review, goes through withdraw_review() below.
--
-- Not covered: properties and management_companies are written by the catalog
-- importer, an operator tool that runs with the master login. Accepted: through
-- this role an injection could still read emails and reports, write reviews'
-- text and ratings, and withdraw every authored review (withdraw_review trusts
-- the author it is given, and the role can read author_id), because the API
-- itself must do each of these. It cannot publish a hidden review or touch one
-- with no author.
--
-- Every future migration that adds a table or a column the API writes must
-- grant it here too; nothing is granted by default.
--
-- Amended after merge (#36) and before it was ever applied in production,
-- following an independent review. Databases that applied the first version
-- should roll it back and re-apply.

do $$
begin
  if not exists (select from pg_roles where rolname = 'api_access') then
    create role api_access nologin;
  end if;
end
$$;
-- A group role and nothing more. SUPERUSER, REPLICATION and BYPASSRLS are left
-- alone: only a true superuser may even name them, which the RDS master is not,
-- and a role this migration created never has them. If some other role created
-- api_access, the RDS master holds no ADMIN on it and this statement fails,
-- which is the right outcome: the migration should not adopt a role it does not
-- control.
alter role api_access nologin nocreatedb nocreaterole;

grant usage on schema public to api_access;

grant select on management_companies, properties, reviews, users, review_reports to api_access;
grant select on property_stats, company_stats to api_access;

-- upsertUser: insert on first sign-in, refresh the email afterwards.
grant insert (id, email) on users to api_access;
grant update (email) on users to api_access;

-- createReview and updateReview. Not status: a column grant cannot limit the
-- value written, so UPDATE (status) would let an injection publish a review a
-- moderator hid.
grant insert (property_id, author_id, maintenance, communication, value, overall, body, lease_term)
  on reviews to api_access;
grant update (maintenance, communication, value, overall, body, lease_term)
  on reviews to api_access;

-- createReport.
grant insert (review_id, reporter_id, reason, details) on review_reports to api_access;

-- deleteReview. The only status change the API may make: its author's own
-- review, from published to removed. SECURITY DEFINER runs it with the owner's
-- privileges, so api_access needs no UPDATE on status; search_path is pinned so
-- a caller cannot redirect `reviews` to an object of their own.
create function withdraw_review(review_id uuid, author uuid) returns boolean
  language sql
  security definer
  set search_path = pg_catalog, public
as $$
  with withdrawn as (
    update public.reviews
    set status = 'removed'
    -- Qualified, because in an SQL function a column of the same name would
    -- silently win over a parameter if one were ever added to reviews.
    where id = withdraw_review.review_id
      and author_id = withdraw_review.author
      and status = 'published'
    returning 1
  )
  select exists (select from withdrawn)
$$;
revoke all on function withdraw_review(uuid, uuid) from public;
grant execute on function withdraw_review(uuid, uuid) to api_access;

-- PUBLIC can create temporary tables by default; nothing here needs them, and
-- they are an unmetered place for an injection to put data.
do $$
begin
  execute format('revoke temporary on database %I from public', current_database());
end
$$;

-- Down Migration

-- Dropping a role silently removes its members, so rolling back while the API's
-- login belongs to it would leave the live API with no privileges at all while
-- /readyz, which only runs `select 1`, kept reporting healthy.
--
-- Only memberships that pass privileges on count. On Postgres 16+ a
-- non-superuser who creates a role, as the RDS master does, is recorded as a
-- member with ADMIN but neither INHERIT nor SET; counting that would make this
-- step refuse forever.
do $$
declare
  members text;
begin
  select string_agg(r.rolname, ', ') into members
  from pg_auth_members m
  join pg_roles g on g.oid = m.roleid
  join pg_roles r on r.oid = m.member
  where g.rolname = 'api_access' and (m.inherit_option or m.set_option);
  if members is not null then
    raise exception 'api_access still has members (%). Revoke them first (revoke api_access from <login>), knowing the API loses its privileges.', members;
  end if;
end
$$;

drop function if exists withdraw_review(uuid, uuid);
revoke all on management_companies, properties, reviews, users, review_reports from api_access;
revoke all on property_stats, company_stats from api_access;
revoke usage on schema public from api_access;
-- Restores Postgres's default. It cannot tell whether TEMP was revoked from
-- PUBLIC before this migration ran; if it was, revoke it again by hand.
do $$
begin
  execute format('grant temporary on database %I to public', current_database());
end
$$;
-- Roles are cluster-wide, so another database may still grant to it, or a role
-- created by someone else may not be ours to drop. Leave it in either case.
do $$
begin
  drop role if exists api_access;
exception when dependent_objects_still_exist or insufficient_privilege then
  raise notice 'api_access left in place: %', sqlerrm;
end
$$;
