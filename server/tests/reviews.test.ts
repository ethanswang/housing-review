import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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
let signingKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
let keys: ReturnType<typeof localKeySource>

/** A property of our own, so these writes never disturb the seeded aggregates. */
let propertySlug: string
let propertyId: string

const VALID = {
  maintenance: 4,
  communication: 4,
  value: 5,
  overall: 4,
  body: 'Radiators are loud in winter but everything worked and the office answered the phone.',
  leaseTerm: '2024-25',
}

/** A signed-in person: their own token and id. */
async function signIn(): Promise<{ bearer: string; id: string }> {
  const id = crypto.randomUUID()
  const jwt = await new SignJWT({
    email: `writer-${id.slice(0, 8)}@test.illinois.edu`,
    role: 'authenticated',
  })
    .setProtectedHeader({ alg: 'ES256', kid: KID })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(id)
    .setExpirationTime('1h')
    .sign(signingKey)
  return { bearer: `Bearer ${jwt}`, id }
}

const post = (url: string, body: unknown, bearer?: string) =>
  app.inject({
    method: 'POST',
    url,
    payload: body as object,
    headers: bearer ? { authorization: bearer } : {},
  })

const patch = (url: string, body: unknown, bearer?: string) =>
  app.inject({
    method: 'PATCH',
    url,
    payload: body as object,
    headers: bearer ? { authorization: bearer } : {},
  })

const del = (url: string, bearer?: string) =>
  app.inject({ method: 'DELETE', url, headers: bearer ? { authorization: bearer } : {} })

const get = (url: string, bearer?: string) =>
  app.inject({ method: 'GET', url, headers: bearer ? { authorization: bearer } : {} })

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true })
  signingKey = pair.privateKey
  const jwk = await exportJWK(pair.publicKey)
  keys = localKeySource({ keys: [{ ...jwk, kid: KID, alg: 'ES256' }] })

  pool = createPool(DATABASE_URL)
  app = await buildApp({ config, db: pool, keys })
  await app.ready()

  propertySlug = `write-test-${crypto.randomUUID().slice(0, 8)}`
  const { rows } = await pool.query(
    `insert into properties (name, slug, address, neighborhood, rent_min, rent_max, bedrooms)
     values ('Write Test Property', $1, '1 Test St', 'Campustown', 800, 1200, '{1,2}')
     returning id`,
    [propertySlug]
  )
  propertyId = rows[0].id
})

afterAll(async () => {
  // Reviews cascade with the property, so nothing is left behind.
  await pool?.query('delete from properties where id = $1', [propertyId])
  await pool?.query("delete from users where email like '%test.illinois.edu'")
  await app?.close()
  await pool?.end()
})

afterEach(async () => {
  await pool.query('delete from reviews where property_id = $1', [propertyId])
})

describe('POST /api/properties/:slug/reviews', () => {
  it('refuses an anonymous submission', async () => {
    const response = await post(`/api/properties/${propertySlug}/reviews`, VALID)
    expect(response.statusCode).toBe(401)
  })

  it('creates a review for a signed-in user', async () => {
    const { bearer, id } = await signIn()
    const response = await post(`/api/properties/${propertySlug}/reviews`, VALID, bearer)
    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.authorId).toBe(id)
    expect(body.propertySlug).toBe(propertySlug)
    expect(body.status).toBe('published')
    expect(body.overall).toBe(4)
  })

  it('moves the property average immediately', async () => {
    const { bearer } = await signIn()
    const before = (await get(`/api/properties/${propertySlug}`)).json()
    expect(before.reviewCount).toBe(0)
    expect(before.averages.overall).toBeNull()

    await post(`/api/properties/${propertySlug}/reviews`, { ...VALID, overall: 5 }, bearer)

    const after = (await get(`/api/properties/${propertySlug}`)).json()
    expect(after.reviewCount).toBe(1)
    expect(after.averages.overall).toBe(5)
  })

  it('refuses a second review of the same property by the same person', async () => {
    const { bearer } = await signIn()
    await post(`/api/properties/${propertySlug}/reviews`, VALID, bearer)
    const second = await post(`/api/properties/${propertySlug}/reviews`, VALID, bearer)
    expect(second.statusCode).toBe(409)
    expect(second.json().error.code).toBe('already_reviewed')
  })

  it('allows two different people to review the same property', async () => {
    const first = await signIn()
    const second = await signIn()
    expect((await post(`/api/properties/${propertySlug}/reviews`, VALID, first.bearer)).statusCode).toBe(201)
    expect((await post(`/api/properties/${propertySlug}/reviews`, VALID, second.bearer)).statusCode).toBe(201)
  })

  it('returns 404 for a property that does not exist', async () => {
    const { bearer } = await signIn()
    const response = await post('/api/properties/no-such-building/reviews', VALID, bearer)
    expect(response.statusCode).toBe(404)
  })

  it('rejects a rating outside 1-5', async () => {
    const { bearer } = await signIn()
    const response = await post(
      `/api/properties/${propertySlug}/reviews`,
      { ...VALID, overall: 9 },
      bearer
    )
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation_failed')
  })

  it('rejects a body under 20 characters', async () => {
    const { bearer } = await signIn()
    const response = await post(
      `/api/properties/${propertySlug}/reviews`,
      { ...VALID, body: 'too short' },
      bearer
    )
    expect(response.statusCode).toBe(400)
  })

  it('rejects a missing rating rather than defaulting it', async () => {
    const { bearer } = await signIn()
    const withoutOverall: Record<string, unknown> = { ...VALID }
    delete withoutOverall.overall
    const response = await post(`/api/properties/${propertySlug}/reviews`, withoutOverall, bearer)
    expect(response.statusCode).toBe(400)
  })
})

