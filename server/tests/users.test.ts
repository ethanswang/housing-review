import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPool, type Database } from '../src/db.ts'
import { upsertUser } from '../src/repositories/users.ts'
import { DATABASE_URL } from './helpers.ts'

let pool: Database

beforeAll(() => { pool = createPool(DATABASE_URL) })
afterAll(async () => {
  await pool?.query("delete from users where email like 'race-%@test.illinois.edu'")
  await pool?.end()
})

describe('upsertUser', () => {
  it('returns the user to every one of several simultaneous first sign-ins', async () => {
    // A new user's first page load can send several authenticated requests at
    // once, each creating the row. All of them must get the user back, not a
    // conflict. Repeated, because a race can pass by luck once.
    for (let i = 0; i < 10; i++) {
      const sub = crypto.randomUUID()
      const claims = { sub, email: `race-${sub.slice(0, 8)}@test.illinois.edu` }
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => upsertUser(pool, claims)))
      const failures = results.filter((r) => r.status === 'rejected')
      expect(failures.map((f) => (f as PromiseRejectedResult).reason?.code)).toEqual([])
      for (const r of results) expect((r as PromiseFulfilledResult<{ id: string }>).value.id).toBe(sub)
    }
  })

  it('refuses an email change to an address another account holds', async () => {
    // The row for this id exists, so reading it back after the collision must
    // not be mistaken for the simultaneous-sign-in case and return stale data.
    const holder = { sub: crypto.randomUUID(), email: `race-holder-${Date.now()}@test.illinois.edu` }
    const mover = { sub: crypto.randomUUID(), email: `race-mover-${Date.now()}@test.illinois.edu` }
    await upsertUser(pool, holder)
    await upsertUser(pool, mover)

    await expect(upsertUser(pool, { ...mover, email: holder.email.toUpperCase() })).rejects.toMatchObject({
      code: 'email_taken',
    })
    const { rows } = await pool.query('select email from users where id = $1', [mover.sub])
    expect(rows[0].email).toBe(mover.email)
  })
})
