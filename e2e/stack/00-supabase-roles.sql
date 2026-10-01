-- The roles and default grants a Supabase project starts with, so that
-- supabase/schema.sql (run next) behaves here as it does there. PostgREST logs
-- in as `authenticator` and switches to `anon` for requests carrying the anon
-- key. Test-only credentials; this database exists only for the e2e suite.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role authenticator login password 'e2e-authenticator' noinherit;
grant anon, authenticated to authenticator;

grant usage on schema public to anon, authenticated;
-- Supabase's default: the API roles get every privilege on new tables, which
-- schema.sql then narrows with RLS and column grants.
alter default privileges in schema public grant all on tables to anon, authenticated;
