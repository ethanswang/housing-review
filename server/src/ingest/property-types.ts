/**
 * One vocabulary for building types across sources, and which of them the
 * directory shows. Each source maps its own values here conservatively: a value
 * it cannot place is 'other', and a source with no type at all leaves it null.
 */
export const PROPERTY_TYPES = ['apartment', 'multi_unit', 'duplex', 'house', 'greek_house', 'other'] as const
export type PropertyType = (typeof PROPERTY_TYPES)[number]

export type Visibility = 'listed' | 'search_only' | 'hidden'

/**
 * Set when a building is first imported, then left alone so it can be changed
 * by hand. Houses and buildings of unknown type stay findable by search without
 * filling the directory; Greek houses are kept but not shown, for now.
 */
export function visibilityFor(type: PropertyType | null): Visibility {
  if (type === 'greek_house') return 'hidden'
  if (type === 'house' || type === null) return 'search_only'
  return 'listed'
}
