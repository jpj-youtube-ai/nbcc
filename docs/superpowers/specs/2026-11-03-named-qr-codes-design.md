# Named QR codes, each counting its own scans: design

Date: 2026-11-03. Asked for by Jaimie, designed in chat with a mockup, and approved the same day
("Yes, build it"). Builds on the admin QR codes (`2026-10-02-admin-qr-codes-design.md`).

## What it is for

When the Donate QR code goes on a billboard and on a business card, staff want to know which one
people scan. So each place a code is printed or shown gets its own code, with a name staff choose,
and each one counts its own scans. Where a code goes is chosen from a list, never typed, so a typo
can never make a broken printed code.

## Decisions

| Question | Answer |
|---|---|
| Can a printed code change where it goes? | **Yes** (Jaimie). The code holds a short link, `nbcc.scot/q/c<id>`, that forwards to the chosen page. A destination can be changed, or a mistake fixed, after printing. A short link also makes a smaller code that scans easily on a business card. |
| The old one-code-per-page list | **Kept**, underneath, as "A quick code for every page" (Jaimie). Codes already printed from it keep working and counting. |
| What "Goes to" offers | Every page of nbcc.scot (`SITE_PAGES`), plus **our three sign-up sites**: drop.nbcc.scot, referrals.nbcc.scot and vol.nbcc.scot (Jaimie). No events or fundraiser pages. |
| The "Any other nbcc.scot address" typing box | **Removed** (Claude's call, from "rather than typing it in, select from the list"). |
| Where scans are counted | **At the short link** (Claude's call). One number per code per UK day, nothing about the person scanning. Counting on the landing page could not count a code that goes to a sign-up site. Bots, link previews and HEAD requests are not counted. |
| Deleting a code | **Not possible** (Claude's call): a printed code must never break. "Hide it" folds the code into Hidden codes, where it still forwards and counts. |
| Who | Anyone who can view Site pages sees and downloads codes. Making, renaming, moving and hiding need Site pages **edit** (Claude's call, matching Spare addresses; editors have view only). |
| What each card shows | Name, where it goes, total scans, scans in the last 7 days, the short link, when it was made, when it was last scanned, and the SVG and PNG downloads. |

## How it works

- `src/site/qr-named.ts` holds the pure rules: the Goes to list (`qrDestinations`), the exact check
  on a submitted value (`isDestination`), the short link (`/q/c<id>`), where a scan goes
  (`namedTarget`), name tidying (`cleanName`, 1 to 80 letters), the scan summary and the Analytics
  names.
- `migrations/1791200000305_qr-codes.js` adds `qr_codes` (name, target, hidden, who and when) and
  `qr_code_scans` (code, UK day, count). The change is additive only.
- `src/db/qr-codes.ts` lists, makes and changes codes, each change written with its audit row in
  one transaction, and counts a scan with one upsert.
- `src/routes/qr-codes.ts` provides the admin API (`GET`/`POST /api/admin/qr-codes/named`,
  `PATCH /api/admin/qr-codes/named/:id`, `GET /api/admin/qr-codes/named/:id/image`) and the public
  `GET /q/c<id>`.
  - It answers a scan with a 302, never cached, then counts the scan.
  - A destination on nbcc.scot gets `utm_medium=qr&utm_campaign=c<id>`, so Analytics names the scan too.
  - Anything that is not a named code falls through to the fundraisers' `/q/` links, then to the 404.
- In the admin (`admin.html`, `assets/js/admin/app.js`, `assets/css/admin.css`):
  - the make-a-code form sits at the top;
  - named cards follow, each with a quiet "Rename or change where it goes" and "Hide it";
  - the hidden codes come next, folded;
  - the page codes are at the bottom.
  - Editing a code warns that every printed copy follows the new choice.
  - The QR codes menu item gets a New pill.

## Testing

- Unit tests:
  - the pure rules (`qr-named.test.ts`);
  - the routes, covering permissions, the list-only check, the scan forward, not counting bots,
    and the fall-through (`qr-codes-routes.test.ts`);
  - the migration;
  - the backup table counts;
  - the admin screen in jsdom (`admin-app.test.ts`).
- BDD (`admin-qr-named.feature`) runs against the real database in CI:
  - who may do what;
  - typed and typo destinations refused;
  - a phone scan forwarded and counted, and a link preview not counted;
  - a destination changed after "printing";
  - hiding;
  - downloading;
  - an unknown short link getting a 404.

## Out of scope

The following are left out:
- colours or a logo in the code;
- codes for events or fundraiser pages;
- deleting codes;
- a chart of scans over time.
