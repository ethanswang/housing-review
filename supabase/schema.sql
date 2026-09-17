-- UIUC Housing Review — schema
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: drops and recreates everything.

drop table if exists reviews cascade;
drop table if exists properties cascade;
drop table if exists management_companies cascade;

create table management_companies (
  id   uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique
);

create table properties (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  address      text not null,
  neighborhood text not null,
  rent_min     int  not null,
  rent_max     int  not null,
  bedrooms     int[] not null default '{}',
  company_id   uuid references management_companies(id) on delete set null
);

create table reviews (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references properties(id) on delete cascade,
  maintenance   smallint not null check (maintenance   between 1 and 5),
  communication smallint not null check (communication between 1 and 5),
  value         smallint not null check (value         between 1 and 5),
  overall       smallint not null check (overall       between 1 and 5),
  body          text not null check (char_length(body) between 20 and 2000),
  lease_term    text not null,
  -- Marks seeded demo reviews so the UI can label them and a real launch can
  -- remove them with: delete from reviews where is_sample;
  is_sample     boolean not null default false,
  created_at    timestamptz not null default now()
);

create index reviews_property_id_idx on reviews(property_id);
create index properties_company_id_idx on properties(company_id);

-- Row Level Security ---------------------------------------------------------
-- The app talks to Supabase with the anon key, which is public by design. RLS is
-- therefore the actual access control:
-- anyone may read, anyone may submit a review, nobody may edit or delete.

alter table management_companies enable row level security;
alter table properties           enable row level security;
alter table reviews              enable row level security;

create policy "public read companies"   on management_companies for select using (true);
create policy "public read properties"  on properties           for select using (true);
create policy "public read reviews"     on reviews              for select using (true);

-- Submissions are open (no accounts in the MVP). The column checks above are
-- the server-side guard on rating ranges and body length. `is_sample` is not
-- writable by the public policy path — seeded rows are inserted by an admin.
create policy "public insert reviews" on reviews for insert with check (is_sample = false);
