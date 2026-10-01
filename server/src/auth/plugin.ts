import type { FastifyInstance, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import type { Database } from '../db.ts'
import { forbidden, unauthorized } from '../errors.ts'
import { type User, upsertUser } from '../repositories/users.ts'
import { type KeySource, type VerifyOptions, bearerToken, verifyToken } from './verify.ts'

declare module 'fastify' {
  interface FastifyRequest {
    /** Set only after requireAuth has run. */
    currentUser?: User
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest) => Promise<void>
  }
}

/**
 * Only university addresses may hold an account. Enforced here, at the moment
 * identity enters the system, as well as by a CHECK constraint in the schema —
 * so neither a change to this code nor a direct INSERT can create one alone.
 */
const UNIVERSITY_EMAIL = /^[^@\s]+@([a-z0-9-]+\.)*illinois\.edu$/i

/**
 * Authentication methods that prove the person controls the email address:
 * each one means they followed a link or typed a code sent to that inbox.
 *
 * The rule above is only as good as this. A password sign-up with email
 * confirmation off, an OAuth identity, or an anonymous session can carry any
 * address, so without this anyone could sign up as anything@illinois.edu and
 * get past both the university rule and the per-account rate limit.
 *
 * Supabase's access token has no email-verified claim, and
 * `user_metadata.email_verified` is editable by the user, so `amr` is the
 * evidence the token can actually offer. See docs/API.md for the Supabase Auth
 * settings this relies on.
 */
const EMAIL_PROOF_METHODS = new Set(['otp', 'magiclink', 'email/signup', 'email_change', 'invite', 'recovery'])

export type AuthOptions = {
  db: Database
  keys: KeySource
  verify: VerifyOptions
}

async function authPlugin(app: FastifyInstance, options: AuthOptions) {
  /**
   * A preHandler rather than a global hook: reads are public, so authentication
   * is opt-in per route. A route that forgets it stays public, which is the
   * safe direction for this application — nothing is readable that was not
   * already meant to be. Writes are protected explicitly.
   */
  app.decorate('requireAuth', async (request: FastifyRequest) => {
    const token = bearerToken(request.headers.authorization)
    if (!token) throw unauthorized('Sign in to continue')

    const claims = await verifyToken(token, options.keys, options.verify)

    if (!UNIVERSITY_EMAIL.test(claims.email)) {
      throw forbidden('An @illinois.edu address is required to post or report reviews')
    }
    if (claims.isAnonymous || !claims.authMethods.some((method) => EMAIL_PROOF_METHODS.has(method))) {
      throw forbidden('Sign in with the link emailed to your @illinois.edu address')
    }

    request.currentUser = await upsertUser(options.db, claims)
  })
}

export const auth = fp(authPlugin, { name: 'auth' })

/** Narrows the optional property after requireAuth has run. */
export function currentUser(request: FastifyRequest): User {
  if (!request.currentUser) {
    // Reaching this means a route used currentUser without requireAuth.
    throw unauthorized('Sign in to continue')
  }
  return request.currentUser
}
