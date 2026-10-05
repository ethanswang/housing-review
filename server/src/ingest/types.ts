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
  propertyType: string | null
  manager: string | null
}

/** A record that could not be used, kept for the report rather than dropped silently. */
export type Problem = { sourceId: string | null; reason: string; detail?: unknown }

export type Source = {
  name: string
  fetchRecords(): Promise<{ records: SourceRecord[]; problems: Problem[] }>
}
