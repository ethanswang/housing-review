import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { createPool, type Database } from '../src/db.ts'
import { DATABASE_URL as SHARED_DATABASE_URL } from './helpers.ts'
import { AppError, notFound } from '../src/errors.ts'

const DATABASE_URL = SHARED_DATABASE_URL

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL,
  LOG_LEVEL: 'silent',
  SUPABASE_URL: 'https://project.supabase.co',
})

/** A database that always fails, for proving what does and does not touch it. */
const brokenDb = {
  query: () => Promise.reject(new Error('connection refused')),
  on: () => {},
} as unknown as Database

describe('configuration', () => {
  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadConfig({ SUPABASE_URL: 'https://p.supabase.co' })).toThrow(/DATABASE_URL/)
  })

  it('rejects a DATABASE_URL that is not a URL', () => {
    expect(() => loadConfig({ ...{ DATABASE_URL: 'not a url' }, SUPABASE_URL: 'https://p.supabase.co' })).toThrow(/postgres/)
  })

  it('rejects a connection string with no scheme', () => {
    expect(() => loadConfig({ ...{ DATABASE_URL: 'housing:pass@localhost:5433/housing' }, SUPABASE_URL: 'https://p.supabase.co' })).toThrow(/postgres/)
  })

  it('rejects a misspelled postgres scheme', () => {
    expect(() => loadConfig({ ...{ DATABASE_URL: 'postgress://user@localhost:5432/db' }, SUPABASE_URL: 'https://p.supabase.co' })).toThrow(/postgres/)
  })

  it('accepts both postgres:// and postgresql://', () => {
    expect(loadConfig({ DATABASE_URL: 'postgresql://u@h:5432/d', SUPABASE_URL: 'https://p.supabase.co' }).DATABASE_URL).toBeTruthy()
    expect(loadConfig({ DATABASE_URL: 'postgres://u@h:5432/d', SUPABASE_URL: 'https://p.supabase.co' }).DATABASE_URL).toBeTruthy()
  })

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ DATABASE_URL, LOG_LEVEL: 'chatty', SUPABASE_URL: 'https://p.supabase.co' })).toThrow(/LOG_LEVEL/)
  })

  it('applies defaults for everything optional', () => {
    const parsed = loadConfig({ DATABASE_URL, SUPABASE_URL: 'https://p.supabase.co' })
    expect(parsed.PORT).toBe(3001)
    expect(parsed.HOST).toBe('0.0.0.0')
    expect(parsed.NODE_ENV).toBe('development')
  })

  it('coerces PORT from a string, as environments always supply it', () => {
    expect(loadConfig({ DATABASE_URL, PORT: '8080', SUPABASE_URL: 'https://p.supabase.co' }).PORT).toBe(8080)
  })
})

describe('health endpoints', () => {
  let app: FastifyInstance
  let pool: Database

  beforeAll(async () => {
    pool = createPool(DATABASE_URL)
    app = buildApp({ config, db: pool })
    await app.ready()
  })
  afterAll(async () => {
    await app?.close()
    await pool?.end()
  })

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

  it('names the specific client error rather than flattening to bad_request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/xml' },
      payload: '<x/>',
    })
    expect(response.statusCode).toBe(415)
    expect(response.json().error.code).toBe('unsupported_media_type')
  })
})

describe('resilience', () => {
  it('survives an idle client error instead of crashing the process', async () => {
    const pool = createPool(DATABASE_URL)
    const app = buildApp({ config, db: pool })
    await app.ready()
    // pg.Pool emits this when an idle connection dies. With no listener,
    // EventEmitter throws and the process exits.
    expect(() => pool.emit('error', new Error('terminating connection'), {} as never)).not.toThrow()
    await app.close()
    await pool.end()
  })

  it('returns 503 rather than hanging when the database never answers', async () => {
    const wedged = { query: () => new Promise(() => {}), on: () => {} } as unknown as Database
    const app = buildApp({ config, db: wedged })
    await app.ready()
    const response = await app.inject({ method: 'GET', url: '/readyz' })
    expect(response.statusCode).toBe(503)
    await app.close()
  }, 10_000)
})
