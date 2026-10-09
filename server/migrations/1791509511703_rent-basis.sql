-- Up Migration
--
-- What a rent range is per: a bed in a shared unit, a whole unit, or both in one
-- building (shared suites priced per bed, studios per unit). Student buildings
-- near campus mostly price per bed, so a range shown without this misleads by a
-- factor of two to four. Null means the listing did not say.

alter table properties
  add column rent_basis text check (rent_basis in ('bed', 'unit', 'mixed')),
  add constraint properties_rent_basis_needs_rent check (rent_basis is null or rent_min is not null);

-- Appended, which create or replace allows; the view keeps its grants.
create or replace view property_stats with (security_invoker = true) as
select p.id, p.slug, p.name, p.address, p.neighborhood,
       p.rent_min, p.rent_max, p.bedrooms, p.company_id,
       c.name as company_name, c.slug as company_slug,
       s.review_count,
       s.avg_overall, s.avg_maintenance, s.avg_communication, s.avg_value,
       p.visibility,
       p.unit_count, p.stories, p.website, p.rent_basis
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

-- Recreated as 1791487371250 left it; recreating drops the grant, restored below.
drop view property_stats;
create view property_stats with (security_invoker = true) as
select p.id, p.slug, p.name, p.address, p.neighborhood,
       p.rent_min, p.rent_max, p.bedrooms, p.company_id,
       c.name as company_name, c.slug as company_slug,
       s.review_count,
       s.avg_overall, s.avg_maintenance, s.avg_communication, s.avg_value,
       p.visibility,
       p.unit_count, p.stories, p.website
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
grant select on property_stats to api_access;
alter table properties drop column rent_basis;
