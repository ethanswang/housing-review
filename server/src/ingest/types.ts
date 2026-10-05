import type { PropertyType } from './property-types.ts'

/**
 * The shape every source is turned into before matching, so the matcher and
 * importer never see a source's own field names. Null means the source did not
 * say; nothing here is guessed.
 */
export type SourceRecord = {
  /** Which dataset, e.g. "champaign_gis". Stored in property_sources.source. */
  source: string
  /** The dataset's stable id for this record. Stored in property_sources.source_id. */
  sourceId: string
  name: string | null
  complexName: string | null
  /** Street address without the city, as the source wrote it: "809 S First St". */
  street: string | null
  city: string
  latitude: number | null
  longitude: number | null
  unitCount: number | null
  stories: number | null
  /** Mapped to the shared vocabulary; the source's own value stays in `raw`. */
  propertyType: PropertyType | null
  /** The management company exactly as the source spelled it. */
  manager: string | null
  /** Every field the source gave, kept in property_sources.raw. */
  raw: Record<string, unknown>
}

/** A record that could not be used, kept for the report rather than dropped silently. */
export type Problem = {
  sourceId: string | null
  reason: string
  detail?: unknown
  /** A usable record the source itself marks as out of scope (not currently a rental), rather than a broken one. */
  outOfScope?: boolean
}

export type Source = {
  name: string
  fetchRecords(): Promise<{ records: SourceRecord[]; problems: Problem[] }>
}
