import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { createPool, type Database } from '../src/db.ts'
import { localKeySource } from '../src/auth/verify.ts'
import { DATABASE_URL } from './helpers.ts'

const ISSUER = 'https://project.supabase.co/auth/v1'
const AUDIENCE = 'authenticated'
const KID = 'test-key-1'

/**
 * Two apps, because the two ceilings cannot be exercised in one. Every request
 * here originates from the same address, so an app tight enough to demonstrate
 * the per-IP limit would exhaust that limit and mask everything tested after
 * it — which is exactly what the first version of this file did.
 */
const base = {
  NODE_ENV: 'test',
  DATABASE_URL,
  LOG_LEVEL: 'silent',
  SUPABASE_URL: 'https://project.supabase.co',
}

/** Tight per-IP ceiling, writes effectively unlimited. */
const globalConfig = loadConfig({
  ...base,
  RATE_LIMIT_MAX: '3',
  RATE_LIMIT_WINDOW: '1 minute',
  RATE_LIMIT_WRITE_MAX: '100000',
})

/** Per-IP ceiling out of the way, so only the per-account write limit can fire. */
const writeConfig = loadConfig({
  ...base,
  RATE_LIMIT_MAX: '100000',
  RATE_LIMIT_WRITE_MAX: '1',
  RATE_LIMIT_WRITE_WINDOW: '1 hour',
})

let globalApp: FastifyInstance
let writeApp: FastifyInstance
let pool: Database
let signingKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
let propertySlug: string
let propertyId: string

async function signIn(): Promise<string> {
  const id = crypto.randomUUID()
  const jwt = await new SignJWT({ email: `rl-${id.slice(0, 8)}@test.illinois.edu` })
    .setProtectedHeader({ alg: 'ES256', kid: KID })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(id)
    .setExpirationTime('1h')
    .sign(signingKey)
  return `Bearer ${jwt}`
}

const REVIEW = {
  maintenance: 4,
  communication: 4,
  value: 4,
  overall: 4,
  body: 'A perfectly ordinary review body, long enough to satisfy the constraint.',
  leaseTerm: '2024-25',
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true })
  signingKey = pair.privateKey
  const jwk = await exportJWK(pair.publicKey)

  const keys = localKeySource({ keys: [{ ...jwk, kid: KID, alg: 'ES256' }] })
  pool = createPool(DATABASE_URL)
  globalApp = await buildApp({ config: globalConfig, db: pool, keys })
  writeApp = await buildApp({ config: writeConfig, db: pool, keys })
  await globalApp.ready()
  await writeApp.ready()

  propertySlug = `rl-test-${crypto.randomUUID().slice(0, 8)}`
  const { rows } = await pool.query(
    `insert into properties (name, slug, address, neighborhood, rent_min, rent_max, bedrooms)
     values ('Rate Limit Property', $1, '2 Test St', 'Campustown', 800, 1200, '{1,2}')
     returning id`,
    [propertySlug]
  )
  propertyId = rows[0].id
})

afterAll(async () => {
  await pool?.query('delete from properties where id = $1', [propertyId])
  await pool?.query("delete from users where email like '%test.illinois.edu'")
  await globalApp?.close()
  await writeApp?.close()
  await pool?.end()
})

describe('global per-IP limit', () => {
  const app = () => globalApp
  it('rejects once the ceiling is passed, in the API error shape', async () => {
    const url = `/api/properties/${propertySlug}`
    for (let i = 0; i < 3; i++) {
      expect((await app().inject({ method: 'GET', url })).statusCode).toBe(200)
    }
    const blocked = await app().inject({ method: 'GET', url })
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().error.code).toBe('rate_limited')
    // The message has to survive too. The plugin throws whatever its builder
    // returns, so a plain object arrives with no top-level `message` and the
    // client gets a 429 that says nothing.
    expect(blocked.json().error.message).toMatch(/too many requests/i)
    // Tells a client when to come back, rather than leaving it to guess.
    expect(blocked.headers['retry-after']).toBeDefined()
  })

  it('exempts a health probe that carries a query string', async () => {
    // request.url includes the query, so an exact-equality allowList would
    // throttle any probe appending a cache-buster — during exactly the traffic
    // spike the exemption exists for.
    for (const url of ['/healthz?probe=1', '/readyz?ts=12345']) {
      expect((await app().inject({ method: 'GET', url })).statusCode).toBe(200)
    }
  })

  it('never throttles the health endpoints', async () => {
    // These decide whether an orchestrator kills the container; throttling them
    // would turn a traffic spike into a restart loop.
    for (let i = 0; i < 10; i++) {
      expect((await app().inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200)
      expect((await app().inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(200)
    }
  })
})

describe('per-account write limit', () => {
  const app = () => writeApp
  it('stops one account after its ceiling, and the review is not written', async () => {
    const bearer = await signIn()
    const first = await app().inject({
      method: 'POST',
      url: `/api/properties/${propertySlug}/reviews`,
      payload: REVIEW,
      headers: { authorization: bearer },
    })
    expect(first.statusCode).toBe(201)

    const second = await app().inject({
      method: 'POST',
      url: `/api/properties/${propertySlug}/reviews`,
      payload: REVIEW,
      headers: { authorization: bearer },
    })
    expect(second.statusCode).toBe(429)
    expect(second.json().error.code).toBe('rate_limited')

    const { rows } = await pool.query(
      'select count(*)::int as n from reviews where property_id = $1',
      [propertyId]
    )
    expect(rows[0].n).toBe(1)
  })

  it('is keyed to the account, so one person cannot exhaust another', async () => {
    // The point of limiting writes per user rather than per IP: a campus shares
    // a handful of NAT addresses, so an IP bucket would let one student lock
    // out everyone on the same network.
    const exhausted = await signIn()
    await app().inject({
      method: 'POST',
      url: `/api/properties/${propertySlug}/reviews`,
      payload: REVIEW,
      headers: { authorization: exhausted },
    })
    const blocked = await app().inject({
      method: 'POST',
      url: `/api/properties/${propertySlug}/reviews`,
      payload: REVIEW,
      headers: { authorization: exhausted },
    })
    expect(blocked.statusCode).toBe(429)

    // A different account, same address, still writes.
    const other = await signIn()
    const allowed = await app().inject({
      method: 'POST',
      url: `/api/properties/${propertySlug}/reviews`,
      payload: REVIEW,
      headers: { authorization: other },
    })
    expect(allowed.statusCode).toBe(201)
  })

  it('does not charge the budget for a rejected write', async () => {
    // Counting in the preHandler would spend the budget on attempts that never
    // wrote anything, so someone fighting a validation error would be locked
    // out for the window having published nothing at all.
    const bearer = await signIn()
    for (let i = 0; i < 3; i++) {
      const rejected = await app().inject({
        method: 'POST',
        url: `/api/properties/${propertySlug}/reviews`,
        payload: { ...REVIEW, overall: 99 },
        headers: { authorization: bearer },
      })
      expect(rejected.statusCode).toBe(400)
    }

    const accepted = await app().inject({
      method: 'POST',
      url: `/api/properties/${propertySlug}/reviews`,
      payload: REVIEW,
      headers: { authorization: bearer },
    })
    expect(accepted.statusCode).toBe(201)
  })

  it('still refuses an unauthenticated write with 401, not 429', async () => {
    const response = await app().inject({
      method: 'POST',
      url: `/api/properties/${propertySlug}/reviews`,
      payload: REVIEW,
    })
    expect(response.statusCode).toBe(401)
  })
})
