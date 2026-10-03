import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

/**
 * A Supabase client that keeps the visitor's session in cookies, for sign-in. Reads
 * still go to the API (lib/queries.ts); this only talks to Supabase Auth.
 */
export async function authClient() {
  const store = await cookies()
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options)
        } catch {
          // Pages cannot set cookies; proxy.ts renews the session before they render.
        }
      },
    },
  })
}

/**
 * The signed-in visitor, or null. getClaims() checks the token's signature against
 * Supabase's published keys, so a forged cookie does not count.
 */
export async function currentUser(): Promise<{ email: string } | null> {
  const { data } = await (await authClient()).auth.getClaims()
  const email = data?.claims.email
  return typeof email === 'string' ? { email } : null
}
