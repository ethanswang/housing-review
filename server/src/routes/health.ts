import type { FastifyInstance } from 'fastify'
import type { Database } from '../db.ts'
import { serviceUnavailable } from '../errors.ts'

/**
 * Two endpoints, deliberately different:
 *
 *   /healthz  liveness  — is the process running? Never touches the database,
 *                         so a database blip cannot cause the orchestrator to
 *                         kill and restart otherwise-healthy containers.
 *   /readyz   readiness — can this instance actually serve traffic? Checks the
 *                         database, so a broken instance is removed from the
 *                         load balancer instead of returning errors.
 */
const READINESS_TIMEOUT_MS = 2_000

/**
 * connectionTimeoutMillis bounds acquiring a connection, not running a query.
 * A Postgres that accepts connections but is wedged would leave /readyz hanging
 * instead of reporting 503, keeping a useless instance in the load balancer.
 */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}

export async function healthRoutes(app: FastifyInstance, options: { db: Database }) {
  app.get('/healthz', async () => ({ status: 'ok' }))

  app.get('/readyz', async (request) => {
    try {
      await withTimeout(options.db.query('select 1'), READINESS_TIMEOUT_MS)
    } catch (error) {
      // request.log, not app.log: this line needs the reqId to correlate with
      // the 503 the client received.
      request.log.error({ err: error }, 'readiness check failed')
      throw serviceUnavailable('Database unreachable')
    }
    return { status: 'ready' }
  })
}
