# Moderation

Reviews go live as soon as a signed-in student posts them. Readers who are signed in can report a
review; a report hides nothing by itself. It waits for a moderator, who decides with the
operator tool below. There is no moderation page on the site on purpose: the API's own database
login cannot change a review's status (except an author withdrawing their own), so a compromised
API or a stolen session cannot hide or publish reviews.

## Checking for reports

Nothing notifies you of a new report yet, so check regularly (weekly is plenty at launch):

```bash
infra/moderate.sh reports        # open reports, oldest first, with reasons, details and the review
infra/moderate.sh recent 20      # the newest reviews, reported or not
```

This runs through the same tunnel as the other operator scripts (needs `aws login` and
`cd server && npm ci`). Locally: `cd server && npm run moderate -- reports`.

## Acting on a report

Each command is a dry run until `--apply` is added:

```bash
infra/moderate.sh hide <review-id> --apply      # hide the review; its open reports become "actioned"
infra/moderate.sh dismiss <review-id> --apply   # keep the review; its open reports become "dismissed"
infra/moderate.sh restore <review-id> --apply   # undo a hide
```

A hidden review disappears from the building page and its averages. Its author still sees it,
with a note that a moderator hid it, and cannot post another review of that building while it is
hidden. A review its author withdrew is never touched. Nothing is deleted.

## Deciding

Hide a review that:

- shares personal information, or names an individual staff member;
- harasses anyone, or contains slurs or threats;
- was clearly not written by someone who lived there (the landlord, a competitor, an ad).

Do **not** hide a review for being negative. A landlord who says a review is false should point to
a specific false statement of fact; opinions ("the office was rude") stay. When unsure, leave the
review up and dismiss the report later if nothing else comes in.

Reporter and author identities stay out of the tool's output. If you need to know who wrote a
review (repeated abuse, say), the `reviews.author_id` → `users.email` link is in the database.
