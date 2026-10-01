/**
 * The PostgREST filter for "name or address contains this text".
 *
 * Two layers of escaping, innermost first:
 *   - LIKE: `%`, `_` and `\` are wildcards or the escape character, so a search
 *     for "%" would otherwise match every property.
 *   - PostgREST: inside `or(...)`, commas, dots, colons and parentheses are
 *     syntax. Double-quoting the value makes them literal, so "Green St,
 *     Champaign" is searched as typed; inside the quotes `"` and `\` are escaped.
 * The column names are fixed here; only the value comes from the visitor.
 */
export function containsFilter(term: string): string {
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const quoted = `"${like.replace(/[\\"]/g, (c) => `\\${c}`)}"`
  return `name.ilike.${quoted},address.ilike.${quoted}`
}
