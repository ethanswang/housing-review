// Generates volume data, runs EXPLAIN ANALYZE on the three hot directory
// queries, then rolls back. Nothing is left behind, so it is safe to run
// against a seeded development database.
//
//   npm run db:benchmark
//
// The point is to check that the indexes in the initial migration are actually
// chosen by the planner at a size the seed data cannot demonstrate.
import pg from 'pg'
import { assertLocalDatabase } from './guard.mjs'

const PROPERTIES = Number(process.env.BENCH_PROPERTIES ?? 5000)
const REVIEWS_EACH = Number(process.env.BENCH_REVIEWS_EACH ?? 10)
const URL = process.env.DATABASE_URL ?? 'postgres://housing:housing_dev@localhost:5433/housing'

// Inserts tens of thousands of rows before rolling back; not for a real database.
assertLocalDatabase(URL, 'run the benchmark')

const client = new pg.Client({ connectionString: URL })
await client.connect()
await client.query('begin')
let completed = false
try {
  console.log(`generating ${PROPERTIES} properties x ${REVIEWS_EACH} reviews...`)
  await client.query(
    `insert into properties (name, slug, address, neighborhood, rent_min, rent_max, bedrooms)
     select 'Property ' || g, 'bench-' || g,
            (100 + g % 900) || ' block of Test St, Champaign',
            (array['Campustown','Urbana','Downtown Champaign','Engineering Campus'])[1 + g % 4],
            600 + (g % 800), 900 + (g % 800),
            (array['{1,2}','{2,3}','{1,2,3,4}','{3,4}'])[1 + g % 4]::int[]
     from generate_series(1, $1) g`,
    [PROPERTIES]
  )
  await client.query(
    `insert into reviews (property_id, maintenance, communication, value, overall, body, lease_term)
     select p.id, 1 + (r % 5), 1 + ((r + 1) % 5), 1 + ((r + 2) % 5), 1 + ((r + 3) % 5),
            'Benchmark review body number ' || r || ' padded out to satisfy the length constraint.',
            '2024-25'
     from properties p, generate_series(1, $1) r
     where p.slug like 'bench-%'`,
    [REVIEWS_EACH]
  )
  await client.query('analyze properties')
  await client.query('analyze reviews')

  const { rows: counts } = await client.query(
    'select (select count(*) from properties) as properties, (select count(*) from reviews) as reviews'
  )
  console.log('rows in play:', counts[0])

  const queries = {
    'search, both columns': `select * from property_stats
       where name ilike '%4242%' or address ilike '%4242%' limit 24`,
    'directory page 1, by rating': `select * from property_stats
       order by avg_overall desc nulls last, slug limit 24`,
    'filtered: area + rent + bedrooms': `select * from property_stats
       where neighborhood = 'Campustown' and rent_min <= 900 and bedrooms && '{2,3}'::int[]
       order by avg_overall desc nulls last, slug limit 24`,
    'one property page': `select * from property_stats where slug = 'bench-4242'`,
    'review page for one property': `select r.* from reviews r
       join properties p on p.id = r.property_id
       where p.slug = 'bench-4242' and r.status = 'published'
       order by r.created_at desc limit 20`,
  }

  for (const [label, sql] of Object.entries(queries)) {
    const { rows } = await client.query(`explain (analyze, buffers) ${sql}`)
    const plan = rows.map((r) => r['QUERY PLAN'])
    const time = plan.find((l) => l.includes('Execution Time'))?.match(/[\d.]+ ms/)?.[0]
    const scans = plan
      .filter((l) => /Index Scan|Index Only Scan|Seq Scan/.test(l))
      .map((l) => l.trim().replace(/\s+\(cost.*/, ''))
    console.log(`\n### ${label}  —  ${time}`)
    for (const scan of scans) console.log('   ', scan)
  }
  completed = true
} finally {
  // Report what actually happened: a crash mid-run must not print success.
  try {
    await client.query('rollback')
  } catch (rollbackError) {
    console.error('rollback failed:', rollbackError.message)
  } finally {
    await client.end()
  }
  console.log(completed ? '\nrolled back — development data untouched' : '\nfailed; transaction rolled back')
}
