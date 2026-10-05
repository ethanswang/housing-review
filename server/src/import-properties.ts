/**
 * node src/import-properties.ts [--apply] [--radius-km <km>] [--report <file>]
 * (npm run import:properties [-- --apply])
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
import type { Source } from './ingest/types.ts'

// Add a source here to make it importable with --source.
const SOURCES: Record<string, () => Source> = { champaign_gis: () => champaignGis() }

const args = process.argv.slice(2)
const option = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
// Anything unrecognized stops the run: a mistyped flag must not change what it does.
const FLAGS = ['--apply']
const OPTIONS = ['--source', '--radius-km', '--report']
const unknown = args.filter((arg, i) => !FLAGS.includes(arg) && !OPTIONS.includes(arg) && !OPTIONS.includes(args[i - 1] ?? ''))
const apply = args.includes('--apply')
const sourceName = option('--source') ?? 'champaign_gis'
const radius = option('--radius-km')
const area = radius === undefined ? TARGET_AREA : { ...TARGET_AREA, radiusKm: Number(radius) }
const reportPath = option('--report') ?? `import-reports/${sourceName}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`

const makeSource = SOURCES[sourceName]
if (!process.env.DATABASE_URL || !makeSource || !(area.radiusKm > 0) || unknown.length) {
  if (unknown.length) console.error(`unknown argument(s): ${unknown.join(' ')}`)
  console.error(
    'usage: DATABASE_URL=... node src/import-properties.ts [--apply] [--radius-km <km>] [--report <file>] ' +
      `[--source ${Object.keys(SOURCES).join('|')}]`
  )
  process.exit(2)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
try {
  const source = makeSource()
  console.log(`Fetching ${source.name}…`)
  const { records, problems } = await source.fetchRecords()
  await client.connect()
  const report = await importRecords(client, source.name, records, problems, {
    apply,
    area,
    beforeFinish: (r) => writeReport(r, reportPath),
  })
  console.log(summarize(report))
  console.log(`Report: ${reportPath}`)
  if (report.counts.errors) process.exitCode = 1
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
} finally {
  await client.end()
}
