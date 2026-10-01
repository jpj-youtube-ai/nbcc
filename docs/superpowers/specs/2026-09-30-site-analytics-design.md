# Site analytics

Date: 2026-09-30. Asked for by Jaimie, who answered four questions before bed:

- **No cookies, no banner.** Count visits the way Plausible or Fathom do: nothing stored on the
  visitor's device, no IP address stored. Accept that the same person on two different days counts
  as two visitors.
- **Town or city.** Download the free DB-IP "IP to City Lite" database (CC BY 4.0, credited on the
  page) and look places up from the IP address, which is then thrown away.
- **Access: its own permission, admins only for now**, which Jaimie can give to anyone on Team >
  Manage access.
- **Nothing collected until Jaimie says so.** Everything is built and tested overnight; collecting
  starts only when an admin turns the switch on.

## What the page answers

On Admin > Analytics, for the last 7, 30 or 90 days, each next to the period before:

1. **How many:** visitors (distinct people per day, added up over the period), visits (a visitor's
   views with no gap longer than 30 minutes), page views, and the share of visits that saw only one
   page.
2. **A line of visitors per day.**
3. **Where they came from:** Newsletter, Email, Search, Social, Other websites, Direct (typed, a
   bookmark, an app). Under it: the top other websites by name, and the visits each newsletter issue
   brought.
4. **Where they are:** top towns and cities, and top countries.
5. **What they looked at:** each page with its views, visitors, average time actually spent on it,
   how far down people scrolled on average, and how often it was the first page of a visit.
6. **What they clicked:** Donate and ticket buttons, phone and email links, links to other websites
   and downloads, counted.
7. **What they used:** phone, tablet or computer; browser.
8. **Right now:** people on the site in the last 5 minutes.

The page credits DB-IP ("IP geolocation by DB-IP", linked), as its licence requires.

## How it counts (no cookies)

A small script, `assets/js/pulse.js` (under 2 KB, no libraries), is added to every public page. It
stores nothing on the device: no cookies, no localStorage, no sessionStorage. It does nothing at all
if the browser sends Do Not Track or Global Privacy Control.

It sends three kinds of event to `POST /api/pulse`, as JSON in a `text/plain` body through
`navigator.sendBeacon` (falling back to `fetch` with `keepalive`), so no CORS preflight:

- `view`, on load: `{ t: "view", v, p, r, u, w }`: `v` a random id for this page view (made with
  `crypto.getRandomValues`, kept in memory only), `p` the page path, `r` `document.referrer`, `u` the
  `utm_source`, `utm_medium` and `utm_campaign` from the address if present, `w` the screen width.
- `leave`, on `pagehide` or the page becoming hidden: `{ t: "leave", v, a, s }`: `a` the seconds the
  page was actually visible (not while in a background tab), capped at 1,800; `s` the furthest the
  visitor scrolled, as a percentage of the page. Sent at most once per view, and again with the
  larger values if the page comes back into view and is hidden again.
