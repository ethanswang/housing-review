/** The API's slug format: lowercase letters, digits and hyphens. */
const SLUG = /^[a-z0-9-]+$/

/**
 * What a page should do with the slug in its URL: render it, send the visitor
 * to the lowercase form (a shared link with capitals), or answer 404. A slug
 * the API would refuse never reaches it, which would otherwise show the error
 * page instead of "not found".
 */
export function checkSlug(slug: string): { ok: true } | { redirectTo: string } | { notFound: true } {
  if (SLUG.test(slug)) return { ok: true }
  const lower = slug.toLowerCase()
  return SLUG.test(lower) ? { redirectTo: lower } : { notFound: true }
}
