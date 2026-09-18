-- Development seed data. Safe to re-run: it clears the tables first.
--
-- Property and company names are real and public; addresses are block-level,
-- and the rent figures are illustrative placeholders, not quotes. Company and
-- property pairings have not been verified. No review text here came from a
-- real tenant.

truncate review_reports, reviews, properties, management_companies, users restart identity cascade;

-- Fixed UUIDs so local logins and tests can rely on them.
insert into users (id, email, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', 'student@illinois.edu',   'Test Student',   'student'),
  ('22222222-2222-4222-8222-222222222222', 'moderator@illinois.edu', 'Test Moderator', 'moderator'),
  ('33333333-3333-4333-8333-333333333333', 'admin@illinois.edu',     'Test Admin',     'admin');

insert into management_companies (name, slug) values
  ('JSM',                 'jsm'),
  ('Bankier Apartments',  'bankier-apartments'),
  ('Roland Realty',       'roland-realty'),
  ('Green Street Realty', 'green-street-realty'),
  ('Smith Apartments',    'smith-apartments'),
  ('Core Spaces',         'core-spaces');

insert into properties (name, slug, address, neighborhood, rent_min, rent_max, bedrooms, company_id)
select v.name, v.slug, v.address, v.neighborhood, v.rent_min, v.rent_max, v.bedrooms, c.id
from (values
  ('HERE Champaign',      'here-champaign',      '300 block of E Green St, Champaign',  'Campustown',         1150, 1650, '{1,2,3,4}'::int[], 'core-spaces'),
  ('Green Street Towers', 'green-street-towers', '500 block of E Green St, Champaign',  'Campustown',          875, 1250, '{1,2,3}'::int[],   'jsm'),
  ('Lofts 54',            'lofts-54',            '50 block of E John St, Champaign',    'Campustown',          900, 1300, '{1,2,4}'::int[],   'jsm'),
  ('Bankier Apartments',  'bankier-apartments',  '400 block of E Green St, Champaign',  'Campustown',          700, 1050, '{1,2,3}'::int[],   'bankier-apartments'),
  ('Roland Realty',       'roland-realty',       '600 block of E Daniel St, Champaign', 'Campustown',          650,  975, '{1,2,3,4}'::int[], 'roland-realty'),
  ('Green Street Realty', 'green-street-realty', '100 block of N Neil St, Champaign',   'Downtown Champaign',  825, 1400, '{1,2}'::int[],     'green-street-realty'),
  ('Smith Apartments',    'smith-apartments',    '900 block of W Green St, Urbana',     'Urbana',              575,  850, '{1,2,3}'::int[],   'smith-apartments'),
  ('Campus Circle',       'campus-circle',       '200 block of E Springfield Ave',      'Engineering Campus',  700,  995, '{2,3,4}'::int[],   'roland-realty')
) as v(name, slug, address, neighborhood, rent_min, rent_max, bedrooms, company_slug)
join management_companies c on c.slug = v.company_slug;

-- A few demo reviews so the aggregates are non-empty locally. is_sample = true
-- keeps them labelled in the UI and deletable in one statement before launch.
insert into reviews (property_id, maintenance, communication, value, overall, body, lease_term, is_sample)
select p.id, v.maintenance, v.communication, v.value, v.overall, v.body, v.lease_term, true
from (values
  ('here-champaign', 4, 4, 2, 3, 'Building is genuinely nice and the gym gets used, but you pay a real premium for it. Once parking and fees were added in it stopped feeling worth it.', '2024-25'),
  ('here-champaign', 5, 4, 3, 4, 'Front desk is responsive and packages never went missing. Elevators get slow around class change. Would live here again if rent had not gone up.', '2023-24'),
  ('bankier-apartments', 4, 4, 5, 4, 'Best value I found in Campustown. Nothing fancy, but things worked, and when they did not someone actually came out to fix them.', '2024-25'),
  ('bankier-apartments', 4, 5, 5, 5, 'Easy to get someone on the phone, which sounds like a low bar until you have leased somewhere else. Straightforward lease, no surprises at move out.', '2023-24'),
  ('smith-apartments', 4, 4, 5, 4, 'Cheapest decent place I toured. Urbana side so plan around the bus. Maintenance was quick and the office actually answers the phone.', '2024-25'),
  ('roland-realty', 2, 2, 3, 2, 'Communication was the weak point. Multiple emails went unanswered and I ended up walking into the office to get anything done at all.', '2024-25')
) as v(property_slug, maintenance, communication, value, overall, body, lease_term)
join properties p on p.slug = v.property_slug;
