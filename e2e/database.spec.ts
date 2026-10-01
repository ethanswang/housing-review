import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

/**
 * What the database itself refuses an anon-key caller, straight against the
 * stand-in's PostgREST, as anyone holding the key could call it. These pin
 * down supabase/schema.sql's row-level security and column grants, which the
 * site's own pages never exercise from the refusing side.
 */
const REST = 'http://localhost:54321/rest/v1'
const key = execFileSync('node', ['e2e/stack/anon-key.mjs']).toString()
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

async function someProperty(request: import('@playwright/test').APIRequestContext) {
  const response = await request.get(`${REST}/properties?select=id&limit=1`, { headers })
  return (await response.json())[0].id as string
}

const review = (propertyId: string) => ({
  property_id: propertyId,
  maintenance: 4,
  communication: 4,
  value: 4,
  overall: 4,
  body: 'A body long enough to satisfy the length check.',
  lease_term: '2024-25',
})

test('a request without an API key is refused at the gateway, as Supabase does', async ({ request }) => {
  const response = await request.get(`${REST}/properties?select=id`)
  expect(response.status()).toBe(401)
})

test('the anon key cannot backdate a review or label it sample data', async ({ request }) => {
  const propertyId = await someProperty(request)
  for (const extra of [{ created_at: '2099-01-01T00:00:00Z' }, { is_sample: true }, { id: crypto.randomUUID() }]) {
    const response = await request.post(`${REST}/reviews`, { headers, data: { ...review(propertyId), ...extra } })
    expect(response.ok(), JSON.stringify(extra)).toBe(false)
    expect((await response.json()).code, JSON.stringify(extra)).toBe('42501') // insufficient_privilege
  }
})

test('the anon key cannot store an oversized lease term', async ({ request }) => {
  const propertyId = await someProperty(request)
  const response = await request.post(`${REST}/reviews`, {
    headers,
    data: { ...review(propertyId), lease_term: 'x'.repeat(41) },
  })
  expect((await response.json()).code).toBe('23514') // check_violation
})

test('the anon key cannot edit or delete reviews', async ({ request }) => {
  const [target] = await (await request.get(`${REST}/reviews?select=id,body&limit=1`, { headers })).json()
  // Row-level security has no update or delete policy, so these match no rows.
  await request.patch(`${REST}/reviews?id=eq.${target.id}`, { headers, data: { body: 'Rewritten by an anonymous caller here.' } })
  await request.delete(`${REST}/reviews?id=eq.${target.id}`, { headers })
  const [after] = await (await request.get(`${REST}/reviews?select=id,body&id=eq.${target.id}`, { headers })).json()
  expect(after).toEqual(target)
})
