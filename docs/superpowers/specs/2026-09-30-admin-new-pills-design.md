# "New" pills in the admin, per person: design

Date: 2026-09-30. Task: TASK-478. The client approved it. Their choices:

- **What gets a pill:** both new arrivals and new parts of the admin.
- **Which arrivals:** all seven kinds.
- **When a pill goes away:** it clears for a person when that person opens the section.

## What staff see

- **A New pill on a menu section** when it holds something the person has not seen. The pinned
  Menu button on a phone gets one too, if any section has one.
- **New pills inside the section**, on the things that arrived since the person's previous visit.
  They last for that visit.
- **Opening a section clears its menu pill for that person only.** Everyone else keeps theirs until
  they open it.
- **Only reachable sections.** A person only sees pills on sections they are allowed to open.

## The areas

| Menu section (view) | Who can open it | A new arrival is | Time used | Row pill in |
|---|---|---|---|---|
| Contact form (`contact`) | contact: view | an enquiry | `contact_enquiries.created_at` (the contact database) | `contactTable`, `created_at` |
| Stories (`stories`) | stories: view | a submitted story | `stories.created_at` (the stories database) | `storiesTable`, `created_at` |
| Donations (`donations`) | donations: view | a paid donation | `donations.created_at`, where `payment_status='paid'` | `donationsTable` (not the Overview's copy), `created_at` |
| Monthly givers (`monthly`) | donations: view | an individual's first paid monthly gift | min(`created_at`) of that donor's paid monthly donations | `monthlyTable`, `firstPaidAt` |
| Business supporters (`fulfilments`) | business-supporters: edit | a new business supporter | `business_supporter_fulfilment.created_at` | `fulfilmentBusinessCell`, `created_at` |
| Festive Ball (`ball`) | ball: view | a paid booking | `ball_bookings.paid_at`, where `status='paid'` | `ballBookingsTable`, `paidAt` |
| Newsletter (`newsletter`) | newsletter: view | a public sign-up | `list_subscribers.consented_at`, where `consent_source='footer'` and not unsubscribed | `nlRenderAudienceMembers`, `consentedAt` |

The access rules are the same gates the menu already uses (`data-view-gate` and `data-edit-gate`).

## New parts of the admin

- **A short list in code.** `src/admin/whats-new.ts` holds entries of the form
  `{ area, added, what }`. Shipping a change adds a line.
- **The first entries** are the features added today:
  - `events`: the Events page and its ticket report (TASK-453, TASK-464);
  - `monthly`: Monthly givers (TASK-447);
  - `stories`: bringing in the old website's stories (TASK-461).
- **When it counts as new.** An entry is new to a person if it was added after their account was
  created and they have not opened that section since.

## Remembering who has seen what

- **The table.** A new table `admin_seen` holds `(user_id, area, seen_at)`, with the primary key
  `(user_id, area)` and `ON DELETE CASCADE` from `users`. The migration is additive,
  `1791000000000_admin-seen.js`.
- **Recording a visit.** Opening a tracked section calls `POST /api/admin/whats-new/seen { area }`,
  which records `seen_at = now()`.
- **When a person has never opened a section**, what counts as their last visit depends on the kind
  of news:
  - **for arrivals**, it is the later of when the person's account was made and the moment the
    feature launched (`LAUNCH_AT` in code), so launch day does not light up years of old records;
  - **for new parts of the admin**, it is when their account was made.

## The server

- **`GET /api/admin/whats-new`** is open to any signed-in person (`authorizeAny`). For each section
  the person may open, it returns `{ area, new, since }`, where `since` is the last-visit time the
  row pills compare against.
- **How it counts.** It reads the person's `admin_seen` rows. Then, for each area, it asks that
  area's source a single "anything since `since`?" question. For the contact and stories databases
  that is a parameter passed to their own pool. It also checks the features list.
- **If one source fails**, that area reports `new: false` and the error is logged. The rest still
  answer.
- **`POST /api/admin/whats-new/seen`** answers 400 for an unknown area and 403 for an area the
  person may not open.

## The browser

- **When the list is fetched.** After `/api/admin/me` has filtered the menu, `app.js` fetches the
  list. It fetches it again each time the view changes, and a failure simply shows no pills.
- **Opening a tracked section:**
  - its `since` is kept for this visit, so rows newer than it get a pill;
  - the visit is recorded;
  - the pill is removed straight away.
- **How a pill reads.** It is `<span class="admin-new-pill">`, containing a visually hidden comma
  and the word "New". A screen reader therefore reads "Contact form, New".

## Testing

- **Unit.** The pure rules in `src/admin/whats-new.ts`: the last-visit times, features, access
  gates and the launch time. The routes are tested with the database module mocked.
- **jsdom** (`test/unit/admin-app.test.ts`): the menu pills from a stubbed list, opening a section
  records the visit and clears its pill, and new rows get their pill.
- **BDD** (`features/whats-new.feature`, database, CI only): two admins and one public newsletter
  sign-up. Both see the Newsletter as new; one opens it; theirs clears and the other's stays.
- **Browser.** Checked in headless Chrome with the stand-in server.
