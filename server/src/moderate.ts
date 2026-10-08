/**
 * node src/moderate.ts reports                       open reports, by review
 * node src/moderate.ts recent [count]                the newest reviews (default 20)
 * node src/moderate.ts hide|restore|dismiss <review-id> [--apply]
 *
 * Changes are a dry run unless --apply is given. Against production it runs
 * through infra/moderate.sh. See docs/MODERATION.md.
 */
import pg from 'pg'
import { listRecent, listReported, moderate } from './moderation.ts'

const [command, arg, ...rest] = process.argv.slice(2)
const apply = rest.includes('--apply') || arg === '--apply'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const usage = 'usage: DATABASE_URL=... node src/moderate.ts reports | recent [count] | hide|restore|dismiss <review-id> [--apply]'

const isChange = command === 'hide' || command === 'restore' || command === 'dismiss'
const valid =
  (command === 'reports' && arg === undefined) ||
  (command === 'recent' && (arg === undefined || /^\d+$/.test(arg)) && rest.length === 0) ||
  (isChange && UUID.test(arg ?? '') && rest.every((r) => r === '--apply'))
if (!process.env.DATABASE_URL || !valid) {
  console.error(usage)
  process.exit(2)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
const excerpt = (text: string) => (text.length > 300 ? `${text.slice(0, 300)}…` : text)
const date = (d: Date) => d.toISOString().slice(0, 10)

try {
  await client.connect()
  if (command === 'reports') {
    const reported = await listReported(client)
    if (!reported.length) console.log('No open reports.')
    for (const r of reported) {
      console.log(`\n${r.reviewId}  [${r.status}]  ${r.property} (/properties/${r.propertySlug})`)
      console.log(`  ${r.reports} report(s) since ${date(r.firstReportedAt)}: ${r.reasons.join(', ')}`)
      for (const d of r.details) console.log(`  · "${excerpt(d)}"`)
      console.log(`  ${r.overall}/5, posted ${date(r.postedAt)}: ${excerpt(r.body)}`)
    }
  } else if (command === 'recent') {
    for (const r of await listRecent(client, Number(arg ?? 20))) {
      console.log(`\n${r.reviewId}  [${r.status}]  ${r.property}, ${r.overall}/5, ${date(r.postedAt)}`)
      console.log(`  ${excerpt(r.body)}`)
    }
  } else {
    const result = await moderate(client, command as 'hide' | 'restore' | 'dismiss', arg!, { apply })
    console.log(`review: ${result.review}; reports closed: ${result.reportsClosed}`)
    console.log(result.applied ? 'Applied.' : 'Dry run: nothing was changed. Re-run with --apply.')
  }
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
} finally {
  await client.end()
}
