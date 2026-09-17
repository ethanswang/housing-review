# Database

PostgreSQL 17. The schema lives in `server/migrations/` and is applied with
[node-pg-migrate](https://github.com/salsita/node-pg-migrate). Every change to the database
is a migration file in that directory — there is no hand-edited schema script, and nothing
drops a table that holds real data.

## Running it locally

```bash
docker compose up -d --wait      # Postgres 17 on localhost:5433
cd server
npm install
npm run db:migrate               # apply migrations
npm run db:seed                  # load development data
npm test                         # constraint and aggregate tests
```

`DATABASE_URL` overrides the connection string; it defaults to the compose database
(`postgres://housing:housing_dev@localhost:5433/housing`). Port 5433 is deliberate, so this
never collides with a Postgres already running on 5432.

To start over: `docker compose down -v && docker compose up -d --wait`.

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

- `reviews_one_per_author_property` is `unique (author_id, property_id)`. Postgres treats
  nulls as distinct, so this limits a real person to one review per property while still
  allowing several authorless legacy rows on the same property.
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
| `reviews_author_idx` | "My reviews", partial on `author_id is not null` so legacy rows are not indexed. |
| `review_reports_open_idx` | The moderation queue, partial on `status = 'open'` — the only rows it reads. |

## Aggregates

`property_stats` and `company_stats` compute review counts and per-category averages in
SQL. Application code does not average anything.

Both use `LEFT JOIN LATERAL` rather than `GROUP BY`. With a lateral join, conditions on
`properties` (search, area, rent, bedrooms) restrict the property scan *before* any review
row is read. A view that groups over the whole join cannot push those conditions below the
aggregate, so it would read every review on every request regardless of the filter.

Averages are rounded to one decimal place in SQL, and a property with no published reviews
returns `review_count = 0` with null averages — which is what the UI renders as "—".

The views are declared `security_invoker = true`, so if row-level security is enabled on
the base tables later, the caller's policies still apply rather than the view owner's.

## Where each rule is enforced

| Rule | Browser | API | Database |
| --- | --- | --- | --- |
| Ratings are 1–5 | `required` inputs | request validation | `check` constraint |
| Body length 20–2000 | `minLength` | request validation | `check` constraint |
| University email only | — | checked at sign-in | `check` constraint |
| One review per property | UI hides the form | ownership + conflict check | `unique` constraint |
| Only the author edits a review | UI hides controls | **authoritative check** | `author_id` comparison |

The browser layer is convenience. The API is the real guard. The database is the last line,
and the only one nothing can bypass.

## Migrations

```bash
npm run migrate create add-something -- -j sql   # new migration
npm run db:migrate                               # apply
npm run db:rollback                              # revert the most recent
```

Migrations run in a single transaction by default, so a failure rolls back cleanly. Applied
migrations are tracked in the `pgmigrations` table.
