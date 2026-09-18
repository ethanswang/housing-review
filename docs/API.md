# Running the API

The API is a Fastify service in `server/`. It owns all database access; nothing else queries
Postgres directly.

## Everything at once

```bash
docker compose up -d --wait        # Postgres and the API
cd server && npm install           # migrations need node-pg-migrate, a dev dependency
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
docker compose up -d --wait db
cd server
npm install
npm run db:migrate && npm run db:seed
npm run dev                        # http://localhost:3001
```

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
| `403` | A valid token whose email is not an `illinois.edu` address |
| `409` | The email already belongs to another account |
| `503` | Supabase's key set is unreachable — deliberately **not** 401, so an outage does not read as "sign in again" |

`GET /api/me` returns the caller and is the quickest way to check sign-in end to end.
