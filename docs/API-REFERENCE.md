# API reference

Every route the API serves, at `https://api.uiuchousing.com` (locally `http://localhost:3001`).
For running it, configuration, authentication and rate limiting, see [API.md](API.md). Routes
are defined in `server/src/routes/`, and the response types below are the ones exported from
`server/src/repositories/`.

## Conventions

- **JSON in and out.** Request bodies are JSON (`Content-Type: application/json`), at most 1 MB.
- **Field names are camelCase** (`rentMin`, `leaseTerm`), unlike the database's snake_case.
- **Averages are numbers or `null`**, rounded to one decimal place. `null` means no published
  reviews; a property with none has `reviewCount: 0`.
- **Lists are paginated** and come back in one envelope:

  ```json
  { "data": [ ... ], "page": 1, "perPage": 24, "total": 57, "totalPages": 3 }
  ```

  `page` starts at 1 (at most 10,000); `perPage` is capped at 100. A page past the end returns
  an empty `data` with the true `total`.
- **Paginated orders are total.** Each ends in a unique column (the slug, or a review's id), so
  equal values never swap between pages.
- **Auth** is `Authorization: Bearer <Supabase access token>`, required where marked 🔒. See
  [API.md](API.md#authentication) for what a token must prove.
- **Writes** marked ✍️ also count against the per-account write limit (20 an hour by default);
  a failed write is not counted.

### Errors

Every error has the same shape:

```json
{ "error": { "code": "validation_failed", "message": "perPage: Too big: expected number to be <=100" } }
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `validation_failed` | A query parameter, path parameter or body field is invalid; the message names it |
| 400 | `bad_request` | Malformed request, such as unparseable JSON |
| 401 | `unauthorized` | No token, or a token that is forged, expired, or for another issuer or audience |
| 403 | `forbidden` | A valid token that is not an `@illinois.edu` address, is anonymous, or never proved the inbox; or changing someone else's review |
| 404 | `not_found` | No such route, property, company or review |
| 409 | `already_reviewed` | This account already has a review of this property |
| 409 | `already_reported` | This account already reported this review |
| 409 | `under_moderation` | Deleting a review a moderator has hidden |
| 409 | `email_taken` | The token's email belongs to another account |
| 409 | `user_unavailable` | The account row vanished mid-request; retry |
| 413 | `payload_too_large` | Body over 1 MB |
| 415 | `unsupported_media_type` | Body whose content type is neither JSON nor plain text (a plain-text body fails validation instead, with 400) |
| 429 | `rate_limited` | Over a rate limit; `Retry-After` says when to come back |
| 500 | `internal_error` | A bug; details are only in the server log |
| 503 | `service_unavailable` | The database (`/readyz`) or Supabase's key set is unreachable |

## Types

```ts
type Averages = { overall: number | null; maintenance: number | null; communication: number | null; value: number | null }

type PropertySummary = {
  id: string; slug: string; name: string; address: string; neighborhood: string | null
  rentMin: number | null; rentMax: number | null                // both null when unknown
  bedrooms: number[]                                            // 0 is a studio; empty when unknown
  unitCount: number | null; stories: number | null              // from public building data
  company: { slug: string; name: string } | null                 // null: not known
  reviewCount: number; averages: Averages
}

type Review = {                                                  // as the public sees it: no author
  id: string; maintenance: number; communication: number; value: number; overall: number
  body: string; leaseTerm: string; isSample: boolean; createdAt: string   // ISO 8601
}

type CompanySummary = {
  id: string; slug: string; name: string; website: string | null
  propertyCount: number; reviewCount: number; averages: Averages
}

type OwnedReview = {                                             // the author's view of their own review
  id: string; propertyId: string; propertySlug: string; authorId: string | null
  maintenance: number; communication: number; value: number; overall: number
  body: string; leaseTerm: string; status: 'published' | 'hidden' | 'removed'
  createdAt: string; updatedAt: string
}

type User = { id: string; email: string; displayName: string | null; role: 'student' | 'moderator' | 'admin'; createdAt: string }

type Report = {
  id: string; reviewId: string
  reason: 'spam' | 'harassment' | 'not_a_tenant' | 'personal_info' | 'other'
  details: string | null; status: 'open' | 'dismissed' | 'actioned'; createdAt: string
}
```

A company's `averages` are over every published review of every one of its buildings together.

## Health

### `GET /healthz`
The process is up. Never touches the database. `200 { "status": "ok" }`. Not rate limited.

### `GET /readyz`
The database answers, within 2 seconds. `200 { "status": "ready" }` or `503`. Not rate limited,
and answered 404 from the internet by Caddy; query it on the instance
([INFRASTRUCTURE.md](INFRASTRUCTURE.md#when-something-is-wrong)).

## Properties

### `GET /api/properties`
The directory. Every parameter is optional; an empty value (`?q=`) means "no filter". Without
`q` it lists the directory's buildings; with `q` it also finds houses and buildings of unknown
type. Some imported buildings (Greek houses, for now) are in neither, but `GET
/api/properties/:slug` still returns them.

| Query | Meaning |
| --- | --- |
| `q` | Name or address contains this text, case-insensitive. At most 100 characters; `%` and `_` match literally |
| `company` | Company slugs. Repeated (`?company=a&company=b`) or comma-separated (`?company=a,b`) |
| `hood` | Neighborhoods, same forms |
| `beds` | Bedroom counts 0–20, same forms. Matches a property offering **any** of them |
| `maxRent` | Whole dollars, 1–100,000. Matches when the **cheapest** unit is within it; a property with unknown rent never matches |
| `sort` | `rating` (default; unreviewed last), `price` (cheapest first, unknown rent last), `reviews` (most first). Ties go largest building first |
| `page`, `perPage` | Default `1` and `24` |

`200` — page of `PropertySummary`.

### `GET /api/properties/:slug`
One property with a page of its published reviews, newest first. Query: `page`, `perPage`
(default 20).

`200` — `PropertySummary & { reviews: Page<Review> }`. `404` if there is no such property.

### `POST /api/properties/:slug/reviews` 🔒 ✍️
Write a review.

```json
{ "overall": 4, "maintenance": 3, "communication": 4, "value": 5,
  "body": "At least 20 and at most 2000 characters, trimmed.", "leaseTerm": "2024-25" }
```

Ratings are whole numbers 1–5; all four are required. `leaseTerm` is 1–40 characters, trimmed.

`201` — `OwnedReview`, status `published`. `404` no such property; `409 already_reviewed`.

## Reviews

### `PATCH /api/reviews/:id` 🔒 ✍️
Change your own review. Send only the fields that change, at least one; each is validated as on
create. Fields you leave out keep their current value, even if another edit lands at the same
time.

`200` — `OwnedReview`. `403` not yours; `404` no such review, or removed.

### `DELETE /api/reviews/:id` 🔒 ✍️
Withdraw your own published review. It is marked `removed`, disappears from every read, and no
longer counts toward one-review-per-property, so you can write a new one.

`204`. `403` not yours; `404` no such review, or already removed; `409 under_moderation` if a
moderator has hidden it.

### `POST /api/reviews/:id/reports` 🔒 ✍️
Report a review to a moderator.

```json
{ "reason": "personal_info", "details": "Optional, at most 1000 characters." }
```

`201` — `Report`, status `open`. The review is **not** hidden by a report. `404` if there is no
published review with that id, which includes hidden and removed ones; `409 already_reported`.

## Companies

### `GET /api/companies`
Query: `sort` — `rating` (default), `name`, `properties` (most first), `reviews` (most first);
`page`, `perPage` (default 24).

`200` — page of `CompanySummary`.

### `GET /api/companies/:slug`
One company with a page of its buildings, highest rated first. Query: `page`, `perPage` (default
24).

`200` — `CompanySummary & { properties: Page<PropertySummary> }`. `404` if there is no such company.

## Filters

### `GET /api/filters`
The choices the directory's filters offer, from the whole catalog.

`200` — `{ companies: { slug, name }[], neighborhoods: string[], bedrooms: number[], maxRent: number }`,
companies by name, the rest ascending; `bedrooms` uses `0` for a studio, and `maxRent` is the
highest `rentMax`, or `0` with no buildings.

## You

### `GET /api/me` 🔒
The signed-in account, created on first sight. The quickest end-to-end check of sign-in.

`200` — `User`.

### `GET /api/me/reviews` 🔒
Your reviews, newest first, including ones a moderator has hidden from everyone else, but not
removed ones. Not paginated.

`200` — `OwnedReview[]`.
