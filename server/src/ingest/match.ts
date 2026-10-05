import { normalizeAddress } from './address.ts'
import type { SourceRecord } from './types.ts'

/**
 * Finds the existing property a source record describes, if any. Strategies
 * run in order and the first that decides wins; add one to the list to match
 * on something new. Anything no strategy decides becomes a new property, and
 * anything uncertain is reported, never merged.
 */

export type Match =
  | { kind: 'linked'; propertyId: string }
  | { kind: 'address'; propertyId: string }
  | { kind: 'none' }
  | { kind: 'ambiguous'; reason: string; propertyIds: string[] }

/** What the database already holds, loaded once per run and kept current as the run writes. */
export class PropertyIndex {
  /** "source|sourceId" → property id */
  private links = new Map<string, string>()
  /** normalized address → property ids */
  private byAddress = new Map<string, string[]>()
  /** property id → "source|sourceId" keys linked to it */
  private linksOf = new Map<string, string[]>()

  addProperty(id: string, address: string) {
    const key = normalizeAddress(address)
    if (key) this.byAddress.set(key, [...(this.byAddress.get(key) ?? []), id])
  }

  addLink(source: string, sourceId: string, propertyId: string) {
    const key = `${source}|${sourceId}`
    this.links.set(key, propertyId)
    this.linksOf.set(propertyId, [...(this.linksOf.get(propertyId) ?? []), key])
  }

  linked(source: string, sourceId: string) {
    return this.links.get(`${source}|${sourceId}`)
  }

  atAddress(key: string) {
    return this.byAddress.get(key) ?? []
  }

  /** Whether another record from the same source is already linked to this property. */
  linkedFromSource(propertyId: string, source: string) {
    return (this.linksOf.get(propertyId) ?? []).some((key) => key.startsWith(`${source}|`))
  }
}

export type Strategy = (record: SourceRecord, index: PropertyIndex) => Match | null

/** 1. The same record, seen on an earlier run. */
export const bySourceId: Strategy = (record, index) => {
  const propertyId = index.linked(record.source, record.sourceId)
  return propertyId ? { kind: 'linked', propertyId } : null
}

/** 2. The same normalized street address, in the same city. */
export const byAddress: Strategy = (record, index) => {
  const key = record.street && normalizeAddress(record.street, record.city)
  if (!key) return null
  const ids = index.atAddress(key)
  const [only, ...others] = ids
  if (!only) return null
  if (others.length) return { kind: 'ambiguous', reason: 'several properties at this address', propertyIds: ids }
  // Two records from one source at one address are two buildings sharing a
  // street number (a complex, usually); folding them together would lose one.
  if (index.linkedFromSource(only, record.source)) {
    return { kind: 'ambiguous', reason: `address already linked to another ${record.source} record`, propertyIds: ids }
  }
  return { kind: 'address', propertyId: only }
}

export const STRATEGIES: Strategy[] = [bySourceId, byAddress]

export function match(record: SourceRecord, index: PropertyIndex, strategies = STRATEGIES): Match {
  for (const strategy of strategies) {
    const result = strategy(record, index)
    if (result) return result
  }
  return { kind: 'none' }
}
