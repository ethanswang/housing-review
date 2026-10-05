import type pg from 'pg'
import { inArea, type TargetArea } from './config.ts'
import { normalizeAddress, normalizeCompanyName } from './address.ts'
import { match, PropertyIndex } from './match.ts'
import type { Problem, SourceRecord } from './types.ts'

/**
 * Writes source records into properties, safely re-runnable:
 *
 *   - A record already linked (property_sources) updates its property; a
 *     record matching one property's address is linked to it; anything else
 *     is inserted. Uncertain matches are reported and left alone.
 *   - Source values only ever fill in or refresh what the source knows
 *     (location, size, type, complex). Null never overwrites a value, and the
 *     name, address and slug a property already has are never changed, so a
 *     hand-curated property keeps its curation. A company is only set on a
 *     property that has none.
 *   - Nothing is deleted.
 *   - One transaction, with a savepoint per record: a record that fails is
 *     rolled back alone and reported, and a dry run rolls everything back.
 */

export type ImportReport = {
  source: string
  applied: boolean
  area: TargetArea
  counts: {
    fetched: number
    outsideArea: number
    inserted: number
    linkedByAddress: number
    updated: number
    unchanged: number
    companiesCreated: number
    ambiguous: number
    skipped: number
    errors: number
  }
  ambiguous: { sourceId: string; address: string | null; reason: string; propertyIds: string[] }[]
  review: { sourceId: string; propertyId: string; note: string }[]
  skipped: Problem[]
  errors: { sourceId: string; message: string }[]
}

export async function importRecords(
  client: pg.ClientBase,
  source: string,
  records: SourceRecord[],
  problems: Problem[],
  { apply, area }: { apply: boolean; area: TargetArea }
): Promise<ImportReport> {
  const report: ImportReport = {
    source,
    applied: apply,
    area,
    counts: {
      fetched: records.length + problems.length,
      outsideArea: 0,
      inserted: 0,
      linkedByAddress: 0,
      updated: 0,
      unchanged: 0,
      companiesCreated: 0,
      ambiguous: 0,
      skipped: problems.length,
      errors: 0,
    },
    ambiguous: [],
    review: [],
    skipped: [...problems],
    errors: [],
  }

  await client.query('begin')
  try {
    const state = await load(client)
    // Stable order, so slugs and "first record at an address" are the same every run.
    const ordered = [...records].sort((a, b) => a.sourceId.localeCompare(b.sourceId))
    for (const record of ordered) {
      if (record.latitude === null || record.longitude === null) {
        report.skipped.push({ sourceId: record.sourceId, reason: 'no coordinates' })
        report.counts.skipped++
        continue
      }
      if (!inArea({ latitude: record.latitude, longitude: record.longitude }, area)) {
        report.counts.outsideArea++
        continue
      }
      if (!record.street || !normalizeAddress(record.street, record.city)) {
        report.skipped.push({ sourceId: record.sourceId, reason: 'no usable street address', detail: record })
        report.counts.skipped++
        continue
      }
      await client.query('savepoint record')
      try {
        await importOne(client, record, state, report)
        await client.query('release savepoint record')
      } catch (error) {
        await client.query('rollback to savepoint record')
        report.errors.push({ sourceId: record.sourceId, message: (error as Error).message })
        report.counts.errors++
      }
    }
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
  /** normalized company name → id */
  companies: Map<string, string>
  companySlugs: Set<string>
  names: Map<string, string>
}

async function load(client: pg.ClientBase): Promise<State> {
  const index = new PropertyIndex()
  const slugs = new Set<string>()
  const names = new Map<string, string>()
  const { rows: properties } = await client.query<{ id: string; slug: string; name: string; address: string }>(
    'select id, slug, name, address from properties'
  )
  for (const p of properties) {
    index.addProperty(p.id, p.address)
    slugs.add(p.slug)
    names.set(p.id, p.name)
  }
  const { rows: links } = await client.query<{ source: string; source_id: string; property_id: string }>(
    'select source, source_id, property_id from property_sources'
  )
  for (const l of links) index.addLink(l.source, l.source_id, l.property_id)

  const { rows: companies } = await client.query<{ id: string; slug: string; name: string }>(
    'select id, slug, name from management_companies'
  )
  return {
    index,
    slugs,
    names,
    companies: new Map(companies.map((c) => [normalizeCompanyName(c.name), c.id])),
    companySlugs: new Set(companies.map((c) => c.slug)),
  }
}

async function importOne(client: pg.ClientBase, record: SourceRecord, state: State, report: ImportReport) {
  const result = match(record, state.index)
  if (result.kind === 'ambiguous') {
    report.ambiguous.push({ sourceId: record.sourceId, address: record.street, reason: result.reason, propertyIds: result.propertyIds })
    report.counts.ambiguous++
    return
  }

  const companyId = record.manager ? await company(client, record, record.manager, state, report) : null

  if (result.kind === 'none') {
    const name = record.name ?? record.complexName ?? record.street!
    if (name.length > 120) throw new Error(`name longer than 120 characters: ${name}`)
    const slug = uniqueSlug([name, `${name} ${record.street}`], state.slugs)
    const address = `${record.street}, ${record.city}`
    const { rows } = await client.query<{ id: string }>(
      `insert into properties
         (slug, name, address, company_id, latitude, longitude, unit_count, stories, property_type, complex_name)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id`,
      [slug, name, address, companyId, record.latitude, record.longitude, record.unitCount, record.stories,
       record.propertyType, record.complexName]
    )
    const id = rows[0]!.id
    await link(client, record, id)
    state.index.addProperty(id, address)
    state.index.addLink(record.source, record.sourceId, id)
    state.slugs.add(slug)
    report.counts.inserted++
    return
  }

  const changed = await refresh(client, result.propertyId, record, companyId)
  if (result.kind === 'address') {
    await link(client, record, result.propertyId)
    state.index.addLink(record.source, record.sourceId, result.propertyId)
    report.counts.linkedByAddress++
    const existing = state.names.get(result.propertyId)
    const incoming = record.name ?? record.complexName
    if (existing && incoming && simplify(existing) !== simplify(incoming)) {
      report.review.push({
        sourceId: record.sourceId,
        propertyId: result.propertyId,
        note: `linked by address; the property is named "${existing}", the source says "${incoming}"`,
      })
    }
    return
  }
  await client.query(
    `update property_sources set last_seen_at = now(), source_address = $3 where source = $1 and source_id = $2`,
    [record.source, record.sourceId, record.street]
  )
  report.counts[changed ? 'updated' : 'unchanged']++
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
    `insert into property_sources (source, source_id, property_id, source_address) values ($1, $2, $3, $4)`,
    [record.source, record.sourceId, propertyId, record.street]
  )
}

/** An existing company with the same normalized name, or a new one. */
async function company(client: pg.ClientBase, record: SourceRecord, name: string, state: State, report: ImportReport) {
  const key = normalizeCompanyName(name)
  const found = state.companies.get(key)
  if (found) return found
  if (!key || name.length > 120) return null
  const slug = uniqueSlug([name], state.companySlugs)
  const { rows } = await client.query<{ id: string }>(
    'insert into management_companies (slug, name) values ($1, $2) returning id',
    [slug, name]
  )
  const id = rows[0]!.id
  state.companies.set(key, id)
  state.companySlugs.add(slug)
  report.counts.companiesCreated++
  // The source spells companies inconsistently ("Green Streeet Realty"), and
  // only exact names are matched, so every new one is listed for a person to check.
  report.review.push({ sourceId: record.sourceId, propertyId: '', note: `created company "${name}"` })
  return id
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

const simplify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
