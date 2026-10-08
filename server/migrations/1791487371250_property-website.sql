-- Up Migration
--
-- A building's own website (its leasing page), entered by hand through the
-- catalog file. http(s) only, as for companies: anything else would become a
-- script the moment a page renders it as a link.

alter table properties
  add column website text check (website ~ '^https?://' and char_length(website) <= 500);

-- Appended, which create or replace allows; the view keeps its grants.
create or replace view property_stats with (security_invoker = true) as
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

-- Down Migration

-- create or replace cannot drop a column, so the view is recreated as
-- 1791187067593 left it, and its grant restored.
drop view property_stats;
create view property_stats with (security_invoker = true) as
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
grant select on property_stats to api_access;
alter table properties drop column website;
