# Contributing

Thanks for working on UIUC Housing Review. This covers how changes get made here; the
[README](README.md) covers running it, and [`docs/`](docs/) covers how each part works.

## Setup

Node 24 (`.nvmrc`; `nvm use` picks it up), Docker, and for the website a free
[Supabase](https://supabase.com) project. The README's *Running it locally* gets the site, the
API and its database going. Install with `npm ci`, not `npm install`, so the lockfile is not
rewritten.

## How a change gets in

1. **Branch from up-to-date `main`**, named for the area and the change:
   `web/…`, `api/…`, `infra/…`, `docs/…`, `deps/…`, `chore/…`.
   ```bash
   git fetch && git checkout -b web/studio-label origin/main
   ```
2. **Keep it small.** One change per pull request, so it can be reviewed and reverted on its
   own. A refactor and a behaviour change are two PRs.
3. **Commit messages** start with an imperative, sentence-case summary ("Fix studio filtering",
   not "fixed stuff"). The body says *why*: what was wrong or missing, and what the change does
   about it. `git log` has plenty of examples.
4. **Open a pull request** whose description has *Why*, *Changes* and *Verification*: what you
   ran or clicked to know it works, with results. "Tests pass" is a start; a before/after for
   the behaviour you changed is better.
5. **Review.** `main` is protected by rulesets:
   - all four CI checks must pass, for everyone;
   - a collaborator's pull request needs an approving review from the maintainer, the code
     owner for everything (`.github/CODEOWNERS`); another collaborator's approval does not
     count, and new commits after an approval need another. The maintainer's own pull requests
     bypass the review rule, though not the CI checks;
   - review comments must be resolved before merging.

   Merge with a merge commit, as the history does. Nobody can push to `main` directly or rewrite
   its history.
6. **Merging to `main` deploys the website** to production through Vercel, immediately. The API
   is deployed by hand by the maintainer ([INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md)), so an API
   change is live only after that.

## Running what CI runs

Run these before pushing; CI runs the same four jobs on every pull request.

```bash
# Website: lint, types, unit tests, build
npm run lint
npx tsc --noEmit
npm test
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder npx next build

# API: types and tests, against real Postgres (needs the compose database)
docker compose up -d --wait db
cd server && npm ci
npm run typecheck
npm run db:migrate && npm run db:seed
npm test
cd ..

# Container
docker build ./server

# Infrastructure (OpenTofu 1.12; CI pins 1.12.6)
cd infra && tofu fmt -check && tofu init -backend=false && tofu validate
```

The root `npm run lint` also lints `server/`, so an API-only change can still fail the website
job.

## Conventions

### Website (`app/`, `components/`, `lib/`)

- **This is Next.js 16**, which changed APIs and conventions; check the bundled docs in
  `node_modules/next/dist/docs/` rather than memory. In particular: `params` and `searchParams`
  are promises; an error page's recovery prop is `retry`; and a `loading.tsx` makes a page
  answer `200` even when it calls `notFound()`, which is why the directory's skeleton lives in
  the `app/(directory)/` route group and the detail pages have none.
- **All data access is in `lib/queries.ts`.** Pages and components never import the Supabase
  client.
- **Logic that can be a pure function goes in `lib/`, with a test** (`lib/*.test.ts`, run by
  `npm test`): filters, sorting, averages, search escaping, labels.
- **Filter state lives in the URL** (`lib/filters.ts` reads and writes it). `FilterRail.tsx`
  shows pending changes optimistically and settles the rent slider's pause; read its comments
  before changing it, and check fast clicks, Back and a slow network by hand.
- **Look and feel** comes from the tokens in `app/globals.css`, explained in
  [DESIGN.md](docs/DESIGN.md). Change the doc along with the design.
- The live site still reads Supabase directly; it moves onto the API later. Expect
  `lib/queries.ts` and the column names in `lib/types.ts` to change then.

### API (`server/`)

- **Routes validate, repositories query.** Routes parse input with the Zod helpers in
  `routes/query.ts` and throw the `AppError` helpers from `errors.ts`; anything else becomes a
  generic 500 so internals never reach a client. SQL lives only in `repositories/`, with every
  value a bound parameter; sort orders come from a fixed map, never from the request.
- **Authentication is opt-in per route** (`preHandler: app.requireAuth`). Writes also take the
  per-account limiter. See [API.md](docs/API.md).
- **Tests run against real Postgres**, not mocks, and each new route or rule gets one. A test
  that fails before your change and passes after is the most convincing kind.
- New endpoints go in [API-REFERENCE.md](docs/API-REFERENCE.md).

### Database migrations (`server/migrations/`)

- Create one with `cd server && npm run migrate:create <name>`; never hand-edit the schema
  elsewhere.
- **Never edit a migration that has run in production.** Write a new one.
- **The API connects as a restricted role.** A migration that adds a table or view the API
  reads, or a column it writes, must grant it to `api_access`, or the API gets a permission error;
  `tests/api-role.test.ts` exists to catch that. See
  [DATABASE.md](docs/DATABASE.md#who-connects-as-what).
- **Never apply these migrations to the Supabase project** the website signs in with
  ([DATABASE.md](docs/DATABASE.md#trust-model)).
- Production migrations run through `infra/migrate-db.sh` (dry run with `--dry-run` first).

### Infrastructure (`infra/`)

- Only the maintainer applies OpenTofu and holds AWS access; collaborators cannot deploy. A PR
  that changes `infra/` should say what `tofu plan` is expected to show, especially anything
  marked *must be replaced*.
- Secrets are generated by OpenTofu and live in Secrets Manager; nothing secret is ever
  committed, and `.env.local`, `*.tfvars` and state are gitignored.

## Security

Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes, not in an issue or a
pull request: this repository is public.

## Your contributions

This repository is public to read but not open source; see the README's
[License](README.md#license). By submitting a pull request you agree that your contribution may
be used, changed and distributed as part of this project by its maintainer, and that you have
the right to offer it.
