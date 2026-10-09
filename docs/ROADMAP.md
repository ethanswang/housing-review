# Roadmap

Optional work after launch, roughly in order of value. None of it is needed for the site to
run. Each item says why it is worth doing and what it involves, so it can be picked up on its
own.

## Review form questions

**Why:** most buildings have no rent or bedroom details, and public data will never supply
rent. Tenants can, and these are the questions students most want answered.

**What:** optional questions on the review form:

- rent you paid, and whether it was per bed or per unit;
- your unit's bedroom count;
- would you rent here again (yes or no);
- did you get your deposit back (yes or no).

A building's page would then show the range tenants reported alongside, or instead of, the
listed rent.

**Involves:** a migration adding the columns to `reviews` (granted to `api_access` for insert
and update), API validation and response fields, the form, and the building page's summary.
Keep every question optional so a review stays quick to write.

## Edit or withdraw your own review

**Why:** today a student who wants to change or remove a review has to email
contact@uiuchousing.com.

**What:** on a building the student has reviewed, show their review with Edit and Withdraw.

**Involves:** site only. The API already supports both (`PATCH` and `DELETE` on
`/api/reviews/:id`, author-only, and withdrawing is refused while a moderator has the review
hidden). Update the guidelines on `/policies` once it ships.

## Alert on new reports

**Why:** a report waits until someone runs `infra/moderate.sh reports`; nothing announces it.

**What:** an email to the moderator when a review is reported.

**Involves:** either the API publishing to the existing alarm topic (an IAM permission for the
instance and a few lines in the report route) or sending through Resend. A daily summary is
enough at this scale.

## Fill in more buildings

**Why:** the 45 buildings with 50 or more units have rent, bedrooms, area, website and manager;
the other ~350 listed buildings mostly have only their size.

**What:** research the next tier (buildings with 12 to 49 units) the same way.

**Involves:** data only. Fill a sheet like `server/data/building-details.csv`, turn it into
catalog `updates` in `server/data/catalog.json`, then dry-run and apply with
`infra/import-catalog.sh` (see `docs/DATABASE.md`, "Filling in an existing building").

## Square footage

**Why:** unit sizes help compare buildings, and the first research pass collected them for
the 45 largest buildings (the earlier version of `server/data/building-details.csv`, in
commit `bc721f9`).

**What:** a size range on building pages, for example "369–1,345 sq ft".

**Involves:** a migration (`sqft_min`, `sqft_max`), catalog `updates` support, the API field,
and one more cell in the building page's facts.

## CAPTCHA on sign-in

**Why:** only if sign-in is abused. A script sending the sign-in form repeatedly could use up
the day's sign-in emails (Resend's free plan sends 100 a day) and email random addresses.
Watch Resend's daily count.

**What:** a CAPTCHA check (Cloudflare Turnstile is free) on the email step.

**Involves:** the widget in `components/SignInForm.tsx`, passing its token to
`signInWithOtp` in `app/auth/actions.ts`, and the public site key in Vercel. **Ship the code
before enabling CAPTCHA in Supabase**: with it enabled, Supabase refuses every sign-in request
that carries no token.

## When the time comes

- **Search engines:** remove `robots: { index: false, follow: false }` from `app/layout.tsx`
  once a few real reviews are up.
- **Sessions over an hour:** confirm a student signed in for more than an hour can still post
  (the refreshed token must keep its email sign-in method), then close the open question in
  `docs/API.md`.
- **Leaving AWS:** when the credits run low, follow `docs/LEAVING-AWS.md`.
