/** Remembers where to return after the emailed link, which cannot carry it itself. */
export const NEXT_COOKIE = 'signin-next'

/** The API's rule (server/src/auth/plugin.ts): an illinois.edu address or a subdomain of it. */
const UNIVERSITY_EMAIL = /^[^@\s]+@([a-z0-9-]+\.)*illinois\.edu$/i

export function isUniversityEmail(email: string): boolean {
  return UNIVERSITY_EMAIL.test(email)
}

/**
 * Where to send someone after they sign in: only a path on this site, else the home page.
 * Resolved the way a browser would, because browsers read "//evil.com", "/\evil.com" and
 * "/<tab>/evil.com" as other hosts, and a string check misses some of them.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next?.startsWith('/')) return '/'
  const url = new URL(next, 'http://this.site')
  return url.origin === 'http://this.site' ? url.pathname + url.search + url.hash : '/'
}
