# Running the API

The API is a Fastify service in `server/`, and the only thing that touches its database. The
live website does not call it yet: it still reads Supabase directly, until the switch.

## Everything at once

```bash
docker compose up -d --wait        # Postgres and the API container, on 3001
cd server && npm ci                # migrations need node-pg-migrate, a dev dependency
npm run db:migrate && npm run db:seed
curl localhost:3001/api/properties
```

Migrations run from the host rather than from the container: the image deliberately excludes
`migrations/`, `seeds/` and `scripts/`, and installs without dev dependencies, so
`node-pg-migrate` is not in it.

The database must be migrated before the endpoints return anything useful. `/healthz` and
`/readyz` work regardless, which is the point of them.

## Just the database, API from source

Useful while developing, since it reloads:

```bash
docker compose up -d --wait db     # only the database
cd server
npm ci
npm run db:migrate && npm run db:seed
npm run dev                        # http://localhost:3001
npm test                           # needs the migrated, seeded database
```

If you started everything at once earlier, `docker compose stop api` first: the container
holds port 3001.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | **required** | The Supabase project URL, `https://` only. The JWKS URL and the expected token issuer are both derived from it. The service holds no Supabase secret — it only reads public keys — so a placeholder is fine until you sign in against a real project. |
| `SUPABASE_JWT_AUDIENCE` | `authenticated` | The `aud` claim every accepted token must carry. |
| `DATABASE_URL` | **required** | Connection string. Must be `postgres://` or `postgresql://`. There is no default: the service refuses to start without it. (The `db:*` npm scripts do default to the compose database, which is why they work with no setup.) |
| `PORT` | `3001` | Listen port. |
| `HOST` | `0.0.0.0` | Listen address. |
| `NODE_ENV` | `development` | `production` enables proxy trust. |
| `LOG_LEVEL` | `info` | pino level. |
| `RATE_LIMIT_MAX` | `600` | Requests per IP per window, across everything. Deliberately generous: a campus shares a few NAT addresses, so a tight ceiling would lock out a lecture hall rather than an attacker. |
| `RATE_LIMIT_WINDOW` | `1 minute` | Window for the per-IP limit. `"30 seconds"`, `"2 hours"`, or milliseconds. |
| `RATE_LIMIT_WRITE_MAX` | `20` | Writes per **account** per window — reviews and reports share one budget. This is the limit with teeth — an account needs a verified `illinois.edu` address. |
| `RATE_LIMIT_WRITE_WINDOW` | `1 hour` | Window for the per-account write limit. |
| `FRONTEND_SECRET` | unset | Shared with the Next.js server; at least 32 characters. See *Requests from the frontend server* below. Blank is treated as unset. |
| `TRUST_PROXY_HOPS` | `1` | Proxy hops to trust for `X-Forwarded-For`. Set to `0` wherever nothing proxies the service, as compose does — otherwise any client can forge `request.ip`. |

A bad environment fails at boot with the specific problem named, rather than surfacing later
as a connection error.

## The container

- **No build stage.** Node 24 runs TypeScript directly through type stripping, so there is no
  compiled output that can drift from source. `tsc --noEmit` enforces types in CI instead.
- **Runs as `node` (uid 1000)**, not root.
- **The base image is pinned by digest.** A tag such as `node:24-alpine` moves when upstream
  rebuilds, so the same Dockerfile would otherwise produce different images on different days.
  To update it: `docker pull node:24-alpine`, read the new digest with
  `docker image inspect node:24-alpine --format '{{index .RepoDigests 0}}'`, and commit the
  change, so a base image bump is reviewable rather than silent.
- **Dependencies install with `--ignore-scripts`**, since none of `pg`, `fastify` or `zod`
  need lifecycle scripts and those run arbitrary code at build time.
- **Dependencies install in their own layer**, so a code-only change rebuilds in seconds.
- **`HEALTHCHECK` calls `/healthz`, not `/readyz`.** Liveness must not depend on the database:
  if it did, a database blip would make Docker restart healthy containers, turning a
  recoverable outage into a crash loop. `/readyz` exists for load balancers, which should
  remove an instance without killing it.
- **Migrations are not in the image.** They are a deploy step, and shipping them would mean
  shipping `node-pg-migrate` and the rest of the dev dependencies into production.

## Health endpoints

