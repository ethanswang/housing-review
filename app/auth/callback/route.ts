import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { NextRequest } from 'next/server'
import { authClient } from '@/lib/auth'
import { NEXT_COOKIE, safeNextPath } from '@/lib/signin'

/**
 * Where the emailed link lands. It carries a one-time code that, with the verifier
 * cookie set when the link was requested, becomes a session; so the link only works
 * in the browser that asked for it.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const store = await cookies()
  const next = safeNextPath(store.get(NEXT_COOKIE)?.value)
  store.delete(NEXT_COOKIE)

  if (code) {
    const { error } = await (await authClient()).auth.exchangeCodeForSession(code)
    if (!error) redirect(next)
    console.error('sign-in callback failed', error.message)
  }
  redirect('/signin?error=link')
}
