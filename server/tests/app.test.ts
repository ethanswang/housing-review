import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { createPool, type Database } from '../src/db.ts'
import { AppError, notFound } from '../src/errors.ts'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://housing:housing_dev@localhost:5433/housing'

const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL, LOG_LEVEL: 'silent' })

/** A database that always fails, for proving what does and does not touch it. */
const brokenDb = {
  query: () => Promise.reject(new Error('connection refused')),
} as unknown as Database

describe('configuration', () => {
  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/)
  })

  it('rejects a DATABASE_URL that is not a URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'not a url' })).toThrow(/valid connection URL/)
  })

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ DATABASE_URL, LOG_LEVEL: 'chatty' })).toThrow(/LOG_LEVEL/)
  })

  it('applies defaults for everything optional', () => {
    const parsed = loadConfig({ DATABASE_URL })
    expect(parsed.PORT).toBe(3001)
    expect(parsed.HOST).toBe('0.0.0.0')
    expect(parsed.NODE_ENV).toBe('development')
  })

  it('coerces PORT from a string, as environments always supply it', () => {
    expect(loadConfig({ DATABASE_URL, PORT: '8080' }).PORT).toBe(8080)
  })
})

describe('health endpoints', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = buildApp({ config, db: createPool(DATABASE_URL) })
    await app.ready()
  })
  afterAll(async () => { await app?.close() })

  it('reports liveness', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('reports readiness once the database answers', async () => {
    const response = await app.inject({ method: 'GET', url: '/readyz' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ready' })
  })
})

describe('health endpoints without a working database', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = buildApp({ config, db: brokenDb })
    await app.ready()
  })
  afterAll(async () => { await app?.close() })

  it('still reports liveness, so a database outage cannot trigger restarts', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' })
    expect(response.statusCode).toBe(200)
  })

  it('reports 503 for readiness, so the instance leaves the load balancer', async () => {
    const response = await app.inject({ method: 'GET', url: '/readyz' })
    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('service_unavailable')
  })
})

describe('error handling', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = buildApp({ config, db: brokenDb })
    app.get('/deliberate', async () => { throw notFound('No such property') })
    app.get('/bug', async () => { throw new Error('connection string postgres://user:secret@host/db') })
    app.get('/validated', {
      schema: { querystring: { type: 'object', required: ['page'], properties: { page: { type: 'integer' } } } },
    }, async () => ({ ok: true }))
    await app.ready()
  })
  afterAll(async () => { await app?.close() })

  it('returns the status and code carried by a deliberate error', async () => {
    const response = await app.inject({ method: 'GET', url: '/deliberate' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: { code: 'not_found', message: 'No such property' } })
  })

  it('never leaks internals from an unexpected error', async () => {
    const response = await app.inject({ method: 'GET', url: '/bug' })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: { code: 'internal_error', message: 'Something went wrong' } })
    expect(response.body).not.toContain('secret')
  })

  it('rejects a request failing schema validation with 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/validated' })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation_failed')
  })

  it('returns a structured 404 for an unknown route', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' })
    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('not_found')
  })

  it('carries a status code and code on every AppError helper', () => {
    expect(new AppError('x', 418, 'teapot').statusCode).toBe(418)
    expect(notFound().code).toBe('not_found')
  })
})

describe('framework-raised client errors', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = buildApp({ config, db: brokenDb })
    app.post('/echo', async (request) => request.body)
    await app.ready()
  })
  afterAll(async () => { await app?.close() })

  it('reports malformed JSON as a client error, not an internal one', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('bad_request')
  })

  it('reports an unsupported content type as a client error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/xml' },
      payload: '<x/>',
    })
    expect(response.statusCode).toBe(415)
    expect(response.json().error.code).toBe('bad_request')
  })
})
