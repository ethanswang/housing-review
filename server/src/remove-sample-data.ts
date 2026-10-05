/**
 * node src/remove-sample-data.ts [--apply]
 *
 * Removes the launch's demonstration reviews and sample buildings
 * (src/sample-data.ts). A dry run unless --apply is given. Against production
 * it runs through infra/remove-sample-data.sh.
 */
import pg from 'pg'
import { removeSampleData } from './sample-data.ts'

const args = process.argv.slice(2)
if (!process.env.DATABASE_URL || args.some((arg) => arg !== '--apply')) {
  console.error('usage: DATABASE_URL=... node src/remove-sample-data.ts [--apply]')
  process.exit(2)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
try {
  await client.connect()
  const result = await removeSampleData(client, { apply: args.includes('--apply') })
  console.log(`sample reviews:    ${result.sampleReviewsDeleted} deleted`)
  console.log(`sample buildings:  ${result.propertiesDeleted.length} deleted${result.propertiesDeleted.length ? ` (${result.propertiesDeleted.join(', ')})` : ''}`)
  for (const kept of result.kept) console.log(`  kept ${kept.slug}: ${kept.reason}`)
  console.log(result.applied ? 'Applied.' : 'Dry run: nothing was deleted. Re-run with --apply to delete.')
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
} finally {
  await client.end()
}
