import type pg from 'pg'
import { inArea, type TargetArea } from './config.ts'
import { normalizeAddress, normalizeCompanyName } from './address.ts'
import { match, PropertyIndex, simplify } from './match.ts'
import { visibilityFor } from './property-types.ts'
import type { Problem, SourceRecord } from './types.ts'

/**
 * Writes source records into properties, safely re-runnable:
 *
 *   - A record already linked (property_sources) updates its property; a
 *     record matching an existing property's address, with nothing against it,
 *     is linked to it; anything else is inserted. Uncertain matches are
 *     reported and left alone.
 *   - Source values only ever fill in or refresh what the source knows
 *     (location, size, type, complex, and its raw fields). Null never
 *     overwrites a value, and the name, address, slug and visibility a property
 *     already has are never changed, so hand curation survives. A company is
 *     only set on a property that has none.
 *   - Companies are never created here. A source's manager name is matched to
 *     a company or one of its aliases by normalized name; an unknown name is
 *     kept in the raw fields and reported for a person to resolve.
 *   - Nothing is deleted.
 *   - One transaction, with a savepoint per record: a record that fails is
 *     rolled back alone and reported, and a dry run rolls everything back.
 *   - Source ids are trusted to be stable. If a source ever reissues them,
 *     every record would arrive as new beside its old self; a run that inserts
 *     roughly as many properties as the source has, on a database that already
 *     holds them, means that happened.
 */

export type ImportReport = {
  source: string
  applied: boolean
  area: TargetArea
  counts: {
    fetched: number
    malformed: number
    outsideArea: number
    inArea: number
    skipped: number
    inserted: number
    matchedBySourceId: number
    updated: number
    unchanged: number
    linkedByAddress: number
    ambiguous: number
    managersToReview: number
    errors: number
  }
  ambiguous: {
    sourceId: string
    address: string | null
    normalizedAddress: string | null
    name: string | null
    latitude: number | null
    longitude: number | null
    reason: string
    candidates: { id: string; name: string | null }[]
  }[]
  /** Imported, but worth a look: a shared address, a name that differs from the matched property. */
  review: { sourceId: string; propertyId: string; note: string }[]
  /** Manager names no company or alias matches, with a near-identical existing name if there is one. */
  managers: { name: string; suggestion: string | null; sourceIds: string[] }[]
  /** Unusable source records (no id, no coordinates). */
  malformed: Problem[]
  /** Out of scope by the source's own account, or in the area with no street address that can be matched. */
  skipped: Problem[]
  errors: { sourceId: string; message: string }[]
}

