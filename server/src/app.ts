import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import type { Config } from './config.ts'
import type { Database } from './db.ts'
import { AppError } from './errors.ts'
import { healthRoutes } from './routes/health.ts'

export type AppDependencies = {
  config: Config
  db: Database
}

/**
 * Builds the server without starting it, so tests can drive it through
 * `app.inject()` with no ports, no sockets, and no cleanup.
 */
export function buildApp({ config, db }: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Never log credentials or bearer tokens, in any environment.
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    // Trust the proxy in front of the container so client IPs and protocol are
    // taken from X-Forwarded-*, which rate limiting and logging depend on.
    trustProxy: config.NODE_ENV === 'production',
  })

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: 'not_found', message: `Route ${request.method} ${request.url} not found` },
    })
  })

  /**
   * One place decides what the client sees. Deliberate errors keep their
   * message; anything else is a bug and is reported generically, because
   * Fastify forwards `message` verbatim and would otherwise leak internals
   * such as SQL text or connection strings.
   */
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      request.log.info({ code: error.code, statusCode: error.statusCode }, 'request rejected')
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: error.message } })
    }

    if (error.validation) {
      return reply.status(400).send({
        error: { code: 'validation_failed', message: error.message },
      })
    }

    // Fastify raises its own 4xx errors (unsupported media type, malformed
    // JSON). Those are the client's fault, not a bug, so they keep their status
    // and say so, rather than being labelled an internal error.
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      request.log.info({ err: error, statusCode: error.statusCode }, 'request rejected')
      return reply
        .status(error.statusCode)
        .send({ error: { code: 'bad_request', message: error.message } })
    }

    request.log.error({ err: error }, 'unhandled error')
    return reply.status(500).send({
      error: { code: 'internal_error', message: 'Something went wrong' },
    })
  })

  app.register(healthRoutes, { db })

  return app
}
