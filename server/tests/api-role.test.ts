import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { createPool, type Database } from '../src/db.ts'
import { localKeySource } from '../src/auth/verify.ts'
import { DATABASE_URL, insertCompany, insertProperty, insertReview, insertUser } from './helpers.ts'

/**
 * The API runs in production as a login that is a member of api_access (see
 * the api-access-role migration). These tests hold that role to two promises:
 * it can do everything the API does, and nothing it does not.
 */

const ISSUER = 'https://project.supabase.co/auth/v1'
const KID = 'role-test-key'
const LOGIN = 'api_role_test'
const PASSWORD = 'api-role-test-password'

let admin: Database
let asApi: Database
let app: FastifyInstance
let signingKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
let propertyId: string
let propertySlug: string
let companyId: string
let companySlug: string

async function bearer(): Promise<string> {
  const id = crypto.randomUUID()
  const jwt = await new SignJWT({
    email: `role-${id.slice(0, 8)}@test.illinois.edu`,
    amr: [{ method: 'otp', timestamp: 1700000000 }],
    is_anonymous: false,
  })
    .setProtectedHeader({ alg: 'ES256', kid: KID })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject(id)
    .setExpirationTime('1h')
    .sign(signingKey)
  return `Bearer ${jwt}`
}

beforeAll(async () => {
  admin = createPool(DATABASE_URL)
  // A login like the production one: no privileges of its own, only what it
  // inherits from api_access.
  await admin.query(`drop role if exists ${LOGIN}`)
  await admin.query(`create role ${LOGIN} login password '${PASSWORD}' in role api_access`)

  const url = new URL(DATABASE_URL)
  url.username = LOGIN
  url.password = PASSWORD
  asApi = createPool(url.toString())

  const pair = await generateKeyPair('ES256', { extractable: true })
  signingKey = pair.privateKey
  const jwk = await exportJWK(pair.publicKey)
  app = await buildApp({
    config: loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url.toString(),
      LOG_LEVEL: 'silent',
      SUPABASE_URL: 'https://project.supabase.co',
      RATE_LIMIT_MAX: '100000',
      RATE_LIMIT_WRITE_MAX: '100000',
    }),
    db: asApi,
    keys: localKeySource({ keys: [{ ...jwk, kid: KID, alg: 'ES256' }] }),
  })
  await app.ready()

  // Properties are the importer's job, which runs as the master login.
  const client = await admin.connect()
  try {
    companyId = await insertCompany(client as unknown as pg.Client)
    propertyId = await insertProperty(client as unknown as pg.Client, companyId)
    const { rows } = await client.query(
      `select p.slug, c.slug as company_slug from properties p join management_companies c on c.id = p.company_id
       where p.id = $1`,
      [propertyId]
    )
    propertySlug = rows[0].slug
    companySlug = rows[0].company_slug
  } finally {
    client.release()
  }
})

afterAll(async () => {
  await app?.close()
  await asApi?.end()
  await admin?.query('delete from properties where id = $1', [propertyId])
  await admin?.query('delete from management_companies where id = $1', [companyId])
  await admin?.query("delete from users where email like 'role-%@test.illinois.edu'")
  await admin?.query(`drop role if exists ${LOGIN}`)
  await admin?.end()
})

