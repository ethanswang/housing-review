import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'
import { createPool } from './db.ts'

const config = loadConfig()
const db = createPool(config.DATABASE_URL)
const app = buildApp({ config, db })

/**
 * Shut down in order: stop accepting connections, finish in-flight requests,
 * then close the pool. Without this, a deploy drops requests that were already
 * being served.
 */
async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down')
  try {
    await app.close()
    await db.end()
    process.exit(0)
  } catch (error) {
    app.log.error({ err: error }, 'shutdown failed')
    process.exit(1)
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => void shutdown(signal))
}

try {
  await app.listen({ host: config.HOST, port: config.PORT })
} catch (error) {
  app.log.error({ err: error }, 'failed to start')
  process.exit(1)
}
