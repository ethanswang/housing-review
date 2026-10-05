-- Up Migration
--
-- A second public source (Urbana) and the lessons of the first (Champaign):
-- keep each source's own values, correct company names by hand rather than by
-- guessing, and store every building while choosing which ones the directory
-- shows. Additive only.

-- Every field the source gave for the record, as it gave it: the misspelled
-- manager name, the city's own building type, an inspection grade. Canonical
-- columns on properties are derived from it; this keeps what they cannot hold.
alter table property_sources add column raw jsonb not null default '{}';

-- Other spellings of a company's name, as sources write it ("Green Streeet
-- Realty"). The importer looks a source's manager up by normalized name, then
-- here; an unknown name is reported, never turned into a company on its own.
create table management_company_aliases (
  alias_normalized text primary key check (alias_normalized ~ '^[a-z0-9 ]+$'),
  alias            text not null check (char_length(alias) between 1 and 120),
  company_id       uuid not null references management_companies(id) on delete cascade,
  created_at       timestamptz not null default now()
);
create index management_company_aliases_company_id on management_company_aliases (company_id);

-- One vocabulary across sources. No imported rows existed in production when
-- this was written; the update only maps a local database's first import.
update properties set property_type = case property_type
  when 'complex' then 'apartment'
  when 'over commercial' then 'multi_unit'
  when 'building' then 'multi_unit'
  when 'house' then 'house'
  when 'fraternity or sorority' then 'greek_house'
  else 'other'
end
where property_type is not null;
alter table properties
  add constraint properties_property_type check
    (property_type in ('apartment', 'multi_unit', 'duplex', 'house', 'greek_house', 'other'));

-- Where a property appears: 'listed' in the directory, 'search_only' when
-- someone searches for it, 'hidden' only by its own link. Set from the type
-- when a building is imported, and kept after that, so it can be changed by
-- hand. Curated properties default to listed.
alter table properties
  add column visibility text not null default 'listed'
    check (visibility in ('listed', 'search_only', 'hidden'));
update properties set visibility = case property_type
  when 'house' then 'search_only'
  when 'greek_house' then 'hidden'
  else 'listed'
end
where property_type is not null;

-- The column is appended, which create or replace allows; the view keeps its
-- grants.
create or replace view property_stats with (security_invoker = true) as
select p.id, p.slug, p.name, p.address, p.neighborhood,
       p.rent_min, p.rent_max, p.bedrooms, p.company_id,
       c.name as company_name, c.slug as company_slug,
       s.review_count,
       s.avg_overall, s.avg_maintenance, s.avg_communication, s.avg_value,
       p.visibility
from properties p
left join management_companies c on c.id = p.company_id
left join lateral (
  select count(*)::int                  as review_count,
         round(avg(r.overall), 1)       as avg_overall,
         round(avg(r.maintenance), 1)   as avg_maintenance,
         round(avg(r.communication), 1) as avg_communication,
         round(avg(r.value), 1)         as avg_value
  from reviews r
  where r.property_id = p.id and r.status = 'published'
) s on true;

-- Down Migration

-- A view's columns cannot be dropped by create or replace, so it is recreated.
drop view company_stats;
drop view property_stats;
create view property_stats with (security_invoker = true) as
select p.id, p.slug, p.name, p.address, p.neighborhood,
       p.rent_min, p.rent_max, p.bedrooms, p.company_id,
       c.name as company_name, c.slug as company_slug,
       s.review_count,
       s.avg_overall, s.avg_maintenance, s.avg_communication, s.avg_value
from properties p
left join management_companies c on c.id = p.company_id
left join lateral (
  select count(*)::int                  as review_count,
         round(avg(r.overall), 1)       as avg_overall,
         round(avg(r.maintenance), 1)   as avg_maintenance,
         round(avg(r.communication), 1) as avg_communication,
         round(avg(r.value), 1)         as avg_value
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
-- Recreated views lose their grants; restore what 1790828306255 gave.
grant select on property_stats, company_stats to api_access;

alter table properties drop column visibility;
alter table properties drop constraint properties_property_type;
drop table management_company_aliases;
alter table property_sources drop column raw;