describe('the API, connected as an api_access login', () => {
  it('really is the restricted login, not a superuser', async () => {
    const { rows } = await asApi.query(
      `select current_user, rolsuper, pg_has_role(current_user, 'api_access', 'member') as member
       from pg_roles where rolname = current_user`
    )
    expect(rows[0]).toEqual({ current_user: LOGIN, rolsuper: false, member: true })
  })

  it('serves every read', async () => {
    const urls = [
      '/api/properties',
      `/api/properties/${propertySlug}`,
      '/api/companies',
      `/api/companies/${companySlug}`,
      '/api/filters',
      // Page 2 of a filtered search returns no rows, so the total comes from
      // the separate count query, which joins management_companies.
      `/api/properties?q=Test&hood=Campustown&beds=1&maxRent=5000&company=${companySlug}&page=2`,
      '/readyz',
    ]
    for (const url of urls) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(200)
    }
  })

  it('completes every write a student can make', async () => {
    const author = await bearer()
    const headers = { authorization: author }
    expect((await app.inject({ method: 'GET', url: '/api/me', headers })).statusCode).toBe(200)

    const created = await app.inject({
      method: 'POST',
      url: `/api/properties/${propertySlug}/reviews`,
      headers,
      payload: {
        maintenance: 4, communication: 4, value: 4, overall: 4,
        body: 'Written through the restricted role, long enough to pass.', leaseTerm: '2024-25',
      },
    })
    expect(created.statusCode).toBe(201)
    const id = created.json().id

    expect((await app.inject({ method: 'PATCH', url: `/api/reviews/${id}`, headers, payload: { overall: 2 } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/me/reviews', headers })).statusCode).toBe(200)

    const reporter = { authorization: await bearer() }
    const report = await app.inject({ method: 'POST', url: `/api/reviews/${id}/reports`, headers: reporter, payload: { reason: 'spam' } })
    expect(report.statusCode).toBe(201)

    expect((await app.inject({ method: 'DELETE', url: `/api/reviews/${id}`, headers })).statusCode).toBe(204)
  })
})

describe('what api_access cannot do', () => {
  /**
   * Runs `sql` as api_access in a transaction that is always rolled back.
   *
   * The role switch is asserted before the statement runs. A refusal test only
   * checks for 42501, and on Postgres 16+ a non-superuser test login could be
   * refused the SET ROLE itself with that same code, so without this a refusal
   * test could pass having never run its statement.
   */
  async function asRole(sql: string, params: unknown[] = []) {
    const client = await admin.connect()
    try {
      await client.query('begin')
      await client.query('set local role api_access')
      const { rows } = await client.query('select current_user')
      if (rows[0].current_user !== 'api_access') throw new Error(`expected api_access, got ${rows[0].current_user}`)
      return await client.query(sql, params)
    } finally {
      await client.query('rollback')
      client.release()
    }
  }
  const denied = { code: '42501' } // insufficient_privilege

  it('cannot make anyone a moderator or admin', async () => {
    await expect(asRole(`update users set role = 'admin'`)).rejects.toMatchObject(denied)
    await expect(
      asRole(`insert into users (id, email, role) values (gen_random_uuid(), 'x@illinois.edu', 'admin')`)
    ).rejects.toMatchObject(denied)
  })

  it('cannot label a review sample data or backdate it', async () => {
    await expect(asRole('update reviews set is_sample = true')).rejects.toMatchObject(denied)
    await expect(asRole(`update reviews set created_at = now() + interval '1 year'`)).rejects.toMatchObject(denied)
    for (const column of ['is_sample', 'status', 'created_at']) {
      const value = { is_sample: 'true', status: `'published'`, created_at: `now() + interval '1 year'` }[column]
      await expect(
        asRole(
          `insert into reviews (property_id, maintenance, communication, value, overall, body, lease_term, ${column})
           values ($1, 4, 4, 4, 4, 'A body long enough for the constraint.', '2024-25', ${value})`,
          [propertyId]
        ),
        column
      ).rejects.toMatchObject(denied)
    }
  })

  it('cannot change any review status directly, so cannot undo moderation', async () => {
    for (const status of ['published', 'hidden', 'removed']) {
      await expect(asRole(`update reviews set status = '${status}'`), status).rejects.toMatchObject(denied)
    }
  })

  it('cannot file a report already resolved', async () => {
    await expect(
      asRole(`insert into review_reports (review_id, reporter_id, reason, status) values (gen_random_uuid(), gen_random_uuid(), 'spam', 'dismissed')`)
    ).rejects.toMatchObject(denied)
    await expect(
      asRole(`insert into review_reports (review_id, reporter_id, reason, resolved_by) values (gen_random_uuid(), gen_random_uuid(), 'spam', gen_random_uuid())`)
    ).rejects.toMatchObject(denied)
  })

  it('cannot create temporary tables', async () => {
    await expect(asRole('create temporary table scratch (id int)')).rejects.toMatchObject(denied)
  })

  it('cannot delete rows', async () => {
    const client = await admin.connect()
    let reviewId: string
    try {
      reviewId = await insertReview(client as unknown as pg.Client, propertyId)
    } finally {
      client.release()
    }
    for (const table of ['reviews', 'users', 'review_reports', 'properties']) {
      await expect(asRole(`delete from ${table}`), table).rejects.toMatchObject(denied)
    }
    await admin.query('delete from reviews where id = $1', [reviewId!])
  })

  it('cannot resolve reports, which is a moderator action', async () => {
    await expect(asRole(`update review_reports set status = 'dismissed'`)).rejects.toMatchObject(denied)
  })

  it('cannot write properties or companies', async () => {
    await expect(asRole(`update properties set rent_min = 1`)).rejects.toMatchObject(denied)
    await expect(asRole(`insert into management_companies (name, slug) values ('x', 'x')`)).rejects.toMatchObject(denied)
  })

  it('cannot change the schema or read migration history', async () => {
    await expect(asRole('create table api_owned (id int)')).rejects.toMatchObject(denied)
    await expect(asRole('drop table reviews')).rejects.toMatchObject({ code: '42501' })
    await expect(asRole('select * from pgmigrations')).rejects.toMatchObject(denied)
  })
})

describe('withdraw_review', () => {
  /** A published review by a fresh author, created as the master login. */
  async function reviewBy(status = 'published') {
    const client = await admin.connect()
    try {
      const author = await insertUser(client as unknown as pg.Client, `role-${crypto.randomUUID().slice(0, 8)}@test.illinois.edu`)
      const id = await insertReview(client as unknown as pg.Client, propertyId, { author_id: author, status })
      return { id, author }
    } finally {
      client.release()
    }
  }
  const statusOf = async (id: string) => (await admin.query('select status from reviews where id = $1', [id])).rows[0].status

  it("withdraws its author's own published review", async () => {
    const { id, author } = await reviewBy()
    const { rows } = await asApi.query('select withdraw_review($1, $2) as withdrawn', [id, author])
    expect(rows[0].withdrawn).toBe(true)
    expect(await statusOf(id)).toBe('removed')
  })

  it("will not withdraw someone else's review", async () => {
    const { id } = await reviewBy()
    const { rows } = await asApi.query('select withdraw_review($1, $2) as withdrawn', [id, crypto.randomUUID()])
    expect(rows[0].withdrawn).toBe(false)
    expect(await statusOf(id)).toBe('published')
  })

  it('will not withdraw a review a moderator hid', async () => {
    const { id, author } = await reviewBy('hidden')
    const { rows } = await asApi.query('select withdraw_review($1, $2) as withdrawn', [id, author])
    expect(rows[0].withdrawn).toBe(false)
    expect(await statusOf(id)).toBe('hidden')
  })

  it('cannot be called by roles outside api_access', async () => {
    const client = await admin.connect()
    try {
      await client.query('begin')
      await client.query('create role role_test_outsider nologin')
      await client.query('set local role role_test_outsider')
      // As in asRole: prove the switch happened, so the refusal below is the
      // function's and not SET ROLE's.
      expect((await client.query('select current_user')).rows[0].current_user).toBe('role_test_outsider')
      await expect(client.query('select withdraw_review(gen_random_uuid(), gen_random_uuid())')).rejects.toMatchObject({
        code: '42501',
        message: expect.stringMatching(/function withdraw_review/),
      })
    } finally {
      await client.query('rollback')
      client.release()
    }
  })
})
