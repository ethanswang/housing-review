import { normalizeAddress } from '../address.ts'
import type { Problem, Source, SourceRecord } from '../types.ts'

/**
 * City of Champaign open data: every registered apartment building, with its
 * address, units, stories, names and outline. No rent, and the managing company
 * is almost always blank. The Urbana side of campus is not in it.
 * https://gisportal.champaignil.gov/ms/rest/services/Open_Data/Open_Data/MapServer/8
 */
export const CHAMPAIGN_GIS_URL =
  'https://gisportal.champaignil.gov/ms/rest/services/Open_Data/Open_Data/MapServer/8'

const FIELDS = ['GlobalID', 'Address', 'Units', 'Stories', 'Building_Name', 'Complex_Name', 'Building_Type', 'Managing_Company']

export type GisFeature = {
  properties: Record<string, unknown> | null
  geometry: { type: string; coordinates: unknown } | null
}

type Fetch = (url: string) => Promise<unknown>

export function champaignGis({ url = CHAMPAIGN_GIS_URL, fetchJson = getJson, pageSize = 1000 } = {}): Source {
  return {
    name: 'champaign_gis',
    async fetchRecords() {
      const features = await fetchAll(url, fetchJson, pageSize)
      const records: SourceRecord[] = []
      const problems: Problem[] = []
      for (const feature of features) {
        const result = transform(feature)
        if ('reason' in result) problems.push(result)
        else records.push(result)
      }
      return { records, problems }
    },
  }
}

/**
 * Pages through the layer by OBJECTID. The server caps a page (2000 here), and
 * the total is checked against its own count afterwards, so a page lost to a
 * flaky connection fails the run instead of quietly importing a partial list.
 */
export async function fetchAll(url: string, fetchJson: Fetch, pageSize: number): Promise<GisFeature[]> {
  const query = (params: Record<string, string>) => `${url}/query?${new URLSearchParams({ where: '1=1', ...params })}`
  const { count } = (await fetchJson(query({ returnCountOnly: 'true', f: 'json' }))) as { count: number }

  const features: GisFeature[] = []
  for (;;) {
    const page = (await fetchJson(
      query({
        outFields: FIELDS.join(','),
        returnGeometry: 'true',
        outSR: '4326',
        orderByFields: 'OBJECTID',
        resultOffset: String(features.length),
        resultRecordCount: String(pageSize),
        f: 'geojson',
      })
    )) as { features?: GisFeature[] }
    if (!Array.isArray(page.features)) throw new Error('The GIS server answered without a feature list')
    features.push(...page.features)
    if (page.features.length === 0 || features.length >= count) break
  }
  if (features.length !== count) {
    throw new Error(`The GIS server reported ${count} records but returned ${features.length}`)
  }
  return features
}

/** One building, in the shared shape, or the reason it cannot be used. */
export function transform(feature: GisFeature): SourceRecord | Problem {
  const p = feature.properties ?? {}
  const sourceId = text(p.GlobalID)
  if (!sourceId) return { sourceId: null, reason: 'no GlobalID', detail: p }
  const name = text(p.Building_Name)
  // About a quarter of the layer leaves Address blank but has the street
  // address as the building's name ("810 Cobblefield Rd"); use it only then.
  const street = text(p.Address) ?? (name && normalizeAddress(name, 'Champaign') ? name : null)
  const point = centroid(feature.geometry)
  if (!point) return { sourceId, reason: 'no usable outline', detail: { address: street } }

  return {
    source: 'champaign_gis',
    sourceId,
    name,
    complexName: text(p.Complex_Name),
    street,
    city: 'Champaign',
    ...point,
    unitCount: count(p.Units),
    stories: count(p.Stories),
    propertyType: text(p.Building_Type)?.toLowerCase() ?? null,
    manager: text(p.Managing_Company),
  }
}

/** Trimmed, with blank as null: the layer uses null, "" and " " interchangeably. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ') : null
}

/** "36" or "3 " as a positive whole number; anything else is unknown. */
function count(value: unknown): number | null {
  const t = text(value)
  return t && /^\d+$/.test(t) && Number(t) > 0 ? Number(t) : null
}

/**
 * The centre of the building's outline (the largest polygon's outer ring, by
 * the shoelace formula), as latitude and longitude. Null for a missing or
 * degenerate outline.
 */
export function centroid(geometry: GisFeature['geometry']): { latitude: number; longitude: number } | null {
  if (!geometry) return null
  const polygons = (
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  ) as number[][][][]
  let best: { area: number; x: number; y: number } | null = null
  for (const polygon of polygons) {
    const ring = polygon?.[0]
    if (!Array.isArray(ring) || ring.length < 3) continue
    let area = 0, cx = 0, cy = 0
    for (let i = 0; i < ring.length; i++) {
      const [x1 = 0, y1 = 0] = ring[i] ?? []
      const [x2 = 0, y2 = 0] = ring[(i + 1) % ring.length] ?? []
      const cross = x1 * y2 - x2 * y1
      area += cross
      cx += (x1 + x2) * cross
      cy += (y1 + y2) * cross
    }
    if (area === 0) continue
    const c = { area: Math.abs(area / 2), x: cx / (3 * area), y: cy / (3 * area) }
    if (!best || c.area > best.area) best = c
  }
  if (!best || !Number.isFinite(best.x) || !Number.isFinite(best.y)) return null
  if (Math.abs(best.y) > 90 || Math.abs(best.x) > 180) return null
  return { latitude: best.y, longitude: best.x }
}

/**
 * GET with a timeout and three tries, backing off, for network errors and 5xx.
 * ArcGIS reports some failures as 200 with an `error` body, so that counts too.
 */
export async function getJson(url: string): Promise<unknown> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (response.status >= 500) throw new Error(`HTTP ${response.status}`)
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { fatal: true })
      const body = (await response.json()) as { error?: { message?: string } }
      if (body?.error) throw new Error(`GIS error: ${body.error.message ?? 'unknown'}`)
      return body
    } catch (error) {
      if ((error as { fatal?: boolean }).fatal) throw error
      lastError = error
    }
  }
  throw new Error(`Could not fetch ${url}: ${(lastError as Error)?.message}`)
}
