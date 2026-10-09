import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Guidelines, terms and privacy — UIUC Housing Review',
  description: 'How reviews work on UIUC Housing Review, the terms of using it, what it collects, and how to reach it.',
}

const CONTACT_EMAIL = 'contact@uiuchousing.com'

/**
 * The site's rules in one page, in plain language, with an anchor per section
 * (#guidelines, #terms, #privacy, #contact) for the links elsewhere on the site.
 * Facts here must match the code: what is logged, kept and shown.
 */
export default function PoliciesPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 md:px-6">
      <h1 className="text-display font-semibold tracking-tight">Guidelines, terms and privacy</h1>
      <p className="mt-4 text-body text-ink-soft">
        UIUC Housing Review is a free site run by an Illinois student. It is not affiliated with the
        University of Illinois or with any landlord or management company. Last updated October 2026.
      </p>
      <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-body">
        <a href="#guidelines" className="underline">Guidelines</a>
        <a href="#terms" className="underline">Terms</a>
        <a href="#privacy" className="underline">Privacy</a>
        <a href="#contact" className="underline">Contact</a>
      </nav>

      <Section id="guidelines" title="Community guidelines">
        <p>Write about your own time living in the building: repairs, communication, noise, value. Be specific, and keep facts apart from opinions.</p>
        <p className="font-semibold">Please don&rsquo;t:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>name or describe individual staff members, other tenants or anyone else, or share phone numbers, emails or unit numbers;</li>
          <li>harass or threaten anyone, or use slurs;</li>
          <li>review a building you didn&rsquo;t live in, or one you own, manage, work for, or were paid to review;</li>
          <li>advertise or post spam.</li>
        </ul>
        <p>
          Each account can review a building once. Reviews appear right away. Anyone signed in can report a
          review; a person then looks at it and hides reviews that break these guidelines. A review is
          never removed for being negative. To change or withdraw your own review, email{' '}
          <Email />.
        </p>
        <p>
          <strong className="font-semibold">Landlords and managers:</strong> if a review states something
          false as fact, email us and point to the statement. Opinions about a building stay up.
        </p>
      </Section>

      <Section id="terms" title="Terms of use">
        <p>
          By using the site you agree to these terms. Posting requires signing in with an @illinois.edu
          email address, and what you post must follow the guidelines above and be true to your own
          experience. You are responsible for what you post.
        </p>
        <p>
          You keep ownership of your reviews. By posting one, you let the site store and show it, for as
          long as it stays posted.
        </p>
        <p>
          Building details (rent, bedrooms, size, managers) come from public records and rental listings
          and may be out of date or wrong; check with the building before you sign anything. Reviews are
          their authors&rsquo; opinions, not the site&rsquo;s.
        </p>
        <p>
          The site may hide content that breaks these terms and may refuse service to anyone who abuses
          it. Please don&rsquo;t collect its content in bulk with automated tools. The site is provided as
          it is, without warranties, and to the extent the law allows, its operator is not liable for how
          it is used. These terms may change; the date above shows the latest version.
        </p>
      </Section>

      <Section id="privacy" title="Privacy">
        <p className="font-semibold">What the site collects</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong className="font-semibold">Your @illinois.edu email,</strong> when you sign in. It is
            used to sign you in and to allow one review per building. It is never shown on the site, sold
            or shared, and you won&rsquo;t get marketing email.
          </li>
          <li>
            <strong className="font-semibold">Your reviews and reports,</strong> linked to your account.
            Reviews are shown without your name or email. A moderator can see which account wrote a
            review that was reported.
          </li>
          <li>
            <strong className="font-semibold">Technical logs.</strong> The site&rsquo;s server records
            visitors&rsquo; IP addresses and the pages requested, kept for 14 days, for security and to
            limit abuse. The hosting services below keep their own logs.
          </li>
          <li>
            <strong className="font-semibold">One cookie,</strong> which keeps you signed in. There are no
            analytics, advertising or tracking cookies.
          </li>
        </ul>
        <p className="font-semibold">Services that handle it</p>
        <p>
          Supabase (signing in, which stores your email), Resend (sending the sign-in code), Vercel
          (hosting the website) and Amazon Web Services (hosting the server and database, in the United States).
        </p>
        <p className="font-semibold">How long it is kept, and your choices</p>
        <p>
          Your account and reviews are kept while the site runs. Database backups are kept for a short
          time (currently one day), and occasional copies are kept offline. To see, correct or delete
          your data, or delete your account and reviews, email <Email />.
        </p>
      </Section>

      <Section id="contact" title="Contact">
        <p>
          Email <Email /> for questions, removal requests, corrections to a building&rsquo;s details, or
          your data. Security problems too: please report them there privately rather than publicly.
        </p>
      </Section>
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mt-12 scroll-mt-4 border-t border-rule pt-6">
      <h2 id={`${id}-heading`} className="text-heading font-semibold tracking-tight">
        {title}
      </h2>
      <div className="mt-4 flex flex-col gap-4 text-body">{children}</div>
    </section>
  )
}

function Email() {
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
      {CONTACT_EMAIL}
    </a>
  )
}
