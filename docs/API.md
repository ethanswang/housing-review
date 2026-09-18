# Running the API

The API is a Fastify service in `server/`. It owns all database access; nothing else queries
Postgres directly.

## Everything at once

```bash
docker compose up -d --wait        # Postgres and the API
cd server && npm run db:migrate && npm run db:seed
curl localhost:3001/api/properties
```

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
| `DATABASE_URL` | compose database on port 5433 | Connection string. Must be `postgres://` or `postgresql://`; validated at boot. |
| `PORT` | `3001` | Listen port. |
| `HOST` | `0.0.0.0` | Listen address. |
| `NODE_ENV` | `development` | `production` enables proxy trust. |
| `LOG_LEVEL` | `info` | pino level. |
| `TRUST_PROXY_HOPS` | `1` | Proxy hops to trust for `X-Forwarded-For`. |

A bad environment fails at boot with the specific problem named, rather than surfacing later
as a connection error.

## The container

- **No build stage.** Node 24 runs TypeScript directly through type stripping, so there is no
  compiled output that can drift from source. `tsc --noEmit` enforces types in CI instead.
- **Runs as `node` (uid 1000)**, not root.
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
