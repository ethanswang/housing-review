# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**Security → [Report a vulnerability](https://github.com/ethanswang/housing-review/security/advisories/new)**.
Do not open a public issue.

Include what you found, how to reproduce it, and what it would let someone do. Replies come
through the advisory. This is a student project run by one person, so there is no bug bounty,
but credit is given in the fix if you want it.

## In scope

- The website at `www.uiuchousing.com` and the API at `api.uiuchousing.com`
- Anything in this repository

Of particular interest: posting or editing a review as someone else, getting past the
`@illinois.edu` requirement or the rate limits, reading data that should not be public, and
anything that reveals who wrote a review.

The sign-in requirement and the rate limits are enforced by the API, which the website reads
and posts through.

## Please don't

- Test against other people's accounts or reviews, or post content to the live site beyond
  what a proof needs.
- Run load or denial-of-service tests against the live site.
- Social-engineer anyone.

For a review you believe breaks the site's rules, rather than a security problem, use the
**Report** link under it.
