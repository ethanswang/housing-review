# UIUC Housing Review

A free, student-run housing review site for the University of Illinois. Students rate
Champaign–Urbana apartments and management companies on **maintenance**, **communication**,
and **value**, and those ratings roll up into scores you can filter and compare.

**Live at [www.uiuchousing.com](https://www.uiuchousing.com)**

> **This is a prototype.** The reviews in it are synthetic sample data, clearly labeled in the
> UI, and the site is set to `noindex` so those ratings don't reach search results — the domain
> is reachable, but deliberately absent from search until the sample data is replaced. See
> [Sample data](#sample-data) below.

---

## Run it locally

**Prerequisites:** Node 20+ and a free [Supabase](https://supabase.com) account. No paid
services are used anywhere in this project.

```bash
git clone <this-repo>
cd housing-review-mvp
npm install
```

**1. Create the database**

Create a new project at [supabase.com/dashboard](https://supabase.com/dashboard) (free tier).
Then in **SQL Editor → New query**, run these two files in order:

- `supabase/schema.sql` — tables, constraints, and Row Level Security policies
- `supabase/seed.sql` — demo properties and sample reviews

**2. Set environment variables**

```bash
cp .env.example .env.local
```

Fill in both values from **Project Settings → API**:

| Variable | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` / `public` key |

The anon key is public by design — Row Level Security is what actually controls access. Only
server components read it, so it does not reach the browser bundle; keep it that way by
importing `lib/supabase.ts` from server code only. **Never** put the `service_role` key here;
it bypasses RLS.

**3. Start**

```bash
npm run dev     # http://localhost:3000
```

---

## How it works

One data path, no exceptions:

```
Browser
   ↓  filter and search state lives in the URL query string
Next.js server component  ·  or Server Action for writes
   ↓
lib/queries.ts            ← every database read and write is in this file
   ↓
Supabase JS client
   ↓
PostgreSQL
```

Components never import the Supabase client directly.

| File | Responsibility |
| --- | --- |
| `lib/queries.ts` | All database access. Averages are computed here. |
| `lib/filters.ts` | The only translation between URL query params and filter objects. |
| `lib/supabase.ts` | Client construction and env validation. |
| `app/actions.ts` | The one Server Action — review submission and validation. |
| `app/page.tsx` | Directory: search, filters, results. |

**Why filter state lives in the URL.** A filtered view is shareable, bookmarkable, and
survives back/forward. The filter rail is a client component that only writes to the URL;
the server page re-runs the query and returns new results.

**Validation happens three times, on purpose.** The browser (`required`, `minLength`) is a
convenience. The Server Action (`app/actions.ts`) is the real guard, because Server Actions
are reachable by direct POST. Postgres `CHECK` constraints are the last line.

**Why a new review appears immediately.** `submitReview` calls `revalidatePath` for the
property page and the directory after the insert, discarding their cached renders so the
next render recomputes the averages.

---

## What's built

- Property directory with search over name and address
- Filters: management company, area, max rent, bedrooms; sort by rating, price, or review count
- Property pages with per-category score breakdowns and full review lists
- Review submission with no account required
- Management-company pages with review-weighted rollup scores

### Sample data

Property and company names are real and public. **Addresses are block-level, rent figures
are illustrative placeholders, and company/property pairings have not been verified.**

**Every seeded review is synthetic.** No line of that text came from a tenant. Those rows
carry `is_sample = true` and render with a visible "Sample data" badge. Before any real
launch:

```sql
delete from reviews where is_sample;
```

Sample text is deliberately limited to mundane observations about response times,
communication, noise, and value. Nothing alleges illegal conduct and no individual employee
is named.

---

## Roadmap

Deliberately **not** in the MVP, in the order they'd matter:

**1. Verify that reviewers are students.** Magic-link email sign-in restricted to
`@illinois.edu` addresses. Reviews stay publicly anonymous, but each is tied to a verified
account, one review per person per property. This is the answer to "what stops a landlord
from astroturfing this?" — and the reason there is no half-working login page in the MVP.

**2. Moderation and takedown.** A report button, an admin queue, and a stated policy: no
naming individual employees, no allegations a reviewer can't speak to firsthand. A site
that names real landlords needs a real process for handling disputed reviews.

**3. Rate limiting.** Per-IP and per-account submission limits.

**4. Direct management-company reviews.** Company scores are currently derived from their
properties. But management experience isn't always property-specific — lease terms, deposit
handling, and billing are company-level concerns. These likely deserve first-class reviews
rather than a derived average.

**5. Coverage.** The seeded list is a sample, not a census. Real coverage means an import
of Champaign–Urbana rental registrations plus student submissions.

Known limitation: the Supabase free tier pauses a project after a period of inactivity.
Fine for a demo; something to handle before launch.

---

## Stack

**Frontend:** Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Vercel
**Backend:** Fastify · PostgreSQL · Docker — see [docs/DATABASE.md](docs/DATABASE.md)

**Domain:** `uiuchousing.com`, registered and served through Vercel DNS
(`ns1`/`ns2.vercel-dns.com`). The apex issues a 308 to `www.uiuchousing.com`, which is the
canonical host. `housing-review-mvp.vercel.app` still resolves and serves the same
deployment.

Managed services throughout, so this ships at zero cost and needs close to zero maintenance
during the school year. Infrastructure decisions get revisited when there's real usage to
justify them.
