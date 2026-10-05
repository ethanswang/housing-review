-- Up Migration
--
-- The directory shows a building's size, which imports know for nearly every
-- building near campus, and sorts unreviewed buildings largest first. Columns
-- are appended, which create or replace allows; the view keeps its grants.

create or replace view property_stats with (security_invoker = true) as
select p.id, p.slug, p.name, p.address, p.neighborhood,
       p.rent_min, p.rent_max, p.bedrooms, p.company_id,
       c.name as company_name, c.slug as company_slug,
       s.review_count,
       s.avg_overall, s.avg_maintenance, s.avg_communication, s.avg_value,
       p.visibility,
       p.unit_count, p.stories
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

-- create or replace cannot drop columns, so the view is recreated as
-- 1791177849432 left it. Nothing depends on it, and recreating it drops its
-- grant, which is restored.
drop view property_stats;
create view property_stats with (security_invoker = true) as
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
grant select on property_stats to api_access;
