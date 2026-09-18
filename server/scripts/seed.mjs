// Applies seeds/dev.sql. A script rather than `psql` so the only requirement
// is Node, which every contributor already has.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { assertLocalDatabase } from './guard.mjs'

const DEFAULT_URL = 'postgres://housing:housing_dev@localhost:5433/housing'
const connectionString = process.env.DATABASE_URL ?? DEFAULT_URL

// seeds/dev.sql truncates every table before inserting.
assertLocalDatabase(connectionString, 'seed (truncates all tables)')

const sql = readFileSync(fileURLToPath(new URL('../seeds/dev.sql', import.meta.url)), 'utf8')
const client = new pg.Client({ connectionString })

await client.connect()
try {
  await client.query(sql)
  const { rows } = await client.query(
    `select (select count(*) from users) as users,
            (select count(*) from management_companies) as companies,
            (select count(*) from properties) as properties,
            (select count(*) from reviews) as reviews`
  )
  console.log('seeded:', rows[0])
} finally {
  await client.end()
}
