/** Remembers where to return after the emailed link, which cannot carry it itself. */
export const NEXT_COOKIE = 'signin-next'

/** The API's rule (server/src/auth/plugin.ts): an illinois.edu address or a subdomain of it. */
const UNIVERSITY_EMAIL = /^[^@\s]+@([a-z0-9-]+\.)*illinois\.edu$/i

export function isUniversityEmail(email: string): boolean {
  return UNIVERSITY_EMAIL.test(email)
}

/**
 * Where to send someone after they sign in. Only a path on this site: "//evil.com" and
 * "/\evil.com" are read by browsers as other hosts, so they fall back to the home page.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/'
  return next
}
