# Leaving AWS

The AWS stack runs on free-plan credits. When they run out, the plan ends rather than
billing, and the account is closed unless it is upgraded — taking the database, and every RDS
snapshot, with it. This is how to move off before that happens, with no application code
changes.

## The deadline

As of 2026-09-29: plan `FREE`, **$133.55** of credit left, plan expiry **2027-03-17**. At
roughly $25–30 a month (see [INFRASTRUCTURE.md](INFRASTRUCTURE.md#cost)) the credit runs out
first, around **February 2027**. Check the current figures with:

```bash
aws freetier get-account-plan-state --region us-east-1
```

Confirm in the Billing console what happens at the end of the plan, including any grace
period, rather than relying on this document.

## What moves and what doesn't

| Piece | AWS-specific? | On the new host |
| --- | --- | --- |
| API (`server/`, a Docker image) | No — configured only through environment variables | Any Docker host |
| Schema and data | No — plain Postgres 17; `pg_trgm` and `citext` are standard extensions | Any Postgres 17, via `pg_dump` / `pg_restore` |
| Frontend (Vercel), sign-in (Supabase Auth) | Never on AWS | Unchanged |
| TLS (Caddy on the instance) | Host setup | Provided by the platform |
| Secrets Manager, CloudWatch, SNS, ECR, `infra/` | Yes, operations only | The platform's env vars, logs, alerts and build |

Nothing in `server/src` imports an AWS SDK or reads an AWS-only setting. Keep it that way.

## 1. Export the data

```bash
infra/export-db.sh
```

Opens a Session Manager tunnel through the API instance (the database has no public address),
runs `pg_dump` from a `postgres:17` container, and writes `backups/housing-<timestamp>.dump`.
It prints row counts for the main tables, to check the restore against.

- Needs `aws` (signed in), `session-manager-plugin`
  (`brew install --cask session-manager-plugin`), `docker`, `jq` and `tofu`.
- `backups/` is gitignored and the file is `chmod 600`: **it contains users' email
  addresses.** Keep it off shared drives.
- TLS is verified against Amazon's RDS roots, hostname included (`verify-full`): the container
  maps the RDS hostname to the tunnel and connects by that name.

**This dump is the real backup.** RDS snapshots, including the final snapshot taken on
deletion, live inside the account and are lost with it. Take one after any batch of real
reviews, not only at the move.

## 2. Choose where to go

Checked 2026-09-29. Free tiers change without notice — re-check before relying on one.

- **Database: [Neon](https://neon.com/faqs/free-plan-limits-and-quotas).** 0.5 GB storage and
  100 CU-hours a month per project, scaling to zero after 5 minutes idle. Over the storage
  limit, writes fail; it does not bill. 0.5 GB is far more than this dataset needs.
- **API: [Render](https://render.com/docs/free).** Deploys the existing Dockerfile. Free
  services spin down after 15 minutes without traffic and take about a minute to wake, so the
  first visitor after a quiet spell waits. 750 instance hours a month; bandwidth was cut to
  5 GB a month in April 2026.
- **Avoid Oracle Cloud's Always Free VM** despite being the closest match to the current setup.
  Oracle [reclaims](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
  an instance whose CPU, network and memory all sit under 20% for seven days — which describes
  a quiet student site — and [halved the allowance](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)
  in June 2026 without announcing it.
- **Do not restore into the Supabase project used for sign-in.** Its `public` schema is
  published through PostgREST to anyone holding the anon key; see
  [DATABASE.md](DATABASE.md#trust-model).

## 3. Restore

Create an empty Postgres 17 database on the new host, then:

```bash
export NEW_DATABASE_URL='postgres://…?sslmode=verify-full'
docker run --rm -e NEW_DATABASE_URL -v "$PWD/backups:/in:ro" postgres:17-alpine \
  sh -c 'pg_restore --no-owner --no-acl --exit-on-error --dbname "$NEW_DATABASE_URL" /in/<file>.dump'
```

`--no-owner --no-acl` because the new host's role is not named `housing`. The dump includes the
`pgmigrations` table, so `npm run db:migrate` picks up where it left off. Compare the row
counts from step 1:

```bash
docker run --rm -e NEW_DATABASE_URL postgres:17-alpine psql "$NEW_DATABASE_URL" -c \
  "select (select count(*) from reviews) as reviews, (select count(*) from users) as users"
```

Then set `random_page_cost = 1.1` on the new database, or search stops using its trigram
indexes ([DATABASE.md](DATABASE.md#random_page_cost-is-load-bearing)):

```sql
alter database <name> set random_page_cost = 1.1;
```

## 4. Run the API there

Build for the host's architecture. The EC2 instance is arm64; most platforms are x86:

```bash
docker buildx build --platform linux/amd64 ./server
```

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The new database, with `sslmode=verify-full`. Hosted providers use publicly trusted certificates, so no `sslrootcert` is needed — unlike RDS. |
| `SUPABASE_URL` | Unchanged |
| `FRONTEND_SECRET` | Unchanged, or rotate it here and on Vercel together |
| `NODE_ENV` | `production` |
| `PORT` | Whatever the platform injects; the API reads it |
| `TRUST_PROXY_HOPS` | **Check the platform's docs.** It must equal the number of proxies in front of the service. Too high lets any client forge its address and escape the per-IP rate limit. |

Check `https://<new-host>/readyz` returns `{"status":"ready"}` before moving traffic.

## 5. Switch over

1. Take a final export (step 1) and restore it (step 3). Reviews written after the export are
   lost, so do this at a quiet hour.
2. Point `api.uiuchousing.com` at the new host in Vercel DNS, replacing the A record for the
   elastic IP. The frontend's API URL does not change.
3. Watch the new host's logs and `/readyz` for a day before tearing anything down.

## 6. Tear down AWS

Deletion protection is on, so this takes two deliberate applies:

```bash
# infra/database.tf: deletion_protection = false
tofu -chdir=infra apply      # only that change
tofu -chdir=infra destroy
```

The destroy leaves the `uiuc-housing-final` snapshot behind, inside the account. The exported
dump from step 1 is the copy that outlives it.
