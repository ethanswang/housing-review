import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'
import { createPool } from './db.ts'

const config = loadConfig()
const db = createPool(config.DATABASE_URL)
const app = await buildApp({ config, db })

/**
 * Shut down in order: stop accepting connections, finish in-flight requests,
 * then close the pool. Without this, a deploy drops requests that were already
 * being served.
 */
let shuttingDown = false

async function shutdown(signal: string) {
  // A second signal (Ctrl-C twice, or SIGTERM followed by SIGINT) would
  // otherwise close an already-closing instance and exit(1), dropping the
  // in-flight requests this ordered shutdown exists to protect.
  if (shuttingDown) {
    app.log.warn({ signal }, 'shutdown already in progress')
    return
  }
  shuttingDown = true

  // One long-lived request must not keep the process alive until SIGKILL.
  const deadline = setTimeout(() => {
    app.log.error('shutdown timed out; forcing exit')
    process.exit(1)
  }, 10_000)
  deadline.unref()

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
