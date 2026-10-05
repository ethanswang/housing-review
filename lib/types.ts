export type Company = {
  name: string
  slug: string
}

export type Review = {
  id: string
  maintenance: number
  communication: number
  value: number
  overall: number
  body: string
  lease_term: string
  is_sample: boolean
  created_at: string
}

export type Property = {
  id: string
  name: string
  slug: string
  address: string
  /** Null when unknown, as for buildings imported from public data. */
  neighborhood: string | null
  rent_min: number | null
  rent_max: number | null
  bedrooms: number[]
}

/** The categories shown as bars. `overall` is displayed separately as the headline score. */
export const SUB_RATING_KEYS = ['maintenance', 'communication', 'value'] as const

/** The four things students are asked to rate. Order is display order. */
export const RATING_KEYS = ['overall', ...SUB_RATING_KEYS] as const
export type RatingKey = (typeof RATING_KEYS)[number]

export const RATING_LABELS: Record<RatingKey, string> = {
  overall: 'Overall',
  maintenance: 'Maintenance',
  communication: 'Communication',
  value: 'Value',
}

export type Averages = Record<RatingKey, number | null>

/** A property joined with its company and its computed rating averages. */
export type PropertyWithStats = Property & {
  company: Company | null
  averages: Averages
  reviewCount: number
}

export type PropertyDetail = PropertyWithStats & {
  reviews: Review[]
}

export type CompanyWithStats = Company & {
  properties: PropertyWithStats[]
  averages: Averages
  reviewCount: number
}

export type SortKey = 'rating' | 'price' | 'reviews'

export type PropertyFilters = {
  search?: string
  companies?: string[]
  neighborhoods?: string[]
  maxRent?: number
  bedrooms?: number[]
  sort?: SortKey
}
