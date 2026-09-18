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
export async function healthRoutes(app: FastifyInstance, options: { db: Database }) {
  app.get('/healthz', async () => ({ status: 'ok' }))

  app.get('/readyz', async () => {
    try {
      await options.db.query('select 1')
    } catch (error) {
      app.log.error({ err: error }, 'readiness check failed')
      throw serviceUnavailable('Database unreachable')
    }
    return { status: 'ready' }
  })
}
