# Node 24 runs TypeScript directly through type stripping, so this image has no
# build stage and no compiled output that could drift from the source. Types are
# enforced separately by `npm run typecheck`, which the CI workflow runs on
# every pull request and every push to main.
# Pinned by digest. `node:24-alpine` moves whenever the upstream image is
# rebuilt, so a tag alone cannot give a reproducible build. The tag stays in the
# reference so an update (by hand, or a Dependabot security fix) follows the
# 24-alpine line rather than `latest`.
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80

ENV NODE_ENV=production
WORKDIR /app

# Manifests first: this layer stays cached unless dependencies actually change,
# so a code-only change rebuilds in seconds rather than reinstalling.
COPY package.json package-lock.json ./
# --ignore-scripts: dependency lifecycle scripts run arbitrary code at build
# time, and none of pg, fastify or zod need them.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY src ./src

# node:24-alpine ships an unprivileged `node` user. Running as root inside a
# container is a needless privilege: a process escape starts as root on the host
# namespace it shares.
USER node

EXPOSE 3001

# Liveness only. /healthz never touches the database on purpose, so a database
# outage cannot make Docker mark healthy containers unhealthy and restart them.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const port = process.env.PORT || 3001; fetch('http://127.0.0.1:' + port + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.ts"]
