import { describe, expect, it } from 'vitest'
import { checkSlug } from './slug'

describe('checkSlug', () => {
  it('renders a valid slug, lowercases a shared one with capitals, and 404s the rest', () => {
    expect(checkSlug('the-dean-campustown')).toEqual({ ok: true })
    expect(checkSlug('The-Dean-Campustown')).toEqual({ redirectTo: 'the-dean-campustown' })
    expect(checkSlug('foo_bar')).toEqual({ notFound: true })
    expect(checkSlug('..')).toEqual({ notFound: true })
  })
})
