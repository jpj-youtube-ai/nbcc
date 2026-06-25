# TASK-004 — Per-page SEO & social metadata

**Task:** TASK-004 — give each static page unique SEO + social-share metadata.
Builds on the REQ-001 skeleton (TASK-001) and the TASK-002 clean URLs. Stops at
referencing the share-image path; the asset pipeline is REQ-034 and the
accessibility/mobile floor is REQ-032 (already met: `lang` + viewport present).

## Canonical domain (placeholder)

No production domain exists yet (hosting is REQ-033). Canonical/og:url must be
absolute, so a **documented placeholder** is used:

```
https://www.example.org      <-- PLACEHOLDER, replace at REQ-033
```

It is the single base for every absolute URL below. REQ-033 finalises it with one
find/replace across the four pages and the test. The placeholder is flagged in
the README and in an HTML comment on each page.

## Per-page metadata

Paths use the TASK-002 clean URLs. Canonical and `og:url` are identical per page.

| File | `<title>` (unchanged) | Canonical = `og:url` |
|---|---|---|
| `index.html`   | `Home — Charity Site`    | `https://www.example.org/`         |
| `about.html`   | `About — Charity Site`   | `https://www.example.org/about-us` |
| `donate.html`  | `Donate — Charity Site`  | `https://www.example.org/donate`   |
| `contact.html` | `Contact — Charity Site` | `https://www.example.org/contact`  |

Titles are kept as-is — they are already unique and TASK-001's
`static-site.test.ts` asserts each contains its page label (Home/About/Donate/
Contact). Each page also gets a unique `<meta name="description">` (placeholder
copy; real content is REQ-010+).

### Tag set added to every page's `<head>`

Same structure and order on all four pages (the no-build "shared head pattern");
only the values differ.

- `<meta name="description" content="…">` — unique per page
- `<link rel="canonical" href="…absolute clean URL…">`
- Open Graph: `og:type` = `website`, `og:site_name` = `Charity Site`,
  `og:title`, `og:description`, `og:url` (= canonical), `og:image`
- Twitter: `twitter:card` = `summary_large_image`, `twitter:title`,
  `twitter:description`, `twitter:image`
- `lang="en"` on `<html>` and the viewport `<meta>` stay (REQ-032 floor)

`og:title`/`twitter:title` mirror the page `<title>`; `og:description`/
`twitter:description` mirror the meta description.

### Share image

A single shared image referenced absolutely:

```
https://www.example.org/assets/img/og-image.png
```

Used for both `og:image` and `twitter:image`. **The path is referenced only** —
the image file and any asset pipeline are REQ-034, out of scope here. (Acceptance
needs distinct title/description/canonical/og:url, not distinct images, so one
shared image is sufficient.)

## Testing (golden rules 1 & 5)

New `test/unit/seo-metadata.test.ts`, DB-free, encodes the acceptance check:

- Each page exposes the full tag set above, all non-empty.
- `canonical` is absolute (under the placeholder base) and equals the expected
  clean-URL path; `og:url` === `canonical`.
- `og:image`/`twitter:image` are absolute and reference `/assets/`.
- `og:type` = `website`, `twitter:card` = `summary_large_image`.
- `lang="en"` and a viewport meta are present.
- **Cross-page:** title, description, canonical and `og:url` are each distinct
  across all four pages (no duplication).

Existing `static-site.test.ts` and `clean-urls.test.ts` stay green: the new tags
add no extra `.css`/`.js` hrefs and no raw `.html` links.

## Out of scope

- The real domain / hosting (REQ-033) and the share-image asset/pipeline
  (REQ-034).
- Page body content (REQ-010+) and any title rewrites.

## Files

- `index.html`, `about.html`, `donate.html`, `contact.html` (edit `<head>`).
- `test/unit/seo-metadata.test.ts` (new).
- `README.md` (note per-page metadata + the placeholder-domain flag).
- `docs/superpowers/specs/2026-06-25-per-page-seo-metadata-design.md` (this doc).
