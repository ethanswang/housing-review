-- Run once in the Supabase SQL editor against the live project, AFTER the
-- code that stops sending `is_sample` on insert has deployed (#33 or later).
-- Deployed in the other order, every submission fails: the old code would be
-- inserting a column the anon role may no longer write.
--
-- supabase/schema.sql already contains both changes for a fresh project;
-- this file applies them to the existing one. Safe to re-run.

begin;

-- 1. Cap lease_term at 40 characters, matching the API's schema.
--    If this fails, some existing row is longer: find it with
--      select id, char_length(lease_term) from reviews where char_length(lease_term) > 40;
alter table reviews drop constraint if exists reviews_lease_term_length;
alter table reviews add constraint reviews_lease_term_length
  check (char_length(lease_term) between 1 and 40);

-- 2. Let the API roles insert only the review's own fields, so `created_at`,
--    `id` and `is_sample` always take their defaults.
revoke insert on reviews from anon, authenticated;
grant insert (property_id, maintenance, communication, value, overall, body, lease_term)
  on reviews to anon, authenticated;

commit;

-- Check: should list exactly the seven columns, for anon and authenticated.
select grantee, column_name
from information_schema.column_privileges
where table_name = 'reviews' and privilege_type = 'INSERT'
  and grantee in ('anon', 'authenticated')
order by grantee, column_name;
