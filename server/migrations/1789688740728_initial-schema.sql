-- Up Migration

-- pg_trgm powers the `ilike '%term%'` property search; citext gives
-- case-insensitive unique emails without lower() indexes everywhere.
create extension if not exists pg_trgm;
create extension if not exists citext;

-- Identity is issued by Supabase Auth (ES256 JWT). We store the token's `sub`
-- claim as the primary key so a row survives an email change, and keep a local
-- copy of the email for display and for the university-domain rule.
create table users (
  id           uuid primary key,
  email        citext not null unique,
  display_name text check (char_length(display_name) <= 80),
  role         text not null default 'student'
                 check (role in ('student', 'moderator', 'admin')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- The API enforces this too, at sign-in. Keeping it here means no code path,
  -- including a future admin script, can create a non-university account.
  constraint users_illinois_email check (email ~* '@([a-z0-9-]+\.)*illinois\.edu$')
);

create table management_companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  slug       text not null unique,
  website    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table properties (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references management_companies(id) on delete set null,
  name         text not null check (char_length(name) between 1 and 120),
  slug         text not null unique,
  address      text not null,
  neighborhood text not null,
  rent_min     integer not null check (rent_min > 0),
  rent_max     integer not null check (rent_max > 0),
  bedrooms     integer[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint properties_rent_range check (rent_max >= rent_min)
);

create table reviews (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references properties(id) on delete cascade,
  -- Nullable on purpose: reviews written before accounts existed, and the
  -- seeded demo rows, have no author. A null author can never pass an
  -- ownership check, so those rows are readable but not editable by anyone.
  author_id     uuid references users(id) on delete set null,
  maintenance   smallint not null check (maintenance between 1 and 5),
  communication smallint not null check (communication between 1 and 5),
  value         smallint not null check (value between 1 and 5),
  overall       smallint not null check (overall between 1 and 5),
  body          text not null check (char_length(body) between 20 and 2000),
  lease_term    text not null check (char_length(lease_term) between 1 and 40),
  status        text not null default 'published'
                  check (status in ('published', 'hidden', 'removed')),
  is_sample     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- One review per person per property. Postgres treats nulls as distinct, so
  -- this constrains real authors without blocking multiple legacy rows.
  constraint reviews_one_per_author_property unique (author_id, property_id),
  constraint reviews_sample_has_no_author check (not is_sample or author_id is null)
);

create table review_reports (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references reviews(id) on delete cascade,
  reporter_id uuid not null references users(id) on delete cascade,
  reason      text not null
                check (reason in ('spam', 'harassment', 'not_a_tenant', 'personal_info', 'other')),
  details     text check (char_length(details) <= 1000),
  status      text not null default 'open'
                check (status in ('open', 'dismissed', 'actioned')),
  resolved_by uuid references users(id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  -- A person may report a given review once.
  constraint review_reports_one_per_reporter unique (review_id, reporter_id),
  -- Resolution metadata and status cannot disagree.
  constraint review_reports_resolution_consistent
    check ((status = 'open') = (resolved_at is null))
);

-- Indexes -------------------------------------------------------------------
-- Each one exists for a named query; see docs/DATABASE.md.

create index properties_company_id_idx on properties (company_id);
create index properties_neighborhood_idx on properties (neighborhood);
create index properties_rent_min_idx on properties (rent_min);
create index properties_bedrooms_idx on properties using gin (bedrooms);
create index properties_name_trgm_idx on properties using gin (name gin_trgm_ops);
create index properties_address_trgm_idx on properties using gin (address gin_trgm_ops);

-- Serves both the per-property average and the newest-first review page.
create index reviews_property_created_idx on reviews (property_id, created_at desc);
create index reviews_author_idx on reviews (author_id) where author_id is not null;

-- The moderation queue only ever reads open reports.
create index review_reports_open_idx on review_reports (created_at desc) where status = 'open';

-- Aggregates ----------------------------------------------------------------
-- Averages are computed in SQL rather than in application code. LEFT JOIN
-- LATERAL rather than GROUP BY so filters on properties (search, area, rent,
-- bedrooms) apply before any review row is read.

create view property_stats with (security_invoker = true) as
select p.id, p.slug, p.name, p.address, p.neighborhood,
       p.rent_min, p.rent_max, p.bedrooms, p.company_id,
       c.name as company_name, c.slug as company_slug,
       s.review_count,
       s.avg_overall, s.avg_maintenance, s.avg_communication, s.avg_value
from properties p
left join management_companies c on c.id = p.company_id
left join lateral (
  select count(*)::int                             as review_count,
         round(avg(r.overall), 1)                  as avg_overall,
         round(avg(r.maintenance), 1)              as avg_maintenance,
         round(avg(r.communication), 1)            as avg_communication,
         round(avg(r.value), 1)                    as avg_value
  from reviews r
  where r.property_id = p.id and r.status = 'published'
) s on true;

create view company_stats with (security_invoker = true) as
select c.id, c.slug, c.name, c.website,
       (select count(*)::int from properties p where p.company_id = c.id) as property_count,
       s.review_count,
       s.avg_overall, s.avg_maintenance, s.avg_communication, s.avg_value
from management_companies c
left join lateral (
  select count(*)::int                  as review_count,
         round(avg(r.overall), 1)       as avg_overall,
         round(avg(r.maintenance), 1)   as avg_maintenance,
         round(avg(r.communication), 1) as avg_communication,
         round(avg(r.value), 1)         as avg_value
  from reviews r
  join properties p on p.id = r.property_id
  where p.company_id = c.id and r.status = 'published'
) s on true;

-- Down Migration

drop view if exists company_stats;
drop view if exists property_stats;
drop table if exists review_reports;
drop table if exists reviews;
drop table if exists properties;
drop table if exists management_companies;
drop table if exists users;
