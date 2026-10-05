-- Up Migration
--
-- The first production import (2026-10-05) gave the second building at each of
-- three shared addresses a URL with the address twice. The importer now numbers
-- them instead; this renames the three that already exist, by exact slug, before
-- the site serves any of them. A database without them (local, CI) is unchanged,
-- and a rename whose target is taken is skipped rather than failing.

update properties p set slug = v.new_slug, updated_at = now()
from (values
  ('610-s-fourth-st-610-s-fourth-st', '610-s-fourth-st-2'),
  ('1107-s-second-st-1107-s-second-st', '1107-s-second-st-2'),
  ('56-e-green-st-56-e-green-st', '56-e-green-st-2')
) as v(old_slug, new_slug)
where p.slug = v.old_slug
  and not exists (select from properties q where q.slug = v.new_slug);

-- Down Migration

update properties p set slug = v.old_slug, updated_at = now()
from (values
  ('610-s-fourth-st-610-s-fourth-st', '610-s-fourth-st-2'),
  ('1107-s-second-st-1107-s-second-st', '1107-s-second-st-2'),
  ('56-e-green-st-56-e-green-st', '56-e-green-st-2')
) as v(old_slug, new_slug)
where p.slug = v.new_slug
  and not exists (select from properties q where q.slug = v.old_slug);
