/** Helpers shared by every repository. */

export type Page<T> = {
  data: T[]
  page: number
  perPage: number
  total: number
  totalPages: number
}

export type Averages = {
  overall: number | null
  maintenance: number | null
  communication: number | null
  value: number | null
}

/**
 * node-postgres returns `numeric` as a string, because numeric cannot be
 * represented exactly as a double. Converting once at the repository boundary
 * keeps that detail out of every caller.
 */
export const toNumber = (value: string | number | null): number | null =>
  value === null ? null : Number(value)

/**
 * `%` and `_` are wildcards to LIKE. Left unescaped, a search for "%" matches
 * everything and scans the whole table, and "_" quietly matches any single
 * character. Values are bound parameters either way, so this is about correct
 * search behaviour, not injection.
 */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`)

export function toPage<T>(data: T[], page: number, perPage: number, total: number): Page<T> {
  return { data, page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) }
}

/**
 * `count(*) over()` only reports a total on rows that come back, so a page past
 * the end would answer "total: 0" — telling a client the filter matches nothing
 * when it matches plenty. This was written out three times before it was worth
 * naming; the count query differs per caller, the guard does not.
 */
export async function totalForPage(
  rows: Array<{ total_count?: string | number }>,
  page: number,
  countAll: () => Promise<number>
): Promise<number> {
  const first = rows[0]
  if (first?.total_count !== undefined) return Number(first.total_count)
  return page > 1 ? countAll() : 0
}
