-- Up Migration
--
-- Lets properties come from public datasets (server/src/ingest/), which know a
-- building's location and size but not its rent or the site's neighborhood
-- names. Additive only: no row or column is removed.

-- Unknown until a curated file or a tenant says otherwise. Both or neither,
-- so a half-known range never shows up as "$900–null".
alter table properties
  alter column rent_min drop not null,
  alter column rent_max drop not null,
  alter column neighborhood drop not null,
  add constraint properties_rent_both check ((rent_min is null) = (rent_max is null));

-- What the datasets do know. Null means the source did not say.
alter table properties
  add column latitude      double precision check (latitude between -90 and 90),
  add column longitude     double precision check (longitude between -180 and 180),
  add column unit_count    integer check (unit_count > 0),
  add column stories       smallint check (stories > 0),
  add column property_type text check (char_length(property_type) <= 40),
  add column complex_name  text check (char_length(complex_name) <= 120);

-- Which dataset record each property came from. The primary key is what makes
-- an import safe to re-run: a record already linked updates its property
-- instead of creating another. A property may be linked from several sources.
-- Not granted to api_access: only the importer, as the master user, reads it.
create table property_sources (
  source         text not null check (source ~ '^[a-z0-9_]+$'),
  source_id      text not null check (char_length(source_id) between 1 and 200),
  property_id    uuid not null references properties(id) on delete cascade,
  -- The address as the source wrote it, for checking a match by hand.
  source_address text not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  primary key (source, source_id)
);
create index property_sources_property_id on property_sources (property_id);

-- Down Migration

-- Restoring NOT NULL would fail, or need invented values, once a property has
-- no rent or neighborhood; say so instead of failing halfway.
do $$
begin
  if exists (select from properties where rent_min is null or neighborhood is null) then
    raise exception 'Some properties have no rent or neighborhood. Fill them in or remove them before rolling back.';
  end if;
end
$$;

drop table property_sources;
alter table properties
  drop column complex_name,
  drop column property_type,
  drop column stories,
  drop column unit_count,
  drop column longitude,
  drop column latitude,
  drop constraint properties_rent_both,
  alter column neighborhood set not null,
  alter column rent_max set not null,
  alter column rent_min set not null;
