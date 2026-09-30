# Events page, behind a switch: design

Date: 2026-09-30. Task: TASK-453. Approved by the client ("This looks perfect... build this and put
it behind the toggle") after reviewing the prototype page and the admin mock-up.

## What it is

A public page at `/events` showing upcoming events as a deck of playing cards (the approved
prototype on this branch: picture and gist on the front, everything else on the back, wobble on
hover, turn on click). Staff build each event in a new **Events** section of the admin. The whole
page sits behind an on/off switch so it can ship to production switched off and be turned on from
the admin when the client is ready.

## Decisions (client defaults, changeable before launch)

| Question | Decision |
|---|---|
| What does "the toggle" control? | The whole page: its URL, its menu link and its sitemap entry. Each event also has its own status (draft, live, live from a date). |
| Who flips the page switch? | Admins only, regardless of the section matrix (precedent: sending a newsletter). |
| Who adds and edits events? | New permission section `events`: admins edit, editors edit (content work, like Stories), viewers view. |
| Past events | Leave the page the day after the event (Europe/London date) and appear under Past in the admin. |
| Menu | "Events" between About and Donate on every page, only while the switch is on. |
| First events | EmpowHer '26 and the Festive Ball are seeded as live events. The switch stays off. |

## Approach

**Chosen: server-rendered from the database, one renderer.** `src/events/render.ts` turns event rows
into the card markup already approved in `events.html`. The public route uses it to fill the page;
the admin's previews call a preview endpoint that uses the same function (the newsletter builder's
precedent: a debounced POST, rendered into an iframe). One renderer means the admin preview cannot
drift from the page, and the page works without JavaScript and is indexable.

Rejected: rendering cards in the browser from a JSON feed (a second renderer for previews, weaker
without JavaScript); leaving the page as hand-edited HTML with only the switch in the admin (does
not meet "build an event in the admin").

## Data (migrations, additive only)

- `events_settings`: one row (`id = 1`), `page_on boolean not null default false`, `updated_at`,
  `updated_by`.
- `events`: integer identity id (the audit log's `entity_id` is an integer), a unique `slug` for
  card anchors, and one column per form field: name, subtitle, gist, event_date, start_time,
  end_time, time_tbc, venue, town, address, access (text[]), image_src, image_fit, image_ground,
  image_alt, cover, cost_front, cost_back, flag, list_heading, whats_on, note, run_by,
  partner_name, partner_front, partner_credit, partner_logo_src, partner_line, booking_how,
  booking_url, booking_label, booking_note, status, show_from, created/updated at and by.
  Enumerated columns carry CHECK constraints matching the validation.
- `event_images`: uploaded pictures and logos, bytes in Postgres, mirroring `newsletter_images`.
  Served publicly at `/media/events/:id` (uuid-only lookup, raster allow-list, nosniff).
- Permissions: `events` added to `SECTIONS` (server and admin client, kept in sync by the existing
  test), with a migration giving every stored matrix the role default (the
  `permissions-business-supporters` pattern).
- Seed migration: the two events, `ON CONFLICT (slug) DO NOTHING`.

## Safety rules the validation enforces

- `image_src` and `partner_logo_src` may only be `/media/events/<uuid>` or `/assets/img/<file>`.
  No external image URLs.
- `booking_url`: `https://` or `http://` when booking elsewhere; a site path starting with a single
  `/` when booking on nbcc.scot. Nothing else, so no `javascript:` link can reach a page.
- The corner note (`flag`) is chosen from a fixed list of true statements, never free text
  (the Code of Fundraising Practice's rule on invented urgency).
- Every rendered string is HTML-escaped; `*stars*` bold is applied after escaping.

## Visibility and order

Pure function, Europe/London dates. An event is on the page when its status is `live`, or
`scheduled` with `show_from` on or before today, and its date is today or later. Order: date,
then start time (no time last), then name. The face down "more on the way" card always ends the
deck, and is the whole deck when there are no events.

## Public behaviour

- Switch off: `/events` falls through to the site's catch-all (a real 404, or a spare address if
  one was set up for `/events` before), no menu link anywhere, absent from `/sitemap` and
  `sitemap.xml`.
- Switch on: `/events` renders the template with the deck; every page served through the routes
  that add the Festive Ball menu item (home, the clean-URL pages, supporters, the ball pages) also
  gets "Events" after "About", whatever the ball's own state; the page is listed in both sitemaps.
- `/events` is reserved so no spare address can shadow it.
- `events.html` joins the Dockerfile's explicit page list.

## Admin

A new view under Content, matching the approved mock-up: the Coming up / Drafts / Past list; the
eight-step form; a live card preview and a whole-page preview (server-rendered, debounced, in
iframes sized to their content so nothing scrolls inside them); Save as draft and Publish; Delete
with a confirmation. The page switch sits at the top of the view with its current state in words.
Pictures are shrunk in the browser before upload using the newsletter's existing code path. Every
create, update, publish, delete and switch flip writes an audit row in the same transaction as the
change.

## Testing

- Unit: validation (including the URL and image-source rules), visibility and order, the renderer
  (escaping, bold, every optional section, the face down card), the nav insertion (idempotent,
  after About, only in the main nav), the sitemap gating, the permission defaults and sync.
- BDD: switch off gives 404 and no menu link; switch on gives the page, the link and the sitemap
  entry; drafts, past events and not-yet-scheduled events stay off the page; the admin API refuses
  without a session, refuses editors the switch, creates, updates, publishes and deletes with
  audit rows.
