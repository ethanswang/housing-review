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
