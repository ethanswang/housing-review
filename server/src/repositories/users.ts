import type { Database } from '../db.ts'
import type { TokenClaims } from '../auth/verify.ts'

export type Role = 'student' | 'moderator' | 'admin'

export type User = {
  id: string
  email: string
  displayName: string | null
  role: Role
  createdAt: string
}

/**
 * Turns a verified token into a local user row.
 *
 * The primary key is the token's `sub`, so identity survives an email change.
 * The email is refreshed on every call, because Supabase is the authority on it
 * and a stale copy here would be wrong in a way nothing would notice.
 *
 * `role` is never taken from the token. It lives only in this database, so a
 * forged or replayed claim cannot escalate anyone to moderator.
 */
export async function upsertUser(db: Database, claims: TokenClaims): Promise<User> {
  const { rows } = await db.query(
    `insert into users (id, email)
     values ($1, $2)
     on conflict (id) do update
       set email = excluded.email,
           updated_at = clock_timestamp()
     returning id, email, display_name, role, created_at`,
    [claims.sub, claims.email]
  )

  const row = rows[0]
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  }
}

export async function getUserById(db: Database, id: string): Promise<User | null> {
  const { rows } = await db.query(
    'select id, email, display_name, role, created_at from users where id = $1',
    [id]
  )
  if (!rows.length) return null
  const row = rows[0]
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  }
}
