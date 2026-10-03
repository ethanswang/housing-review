import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { SignJWT, errors, exportJWK, generateKeyPair } from 'jose'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { createPool, type Database } from '../src/db.ts'
import { bearerToken, localKeySource, verifyToken } from '../src/auth/verify.ts'
import { DATABASE_URL } from './helpers.ts'

/**
 * Tokens are signed here with a locally generated ES256 key pair, so these
 * tests verify real signatures and real claim checking without depending on
 * Supabase being reachable — and without anybody's real credentials.
 */
const ISSUER = 'https://project.supabase.co/auth/v1'
const AUDIENCE = 'authenticated'
const KID = 'test-key-1'

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL,
  LOG_LEVEL: 'silent',
  SUPABASE_URL: 'https://project.supabase.co',
  // Pinned high so these suites can never trip the limiter incidentally; the
  // limiter's own behaviour is tested in rate-limit.test.ts with tiny ceilings.
  RATE_LIMIT_MAX: '100000',
  RATE_LIMIT_WRITE_MAX: '100000',
})

let app: FastifyInstance
let pool: Database
// Derived from jose rather than named directly: the server tsconfig has no DOM
// lib, so there is no global CryptoKey type in scope.
type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey']

let signingKey: SigningKey
let keys: ReturnType<typeof localKeySource>
let otherKey: SigningKey

type TokenOptions = {
  sub?: string
  email?: string
  issuer?: string
  audience?: string
  expiresIn?: string
  key?: SigningKey
  omitEmail?: boolean
  omitSub?: boolean
  /** Authentication methods for `amr`; null leaves the claim out. Defaults to a one-time code. */
  methods?: string[] | null
  isAnonymous?: boolean
  userMetadata?: Record<string, unknown>
}

async function token(options: TokenOptions = {}): Promise<string> {
  const methods = options.methods === undefined ? ['otp'] : options.methods
  const jwt = new SignJWT({
    role: 'authenticated',
    ...(options.omitEmail ? {} : { email: options.email ?? testEmail('student') }),
    // Shaped as Supabase issues them: objects, not bare strings.
    ...(methods ? { amr: methods.map((method) => ({ method, timestamp: 1700000000 })) } : {}),
    is_anonymous: options.isAnonymous ?? false,
    ...(options.userMetadata ? { user_metadata: options.userMetadata } : {}),
  })
    .setProtectedHeader({ alg: 'ES256', kid: KID })
    .setIssuedAt()
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setExpirationTime(options.expiresIn ?? '1h')

  if (!options.omitSub) jwt.setSubject(options.sub ?? crypto.randomUUID())
  return jwt.sign(options.key ?? signingKey)
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true })
  signingKey = pair.privateKey
  const publicJwk = await exportJWK(pair.publicKey)
  keys = localKeySource({ keys: [{ ...publicJwk, kid: KID, alg: 'ES256' }] })

  // A second key that the issuer does not publish, for forged-token tests.
  otherKey = (await generateKeyPair('ES256', { extractable: true })).privateKey

  pool = createPool(DATABASE_URL)
  app = await buildApp({ config, db: pool, keys })
  await app.ready()
})

afterAll(async () => {
  await app?.close()
  await pool?.end()
})

/**
 * Every address is unique per run and ends in `test.illinois.edu`, so rows
 * cannot collide with a previous run's. The pattern has no `@` in it on
 * purpose: `grad@cs.test.illinois.edu` would not match `%@test.illinois.edu`,
 * which is how a leaked row from an earlier run caused a unique violation.
 * Seeded users (student@illinois.edu and friends) do not match this suffix.
 */
const testEmail = (local: string, subdomain = '') =>
  `${local}-${crypto.randomUUID().slice(0, 8)}@${subdomain}test.illinois.edu`

afterEach(async () => {
  await pool.query("delete from users where email like '%test.illinois.edu'")
})

const me = (bearer?: string) =>
  app.inject({
    method: 'GET',
    url: '/api/me',
    headers: bearer ? { authorization: bearer } : {},
  })

describe('bearerToken', () => {
  it('extracts a bearer token', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
  })

  it('is case-insensitive about the scheme', () => {
    expect(bearerToken('bearer abc')).toBe('abc')
  })

  it('ignores other schemes and empty values', () => {
    expect(bearerToken('Basic abc')).toBeNull()
    expect(bearerToken('Bearer ')).toBeNull()
    expect(bearerToken(undefined)).toBeNull()
  })
})

