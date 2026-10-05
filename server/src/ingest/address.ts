/**
 * Turns an address into a key for comparing, not for display: "809 S. First
 * Street, Champaign, IL 61820" and "809 S First St" (in Champaign) both become
 * "809 S FIRST ST|CHAMPAIGN".
 *
 * Deliberately conservative. Only differences that cannot change which
 * building is meant are removed: case, punctuation, spacing, the state and ZIP,
 * and the standard abbreviation of the street type and of a direction. Nothing
 * fuzzy, so neighbours ("809" and "811") never compare equal.
 */

const SUFFIXES: Record<string, string> = {
  STREET: 'ST', AVENUE: 'AVE', DRIVE: 'DR', BOULEVARD: 'BLVD', ROAD: 'RD', COURT: 'CT',
  PLACE: 'PL', LANE: 'LN', CIRCLE: 'CIR', PARKWAY: 'PKWY', TERRACE: 'TER', HIGHWAY: 'HWY',
  SQUARE: 'SQ', TRAIL: 'TRL',
}
const DIRECTIONS: Record<string, string> = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W' }

/**
 * Null when the address has no city and none is given, or does not start with
 * a house number (such as "500 block of E Green St"): those cannot be matched
 * safely, so they never are.
 */
export function normalizeAddress(address: string, defaultCity?: string): string | null {
  const [streetPart, ...rest] = address.split(',')
  const tokens = clean(streetPart ?? '').split(' ').filter(Boolean)
  if (!/^\d+(-\d+)?[A-Z]?$/.test(tokens[0] ?? '') || tokens.includes('BLOCK')) return null

  // "100 North St" names a street called North, so a direction is abbreviated
  // only when a street name and a street type still follow it.
  const direction = DIRECTIONS[tokens[1] ?? '']
  if (tokens.length >= 4 && direction) tokens[1] = direction
  // Only the last word is the street type; "Court" in "Avenue Court Dr" is a name.
  const suffix = SUFFIXES[tokens.at(-1) ?? '']
  if (tokens.length >= 3 && suffix) tokens[tokens.length - 1] = suffix

  const city = cityOf(rest) ?? (defaultCity ? clean(defaultCity) : null)
  return city ? `${tokens.join(' ')}|${city}` : null
}

/** The city from what follows the street, without the state or ZIP. */
function cityOf(parts: string[]): string | null {
  for (const part of parts) {
    const words = clean(part)
      .split(' ')
      .filter((word) => word && !/^\d{5}(-\d{4})?$/.test(word) && word !== 'IL' && word !== 'ILLINOIS')
    if (words.length) return words.join(' ')
  }
  return null
}

const clean = (text: string) =>
  text
    .toUpperCase()
    .replace(/[.#'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** A company name reduced for comparing: "Bankier Apartments, Inc." and "bankier apartments inc". */
export function normalizeCompanyName(name: string): string {
  return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim()
}
