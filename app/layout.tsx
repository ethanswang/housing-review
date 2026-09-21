import type { Metadata } from 'next'
import Link from 'next/link'
import { Instrument_Serif, Public_Sans, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

const display = Instrument_Serif({
  weight: ['400'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-instrument-serif',
})

const body = Public_Sans({
  subsets: ['latin'],
  variable: '--font-public-sans',
})

const mono = IBM_Plex_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  variable: '--font-plex-mono',
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
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-screen flex flex-col antialiased">
        <header className="border-b border-rule">
          <div className="mx-auto max-w-6xl px-5">
            <div className="rule-double flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 py-5">
              <Link href="/">
                <h1 className="font-display text-3xl leading-none tracking-tight sm:text-4xl">
                  UIUC Housing Review
                </h1>
              </Link>
              <p className="label">Free · Student-run · Not affiliated with the University</p>
            </div>
            <p className="label py-2.5">
              Champaign — Urbana · Rated on maintenance, communication &amp; value
            </p>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="mt-20 border-t border-rule">
          <div className="mx-auto max-w-6xl px-5 py-8">
            <p className="max-w-2xl text-sm leading-relaxed text-ink-soft">
              Reviews are written by students and reflect their own experiences. This site is not
              affiliated with the University of Illinois or with any management company.
            </p>
            <p className="label mt-4">Built for the r/UIUC community</p>
          </div>
        </footer>
      </body>
    </html>
  )
}