describe('PATCH /api/reviews/:id — ownership', () => {
  it('lets an author change their own review', async () => {
    const { bearer } = await signIn()
    const created = (await post(`/api/properties/${propertySlug}/reviews`, VALID, bearer)).json()

    const response = await patch(
      `/api/reviews/${created.id}`,
      { ...VALID, overall: 2, body: 'Revised after a second winter here; the heating never got fixed.' },
      bearer
    )
    expect(response.statusCode).toBe(200)
    expect(response.json().overall).toBe(2)
  })

  it('refuses to let one person edit another person\'s review', async () => {
    const author = await signIn()
    const stranger = await signIn()
    const created = (await post(`/api/properties/${propertySlug}/reviews`, VALID, author.bearer)).json()

    const response = await patch(
      `/api/reviews/${created.id}`,
      { ...VALID, overall: 1, body: 'Sabotaging somebody else review text, long enough to pass.' },
      stranger.bearer
    )
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('forbidden')

    // And the review is untouched.
    const { rows } = await pool.query('select overall from reviews where id = $1', [created.id])
    expect(rows[0].overall).toBe(4)
  })

  it('refuses an anonymous edit', async () => {
    const { bearer } = await signIn()
    const created = (await post(`/api/properties/${propertySlug}/reviews`, VALID, bearer)).json()
    expect((await patch(`/api/reviews/${created.id}`, VALID)).statusCode).toBe(401)
  })

  it('refuses to edit an authorless seeded review', async () => {
    const { bearer } = await signIn()
    const { rows } = await pool.query(
      `insert into reviews (property_id, maintenance, communication, value, overall, body, lease_term, is_sample)
       values ($1, 4, 4, 4, 4, 'Seeded demonstration review text that is long enough.', '2023-24', true)
       returning id`,
      [propertyId]
    )
    const response = await patch(`/api/reviews/${rows[0].id}`, VALID, bearer)
    expect(response.statusCode).toBe(403)
  })

  it('changes only the fields sent', async () => {
    const { bearer } = await signIn()
    const created = (await post(`/api/properties/${propertySlug}/reviews`, VALID, bearer)).json()

    // PATCH means "change these": echoing back four untouched ratings to fix a
    // typo would make this a replacement wearing the wrong verb.
    const response = await patch(`/api/reviews/${created.id}`, { overall: 2 }, bearer)
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.overall).toBe(2)
    expect(body.maintenance).toBe(VALID.maintenance)
    expect(body.body).toBe(VALID.body)
  })

  it('rejects an empty patch rather than writing nothing', async () => {
    const { bearer } = await signIn()
    const created = (await post(`/api/properties/${propertySlug}/reviews`, VALID, bearer)).json()
    expect((await patch(`/api/reviews/${created.id}`, {}, bearer)).statusCode).toBe(400)
  })

  it('still validates the fields that are sent', async () => {
    const { bearer } = await signIn()
    const created = (await post(`/api/properties/${propertySlug}/reviews`, VALID, bearer)).json()
    expect((await patch(`/api/reviews/${created.id}`, { overall: 99 }, bearer)).statusCode).toBe(400)
  })

  it('returns 404 for a review that does not exist', async () => {
    const { bearer } = await signIn()
    const response = await patch(`/api/reviews/${crypto.randomUUID()}`, VALID, bearer)
    expect(response.statusCode).toBe(404)
  })

  it('rejects a malformed id before touching the database', async () => {
    const { bearer } = await signIn()
    expect((await patch('/api/reviews/not-a-uuid', VALID, bearer)).statusCode).toBe(400)
  })

  it('refuses to edit a review moderation has removed', async () => {
    const { bearer } = await signIn()
    const created = (await post(`/api/properties/${propertySlug}/reviews`, VALID, bearer)).json()
    await pool.query("update reviews set status = 'removed' where id = $1", [created.id])
    expect((await patch(`/api/reviews/${created.id}`, VALID, bearer)).statusCode).toBe(404)
  })
})

