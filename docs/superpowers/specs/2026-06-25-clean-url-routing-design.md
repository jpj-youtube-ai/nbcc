# TASK-002 — Clean-URL routing for the static site

**Requirement:** REQ-002 (clean URLs). Complements but does **not** implement
REQ-033 (hosting/perf). Scope is URL mapping only.

## Problem

TASK-001 shipped four standalone pages at the repo root —
`index.html`, `about.html`, `donate.html`, `contact.html` — each a complete
HTML5 document sharing one stylesheet and one script. They are served as static
files, independent of the Express service.

We want each page reachable at a clean, canonical URL (no `.html`), so that the
eventual navigation and any external links use stable, pretty paths.

## URL map

| Clean URL    | Serves        |
|--------------|---------------|
| `/`          | `index.html`  |
| `/about-us`  | `about.html`  |
| `/donate`    | `donate.html` |
| `/contact`   | `contact.html`|

## Approach

The hosting platform (REQ-033) is undecided, so we ship a **portable
Netlify-style `_redirects`** file at the repo root and document the equivalent
rules for other hosts in the README. `_redirects` is the simplest, most widely
recognised portable format; it is honoured natively by Netlify and Cloudflare
Pages and is trivial to translate to `netlify.toml`, Vercel, nginx, or Apache.

### `_redirects` rules

Two kinds of rule:

1. **Rewrites (200)** — serve the page's HTML at the clean URL without changing
   the address bar:

   ```
   /about-us   /about.html    200
   /donate     /donate.html   200
   /contact    /contact.html  200
   ```

   `/` is served from `index.html` automatically by every static host, so it
   needs no rewrite rule.

2. **Canonical redirects (301!)** — collapse the raw `.html` paths onto the
   clean URL so each page has exactly one canonical address. The `!` force flag
   is required because the `.html` files physically exist and would otherwise be
   served directly:

   ```
   /index.html   /           301!
   /about.html   /about-us   301!
   /donate.html  /donate     301!
   /contact.html /contact    301!
   ```

Rewrites and redirects never collide: a request matches by path, and the two
groups use disjoint from-paths.

## Internal links

The pages currently have **no inter-page links** — the `<header
data-region="nav">` is an empty placeholder owned by a later requirement. So
"internal links use clean URLs" is enforced as a **guard**: no page may link to
another page via a raw `.html` href. When nav lands later it must use
`/about-us`, `/donate`, `/contact`.

## Testing (golden rules 1 & 5)

A DB-free Vitest unit test, `test/unit/clean-urls.test.ts`, encodes the
acceptance check portably (no live host needed):

- For each clean URL, the `_redirects` file has a `200` rewrite to the expected
  `.html` file, that file exists, and its `<title>`/`<h1>` matches the page.
- Each raw `.html` path has a `301!` canonical redirect to its clean URL.
- No page links to another page through a raw `.html` href (clean-link guard).

BDD is intentionally **not** used here: the static site is not served by the
Express app (whose `BASE_URL` the Cucumber harness targets), so an HTTP feature
test would not exercise these rewrites. The unit test validates the config that
the host consumes, which is the deliverable.

## Out of scope

- The actual static host / CDN / performance work (REQ-033).
- The navigation markup and footer (later REQ-010+).
- Any change to the Express service.

## Files

- `_redirects` (new) — the rewrite/redirect config.
- `test/unit/clean-urls.test.ts` (new) — acceptance check as unit tests.
- `README.md` (edit) — document the clean-URL map, the `_redirects` rules, and
  per-host equivalents.
- `docs/superpowers/specs/2026-06-25-clean-url-routing-design.md` (this doc).
