import { normalizeAddress } from './address.ts'
import { distanceKm } from './config.ts'
import type { SourceRecord } from './types.ts'

/**
 * Finds the existing property a source record describes, if any. Strategies
 * run in order and the first that decides wins; add one to the list to match
 * on something new. Anything no strategy decides becomes a new property, and
 * anything uncertain is reported, never merged.
 *
 * An address is evidence, not identity: two records from one source at one
 * address are two buildings (a complex sharing a street number), and a record
 * at a known address is matched only when nothing else contradicts it.
 */

export type Match =
  | { kind: 'linked'; propertyId: string }
  | { kind: 'address'; propertyId: string }
  /** A new property; `note` flags something worth a look, such as a shared address. */
  | { kind: 'none'; note?: string }
  | { kind: 'ambiguous'; reason: string; propertyIds: string[] }

/** Within this distance, two points can be the same building; beyond it they are not. */
export const SAME_BUILDING_KM = 0.075
/** Closer than this, with the same unit count, two records of one source are one building entered twice. */
export const DUPLICATE_KM = 0.01

type Known = { name: string; latitude: number | null; longitude: number | null; unitCount: number | null }

/** What the database already holds, loaded once per run and kept current as the run writes. */
export class PropertyIndex {
  /** "source|sourceId" → property id */
  private links = new Map<string, string>()
  /** normalized address → property ids */
  private byAddress = new Map<string, string[]>()
  /** property id → sources linked to it */
  private sourcesOf = new Map<string, Set<string>>()
  private known = new Map<string, Known>()

  addProperty(id: string, address: string, known: Known) {
    const key = normalizeAddress(address)
    if (key) this.byAddress.set(key, [...(this.byAddress.get(key) ?? []), id])
    this.known.set(id, known)
  }

  addLink(source: string, sourceId: string, propertyId: string) {
    this.links.set(`${source}|${sourceId}`, propertyId)
    this.sourcesOf.set(propertyId, (this.sourcesOf.get(propertyId) ?? new Set()).add(source))
  }

  linked(source: string, sourceId: string) {
    return this.links.get(`${source}|${sourceId}`)
  }

  atAddress(key: string) {
    return this.byAddress.get(key) ?? []
  }

  linkedFromSource(propertyId: string, source: string) {
    return this.sourcesOf.get(propertyId)?.has(source) ?? false
  }

  get(propertyId: string) {
    return this.known.get(propertyId)
  }

  /** What a refresh just wrote: source values fill in, never blank out, as in the database. */
  learn(propertyId: string, values: { latitude: number | null; longitude: number | null; unitCount: number | null }) {
    const p = this.known.get(propertyId)
    if (!p) return
    this.known.set(propertyId, {
      name: p.name,
      latitude: values.latitude ?? p.latitude,
      longitude: values.longitude ?? p.longitude,
      unitCount: values.unitCount ?? p.unitCount,
    })
  }
}

export type Strategy = (record: SourceRecord, index: PropertyIndex) => Match | null

/** 1. The same record, seen on an earlier run. Authoritative. */
export const bySourceId: Strategy = (record, index) => {
  const propertyId = index.linked(record.source, record.sourceId)
  return propertyId ? { kind: 'linked', propertyId } : null
}

/** 2. The same normalized street address and city, with nothing against it. */
export const byAddress: Strategy = (record, index) => {
  const key = record.street && normalizeAddress(record.street, record.city)
  if (!key) return null
  const atAddress = index.atAddress(key)
  if (atAddress.length === 0) return null

  // Another record of this source at this address is a different building in
  // the source's own eyes (it has its own id), so it is never a candidate.
  const distance = (id: string) => {
    const p = index.get(id)
    if (!p || p.latitude === null || p.longitude === null || record.latitude === null || record.longitude === null) return null
    return distanceKm({ latitude: p.latitude, longitude: p.longitude }, { latitude: record.latitude, longitude: record.longitude })
  }

  const sameSource = atAddress.filter((id) => index.linkedFromSource(id, record.source))
  // Unless it is the same building twice: same spot, same size. Champaign's
  // layer has such pairs; importing both would list one building twice.
  const twin = sameSource.filter((id) => {
    const km = distance(id)
    return km !== null && km <= DUPLICATE_KM && index.get(id)?.unitCount === record.unitCount
  })
  if (twin.length) {
    return { kind: 'ambiguous', reason: `likely a duplicate of another ${record.source} record (same address, location and units)`, propertyIds: twin }
  }
  const candidates = atAddress.filter((id) => !sameSource.includes(id))
  if (candidates.length === 0) {
    return { kind: 'none', note: `shares its address with ${atAddress.length} other ${record.source} record(s)` }
  }

  if (candidates.length === 1) {
    const [only] = candidates as [string]
    const km = distance(only)
    if (km !== null && km > SAME_BUILDING_KM) {
      return { kind: 'ambiguous', reason: `same address, but ${Math.round(km * 1000)} m apart`, propertyIds: candidates }
    }
    return { kind: 'address', propertyId: only }
  }

  // Several at the address: one must stand out, close by and, when both have
  // names, with the same name.
  const incoming = record.name ?? record.complexName
  const fitting = candidates.filter((id) => {
    const km = distance(id)
    const name = index.get(id)?.name
    return km !== null && km <= SAME_BUILDING_KM && (!incoming || !name || simplify(name) === simplify(incoming))
  })
  if (fitting.length === 1) return { kind: 'address', propertyId: fitting[0]! }
  return { kind: 'ambiguous', reason: `${candidates.length} properties at this address, none clearly this one`, propertyIds: candidates }
}

export const STRATEGIES: Strategy[] = [bySourceId, byAddress]

export function match(record: SourceRecord, index: PropertyIndex, strategies = STRATEGIES): Match {
  for (const strategy of strategies) {
    const result = strategy(record, index)
    if (result) return result
  }
  return { kind: 'none' }
}

export const simplify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