- `click`: `{ t: "click", v, k, l }` for links and buttons that matter: `k` is `donate`, `tickets`,
  `phone`, `email`, `download` or `outbound`, and `l` a short label (the link's host for outbound,
  the file name for a download, the button's words otherwise, 80 characters at most).

### What the server keeps

`POST /api/pulse` always answers 204 and never an error the page could notice. It drops the event
unless the switch is on. Before storing anything it:

- **Checks the path against the site's own pages.** The path kept is the page's canonical path
  from the site map (`/`, `/donate`, `/events`, ...), or `other` for anything else. A query string
  is never kept, so a token in an address can never reach the table.
- **Makes the visitor id.** `sha256(daily salt + IP + user agent)`, cut to 16 hex characters. The
  salt is random, made at the first event of each UK day, kept in the database for that day only
  and deleted the next day, so the id cannot be linked across days or turned back into an IP.
- **Looks up the place** from the IP address (country, region, town or city) and then forgets the
  IP. Nothing stores the IP address or the user agent.
- **Reads the device** from the user agent: phone, tablet or computer; browser family (Chrome,
  Safari, Edge, Firefox, Samsung Internet, Other); operating system family.
- **Drops bots:** user agents naming a bot, crawler, spider, headless browser or preview fetcher.
- **Works out the channel** (below), and keeps only the referring website's host name, never the
  full referring address.
- **Limits each IP** to 120 events a minute, in memory.

### Channels

In order, first match wins:

1. `utm_source=newsletter`, or the referrer is `click.news.nbcc.scot`: **Newsletter**, with the
   campaign kept as the newsletter issue.
2. `utm_medium=email`: **Email**, with the campaign kept (the kind of email).
3. Any other `utm_source`: the source decides: a known search engine or social site as below,
   otherwise **Other websites** named after the source.
4. Referrer host on a search engine (Google, Bing, DuckDuckGo, Yahoo, Ecosia, Yandex, Brave,
   Startpage): **Search**.
5. Referrer host on a social site (Facebook, Instagram, X/Twitter, LinkedIn, TikTok, YouTube,
   WhatsApp, Threads, Pinterest, Reddit): **Social**.
6. Referrer host is our own site: not a new arrival; the view keeps the channel of the visit.
7. Any other referrer host: **Other websites**, named by host.
8. No referrer: **Direct**.

### Links in our own emails

So that newsletters and emails show up as themselves rather than as Direct, links to our own site
in emails gain tracking words in the address, and only links to our own site:

- in newsletters: `utm_source=newsletter&utm_medium=email&utm_campaign=<the newsletter's id>`;
- in other emails: `utm_source=email&utm_medium=email&utm_campaign=<the email's kind>` (for example
  `ballConfirmation`).

A link that already has `utm_` words keeps its own. Links to other sites, unsubscribe links, and
links carrying a token (portal, set password, guest details) are left exactly as they are.

## Data

In the main database, additive only:

- `analytics_settings`: one row, `collecting boolean not null default false`, `updated_at`,
  `updated_by`.
- `analytics_salts`: `day date primary key`, `salt text not null`.
- `analytics_views`: `id`, `view_id text unique` (the page's random id), `at timestamptz`,
  `day date` (UK), `path text`, `visitor text` (the daily id), `channel text`, `source text` (the
  other website's host, the search engine or social site, or null), `campaign text`, `country text`
  (ISO code), `region text`, `city text`, `device text`, `browser text`, `os text`, `active_seconds
  integer`, `max_scroll integer`. Indexes on `day`, and on `(day, visitor)`.
- `analytics_clicks`: `id`, `view_id text`, `at`, `day`, `kind text`, `label text`. Index on `day`.

Retention: the daily 8am job deletes views and clicks older than 13 months and every salt older than
today. Numbers only: nothing in these tables identifies a person.

The new permission section is `analytics`: `roleToPermissions` gives admin `edit`, editor `none`,
viewer `none`. A migration adds `analytics` to every stored permissions matrix that lacks it (admin
`edit`, anyone else `none`), with an `audit_log` row each, the TASK-463 way. The Team matrix shows it
like every other section, so Jaimie can give it to anyone.

## The location database

`src/analytics/geo-db.ts`, a small reader for the MaxMind DB format (`.mmdb`) written here, because
the npm registry cannot be reached from this machine: open the file once into memory, walk the
binary search tree for an IPv4 or IPv6 address, decode the record's `country.iso_code`,
`subdivisions[0].names.en` and `city.names.en`. Pure apart from reading the file; tested against a
small `.mmdb` the tests build themselves.

The Docker image fetches this month's `dbip-city-lite-YYYY-MM.mmdb.gz` from `download.db-ip.com` at
build time (falling back to last month's), unpacks it to `/app/geo/dbip-city-lite.mmdb`, and carries
on without it if both fail: the app then records no places rather than failing. Every deploy picks up
the current month's file.

## The admin API

- `GET /api/admin/analytics?days=7|30|90` (`analytics: view`): every panel's numbers for the period
  and the one before, in one payload, computed in SQL over the period's rows.
- `GET /api/admin/analytics/settings` (`analytics: view`) and `PUT /api/admin/analytics/settings`
  (`analytics: edit`, `{ collecting }`): the switch, with an `audit_log` row for each change.

## The admin page

Admin > Analytics, a new nav item shown only with the `analytics` permission, built in the admin's
existing style (cream, maroon and holly tokens, `admin-subhead`, the Events page's cards):

- The switch at the top, as a card like the Events page's: off, it explains what switching on starts
  counting and links the privacy notice; on, it says since when.
- The period chips (7, 30, 90 days).
- The figures, the line (inline SVG, no library), then the panels as tables and simple bars.
- Every panel says "Not enough visits yet" rather than showing an empty table, and "Could not load"
  on a failure, the TASK-476 way.
- Nothing scrolls inside a box: long lists show their top 10 with "Show all" growing the page. It
  works at phone width.

## The privacy notice

A short new section on `privacy.html`, "Counting visits": what is counted, that there are no cookies
and nothing is stored on your device, that the IP address is used only to look up a town and is
never kept, that visits cannot be linked from one day to the next, that numbers are kept 13 months,
and that Do Not Track and Global Privacy Control are honoured. Jaimie approves the wording before it
goes live.

## How it ships

Four pull requests, none merged without Jaimie's yes:

1. **TASK-479, counting:** `pulse.js` on the public pages, `POST /api/pulse`, the tables, the switch
   (off), the retention, the `analytics` permission and its backfill, the privacy notice section.
   Places are looked up through `setPlaceResolver`, which records none until the next PR connects
   the database.
2. **TASK-480, email links:** the `utm_` words on our own links in newsletters and emails.
3. **TASK-481, the location database:** `geo-db.ts`, the Docker build step, and the one line that
   connects it to `setPlaceResolver` at start-up.
4. **TASK-482, the page:** the admin API and Admin > Analytics.

## Tests

- Unit: the channel rules (every row above), the path allowlist, the visitor id (same inputs same
  day match, the next day do not), bot and Do Not Track handling, user agent reading, the payload
  validation, the `.mmdb` reader against its own small file, the email link rewriting (ours only,
  existing `utm_` kept, tokens untouched), each panel's numbers from invented rows, and the admin
  page's panels, empty states and failure states.
- BDD against Postgres: events are dropped while the switch is off and kept once it is on; a query
  string never reaches the table; the page needs the `analytics` permission; the numbers from seeded
  views.
- In a browser against a stand-in server: the page at desktop and phone width.

## Not doing

- Cookies, a consent banner, or recognising a visitor across days.
- Session recordings, heatmaps, mouse movements or keystrokes: invasive, and not worth it here.
- Storing IP addresses or full referring addresses.
- Third-party analytics services.
