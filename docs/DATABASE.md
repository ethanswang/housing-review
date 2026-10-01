# Database

PostgreSQL 17. The schema lives in `server/migrations/` and is applied with
[node-pg-migrate](https://github.com/salsita/node-pg-migrate). Every change to the database
is a migration file in that directory — there is no hand-edited schema script, and nothing
drops a table that holds real data.

## Running it locally

```bash
docker compose up -d --wait db   # Postgres 17 on localhost:5433 (just the database)
cd server
npm ci
npm run db:migrate               # apply migrations
npm run db:seed                  # load development data (refuses non-local databases)
npm test                         # schema, endpoint, auth and role tests; needs the seed
npm run db:benchmark             # EXPLAIN ANALYZE at volume, then rolls back
```

`DATABASE_URL` overrides the connection string; it defaults to the compose database
(`postgres://housing:housing_dev@localhost:5433/housing`). Port 5433 is deliberate, so this
never collides with a Postgres already running on 5432.

To start over: `docker compose down -v && docker compose up -d --wait db`.

## Loading the property list

`db:seed` is for local development only: it truncates every table. The production list of
companies and properties is loaded with the catalog importer instead, which is built to be
safe to run against real data:

```bash
cd server
node src/import-catalog.ts data/catalog.json            # dry run: reports, writes nothing
node src/import-catalog.ts data/catalog.json --apply    # writes
```

It reads `DATABASE_URL`. `data/catalog.example.json` shows the format.

- **It never deletes.** A row missing from the file stays, and so do its reviews. Removing a
  property is a separate, deliberate act.
- **Rows are matched by slug.** Importing the same file twice reports every row unchanged; a
  corrected file updates only the rows that differ. Keep a property's slug fixed once it is
  live — it is the URL, and changing it in the file creates a second property.
- **All or nothing.** The whole file is validated first, with every problem listed at once,
  and the writes share one transaction, so a bad file leaves the database as it was.
- **Dry run by default.** Without `--apply` the transaction is rolled back after counting.
- A property's `company` may be a company in the same file or one already in the database;
  `null` means an independent landlord. Omitting a company's `website` clears it.

**Production:** run it through the tunnel, as the master user, with the same dry-run default:

```bash
infra/import-catalog.sh server/data/catalog.json            # dry run
infra/import-catalog.sh server/data/catalog.json --apply
```

The script runs this importer from your `server/` checkout in a container that reaches the
private database through Session Manager (see [INFRASTRUCTURE.md](INFRASTRUCTURE.md#migrations)).

## Trust model

**Authorization is enforced in the API, not by row-level security**, because no untrusted
client ever holds a connection to this database. That is a deliberate change from the Supabase-era schema, where the browser's anon key
reached PostgREST directly and RLS was the only thing standing between a visitor and the
tables.

The consequence is a rule worth stating plainly: **these migrations must never be applied to
the Supabase project.** PostgREST would publish `users` and `review_reports` to the anon key
with no policies at all. The views are declared `security_invoker = true` so that if RLS is
ever introduced, the caller's policies apply rather than the view owner's.

### Who connects as what

| Login | Used by | Can |
| --- | --- | --- |
| Master (`housing` on RDS) | Migrations, the catalog importer, exports | Everything |
| API login, a member of `api_access` | The running API | Only what the API's own queries do |

`api_access` is created by a migration and holds the runtime grants; the API's login is created
separately with a password that never enters the repository, and inherits them. Grants are
column-level where it matters: even an SQL injection through the API could not write
`users.role`, a review's `is_sample` or `created_at`, or resolve a report, and cannot delete
rows or change the schema. `tests/api-role.test.ts` runs the API through such a login and
checks each of those refusals.

**A migration that adds a table or a column the API writes must grant it to `api_access`.**
Nothing is granted by default, so forgetting shows up as a permission error in that test
rather than in production.

Destructive scripts (`db:seed`, `db:benchmark`) refuse to run against any host that is not
local, and say so, rather than trusting whatever `DATABASE_URL` happens to be exported.

## Tables

```
users ──────────┐
                │ author_id (nullable, set null on delete)
                ▼
management_companies ──< properties ──< reviews ──< review_reports
                          company_id     property_id    review_id
                       (set null)       (cascade)      (cascade)
```

### `users`

Identity is issued by Supabase Auth, which signs ES256 JWTs. The token's `sub` claim is
stored as the primary key, so a row survives a change of email address. The email is kept
locally for display and for the university rule.

`users_illinois_email` restricts addresses to `illinois.edu` and its subdomains. The API
enforces the same rule at sign-in; having it in the database as well means no code path,
including a future admin script or a manual `INSERT`, can create a non-university account.

`role` is `student`, `moderator` or `admin`, checked at the column. Roles are read
server-side on every protected request; the frontend never decides permissions.

### `properties` and `management_companies`

A property optionally belongs to a company. Deleting a company uses `on delete set null`,
so the properties survive as independent listings rather than disappearing — losing review
history because a company record was removed would be the wrong outcome.

`properties_rent_range` rejects `rent_max < rent_min`. `bedrooms` is `integer[]`, since a
building offers several unit sizes and the filter asks "does this property offer any of
these sizes".

### `reviews`

`author_id` is **nullable on purpose**. Reviews written before accounts existed, and the
seeded demo rows, have no author. An ownership check compares `author_id` to the
authenticated user, and `null` never matches, so those rows are readable but not editable
by anyone.

- `reviews_one_per_author_property` is a **partial unique index** on
  `(author_id, property_id) where status <> 'removed'`. Postgres treats nulls as distinct, so
  this limits a real person to one review per property while still allowing several
  authorless legacy rows on the same property. It excludes removed rows deliberately:
  otherwise moderation would permanently bar that author from ever reviewing that building
  again, turning one removal into a lifetime ban on a single property. A hidden review still
  blocks a duplicate, because hiding is temporary. It is an index rather than a table
  constraint because constraints cannot carry a `WHERE` clause.
- `reviews_sample_has_no_author` stops a real user's review from being labelled sample data.
- `status` (`published` / `hidden` / `removed`) drives moderation. Aggregates count only
  `published` rows, so hiding a review immediately changes the scores.
- Rating columns are `smallint` with `between 1 and 5`; `body` is constrained to 20–2000
  characters. These are the last of three validation layers: the browser, the API, then the
  database.

### `review_reports`

- `review_reports_one_per_reporter` prevents one person from reporting the same review
  repeatedly to inflate a queue.
- `review_reports_resolution_consistent` enforces `(status = 'open') = (resolved_at is null)`,
  so a resolved report can never lack a resolution time.

## Indexes

Each index exists for a specific query rather than as a precaution.

| Index | Query it serves |
| --- | --- |
| `properties_name_trgm_idx`, `properties_address_trgm_idx` | Search, which is `ilike '%term%'`. A B-tree cannot serve a leading wildcard; these are GIN trigram indexes. |
| `properties_neighborhood_idx` | Filtering by area. |
| `properties_rent_min_idx` | The max-rent filter, which compares against the cheapest unit. |
| `properties_bedrooms_idx` | GIN index for the array-overlap bedroom filter. |
| `properties_company_id_idx` | A company's property list. |
| `reviews_property_created_idx` | Both the per-property average and the newest-first review page, from one composite index on `(property_id, created_at desc)`. |
| `reviews_author_idx` | "My reviews" including removed ones, which the partial unique index above does not cover. Partial on `author_id is not null`, since legacy rows have no author to look up. |
| `review_reports_reporter_idx` | `reporter_id` cascades from `users`; without it, deleting an account sequentially scans this table. Also serves "reports I filed". |
| `review_reports_open_idx` | The moderation queue, partial on `status = 'open'` — the only rows it reads. |

### Measured, not assumed

`npm run db:benchmark` generates volume data, runs `EXPLAIN ANALYZE` on the hot queries, and
rolls back. It defaults to 5,000 properties; the figures below are at 50,000 properties and
200,000 reviews, roughly ten times a realistic Champaign–Urbana ceiling:

```bash
BENCH_PROPERTIES=50000 BENCH_REVIEWS_EACH=4 npm run db:benchmark
```

| Query | Time | Plan chosen |
| --- | --- | --- |
| Property search (`ilike` on name and address) | 1.5 ms | both trigram indexes |
| Directory page 1, sorted by rating | 164 ms | sequential scan (see *Known ceiling*) |
| Filtered by area + rent + bedrooms | 19 ms | `properties_neighborhood_idx` |
| One property page | 0.08 ms | `properties_slug_key` |
| One property's reviews | 0.05 ms | `reviews_property_created_idx` |

### `random_page_cost` is load-bearing

Postgres defaults `random_page_cost` to 4.0, a value that models a spinning disk. On SSD
storage the planner therefore rejects the trigram indexes and scans the table instead. Measured
at 50k rows, the same search took **23 ms** under the default and **1.5 ms** at
`random_page_cost = 1.1` — an 18x difference from one setting, with no change to the query or
the schema.

Rewriting the query does not substitute for it: filtering in a subquery before the join
measured 23.0 ms, indistinguishable from the unrestructured form. Only the cost setting moved
the planner.

`docker-compose.yml` starts Postgres with `-c random_page_cost=1.1` so local plans match
production plans. **Any production deployment must set the same value** — on RDS, through the
parameter group — or search quietly degrades into a table scan.

## Aggregates

`property_stats` and `company_stats` compute review counts and per-category averages in SQL,
so that application code never has to average anything itself.

The API reads both. The live website does not yet: it still queries the older Supabase schema
directly and averages in JavaScript, until it moves onto the API.

Both use `LEFT JOIN LATERAL` rather than `GROUP BY`. With a lateral join, conditions on
`properties` (search, area, rent, bedrooms) restrict the property scan *before* any review
row is read. A view that groups over the whole join cannot push those conditions below the
aggregate, so it would read every review on every request regardless of the filter.

Averages are rounded to one decimal place in SQL, and a property with no published reviews
returns `review_count = 0` with null averages — which is what the UI renders as "—".

Note for callers: node-postgres returns `numeric` values as strings to avoid precision loss,
so `avg_overall` arrives as `'3.5'`, not `3.5`. Whatever reads these views converts at the
boundary; the tests do the same.

### Known ceiling

Sorting the directory by rating is the one query indexes cannot rescue: every matching property
must have its average computed before the rows can be ordered. Measured at **164 ms for 50,000
properties**, against 65 ms at 5,000. Champaign–Urbana has a few thousand rental properties, so
there is plenty of headroom — and the benchmark is committed so the headroom can be re-measured
rather than assumed.

When that stops being true, the fix is to stop computing averages per request: store
`review_count` and the four averages on `properties`, maintain them with a trigger on
`reviews`, and index them, which turns the sort into an index scan. That is deliberately not
built yet. It costs a trigger, a backfill, and a new way for data to drift, in exchange for
time this dataset does not currently need.

The views are declared `security_invoker = true`, so if row-level security is enabled on
the base tables later, the caller's policies still apply rather than the view owner's.

## Where each rule is enforced

This schema is written only through the API, which enforces the API column today. The live
website still submits through a Next.js Server Action to the older Supabase schema
(`supabase/schema.sql`) until it moves onto the API, so its form is the browser column.

| Rule | Browser (review form) | API | Database |
| --- | --- | --- | --- |
| Ratings are 1–5 | `required` radio inputs | request validation | `check` constraint |
| Body length 20–2000 | `minLength` / `maxLength` | request validation | `check` constraint |
| Lease term at most 40 characters | `required` only | request validation | `check` constraint |
| University email only | — | checked at sign-in | `check` constraint, anchored at both ends |
| One review per property | — | conflict check | partial `unique` index |
| Only the author edits a review | — | ownership check on every write | `author_id` comparison |

The browser layer is convenience. The API is the real guard. The database is the last line,
and the only one nothing can bypass.

## Migrations

```bash
npm run migrate:create add-something             # new SQL migration in server/migrations/
npm run db:migrate                               # apply
npm run db:rollback                              # revert the most recent
```

Migrations run in a single transaction by default, so a failure rolls back cleanly. Applied
migrations are tracked in the `pgmigrations` table.
