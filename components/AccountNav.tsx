import Link from 'next/link'
import { signOut } from '@/app/auth/actions'
import { currentUser } from '@/lib/auth'

export async function AccountNav() {
  const user = await currentUser()
  if (!user) {
    return (
      <Link href="/signin" className="flex min-h-11 items-center text-meta font-semibold underline">
        Sign in
      </Link>
    )
  }
  return (
    <form action={signOut} className="flex min-h-11 items-center gap-3 text-meta">
      <span className="text-muted">{user.email}</span>
      <button type="submit" className="font-semibold underline">
        Sign out
      </button>
    </form>
  )
}
