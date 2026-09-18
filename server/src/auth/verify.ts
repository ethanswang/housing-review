import { type JWTVerifyGetKey, createLocalJWKSet, createRemoteJWKSet, errors, jwtVerify } from 'jose'
import { serviceUnavailable, unauthorized } from '../errors.ts'

/**
 * Tokens are issued by Supabase Auth and signed with ES256. This service never
 * sees a password and holds no signing secret: it fetches Supabase's public
 * keys and verifies signatures against them. A leaked API environment therefore
 * cannot be used to mint tokens.
 */

/** The claims this service relies on. Supabase sends more; we ignore the rest. */
export type TokenClaims = {
  sub: string
  email: string
}

/**
 * The key-resolver shape jwtVerify accepts. Both the remote key set and a
 * locally constructed one satisfy it, which is what lets tests verify real
 * signatures without reaching Supabase.
 */
export type KeySource = JWTVerifyGetKey

export function remoteKeySource(jwksUrl: string): KeySource {
  // jose caches the key set and refetches only when it sees an unknown `kid`,
  // so this is not a fetch per request.
  return createRemoteJWKSet(new URL(jwksUrl))
}

export function localKeySource(jwks: { keys: unknown[] }): KeySource {
  return createLocalJWKSet(jwks as Parameters<typeof createLocalJWKSet>[0])
}

export type VerifyOptions = {
  issuer: string
  audience: string
}

export async function verifyToken(
  token: string,
  keys: KeySource,
  options: VerifyOptions
): Promise<TokenClaims> {
  let payload
  try {
    ;({ payload } = await jwtVerify(token, keys, {
      issuer: options.issuer,
      audience: options.audience,
      algorithms: ['ES256'],
    }))
  } catch (error) {
    // An unreachable or malformed key set is our dependency failing, not a bad
    // request. Reporting it as 401 would tell a user with a perfectly good
    // token to sign in again, which cannot help them.
    // JWKSNoMatchingKey is deliberately NOT here: a token signed by a key the
    // issuer does not publish is a bad token, not a broken dependency.
    if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) {
      throw serviceUnavailable('Cannot verify credentials right now')
    }
    if (error instanceof errors.JWTExpired) {
      throw unauthorized('Your session has expired. Please sign in again.')
    }
    throw unauthorized('Invalid credentials')
  }

  // Verified signature, correct issuer and audience — but the claims this
  // service needs still have to be present and the right shape.
  const { sub, email } = payload
  if (typeof sub !== 'string' || !sub) {
    throw unauthorized('Token is missing a subject')
  }
  if (typeof email !== 'string' || !email) {
    throw unauthorized('Token is missing an email address')
  }

  return { sub, email }
}

/** `Authorization: Bearer <token>`, or nothing. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null
  const [scheme, ...rest] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer') return null
  const token = rest.join(' ').trim()
  return token.length ? token : null
}
