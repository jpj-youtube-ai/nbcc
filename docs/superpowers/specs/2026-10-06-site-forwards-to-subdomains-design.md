# Spare addresses can forward to an NBCC subdomain: design

Date: 2026-10-06. Task: TASK-568. The client asked for Admin > Site pages to let staff add addresses
that forward, including to subdomains (nbcc.scot/drop to drop.nbcc.scot), without coming back for
each one. They chose "NBCC addresses only", and asked for /drop to be created with the release.

## What is there today

Admin > Site pages > Spare addresses already lets staff add a forward (`site_aliases`: `from_path`,
`to_path`). The destination is a dropdown of the site's own pages (`aliasToProblem` accepts only a
registry page), and the catch-all in `src/routes/site.ts` answers a hit with a 301.

It was checked first that a path can forward to a subdomain: a forward is an HTTP redirect, and its
`Location` may be any address. `drop.nbcc.scot` resolves; `nbcc.scot/drop` is a 404 today.

## Decisions

| | Now | After |
|---|---|---|
| Destination | one of the site's pages | a page, **or an nbcc.scot subdomain** typed by staff |
| Typed as | - | `drop.nbcc.scot` or `drop.nbcc.scot/collect` (a pasted `https://` or `http://` is accepted) |
| Stored as | `/donate` | `https://drop.nbcc.scot/collect`, always https |
| Refused | - | any host that is not `<name>.nbcc.scot`; `www.nbcc.scot` and bare `nbcc.scot` (they are this site: use the page list, and a forward to them could loop); a port, a user name, a `?query` or a `#fragment` |
| Forward kind | 301 | **302 for a subdomain**; 301 unchanged for the site's own pages |
| The form | a dropdown | the dropdown gains a last choice, "An NBCC subdomain…", which shows a text box |
| The list | path | the stored address, with a "Subdomain" pill |
| /drop | 404 | forwards to `https://drop.nbcc.scot` (seeded by a migration) |
| /referrals, /referral | 404 | forward to `https://referrals.nbcc.scot` (asked for the same evening; seeded too) |
| /volunteer, /volunteers | 404 | forward to `https://vol.nbcc.scot` (seeded too) |

- **302, not 301, for a subdomain.** A browser keeps a 301 for good, so a visitor who had used /drop
  would go on reaching the old place after staff changed or removed it. Staff-managed forwards must
  be changeable.
- **Only nbcc.scot subdomains.** If a staff login were misused, an nbcc.scot link still could not be
  pointed at somebody else's website. A lookalike (`nbcc.scot.example.com`, `evilnbcc.scot`) is
  refused because the host must END in `.nbcc.scot` and is read by the URL parser, not by a pattern
  on the typed text.
- **The site does not check the subdomain exists.** Making one is a DNS job; the form says so.
- The spare address itself keeps every rule it has (`aliasFromProblem`): it cannot shadow a page.
- The query a visitor arrives with is still carried across (`keepQuery`), so QR scans keep counting.

## How it works

- `src/site/pages.ts`: `forwardTarget(typed)` returns the stored form (`https://host/path`) or null.
  `aliasToProblem(to)` accepts a registry page, or a string that is already its own stored form.
- `postAdminSiteAlias`: a destination not starting with `/` goes through `forwardTarget` first; a
  null answer is a 400 with a sentence saying what is allowed.
- `src/routes/site.ts`: a target starting `https://` is sent with 302, anything else 301 as now.
- No schema change: `to_path` is text. One migration adds the /drop row if no /drop exists.
- `admin.html` / `app.js`: the extra choice and its box; the pill in the list.

## Testing

- `test/unit/site-pages.test.ts`: what `forwardTarget` accepts, normalises and refuses (lookalikes,
  www, ports, credentials, queries), and `aliasToProblem` for both kinds.
- `test/unit/admin-site-forward-ui.test.ts`: choosing the subdomain option shows the box and posts what was typed.
- A migration test for the /drop row.
- `features/site-pages.feature`: an admin adds a subdomain forward and it answers 302 with the query
  kept; a lookalike is refused.
- The form in a real browser, with a picture for the client before it goes live.
