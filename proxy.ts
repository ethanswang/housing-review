import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Renews the visitor's session before a page renders. Access tokens last an hour and
 * pages cannot set cookies, so without this a signed-in visitor would look signed out
 * once theirs expired.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        for (const { name, value } of list) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of list) response.cookies.set(name, value, options)
        // Supabase's no-store headers, so no cache keeps a response that sets a session.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value)
      },
    },
  })
  await supabase.auth.getClaims()
  return response
}

export const config = {
  // Pages only, not static files or the sign-in callback, which sets the session itself.
  matcher: ['/((?!_next/static|_next/image|auth/callback|icon.svg).*)'],
}
