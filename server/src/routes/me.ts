import type { FastifyInstance } from 'fastify'
import { currentUser } from '../auth/plugin.ts'
import type { User } from '../repositories/users.ts'

export async function meRoutes(app: FastifyInstance) {
  /**
   * Who am I? The smallest possible authenticated endpoint, which makes it the
   * one to call when checking whether sign-in works end to end.
   */
  app.get(
    '/me',
    { preHandler: app.requireAuth },
    async (request): Promise<User> => currentUser(request)
  )
}
