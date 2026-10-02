# Admin QR codes — design

Date: 2026-10-02. Asked for by Jaimie; designed in chat and approved the same day.

## What it is for

Staff make QR codes for posters, leaflets, table cards, banners, slides and social posts, for any
page of nbcc.scot, without a third-party QR website. A new page gets its QR code without anyone
doing anything extra. Scans are counted in Admin → Analytics, so staff can tell a poster is working.

## Decisions

| Question | Answer |
|---|---|
| Use | Both print and screen: every code downloads as **SVG** (printers and designers, any size) and **PNG** (slides, social posts, documents). |
| Counting scans | **Yes.** Each code's link carries `utm_medium=qr` and the page as `utm_campaign`. Analytics gains a **QR code** channel and a "QR codes scanned" list by page. |
| Which pages | Every page in the public page registry (`SITE_PAGES`, `src/site/pages.ts`), children included. It already feeds /sitemap, sitemap.xml and Admin → Site pages, so a page added there appears here too. |
| Gated pages | The Festive Ball and Events pages are listed even while switched off, marked "not live yet", so posters can be prepared before launch. |
| Other addresses | A box takes any other nbcc.scot address (a short link, a page not in the registry) and makes its code the same way. Only nbcc.scot addresses: a code for someone else's site is not ours to print. |
| Look | Black on white with the standard quiet margin, error correction level M: the most reliable to scan in print. No logo in the middle. |
| Who | Anyone who can view Admin → Site pages (the `site` section). The codes point at public pages, so nothing here is private. |
| Where | A new **QR codes** item in the admin menu, beside Site pages, with a New pill for everyone the first time (`FEATURES` in `src/admin/whats-new.ts`). |

## How it works

- **The page list:** `GET /api/admin/qr-codes` (site: view) returns each registry page as
  `{ path, title, live, url }`, where `url` is the tagged link the code carries. `live` is false
  for a gated page that is switched off.
- **The link in a code:** `https://nbcc.scot<path>?utm_medium=qr&utm_campaign=<slug>`, where the
  slug is the path without its leading slash and with `/` as `-` (`ball-terms`), and `home` for
  `/`. Built by a pure function, `qrLink(path)`, in `src/site/qr.ts`.
- **The codes:** `GET /api/admin/qr-codes/image?path=/ball&format=svg|png` (site: view) draws the
  code on the server with the `qrcode` npm package, and sends it as a download named
  `nbcc-qr-<slug>.svg` or `.png`. The PNG is 1200 pixels square. The address must be a path on
  nbcc.scot (`/` followed by letters, numbers, `-`, `_` and `/`; at most 200 characters). Anything
  else is refused with 400, so the endpoint cannot be used to make codes for other sites.
- **The admin screen** (`admin.html`, `assets/js/admin/app.js`): one row per page, giving the title,
  the address, "not live yet" where it applies, a small preview (the SVG), and Download SVG and
  Download PNG buttons. Underneath, "Any other nbcc.scot address" takes a path and shows the same.
  The rows wrap into cards on a phone, as the admin's other lists do.
- **Analytics:** `classifyArrival` (`src/analytics/channel.ts`) gives `utm_medium=qr` its own
  channel, `qr`, with the campaign kept, ahead of the utm_source rule. The `analytics_views`
  channel CHECK is widened to allow `qr` (a migration that only widens it, so it is additive; old
  code never writes `qr`). The report gains `qrCodes` (visits by campaign where channel is `qr`),
  and the admin shows "QR code" among the channels and a "QR codes scanned" list.

## Errors

- A bad address: 400 "Give an address on nbcc.scot, starting with /".
- Drawing fails: 500, logged, and the row says the code could not be made.
- The page list cannot load: the screen says so, with no empty list pretending to be the answer.

## Testing

- Unit: `qrLink` (slugs, home, children); the address check; the image route (SVG and PNG content
  types, download file names, the 400s, site view needed); the PNG and SVG decode back to the
  tagged link (decoded with `jsqr`, a test-only dependency, from the PNG's pixels); every
  `SITE_PAGES` entry appears in the list, so a new page cannot be missed; the classifier's `qr`
  rule; the admin screen in jsdom (rows, downloads, the other-address box, the New pill).
- BDD: the list and an image need a session and site: view; a tagged visit is counted as QR code
  in Analytics.

## Out of scope

Colours or a logo in the code, codes for other websites, and shortening long addresses.
