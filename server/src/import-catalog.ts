/**
 * node src/import-catalog.ts <file.json> [--apply]
 *
 * Dry run unless --apply is given. Lives in src/ rather than scripts/ so that
 * it ships in the production image, which is the only place with a route to
 * the private database. See docs/DATABASE.md, "Loading the property list".
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { importCatalog, parseCatalog } from './catalog.ts'

const args = process.argv.slice(2)
const file = args.find((arg) => !arg.startsWith('--'))
const apply = args.includes('--apply')

if (!file || !process.env.DATABASE_URL) {
  console.error('usage: DATABASE_URL=... node src/import-catalog.ts <file.json> [--apply]')
  process.exit(2)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })

try {
  // The person running this is fixing a data file, not debugging the tool, so
  // a problem is reported as its message alone rather than a stack trace.
  const catalog = parseCatalog(JSON.parse(readFileSync(file, 'utf8')))
  await client.connect()
  const result = await importCatalog(client, catalog, { apply })
  console.log(`companies:  ${format(result.companies)}`)
  console.log(`properties: ${format(result.properties)}`)
  console.log(result.applied ? 'Applied.' : 'Dry run: nothing was written. Re-run with --apply to write.')
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
} finally {
  await client.end()
}

function format(c: { inserted: number; updated: number; unchanged: number }) {
  return `${c.inserted} inserted, ${c.updated} updated, ${c.unchanged} unchanged`
}
