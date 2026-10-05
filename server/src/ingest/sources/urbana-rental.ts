import { normalizeAddress } from '../address.ts'
import { getJson } from '../fetch.ts'
import type { Problem, Source, SourceRecord } from '../types.ts'

/**
 * City of Urbana rental registration and inspection listing, published on the
 * state portal (data.illinois.gov, dataset k5wm-jkx9): every registered rental
 * with its address, parcel, latest inspection grade and license status.
 *
 * Not an inventory of apartment buildings like Champaign's layer: a row is a
 * registered rental property, often a house, and there is no building type,
 * unit count, floor count or manager. So records arrive with type unknown,
 * which the directory treats as search-only.
 */
export const URBANA_RENTAL_URL = 'https://data.illinois.gov/resource/k5wm-jkx9.json'

type Row = Record<string, unknown>
type Fetch = (url: string) => Promise<unknown>

export function urbanaRental({ url = URBANA_RENTAL_URL, fetchJson = getJson, pageSize = 1000 } = {}): Source {
  return {
    name: 'urbana_rental',
    async fetchRecords() {
      const rows = await fetchAll(url, fetchJson, pageSize)
      const records: SourceRecord[] = []
      const problems: Problem[] = []
      // Condo units are registered one per row ("… Apt N1", "… Apt N3"), each
      // with its own parcel. The site lists buildings, so the lowest parcel
      // stands for the building and the other units are reported, not imported.
      const buildings = new Set<string>()
      const results = rows.map(transform).sort((a, b) => (a.sourceId ?? '').localeCompare(b.sourceId ?? ''))
      for (const result of results) {
        if ('reason' in result) {
          problems.push(result)
          continue
        }
        const key = normalizeAddress(result.street ?? '', result.city)
        if (key && buildings.has(key)) {
          problems.push({ sourceId: result.sourceId, reason: 'another unit of a building already listed', detail: result.raw, outOfScope: true })
          continue
        }
        if (key) buildings.add(key)
        records.push(result)
      }
      return { records, problems }
    },
  }
}

/** Pages by parcel number, which is unique here, then checks the total against the portal's count. */
export async function fetchAll(url: string, fetchJson: Fetch, pageSize: number): Promise<Row[]> {
  const query = (params: Record<string, string>) => `${url}?${new URLSearchParams(params)}`
  const counted = (await fetchJson(query({ $select: 'count(*)' }))) as { count?: string }[]
  const count = Number(counted?.[0]?.count)
  if (!Number.isInteger(count)) throw new Error('The rental listing did not report a count')

  const rows: Row[] = []
  for (;;) {
    const page = await fetchJson(query({ $order: 'parcel_number', $limit: String(pageSize), $offset: String(rows.length) }))
    if (!Array.isArray(page)) throw new Error('The rental listing answered without a list of rows')
    rows.push(...(page as Row[]))
    if (page.length === 0 || rows.length >= count) break
  }
  if (rows.length !== count) throw new Error(`The rental listing reported ${count} rows but returned ${rows.length}`)
  return rows
}

export function transform(row: Row): SourceRecord | Problem {
  const sourceId = text(row.parcel_number)
  if (!sourceId) return { sourceId: null, reason: 'no parcel number', detail: row }
  // The building's address: a unit ("Apt 101", "Unit B") is dropped, and stays in raw.
  const street = text(row.property_address)?.replace(/\s+(apt|apartment|unit|#)\s*\S+$/i, '') ?? null
  if (!street) return { sourceId, reason: 'no address', detail: row }
  if (text(row.license_status) === 'Temporarily Not a Rental') {
    return { sourceId, reason: 'not currently a rental', detail: { address: street }, outOfScope: true }
  }
  const point = coordinates(row)
  if (!point) return { sourceId, reason: 'no usable coordinates', detail: { address: street } }

  return {
    source: 'urbana_rental',
    sourceId,
    name: null,
    complexName: null,
    street,
    city: 'Urbana',
    ...point,
    unitCount: null,
    stories: null,
    propertyType: null,
    manager: null,
    raw: row,
  }
}

/**
 * From mappable_address, "… Urbana,IL (-88.17, 40.13)", which states the order
 * (longitude, latitude). The georeference point has them swapped against the
 * GeoJSON standard, so it is only a fallback, read by which value is plausible
 * for central Illinois.
 */
export function coordinates(row: Row): { latitude: number; longitude: number } | null {
  const match = typeof row.mappable_address === 'string' && row.mappable_address.match(/\((-?[\d.]+),\s*(-?[\d.]+)\)/)
  let point: { latitude: number; longitude: number } | null = match
    ? { longitude: Number(match[1]), latitude: Number(match[2]) }
    : null
  if (!point) {
    const pair = (row.georeference as { coordinates?: unknown } | undefined)?.coordinates
    if (Array.isArray(pair) && pair.length === 2 && pair.every((n) => typeof n === 'number')) {
      const [a, b] = pair as [number, number]
      point = Math.abs(a) > Math.abs(b) ? { longitude: a, latitude: b } : { longitude: b, latitude: a }
    }
  }
  if (!point || !(point.latitude > 39 && point.latitude < 41 && point.longitude > -89 && point.longitude < -87)) return null
  return point
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ') : null
}
