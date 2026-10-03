import { describe, expect, it } from 'vitest'
import { isUniversityEmail, safeNextPath } from './signin'

describe('isUniversityEmail', () => {
  it('accepts illinois.edu and its subdomains, in any case', () => {
    expect(isUniversityEmail('netid@illinois.edu')).toBe(true)
    expect(isUniversityEmail('netid@cs.Illinois.EDU')).toBe(true)
  })

  it('rejects other domains, including look-alikes', () => {
    expect(isUniversityEmail('netid@gmail.com')).toBe(false)
    expect(isUniversityEmail('netid@notillinois.edu')).toBe(false)
    expect(isUniversityEmail('netid@illinois.edu.evil.com')).toBe(false)
    expect(isUniversityEmail('a b@illinois.edu')).toBe(false)
  })
})

describe('safeNextPath', () => {
  it('keeps a path on this site', () => {
    expect(safeNextPath('/properties/the-dean?x=1')).toBe('/properties/the-dean?x=1')
  })

  it('falls back to the home page for anything else', () => {
    // Browsers drop tabs and newlines from URLs, so "/\t/evil.com" means "//evil.com".
    for (const next of [null, undefined, '', 'https://evil.com', '//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com',
      // Dot segments collapse to "//evil.com" once resolved.
      '/.//evil.com', '/..//evil.com', '/a/..//evil.com', '/%2e//evil.com', '/./\\evil.com']) {
      expect(safeNextPath(next)).toBe('/')
    }
  })
})