| Endpoint | Meaning | Touches the database |
| --- | --- | --- |
| `GET /healthz` | The process is up | No |
| `GET /readyz` | This instance can serve traffic | Yes, bounded at 2s |

## Authentication

Supabase Auth issues ES256 tokens; this service verifies them against Supabase's published
public keys and holds no signing secret. Send one as `Authorization: Bearer <token>`.

Reads are public. `requireAuth` is applied per route rather than globally, so a route that
forgets it stays public — the safe direction here, since nothing readable was ever private.

| Response | Meaning |
| --- | --- |
| `401` | No token, a malformed one, a forged or expired one, or one from another issuer or audience |
| `403` | A valid token whose email is not an `illinois.edu` address, an anonymous session, or a session that never proved the inbox (below) |
| `409` | The email already belongs to another account |
| `503` | Supabase's key set is unreachable — deliberately **not** 401, so an outage does not read as "sign in again" |

`GET /api/me` returns the caller and is the quickest way to check sign-in end to end.

### Proving the address

An `@illinois.edu` address in a token means nothing unless the person controls that inbox.
Supabase's access token has no email-verified claim, and `user_metadata.email_verified` is
[editable by the user](https://supabase.com/docs/guides/auth/managing-user-data), so the API
checks how the session was authenticated instead. It requires:

- `is_anonymous` is not `true`, and
- `amr` contains at least one method that means "followed a link or typed a code sent to that
  inbox": `otp`, `magiclink`, `email/signup`, `email_change`, `invite` or `recovery`.

A session authenticated only by `password`, `oauth`, `sso/saml` or `anonymous` is refused with
403, even with a university address.

**Supabase Auth settings this relies on** (Dashboard → Authentication):

| Setting | Value | Why |
| --- | --- | --- |
| Email provider | On, with **Confirm email** on | Sign-ups must be confirmed through the inbox |
| Sign-in method used by the site | Magic link / one-time code | Produces `otp` or `magiclink` in `amr` |
| Anonymous sign-ins | Off | Not needed; refused by the API regardless |
| Other providers (Google, GitHub, …) | Off | Their sessions carry `oauth`, which the API refuses |

Not yet checked against a real token: what `amr` holds after a session is **refreshed**. Confirm
it when sign-in is wired up, since a refreshed token that lost its original method would be
refused here.

## Reporting a review

`POST /api/reviews/:id/reports` with `{ "reason": "...", "details": "..." }` files a report for
a moderator. `reason` is one of `spam`, `harassment`, `not_a_tenant`, `personal_info`, `other`;
`details` is optional, at most 1000 characters. Requires sign-in.

| Response | Meaning |
| --- | --- |
| `201` | Filed, with `status: "open"` |
| `404` | No published review with that id — hidden and removed reviews cannot be reported, since the reporter cannot see them |
| `409` `already_reported` | This account has already reported this review |

A report never hides a review by itself. If it did, a few accounts could take down any review
they disliked — and a landlord is the person with the most reason to try.

## Rate limiting

Two ceilings, because the two kinds of abuse look different.

**Reads are limited per IP**, generously, to stop crude flooding. `/healthz` and `/readyz` are
exempt: they decide whether an orchestrator kills the container, so throttling them would turn
a traffic spike into a restart loop.

**Writes are limited per account**, not per IP. A campus shares a handful of NAT addresses, so
an IP bucket would let one student exhaust the write budget for everyone on the same network.
The account is the identity that costs something to obtain, since it requires a verified
university address.

Both return `429` with `error.code = "rate_limited"` and a `Retry-After` header.

### Requests from the frontend server

Once the website reads through this API, the Next.js server will call it on behalf of every
visitor, from a handful of its own addresses. Keyed by those, every visitor would share one bucket, and one busy minute would
lock out the whole site. So a request carrying `x-frontend-secret` equal to `FRONTEND_SECRET`
may name the visitor in `x-client-ip`, and is limited under that address instead.

Without a matching secret the header is ignored; otherwise any client could claim a new
address per request and never be limited. A value that is not an IP address falls back to the
connecting address. The secret is compared in constant time and redacted from logs.

The per-account counter lives in the API process, so running N instances permits N times the
limit. That is acceptable for a single service and is the point at which a shared store (Redis,
or Postgres) becomes necessary.
