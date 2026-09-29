# Design

The visual system and page layouts for the site: type, colour, the rating display, and how each
page is laid out on a phone and on desktop. Implemented in #25. §8 lists where the build
departed from the first draft, and why.

## 0. Deliberately left out

Common housing-site features the current data model does not support. The redesign changed
presentation only, not data, so none of these has a placeholder; each needs a schema change
first.

| Feature | What exists today | Decision |
|---|---|---|
| Photos first on listings; photo thumbs in browse | No image field on `properties` | Leave out. No stock or placeholder images. Layout keeps room to add a photo strip above the title later. |
| Distance to campus | No coordinates or distance | Leave out. Key facts show what exists: rent, bedrooms, area, management. |
| Lease terms (on the listing) | Only `review.lease_term`, which is the year a reviewer lived there (e.g. `2024-25`) | Leave out at listing level. Show the year on each review as "Lived here 2024–25". |
| Map/list toggle (StreetEasy) | No coordinates | Leave out. List only. |
| Reviewer unit type | Not collected | Leave out. |
| "Helpful" count | Not in the schema | Leave out. |
| Sub-ratings: noise, landlord responsiveness | Schema has `maintenance`, `communication`, `value` | Keep those three. "Communication" already covers landlord responsiveness. Adding noise changes the form and schema. |
| Recent reviews easy to find | Already sorted newest-first in `getPropertyBySlug` | Label the list "Newest first" and show a date on every review (`created_at` exists and isn't shown yet). |

The earlier palette was Illini navy (`#13294b`) and orange (`#ff5f05`). School colours make an independent site look official, so both were replaced (§3).

## 1. Typeface: keep Public Sans, one family

**Choice:** Public Sans (already loaded via `next/font/google`), weights 400 / 600 only.

**Why it works for long reviews on a phone:**
- **Large x-height and open apertures.** `a e c s` stay distinct at 16px on a 390px screen. That matters most for long paragraphs read at arm's length.
- **Clear letterforms.** `I l 1` and `O 0` are distinguishable, which helps with addresses, prices, and unit numbers.
- **Real tabular figures (`tnum`).** Rating numbers and prices line up in columns. The rating system (§4) depends on this.
- **Neutral, civic feel.** It was designed for US government sites. It reads like a public record rather than a leasing brochure, which suits "independent and trustworthy".
- **No new dependency.** It's already self-hosted by `next/font`, and it keeps the earlier "one typeface throughout" decision (#20).

Considered and rejected: Source Serif 4 for review text only (closer to Letterboxd's editorial feel). It adds a second family and a second download, with no legibility gain at 16px on modern phone screens.

## 2. Type scale (5 sizes)

| Token | Size / line-height | Weight | Used for |
|---|---|---|---|
| `text-meta` | 13px / 18px | 400, 600 | Metadata, labels, dates, counts, chip text. **Sentence case.** The 11px uppercase `.label` is removed because it's below comfortable reading size. |
| `text-body` | 16px / 26px (1.625) | 400 | Review text, form inputs (16px also stops iOS zooming in on focus), body copy |
| `text-title` | 20px / 28px | 600 | Property names in the list, section headings, the overall score on list rows and review cards |
| `text-heading` | 28px / 34px | 600 | Property/company name on detail pages (mobile), big score (mobile) |
| `text-display` | 40px / 44px | 600 | Property name and big score at ≥768px only |

Review text is capped at `max-width: 65ch` (about 600px). On a 390px phone the 16px gutters give roughly 45 characters per line.

## 3. Spacing, palette, surfaces

**Spacing (4px base):** 4, 8, 12, 16, 24, 32, 48, 64. These map to Tailwind `1 2 3 4 6 8 12 16`, and no other values are used. The page gutter is 16px on mobile and 24px at ≥768px.

**Palette (neutral plus one accent).** Contrast is measured against `bg`:

| Token | Hex | Contrast | Role |
|---|---|---|---|
| `bg` | `#FAFAF7` | — | Page background: off-white, not newsprint cream |
| `surface` | `#FFFFFF` | — | Inputs, bottom sheet, sticky summary panel |
| `ink` | `#1C1B19` | 16.5 : 1 | Text, rating bars |
| `ink-soft` | `#45433F` | 9.4 : 1 | Secondary text |
| `muted` | `#6B6862` | 5.3 : 1 | Metadata (passes AA for body text) |
| `rule` | `#E4E2DC` | — | Dividers, bar tracks |
| `rule-strong` | `#8C8983` | 3.3 : 1 | Input borders (passes the 3:1 non-text contrast rule) |
| `accent` | `#1F6B4A` | 6.2 : 1 (white on accent 6.4 : 1) | Links, primary button, selected chips/segments, focus ring. **Interactive elements only.** |

**Why a deep green accent:** it isn't purple, indigo, or Illini colors. It isn't the blue most property-management sites use, and it isn't the red/pink of listing marketplaces. It's quiet enough to use only for things you can tap.

**Rating bars are drawn in `ink`, not the accent.** A colored bar suggests "good" even for a score of 1.8. In ink it's just a length, the way Airbnb shows its category scores.

**Surfaces:**
- **No card boxes.** Lists are separated by 1px `rule` dividers (Letterboxd review lists, StreetEasy result rows).
- **Only two things get a border or panel:** the bottom sheet, and the sticky rating summary on desktop.
- **Shadows:** one, on the bottom sheet only, to show it sits above the page.
- **Corners:** 8px radius on inputs, buttons, and the sheet; nothing else is rounded.
- **Never used:** gradients, glows, blur, or glass effects.

## 4. Rating display system

**Rule: every rating is a number. A sub-rating is always a number plus a thin bar. The overall score is always a number alone, never a bar. No star icons anywhere.**

| Context | Overall | Sub-ratings |
|---|---|---|
| Listing summary (detail page) | `4.2` in `heading`/`display`, then "out of 5 · 12 reviews" in `meta` | Three rows: label (meta), a 4px ink bar on a `rule` track filling the remaining width, and the value `3.8` (tnum, right-aligned) |
| Browse row | `4.2` in `title`, right-aligned; "12 reviews" below in `meta` | Not shown. Rows stay one scan-line tall. Sub-ratings are one tap away. |
| Review card | `4` in `title`, in a fixed-width left column | Three fixed columns, each a label with the value and a 40px mini bar under it (same encoding as the summary), in `meta`. |
| Company page | Same as the listing summary, plus the existing "averaged across properties" note | Same |
| No data | `—` in the same size, in `muted`, with "No reviews yet" | Hidden |
| Form input | Segmented control: five 44×44px buttons labelled `1`–`5`. Only the chosen number fills with the accent (not 1…n). A native radio group underneath, as now. | Same control |

Filling only the chosen number (an earlier form filled 1 through n) stops the control looking like a star row, and it matches how the score is then displayed.

## 5. Layouts

### 5.1 Global chrome
- **Header:** the wordmark "UIUC Housing Review" in `title`, with a `meta` line "Student-run · Not affiliated with UIUC or any landlord". On mobile the line sits below the wordmark; on desktop it sits on the right. The double rule and the second masthead line are removed.
- **Prototype notice:** kept (the data is synthetic), but as a single `meta` line with a left rule. Not a colored callout.
- **Footer:** unchanged content, restyled with the new tokens.

### 5.2 Search / browse (`/`)
Based on StreetEasy's result list and Airbnb's filter sheet.

**Mobile (390px), top to bottom:**
1. **Intro.** A one-sentence page title, "Apartment reviews from Illinois students", in `heading`, followed by the prototype line. No hero and no marketing copy.
2. **Search.** A full-width input at 48px tall, `body` size, on a white surface.
3. **Control row**, sticky under the header while you scroll:
   - A `Filters` button, with a count badge when filters are active: "Filters · 2".
   - A native sort `<select>`.
   - Both are 44px tall.
4. **Active filter chips.** A horizontally scrolling row. Each chip is 36px tall inside a 44px tap area and has a ✕ to remove that one filter. Only shown when there are active filters.
5. **Result count** (`meta`): "14 properties · 83 reviews".
6. **Result rows,** separated by dividers, each a full-width tap target:
   ```
   Green Street Towers                        4.2
   JSM · Campustown                    12 reviews
   $850–1,200/mo · 1–3 BR
   ```
   - Name in `title`; company · area and price · beds in `meta`, with price in tnum.
   - Score column at a fixed 56px width, so scores line up down the page.

**Filters bottom sheet (mobile):**
- **Shape:** slides up from the bottom, up to 85% of the screen height. The page behind is dimmed with a flat 40% ink overlay, no blur.
- **Header:** "Filters" plus "Clear all".
- **Body:** the same groups as today (Management company, Area, Max rent, Bedrooms). Checkbox rows are 44px tall and bedroom buttons are 44×44px.
- **Footer:** a sticky full-width "Show 14 properties" button that closes the sheet.
- **Behavior is unchanged:** each change still writes to the URL right away (`router.push`), so the count updates behind the sheet.
- **Accessibility:** the sheet is a native `<dialog>` for focus trapping, and Esc or tapping the overlay closes it.

**Desktop (≥1024px):**
- A two-column grid: the same filter groups, plus sort, as a 240px left rail with no box and no sheet, and results on the right. The rail isn't sticky (§8).
- The results column is capped at 720px so rows don't stretch.
- The filter button and sheet are hidden.

**Empty (filters):** "Nothing matches these filters." plus a "Clear filters" button. Left-aligned, no dashed box.

**Empty (no data):** "No properties have been added yet."

**Loading:** `app/(directory)/loading.tsx` renders six skeleton rows: two grey bars on the left and a 32px square on the right, in `rule`, with a gentle pulse that's off under `prefers-reduced-motion`.

### 5.3 Listing detail (`/properties/[slug]`)
Based on Airbnb's detail page structure and Letterboxd's review column.

**Mobile, top to bottom (the rating summary must be visible on a 390×844 screen without scrolling):**
1. A "← All properties" link, 44px tall.
2. **Name** in `heading`. Below it, "JSM · Campustown" (company links to its page) and the address, both in `meta`.
3. **Rating summary:** the big overall number with "out of 5 · 12 reviews", then three sub-rating bar rows (§4). About 150px tall.
4. **Key facts,** as a 2×2 `<dl>` grid with 1px dividers:
   - Rent `$850–1,200/mo`
   - Bedrooms `1, 2, 3`
   - Area `Campustown`
   - Managed by `JSM`

   Labels are in `meta`, values in `body` semibold.
5. **Reviews header:** "12 reviews" on the left, "Newest first" on the right, and the note on sample entries below. The "Write a review" button sits in the rating summary (step 3) instead (§8).
6. **Review list** (§5.4).
7. **Write a review** (§5.5) at the bottom of the page.
   - This moves the form below the reviews. People who arrive from a shared link came to read, not write.
   - The summary's button and the empty state both link to it.

**Desktop (≥1024px):**
- Two columns: the main column (max 680px) holds the name, key facts, and reviews.
- The right column (320px) is sticky: the rating summary plus a full-width "Write a review" button, on a white panel with a 1px border. This is the one panel on the page.

**Empty state (0 reviews):**
- Replaces the summary and list with "No reviews yet — lived here? Be the first." in `title`.
- Adds one line of `meta`, "Takes about a minute. No account needed.", and a primary button "Write the first review" that jumps to the form.

**Loading:** no skeleton, on purpose. A `loading.tsx` makes Next.js commit a `200` before the page runs, so a missing property would be served as a soft 404 instead of a real `404`. For the same reason the directory's skeleton sits inside the `(directory)` route group, which scopes it to `/` alone.

### 5.4 Review card
A divider above each review, with no box, background, or shadow (Letterboxd style).

```
4   Lived here 2024–25 · Posted Mar 2025        [Sample]
    The office took three weeks to fix our heat in January, but
    once maintenance showed up they were thorough. Walls are thin…
    (16px / 26px, max 65ch)

    Maintenance     Communication   Value
    3 ▮▮▮▯▯         2 ▮▮▯▯▯         4 ▮▮▮▮▯
```

- **Left column:** the overall score in `title`, 32px wide. The body text runs in the column to its right, so the eye can go down the scores and down the text separately.
- **Meta line:** "Lived here {lease_term}" (the en dash is display only; data unchanged) and "Posted {Mon YYYY}" from `created_at`, formatted on the server with `toLocaleDateString('en-US', { month: 'short', year: 'numeric' })`.
- **Sample badge:** stays, restyled as a `meta` outline tag.
- **Spacing:** 24px vertical padding per review; 16px between the meta line, body, and sub-ratings.

### 5.5 Write-a-review flow
It stays one form, submitted to the same `submitReview` action with the same field names. Only the order and styling change, so it reads top to bottom like a short survey:

1. **Heading:** "Write a review", with "Posted anonymously · takes about a minute" in `meta`.
2. **When did you live here?** A lease year text input (16px, 48px tall, capped at 192px wide on desktop) with the `2024-25` placeholder.
3. **Overall — would you sign again?** A 1–5 segmented control.
4. **Three sub-ratings.** Each is a segmented control with its existing hint line, stacked at every width (§8).
5. **Your review.** A textarea, at least 6 rows, 16px text, with the guidance text below it (unchanged).
6. **Errors:** shown above the button with `role="alert"`, as now, as `ink` text with a left rule. No colored box.
7. **Post review button:** a primary accent button, full width on mobile and auto width on desktop, 48px tall.
8. **Success:** replaces the form with "Thanks — your review is live." in `title` and a `meta` line, left-aligned. No colored box.

### 5.6 Company page (`/companies/[slug]`)
Same structure as listing detail: name, rating summary with the averaging note, then a "Properties" list made of the §5.2 result rows instead of the current bordered cards.

## 6. Accessibility checklist (applies to every page)
- Everything you can tap is at least 44×44px, counting padding. Inline text links inside a paragraph are the exception WCAG allows.
- Text contrast is at least 4.5:1; borders and focus rings at least 3:1 (all tokens above pass).
- Focus ring: 2px accent outline with a 2px offset, as now.
- All form inputs are 16px or larger, so iOS doesn't zoom in when you tap them.
- Skeletons carry `aria-busy` and a visually hidden "Loading" message. Pulse animation is off under reduced motion.
- The bottom sheet is a `<dialog>`: focus moves into it and comes back to the Filters button when it closes.

## 7. What changes in code, and what doesn't

- **Changed:**
  - `app/globals.css` (tokens)
  - `app/layout.tsx` (header)
  - the three pages
  - all six components
  - new: `app/(directory)/loading.tsx`; the directory page moved into that route group
  - `components/PropertyCard.tsx` is renamed to `PropertyRow.tsx`
  - the mobile sheet lives inside `FilterRail.tsx`, so every filter control still goes through a single `apply()`
- **Unchanged:**
  - `lib/` (queries, filters, types)
  - `app/actions.ts`, including its form field names
  - URL parameters
  - server/API
  - schema
- **Behavior that stays identical:**
  - filters write to the URL on change
  - search submits to `?q=`
  - sort options
  - the form's validation and success state
  - reviews are ordered newest first

## 8. Where the build departs from the draft

These came out of the 390px and 1280px screenshot passes:

- **No "Write a review" link in the header.** It could only send people to search, which the search box right below it already does.
- **No drag handle on the sheet.** A handle suggests you can drag it, and the sheet has no drag behaviour. It closes with ✕, Esc, tapping the overlay, or the "Show N properties" button.
- **"Write a review" lives in the rating summary, not the reviews header.** One button instead of two, and it stays visible on mobile above the fold and on desktop in the sticky column.
- **Form sub-ratings stack at every width.** Five 44px segments (236px) didn't fit a third of the 672px form column, so the 3-column layout overflowed.
- **The desktop filter rail isn't sticky.** With 44px rows it's taller than an 800px-high window, so a sticky rail would hide its last groups.
- **Review-card sub-ratings use three fixed columns.** At 390px the inline version wrapped raggedly ("Maintenance" alone on its own line).
- **The company link moved into the "Managed by" fact** and is stretched over the whole cell, so it's a real 44px tap target and the name isn't repeated in the header.
