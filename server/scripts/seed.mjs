// Applies seeds/dev.sql. A script rather than `psql` so the only requirement
// is Node, which every contributor already has.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const DEFAULT_URL = 'postgres://housing:housing_dev@localhost:5433/housing'
const sql = readFileSync(fileURLToPath(new URL('../seeds/dev.sql', import.meta.url)), 'utf8')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? DEFAULT_URL })

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
