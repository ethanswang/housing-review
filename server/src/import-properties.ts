/**
 * node src/import-properties.ts [--source champaign|urbana|all] [--apply] [--radius-km <km>] [--report <file>]
 * (npm run import:properties -- --source all)
 *
 * A dry run unless --apply is given, like the catalog importer.
 * Fetches buildings from a public dataset and adds or refreshes them as
 * properties. Safe to re-run. Against production it runs through
 * infra/import-properties.sh. See docs/DATABASE.md, "Importing buildings from
 * public data".
 */
import pg from 'pg'
import { TARGET_AREA } from './ingest/config.ts'
import { importRecords } from './ingest/importer.ts'
import { summarize, writeReport } from './ingest/report.ts'
import { champaignGis } from './ingest/sources/champaign-gis.ts'
import { urbanaRental } from './ingest/sources/urbana-rental.ts'
import type { Source } from './ingest/types.ts'

// Add a source here to make it importable with --source. Keys are what the
// command line takes; each source's own name is what property_sources stores.
const SOURCES: Record<string, () => Source> = {
  champaign: () => champaignGis(),
  urbana: () => urbanaRental(),
}

const args = process.argv.slice(2)
const option = (name: string) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const value = args[i + 1]
  // "--report --apply" must not read --apply as the file name.
  if (value === undefined || value.startsWith('--')) {
    console.error(`${name} needs a value`)
    process.exit(2)
  }
  return value
}
// Anything unrecognized stops the run: a mistyped flag must not change what it does.
const FLAGS = ['--apply']
const OPTIONS = ['--source', '--radius-km', '--report']
const unknown = args.filter((arg, i) => !FLAGS.includes(arg) && !OPTIONS.includes(arg) && !OPTIONS.includes(args[i - 1] ?? ''))
const apply = args.includes('--apply')
// The names property_sources stores work too.
const ALIASES: Record<string, string> = { champaign_gis: 'champaign', urbana_rental: 'urbana' }
const given = option('--source') ?? 'champaign'
const sourceName = ALIASES[given] ?? given
const radius = option('--radius-km')
const area = radius === undefined ? TARGET_AREA : { ...TARGET_AREA, radiusKm: Number(radius) }
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const chosen = sourceName === 'all' ? Object.keys(SOURCES) : [sourceName]
// One report per source; --report names it, so it needs a single source.
if (option('--report') && chosen.length > 1) {
  console.error('--report needs a single --source; with all, each source writes its own report')
  process.exit(2)
}
const reportPath = (name: string) => option('--report') ?? `import-reports/${name}-${stamp}.json`

if (!process.env.DATABASE_URL || !chosen.every((name) => SOURCES[name]) || !(area.radiusKm > 0) || unknown.length) {
  if (unknown.length) console.error(`unknown argument(s): ${unknown.join(' ')}`)
  console.error(
    'usage: DATABASE_URL=... node src/import-properties.ts [--apply] [--radius-km <km>] [--report <file>] ' +
      `[--source ${[...Object.keys(SOURCES), 'all'].join('|')}]`
  )
  process.exit(2)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
try {
  await client.connect()
  // Sources run one after another, each in its own transaction, so a later one
  // sees what an earlier one wrote (and can link to it) on an applied run.
  for (const name of chosen) {
    const source = SOURCES[name]!()
    console.log(`Fetching ${source.name}…`)
    const { records, problems } = await source.fetchRecords()
    const path = reportPath(source.name)
    const report = await importRecords(client, source.name, records, problems, {
      apply,
      area,
      beforeFinish: (r) => writeReport(r, path),
    })
    console.log(summarize(report))
    console.log(`Report: ${path}\n`)
    if (report.counts.errors) process.exitCode = 1
  }
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
} finally {
  await client.end()
}
