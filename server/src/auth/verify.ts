import { type JWTVerifyGetKey, createLocalJWKSet, createRemoteJWKSet, errors, jwtVerify } from 'jose'
import { serviceUnavailable, unauthorized } from '../errors.ts'

/**
 * Tokens are issued by Supabase Auth and signed with ES256. This service never
 * sees a password and holds no signing secret: it fetches Supabase's public
 * keys and verifies signatures against them. A leaked API environment therefore
 * cannot be used to mint tokens.
 */

/** The claims this service relies on. Supabase sends more; we ignore the rest. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
    /**
     * Enumerate what the caller can be blamed for; treat everything else as our
     * failure. The list has to run this way round, because jose reports a
     * broken key set in shapes that look like nothing in particular: a non-200
     * JWKS response and unparseable JSON both raise a bare JOSEError, and a DNS
     * failure, refused connection or TLS error is fetch's own TypeError passed
     * straight through. Defaulting the unrecognised case to 401 would tell
     * every user holding a valid token to sign in again for the duration of a
     * Supabase outage — the precise failure this branch exists to prevent.
     *
     * JWKSNoMatchingKey stays on the client side deliberately: a token signed
     * by a key the issuer does not publish is a bad token, not a broken
     * dependency.
     */
    const badToken =
      error instanceof errors.JWTExpired ||
      error instanceof errors.JWTInvalid ||
      error instanceof errors.JWTClaimValidationFailed ||
      error instanceof errors.JWSInvalid ||
      error instanceof errors.JWSSignatureVerificationFailed ||
      error instanceof errors.JOSEAlgNotAllowed ||
      error instanceof errors.JWKSNoMatchingKey ||
      error instanceof errors.JWKSMultipleMatchingKeys

    if (!badToken) throw serviceUnavailable('Cannot verify credentials right now')
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
  // `sub` becomes a uuid primary key. Without this check a validly signed token
  // carrying a non-uuid subject reaches Postgres and surfaces as a 500 rather
  // than being rejected as the bad credential it is.
  if (!UUID.test(sub)) {
    throw unauthorized('Token subject is not a valid identifier')
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
