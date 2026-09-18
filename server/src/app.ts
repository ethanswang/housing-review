import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import { auth } from './auth/plugin.ts'
import { type KeySource, remoteKeySource } from './auth/verify.ts'
import type { Config } from './config.ts'
import type { Database } from './db.ts'
import { AppError } from './errors.ts'
import { registerRateLimits } from './rate-limit.ts'
import { healthRoutes } from './routes/health.ts'
import { meRoutes } from './routes/me.ts'
import { companyRoutes } from './routes/companies.ts'
import { propertyRoutes } from './routes/properties.ts'
import { reviewRoutes } from './routes/reviews.ts'

/**
 * Framework-raised client errors carry a status but no code of ours. Flattening
 * the whole 4xx range to 'bad_request' would make the code field useless the
 * moment rate limiting or auth exists: a client could not tell throttling from
 * a malformed body.
 */
const CLIENT_ERROR_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  406: 'not_acceptable',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'unprocessable_entity',
  429: 'rate_limited',
}

export type AppDependencies = {
  config: Config
  db: Database
  /**
   * Injectable so tests can verify against a locally generated key pair rather
   * than reaching Supabase. Defaults to the real remote key set.
   */
  keys?: KeySource
}

/**
 * Builds the server without starting it, so tests can drive it through
 * `app.inject()` with no ports, no sockets, and no cleanup.
 */
export async function buildApp({ config, db, keys }: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Fastify's default request serializer logs no headers at all, so
      // nothing leaks today. These paths cover the shapes a future serializer
      // or an explicit request.log.info({ headers }) would produce.
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'headers.authorization',
        'headers.cookie',
        '*.authorization',
      ],
    },
    // Trust exactly the proxies in front of the container, by hop count.
    // `true` would accept X-Forwarded-For from any peer, letting a client
    // forge request.ip — a fresh rate-limit bucket per forged value.
    trustProxy:
      config.NODE_ENV === 'production'
        ? (_address: string, hop: number) => hop < config.TRUST_PROXY_HOPS
        : false,
  })

  /**
   * pg.Pool emits 'error' when an *idle* connection dies — a database restart,
   * a failover, an idle-connection reaper. EventEmitter throws on an unhandled
   * 'error', so without this the process exits. That would defeat the whole
   * liveness/readiness split below: the container would already be dead before
   * any probe was consulted. The pool itself recovers; it only needs someone
   * listening.
   */
  db.on('error', (error: Error) => {
    app.log.error({ err: error }, 'idle database client error')
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
      // A 4xx is the client's problem and belongs at info. A 5xx raised on
      // purpose — a failed readiness check, say — is still an outage, and must
      // not be buried at a level nobody watches.
      const details = { err: error, code: error.code, statusCode: error.statusCode }
      if (error.statusCode >= 500) request.log.error(details, 'request failed')
      else request.log.info(details, 'request rejected')

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
      return reply.status(error.statusCode).send({
        error: {
          code: CLIENT_ERROR_CODES[error.statusCode] ?? 'client_error',
          message: error.message,
        },
      })
    }

    request.log.error({ err: error }, 'unhandled error')
    return reply.status(500).send({
      error: { code: 'internal_error', message: 'Something went wrong' },
    })
  })

  await registerRateLimits(app, config)

  app.register(auth, {
    db,
    keys: keys ?? remoteKeySource(config.supabaseJwksUrl),
    verify: { issuer: config.supabaseIssuer, audience: config.SUPABASE_JWT_AUDIENCE },
  })

  app.register(healthRoutes, { db })
  app.register(meRoutes, { prefix: '/api' })
  app.register(propertyRoutes, { db, prefix: '/api' })
  app.register(companyRoutes, { db, prefix: '/api' })
  app.register(reviewRoutes, { db, config, prefix: '/api' })

  return app
}
