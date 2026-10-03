# UIUC Housing Review

Apartment reviews from University of Illinois students. Champaign–Urbana buildings and
management companies are rated on **maintenance**, **communication**, and **value**, and the
ratings roll up into scores you can search, filter, and compare.

Free, student-run, and not affiliated with the University of Illinois or any landlord.

**[www.uiuchousing.com](https://www.uiuchousing.com)**

> **Status: in development.** The reviews on the site today are sample data written to
> demonstrate it, and every one carries a "Sample data" badge. The site is kept out of search
> results until they are replaced by real reviews.

## How reviews work

- **Scores are averages of reviews, and nothing else.** Each review rates a building 1–5
  overall and on maintenance, communication, and value. A management company's score is the
  review-weighted average across its buildings.
- **Reviews are anonymous to readers.**
- **Reviewers will need an `@illinois.edu` address** to post, limited to one review per
  building. Sign-in is being built; it is what makes a review from a real student distinct
  from one written by a landlord.
- **Reviews will be reportable** for personal information, harassment, or not being from a
  tenant, arriving on the site with sign-in. A report queues the review for a person to look
  at; reports never remove a review automatically.

## Architecture

```
Browser
   │
Next.js on Vercel ─────────── Supabase Auth (issues sign-in tokens)
   │ HTTPS
Fastify API  (Docker on EC2, TLS by Caddy)
   │ TLS, private subnet
PostgreSQL 17  (RDS)
```

The website is moving from reading Supabase directly onto the API. The API, its database, and
the infrastructure are built and running; the site switches over once sign-in is in place.

| Path | What it is |
| --- | --- |
| `app/`, `components/`, `lib/` | The Next.js site. `lib/queries.ts` holds all data access. |
| `server/` | The API: routes, repositories, migrations, and tests against real Postgres. |
| `infra/` | OpenTofu for the AWS stack: network, EC2, RDS, alarms. |
| `supabase/` | The schema the live site still reads, until the switch. |
| `docs/` | Design and operations documentation, below. |

### Documentation

- [API](docs/API.md) — running it, configuration, authentication, rate limiting.
- [API reference](docs/API-REFERENCE.md) — every route, its parameters, responses and errors.
- [Database](docs/DATABASE.md) — schema, trust model, indexes with measured query plans,
  loading the property list.
- [Infrastructure](docs/INFRASTRUCTURE.md) — the AWS stack, costs, deploying, secrets.
- [Leaving AWS](docs/LEAVING-AWS.md) — exporting the data and moving to another host with no
  code changes.
- [Design](docs/DESIGN.md) — type, colour, the rating display, and page layouts.

## Running it locally

Needs Node 24, Docker, and a free [Supabase](https://supabase.com) project.

**The API and its database:**

```bash
docker compose up -d --wait db     # Postgres 17 on localhost:5433
cd server
npm ci
npm run db:migrate && npm run db:seed
npm run dev                        # http://localhost:3001
npm test                           # runs against the compose database
```

**The website** reads from the API above, so start that first. It still posts reviews to
Supabase until that moves to the API too:

1. In a Supabase project's SQL editor, run `supabase/schema.sql`, then `supabase/seed.sql`. To
   sign in, set the **Confirm signup** and **Magic Link** templates under **Authentication →
   Emails** to [`supabase/email-code.html`](supabase/email-code.html), which emails a code
   instead of a link.
2. `cp .env.example .env.local` and fill in the project URL and `anon` key from
   **Project Settings → API**. The anon key is public by design; never use the `service_role`
   key here. `API_URL` defaults to the local API.
3. `npm ci && npm run dev` — http://localhost:3000

`npm test` runs the site's unit tests (pure functions in `lib/`) and needs no Supabase project.
`npm run test:e2e` runs the browser tests against a local API and a stand-in for Supabase; see
[CONTRIBUTING.md](CONTRIBUTING.md#running-what-ci-runs).

## Sample data

Company and building names are real and public. Addresses are block-level, rents are
placeholders, and company–building pairings have not been verified. **Every seeded review is
synthetic**: none of its text came from a tenant. Sample text sticks to mundane observations
about repairs, communication, noise, and value, and names no individual.

## Contributing

Issues and pull requests are welcome; [CONTRIBUTING.md](CONTRIBUTING.md) covers the workflow,
running CI's checks locally, and the conventions. CI runs lint, type checks, the API test suite against
Postgres, a container build, and an infrastructure validation on every pull request.

To report a security vulnerability, see [SECURITY.md](SECURITY.md) rather than opening an
issue.

## License

Copyright © 2026 Ethan Wang. All rights reserved.

The source is public so that it can be read. No license is granted to copy, modify, or
redistribute it. GitHub's terms of service still allow viewing and forking it on GitHub.
