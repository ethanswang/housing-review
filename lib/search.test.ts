import { describe, expect, it } from 'vitest'
import { containsFilter } from './search'

// Checked against the live PostgREST API when written. "Gr%en" and "Gr_en"
// matched 0 properties escaped and 5 unescaped (the wildcard matching the
// "e" of "Green"), so the escaping is real rather than a pattern that matches
// nothing. "E Green St, Champaign" found its 3 buildings, "*" and "a*e" stopped
// matching everything once * was dropped, and quotes, parentheses and
// backslashes no longer produced errors.
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

  it('drops *, which PostgREST would turn into a wildcard', () => {
    expect(containsFilter('a*e')).toBe(containsFilter('ae'))
    expect(containsFilter('*')).toBe('name.ilike."%%",address.ilike."%%"')
  })
})
