import { describe, expect, it } from 'vitest'
import { containsFilter } from './search'

// Checked against the live PostgREST API when written: "%" and "_" match
// nothing, "E Green St, Champaign" finds its buildings, and quotes,
// parentheses and backslashes no longer produce errors.
describe('containsFilter', () => {
  it('searches name and address', () => {
    expect(containsFilter('Green')).toBe('name.ilike."%Green%",address.ilike."%Green%"')
  })

  it('treats LIKE wildcards as literal characters', () => {
    // \% in LIKE, then the backslash doubled for PostgREST's quoting.
    expect(containsFilter('%')).toBe('name.ilike."%\\\\%%",address.ilike."%\\\\%%"')
    expect(containsFilter('_')).toContain('%\\\\_%')
  })

  it('keeps PostgREST syntax inside the quotes, so commas are searched as typed', () => {
    expect(containsFilter('Green St, Champaign')).toBe(
      'name.ilike."%Green St, Champaign%",address.ilike."%Green St, Champaign%"'
    )
  })

  it('escapes a double quote so the value cannot end early', () => {
    expect(containsFilter('a"b')).toBe('name.ilike."%a\\"b%",address.ilike."%a\\"b%"')
  })
})
