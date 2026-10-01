import type { Database } from '../db.ts'
import type { TokenClaims } from '../auth/verify.ts'
import { conflict } from '../errors.ts'

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
type UserRow = {
  id: string
  email: string
  display_name: string | null
  role: Role
  created_at: Date
}

export async function upsertUser(db: Database, claims: TokenClaims): Promise<User> {
  let rows: UserRow[] = []
  // Set when the insert hit users.email's unique index rather than the id it
  // targets; resolved below once we can see which row holds the address.
  let emailCollision = false
  try {
    /**
     * The update fires only when the email actually changed. Without that
     * guard every authenticated request would write a row, take a row-level
     * lock and leave a dead tuple behind, so two concurrent requests from one
     * user would serialize on each other for no reason.
     *
     * The guard creates a wrinkle: `on conflict do update ... where false`
     * returns no rows, so RETURNING alone would yield nothing in the common
     * case. The union reads the existing row when the upsert had nothing to
     * do, keeping this to a single round trip either way.
     *
     * `updated_at` is not set here; the users_set_updated_at trigger assigns
     * it, and anything written here would simply be overwritten.
     */
    ;({ rows } = await db.query<UserRow>(
      `with updated as (
         insert into users (id, email)
         values ($1, $2)
         on conflict (id) do update
           set email = excluded.email
           where users.email is distinct from excluded.email
         returning id, email, display_name, role, created_at
       )
       select id, email, display_name, role, created_at from updated
       union all
       select id, email, display_name, role, created_at from users
       where id = $1 and not exists (select 1 from updated)`,
      [claims.sub, claims.email]
    ))
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    emailCollision = true
  }

  let row = rows[0]
  if (!row) {
    /**
     * Reached when another request created this user at the same moment. The
     * insert waits for it, then either hits the id conflict and updates nothing
     * — the union's read cannot see the new row, sharing a snapshot taken
     * before it was committed — or trips the unique index on email first and
     * raises a unique violation. A first page load that sends two
     * authenticated requests at once lands here. A separate statement takes a
     * fresh snapshot and sees the row.
     */
    ;({ rows } = await db.query<UserRow>(
      'select id, email, display_name, role, created_at from users where id = $1',
      [claims.sub]
    ))
    row = rows[0]
  }
  // users.email is unique. A collision that the row for this id does not
  // explain means someone else holds the address — a seeded row, or the same
  // person under a second Supabase identity. That is a conflict the caller can
  // act on, not a server fault. citext compares case-insensitively; so does this.
  if (emailCollision && row?.email.toLowerCase() !== claims.email.toLowerCase()) {
    throw conflict('That email address is already associated with another account', 'email_taken')
  }
  if (!row) {
    // Only reachable if the row was deleted in between.
    throw conflict('Could not establish your account, please try again', 'user_unavailable')
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}
