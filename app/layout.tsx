import type { Metadata } from 'next'
import Link from 'next/link'
import { Public_Sans } from 'next/font/google'
import { AccountNav } from '@/components/AccountNav'
import './globals.css'

const body = Public_Sans({
  subsets: ['latin'],
  variable: '--font-public-sans',
})

export const metadata: Metadata = {
  title: 'UIUC Housing Review — honest apartment reviews by Illinois students',
  description:
    'A free, student-run housing review site for the University of Illinois. Compare Champaign-Urbana apartments and management companies on maintenance, communication, and value.',
  // Prototype: the seeded reviews are synthetic and name real companies. Keep
  // this out of search results until the sample data is replaced with real
  // student submissions, then remove this block.
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={body.variable}>
      <body className="min-h-screen flex flex-col antialiased">
        <header className="border-b border-rule">
          <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-x-6 px-4 py-3 md:px-6">
            <Link href="/" className="flex min-h-11 items-center text-title font-semibold tracking-tight">
              UIUC Housing Review
            </Link>
            <div className="flex flex-wrap items-baseline gap-x-6">
              <p className="pb-1 text-meta text-muted">
                Student-run · Not affiliated with UIUC or any landlord
              </p>
              <AccountNav />
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="mt-16 border-t border-rule">
          <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
            <p className="max-w-2xl text-meta text-ink-soft">
              Reviews are written by students and reflect their own experiences. This site is not
              affiliated with the University of Illinois or with any management company.
            </p>
            <p className="mt-4 text-meta text-muted">Built for the r/UIUC community</p>
          </div>
        </footer>
      </body>
    </html>
  )
}
