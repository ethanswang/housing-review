# Node 24 runs TypeScript directly through type stripping, so this image has no
# build stage and no compiled output that could drift from the source. Types are
# still enforced, by `tsc --noEmit` in CI rather than at image build time.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Manifests first: this layer stays cached unless dependencies actually change,
# so a code-only change rebuilds in seconds rather than reinstalling.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# node:24-alpine ships an unprivileged `node` user. Running as root inside a
# container is a needless privilege: a process escape starts as root on the host
# namespace it shares.
USER node

EXPOSE 3001

# Liveness only. /healthz never touches the database on purpose, so a database
# outage cannot make Docker mark healthy containers unhealthy and restart them.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.ts"]