export async function importRecords(
  client: pg.ClientBase,
  source: string,
  records: SourceRecord[],
  problems: Problem[],
  { apply, area, beforeFinish }: { apply: boolean; area: TargetArea; beforeFinish?: (report: ImportReport) => void }
): Promise<ImportReport> {
  const report: ImportReport = {
    source,
    applied: apply,
    area,
    counts: {
      fetched: records.length + problems.length,
      malformed: problems.filter((p) => !p.outOfScope).length,
      outsideArea: 0,
      inArea: 0,
      skipped: problems.filter((p) => p.outOfScope).length,
      inserted: 0,
      matchedBySourceId: 0,
      updated: 0,
      unchanged: 0,
      linkedByAddress: 0,
      ambiguous: 0,
      managersToReview: 0,
      errors: 0,
    },
    ambiguous: [],
    review: [],
    managers: [],
    malformed: problems.filter((p) => !p.outOfScope),
    skipped: problems.filter((p) => p.outOfScope),
    errors: [],
  }

  await client.query('begin')
  try {
    const state = await load(client)
    // Stable order, so slugs and "first record at an address" are the same every run.
    const ordered = [...records].sort((a, b) => a.sourceId.localeCompare(b.sourceId))
    for (const record of ordered) {
      if (record.latitude === null || record.longitude === null) {
        report.malformed.push({ sourceId: record.sourceId, reason: 'no coordinates' })
        report.counts.malformed++
        continue
      }
      if (!inArea({ latitude: record.latitude, longitude: record.longitude }, area)) {
        report.counts.outsideArea++
        continue
      }
      report.counts.inArea++
      if (!record.street || !normalizeAddress(record.street, record.city)) {
        report.skipped.push({ sourceId: record.sourceId, reason: 'no usable street address', detail: record.raw })
        report.counts.skipped++
        continue
      }
      await client.query('savepoint record')
      const done: Done = []
      try {
        await importOne(client, record, state, report, done)
        await client.query('release savepoint record')
        for (const step of done) step()
      } catch (error) {
        await client.query('rollback to savepoint record')
        report.errors.push({ sourceId: record.sourceId, message: (error as Error).message })
        report.counts.errors++
      }
    }
    report.counts.matchedBySourceId = report.counts.updated + report.counts.unchanged
    report.counts.managersToReview = report.managers.length
    // Before committing, so a report that cannot be written rolls the run back
    // rather than leaving changes nobody can review.
    beforeFinish?.(report)
    await client.query(apply ? 'commit' : 'rollback')
    return report
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

type State = {
  index: PropertyIndex
  slugs: Set<string>
  /** normalized company name or alias → company id */
  companies: Map<string, string>
  /** normalized company name → display name, for suggestions */
  companyNames: Map<string, string>
  /** property id → its company, so a company is only looked up where one would be set */
  companyOf: Map<string, string | null>
}

/**
 * What a record changes in memory (state and report), queued and run only once
 * its savepoint is released: a record rolled back in the database must leave
 * no trace here either.
 */
type Done = (() => void)[]

async function load(client: pg.ClientBase): Promise<State> {
  const index = new PropertyIndex()
  const slugs = new Set<string>()
  const companyOf = new Map<string, string | null>()
  const { rows: properties } = await client.query<{
    id: string; slug: string; name: string; address: string; company_id: string | null
    latitude: number | null; longitude: number | null; unit_count: number | null
  }>('select id, slug, name, address, company_id, latitude, longitude, unit_count from properties')
  for (const p of properties) {
    index.addProperty(p.id, p.address, { name: p.name, latitude: p.latitude, longitude: p.longitude, unitCount: p.unit_count })
    slugs.add(p.slug)
    companyOf.set(p.id, p.company_id)
  }
  const { rows: links } = await client.query<{ source: string; source_id: string; property_id: string }>(
    'select source, source_id, property_id from property_sources'
  )
  for (const l of links) index.addLink(l.source, l.source_id, l.property_id)

  const { rows: companies } = await client.query<{ id: string; name: string }>('select id, name from management_companies')
  const { rows: aliases } = await client.query<{ alias_normalized: string; company_id: string }>(
    'select alias_normalized, company_id from management_company_aliases'
  )
  return {
    index,
    slugs,
    companyOf,
    companies: new Map([
      ...companies.map((c) => [normalizeCompanyName(c.name), c.id] as const),
      ...aliases.map((a) => [a.alias_normalized, a.company_id] as const),
    ]),
    companyNames: new Map(companies.map((c) => [normalizeCompanyName(c.name), c.name])),
  }
}

async function importOne(client: pg.ClientBase, record: SourceRecord, state: State, report: ImportReport, done: Done) {
  const result = match(record, state.index)
  if (result.kind === 'ambiguous') {
    done.push(() => {
      report.ambiguous.push({
        sourceId: record.sourceId,
        address: record.street,
        normalizedAddress: record.street && normalizeAddress(record.street, record.city),
        name: record.name ?? record.complexName,
        latitude: record.latitude,
        longitude: record.longitude,
        reason: result.reason,
        candidates: result.propertyIds.map((id) => ({ id, name: state.index.get(id)?.name ?? null })),
      })
      report.counts.ambiguous++
    })
    return
  }

  if (result.kind === 'none') {
    const name = record.name ?? record.complexName ?? record.street!
    if (name.length > 120) throw new Error(`name longer than 120 characters: ${name}`)
    const companyId = company(record, state, report, done)
    const slug = uniqueSlug([name, `${name} ${record.street}`], state.slugs)
    const address = `${record.street}, ${record.city}`
    const { rows } = await client.query<{ id: string }>(
      `insert into properties
         (slug, name, address, company_id, latitude, longitude, unit_count, stories, property_type, complex_name, visibility)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       returning id`,
      [slug, name, address, companyId, record.latitude, record.longitude, record.unitCount, record.stories,
       record.propertyType, record.complexName, visibilityFor(record.propertyType)]
    )
    const id = rows[0]!.id
    await link(client, record, id)
    done.push(() => {
      state.index.addProperty(id, address, { name, latitude: record.latitude, longitude: record.longitude, unitCount: record.unitCount })
      state.index.addLink(record.source, record.sourceId, id)
      state.slugs.add(slug)
      state.companyOf.set(id, companyId)
      report.counts.inserted++
      if (result.note) report.review.push({ sourceId: record.sourceId, propertyId: id, note: result.note })
    })
    return
  }

  const propertyId = result.propertyId
  const companyId = state.companyOf.get(propertyId) ? null : company(record, state, report, done)
  const changed = await refresh(client, propertyId, record, companyId)
  done.push(() => {
    if (companyId) state.companyOf.set(propertyId, companyId)
    state.index.learn(propertyId, record)
  })

  if (result.kind === 'address') {
    await link(client, record, propertyId)
    const existing = state.index.get(propertyId)?.name
    const incoming = record.name ?? record.complexName
    done.push(() => {
      state.index.addLink(record.source, record.sourceId, propertyId)
      report.counts.linkedByAddress++
      if (existing && incoming && simplify(existing) !== simplify(incoming)) {
        report.review.push({
          sourceId: record.sourceId,
          propertyId,
          note: `linked by address; the property is named "${existing}", the source says "${incoming}"`,
        })
      }
    })
    return
  }
  const { rowCount } = await client.query(
    `update property_sources set last_seen_at = now(), source_address = $3, raw = $4
     where source = $1 and source_id = $2`,
    [record.source, record.sourceId, record.street, record.raw]
  )
  if (rowCount !== 1) throw new Error('source link vanished during the run')
  done.push(() => report.counts[changed ? 'updated' : 'unchanged']++)
}

/**
 * Refreshes only what the source knows, never with null, and fills the company
 * only if there is none. Returns whether anything actually changed.
 */
async function refresh(client: pg.ClientBase, propertyId: string, record: SourceRecord, companyId: string | null) {
  const { rowCount } = await client.query(
    `update properties set
       latitude = coalesce($2, latitude), longitude = coalesce($3, longitude),
       unit_count = coalesce($4, unit_count), stories = coalesce($5, stories),
       property_type = coalesce($6, property_type), complex_name = coalesce($7, complex_name),
       company_id = coalesce(company_id, $8)
     where id = $1
       and (latitude, longitude, unit_count, stories, property_type, complex_name, company_id)
           is distinct from
           (coalesce($2, latitude), coalesce($3, longitude), coalesce($4, unit_count), coalesce($5, stories),
            coalesce($6, property_type), coalesce($7, complex_name), coalesce(company_id, $8))`,
    [propertyId, record.latitude, record.longitude, record.unitCount, record.stories, record.propertyType,
     record.complexName, companyId]
  )
  return rowCount === 1
}

async function link(client: pg.ClientBase, record: SourceRecord, propertyId: string) {
  await client.query(
    `insert into property_sources (source, source_id, property_id, source_address, raw) values ($1, $2, $3, $4, $5)`,
    [record.source, record.sourceId, propertyId, record.street, record.raw]
  )
}

/**
 * The record's company, by normalized name or alias. An unknown name sets no
 * company and is listed for review, with an existing company whose name is
 * within two letters of it as a suggestion ("Green Streeet Realty" → "Green
 * Street Realty"). Suggestions are never applied automatically.
 */
function company(record: SourceRecord, state: State, report: ImportReport, done: Done): string | null {
  const name = record.manager
  if (!name) return null
  const key = normalizeCompanyName(name)
  const found = state.companies.get(key)
  if (found) return found
  done.push(() => {
    const listed = report.managers.find((m) => normalizeCompanyName(m.name) === key)
    if (listed) {
      listed.sourceIds.push(record.sourceId)
      return
    }
    let suggestion: string | null = null
    for (const [normalized, display] of state.companyNames) {
      if (editDistance(key, normalized) <= 2) suggestion = display
    }
    report.managers.push({ name, suggestion, sourceIds: [record.sourceId] })
  })
  return null
}

/** Levenshtein distance; short company names, so the quadratic table is fine. */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length]!
}

export function slugify(text: string) {
  return text.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180)
}

/** The first candidate not taken, then the last candidate numbered. */
export function uniqueSlug(candidates: string[], taken: Set<string>) {
  const slugs = candidates.map(slugify).filter(Boolean)
  for (const slug of slugs) if (!taken.has(slug)) return slug
  const base = slugs.at(-1) || 'property'
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}