describe('DELETE /api/reviews/:id — ownership', () => {
  it('lets an author delete their own review, and it leaves every read path', async () => {
    const { bearer } = await signIn()
    const created = (await post(`/api/properties/${propertySlug}/reviews`, VALID, bearer)).json()
    const response = await del(`/api/reviews/${created.id}`, bearer)
    expect(response.statusCode).toBe(204)

    // A soft delete: the row survives as 'removed' so reports against it do,
    // but it is gone from the property page, the aggregates and /me/reviews.
    const { rows } = await pool.query('select status from reviews where id = $1', [created.id])
    expect(rows[0].status).toBe('removed')

    const property = (await get(`/api/properties/${propertySlug}`)).json()
    expect(property.reviewCount).toBe(0)
    expect(property.reviews.total).toBe(0)
    expect((await get('/api/me/reviews', bearer)).json()).toEqual([])
  })

  it('keeps reports filed against a review the author deletes', async () => {
    // Otherwise an author could erase the complaints along with the review,
    // before a moderator ever saw the queue.
    const author = await signIn()
    const reporter = await signIn()
    const created = (await post(`/api/properties/${propertySlug}/reviews`, VALID, author.bearer)).json()
    // The reporter needs a user row; signing in once creates it.
    await get('/api/me', reporter.bearer)
    await pool.query(
      `insert into review_reports (review_id, reporter_id, reason) values ($1, $2, 'spam')`,
      [created.id, reporter.id]
    )

    await del(`/api/reviews/${created.id}`, author.bearer)

    const { rows } = await pool.query(
      'select count(*)::int as n from review_reports where review_id = $1',
      [created.id]
    )
    expect(rows[0].n).toBe(1)
  })

  it('refuses to let one person delete another person\'s review', async () => {
    const author = await signIn()
    const stranger = await signIn()
    const created = (await post(`/api/properties/${propertySlug}/reviews`, VALID, author.bearer)).json()

    expect((await del(`/api/reviews/${created.id}`, stranger.bearer)).statusCode).toBe(403)

    const { rows } = await pool.query('select count(*)::int as n from reviews where id = $1', [
      created.id,
    ])
    expect(rows[0].n).toBe(1)
  })

  it('refuses an anonymous delete', async () => {
    const { bearer } = await signIn()
    const created = (await post(`/api/properties/${propertySlug}/reviews`, VALID, bearer)).json()
    expect((await del(`/api/reviews/${created.id}`)).statusCode).toBe(401)
  })

  it('lets an author review again after deleting', async () => {
    const { bearer } = await signIn()
    const created = (await post(`/api/properties/${propertySlug}/reviews`, VALID, bearer)).json()
    await del(`/api/reviews/${created.id}`, bearer)
    expect((await post(`/api/properties/${propertySlug}/reviews`, VALID, bearer)).statusCode).toBe(201)
  })

  it('drops the property average back when the only review goes', async () => {
    const { bearer } = await signIn()
    const created = (await post(`/api/properties/${propertySlug}/reviews`, VALID, bearer)).json()
    await del(`/api/reviews/${created.id}`, bearer)
    const after = (await get(`/api/properties/${propertySlug}`)).json()
    expect(after.reviewCount).toBe(0)
    expect(after.averages.overall).toBeNull()
  })
})

describe('GET /api/me/reviews', () => {
  it('refuses an anonymous request', async () => {
    expect((await get('/api/me/reviews')).statusCode).toBe(401)
  })

  it('returns only the caller\'s own reviews', async () => {
    const mine = await signIn()
    const theirs = await signIn()
    const created = (await post(`/api/properties/${propertySlug}/reviews`, VALID, mine.bearer)).json()
    await post(`/api/properties/${propertySlug}/reviews`, VALID, theirs.bearer)

    const response = await get('/api/me/reviews', mine.bearer)
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe(created.id)
  })

  it('is empty for someone who has not written one', async () => {
    const { bearer } = await signIn()
    expect((await get('/api/me/reviews', bearer)).json()).toEqual([])
  })
})
