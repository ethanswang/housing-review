import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { isUniversityEmail } from './signin'

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
 * Supabase's published keys, so a forged cookie does not count. Supabase itself lets any
 * address sign up by calling it directly, so non-Illinois accounts count as signed out,
 * as they do in the API.
 */
export async function currentUser(): Promise<{ email: string } | null> {
  const { data } = await (await authClient()).auth.getClaims()
  const email = data?.claims.email
  return typeof email === 'string' && isUniversityEmail(email) ? { email } : null
}

/** The visitor's access token, to post as them through the API, which verifies it again. */
export async function accessToken(): Promise<string | null> {
  const client = await authClient()
  // Verifies the session, renewing it first if the token has expired.
  const { data } = await client.auth.getClaims()
  if (!data) return null
  const { data: session } = await client.auth.getSession()
  return session.session?.access_token ?? null
}