describe('token verification', () => {
  it('accepts a correctly signed token', async () => {
    const claims = await verifyToken(await token(), keys, {
      issuer: ISSUER,
      audience: AUDIENCE,
    })
    expect(claims.email).toMatch(/@test\.illinois\.edu$/)
    expect(claims.sub).toBeTruthy()
  })

  it('rejects a token signed by a key the issuer does not publish', async () => {
    await expect(
      verifyToken(await token({ key: otherKey }), keys, { issuer: ISSUER, audience: AUDIENCE })
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects an expired token, and says so', async () => {
    const expired = await token({ expiresIn: '-1h' })
    await expect(
      verifyToken(expired, keys, { issuer: ISSUER, audience: AUDIENCE })
    ).rejects.toMatchObject({ statusCode: 401, message: /expired/i })
  })

  it('rejects a token from another issuer', async () => {
    await expect(
      verifyToken(await token({ issuer: 'https://evil.example/auth/v1' }), keys, {
        issuer: ISSUER,
        audience: AUDIENCE,
      })
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects a token minted for a different audience', async () => {
    await expect(
      verifyToken(await token({ audience: 'some-other-service' }), keys, {
        issuer: ISSUER,
        audience: AUDIENCE,
      })
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects a token with no email claim', async () => {
    await expect(
      verifyToken(await token({ omitEmail: true }), keys, { issuer: ISSUER, audience: AUDIENCE })
    ).rejects.toMatchObject({ statusCode: 401, message: /email/i })
  })

  it('rejects garbage', async () => {
    await expect(
      verifyToken('not.a.token', keys, { issuer: ISSUER, audience: AUDIENCE })
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('reports an unreachable key set as unavailable, not as a bad token', async () => {
    const broken = (() => {
      throw new errors.JWKSTimeout()
    }) as unknown as typeof keys
    await expect(
      verifyToken(await token(), broken, { issuer: ISSUER, audience: AUDIENCE })
    ).rejects.toMatchObject({ statusCode: 503 })
  })
})

describe('GET /api/me', () => {
  it('refuses an anonymous request', async () => {
    const response = await me()
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('unauthorized')
  })

  it('refuses a malformed authorization header', async () => {
    expect((await me('Basic abc')).statusCode).toBe(401)
  })

  it('refuses a forged token', async () => {
    const response = await me(`Bearer ${await token({ key: otherKey })}`)
    expect(response.statusCode).toBe(401)
  })

  it('returns the user for a valid token', async () => {
    const sub = crypto.randomUUID()
    const email = testEmail('first')
    const response = await me(`Bearer ${await token({ sub, email })}`)
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.id).toBe(sub)
    expect(body.email).toBe(email)
    expect(body.role).toBe('student')
  })

  it('creates the user on first sight and reuses the row afterwards', async () => {
    const sub = crypto.randomUUID()
    const bearer = `Bearer ${await token({ sub, email: testEmail('repeat') })}`
    await me(bearer)
    await me(bearer)
    const { rows } = await pool.query('select count(*)::int as n from users where id = $1', [sub])
    expect(rows[0].n).toBe(1)
  })

  it('refreshes a changed email, since Supabase is the authority on it', async () => {
    const sub = crypto.randomUUID()
    const updated = testEmail('new')
    await me(`Bearer ${await token({ sub, email: testEmail('old') })}`)
    const response = await me(`Bearer ${await token({ sub, email: updated })}`)
    expect(response.json().email).toBe(updated)
  })

  it('never takes the role from the token', async () => {
    const sub = crypto.randomUUID()
    // A forged role claim must not escalate anyone; role lives only in the database.
    const forged = await new SignJWT({
      email: testEmail('sneaky'),
      role: 'admin',
      app_metadata: { role: 'admin' },
      // A legitimate sign-in method, so the only thing under test is the role.
      amr: [{ method: 'otp', timestamp: 1700000000 }],
    })
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(sub)
      .setExpirationTime('1h')
      .sign(signingKey)

    const response = await me(`Bearer ${forged}`)
    expect(response.statusCode).toBe(200)
    expect(response.json().role).toBe('student')
  })

  it('refuses a non-university address with 403, not 401', async () => {
    const response = await me(`Bearer ${await token({ email: 'someone@gmail.com' })}`)
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('forbidden')
  })

  it('accepts a department subdomain address', async () => {
    const response = await me(`Bearer ${await token({ email: testEmail('grad', 'cs.') })}`)
    expect(response.statusCode).toBe(200)
  })

  it('refuses an address that only ends with the university domain', async () => {
    const response = await me(`Bearer ${await token({ email: 'a@notillinois.edu' })}`)
    expect(response.statusCode).toBe(403)
  })
})

describe('failures that are ours, not the caller\'s', () => {
  const opts = { issuer: ISSUER, audience: AUDIENCE }

  it('reports a JWKS endpoint returning non-200 as unavailable', async () => {
    // jose raises a bare JOSEError for this, which looks like nothing in
    // particular — the case that made the original classification wrong.
    const failing = (() => {
      throw new errors.JOSEError('Expected 200 OK from the JSON Web Key Set HTTP response')
    }) as unknown as typeof keys
    await expect(verifyToken(await token(), failing, opts)).rejects.toMatchObject({
      statusCode: 503,
    })
  })

  it('reports a network failure reaching the key set as unavailable', async () => {
    // fetch's own TypeError, passed straight through by jose.
    const offline = (() => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof keys
    await expect(verifyToken(await token(), offline, opts)).rejects.toMatchObject({
      statusCode: 503,
    })
  })

  it('still blames the caller for a token signed by an unpublished key', async () => {
    await expect(verifyToken(await token({ key: otherKey }), keys, opts)).rejects.toMatchObject({
      statusCode: 401,
    })
  })
})

describe('claims that cannot become a user', () => {
  const opts = { issuer: ISSUER, audience: AUDIENCE }

  it('rejects a token with no subject', async () => {
    await expect(verifyToken(await token({ omitSub: true }), keys, opts)).rejects.toMatchObject({
      statusCode: 401,
      message: /subject/i,
    })
  })

  it('rejects a subject that is not a uuid, rather than failing in Postgres', async () => {
    await expect(
      verifyToken(await token({ sub: 'not-a-uuid' }), keys, opts)
    ).rejects.toMatchObject({ statusCode: 401, message: /identifier/i })
  })
})

describe('how the user signed in', () => {
  // The @illinois.edu rule only means something if the person controls that
  // inbox. A magic link or one-time code proves it; a password sign-up with
  // email confirmation off, an OAuth identity or an anonymous session does not.
  for (const method of ['otp', 'magiclink', 'email/signup']) {
    it(`accepts a session started with ${method}`, async () => {
      expect((await me(`Bearer ${await token({ methods: [method] })}`)).statusCode).toBe(200)
    })
  }

  it('accepts a password session that also proved the inbox', async () => {
    expect((await me(`Bearer ${await token({ methods: ['password', 'otp'] })}`)).statusCode).toBe(200)
  })

  it('refuses an anonymous session, whatever email it carries', async () => {
    const response = await me(`Bearer ${await token({ isAnonymous: true })}`)
    expect(response.statusCode).toBe(403)
  })

  for (const methods of [['password'], ['oauth'], ['sso/saml'], ['anonymous'], []]) {
    it(`refuses a session that never proved the inbox: [${methods}]`, async () => {
      const response = await me(`Bearer ${await token({ methods })}`)
      expect(response.statusCode).toBe(403)
      expect(response.json().error.message).toMatch(/code emailed/i)
    })
  }

  it('refuses a token with no authentication methods at all', async () => {
    expect((await me(`Bearer ${await token({ methods: null })}`)).statusCode).toBe(403)
  })

  it('ignores user_metadata.email_verified, which the user can set themselves', async () => {
    const response = await me(
      `Bearer ${await token({ methods: ['password'], userMetadata: { email_verified: true } })}`
    )
    expect(response.statusCode).toBe(403)
  })
})

describe('email already held by another account', () => {
  it('answers 409 rather than a 500 from the unique constraint', async () => {
    const shared = testEmail('shared')
    const first = await me(`Bearer ${await token({ sub: crypto.randomUUID(), email: shared })}`)
    expect(first.statusCode).toBe(200)

    // A second Supabase identity presenting the same address.
    const second = await me(`Bearer ${await token({ sub: crypto.randomUUID(), email: shared })}`)
    expect(second.statusCode).toBe(409)
    expect(second.json().error.code).toBe('email_taken')
  })
})

describe('repeat sign-ins', () => {
  it('does not rewrite the row when nothing changed', async () => {
    const sub = crypto.randomUUID()
    const bearer = `Bearer ${await token({ sub, email: testEmail('quiet') })}`
    await me(bearer)
    const before = await pool.query('select updated_at from users where id = $1', [sub])
    await me(bearer)
    await me(bearer)
    const after = await pool.query('select updated_at from users where id = $1', [sub])
    // The upsert only writes when the email differs, so updated_at stands still.
    expect(after.rows[0].updated_at.getTime()).toBe(before.rows[0].updated_at.getTime())
  })
})
