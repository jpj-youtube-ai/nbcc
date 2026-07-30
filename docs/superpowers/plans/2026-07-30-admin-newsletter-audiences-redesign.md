# Admin newsletter page — audiences redesign (plan)

**Date:** 2026-07-30 · **Status:** ready to execute · **Base:** main @ TASK-269

User brief (verbatim intent): the admin newsletter page is "disjointed and unclear" — it isn't clear
which audience an imported list goes to, nor which audience a newsletter is about to go to. Rethink
the whole page **except the newsletter composer/builder, which works perfectly and must not be
touched, and no data there may be deleted**.

Decisions already taken by the user (do not re-litigate):

1. **Donors = a live, auto-updating audience.** "Donors" always means *every donor with email
   consent*; nobody hand-manages it. "Newsletter" stays everyone (subscribers + donors). You can send
   to Donors alone, or Newsletter for both. The page must explain this in plain English.
2. **Deleting an audience = archive it.** It disappears from the pickers so it can't be sent to, but
   past sends and the record of who was on it are kept. Reversible.
3. **Full restructure into clear stages**: Audiences & people → Compose → Send → History.

---

## Current state (verified by exploration, file:line accurate as of TASK-269)

### Structure
One flat section, `admin.html:273–432`, no tabs. Order today: subscriber card (add subscriber →
audiences → import → manage subscribers) → history table → **composer** (`#newsletterForm`, the
`.nl-builder`) → stats → documents → send actions → template library. The composer is *sandwiched*;
the send-time audience picker (`#sendListPick`, `admin.html:404–407`) sits ~110 lines away from the
Audiences card (`admin.html:292–309`) that names the same lists.

### Audiences
- Migration `migrations/1784800000000_subscriber-lists.js`: `subscriber_lists` (id, slug unique, name),
  seeded `newsletter`, `volunteers`, `partners`, `referrers`; `list_subscribers` (list_id,
  name/email/phone, `consent_source` `footer|import|admin`, `unsubscribed_at` tombstone);
  `newsletters.list_id` nullable FK.
- Model `src/db/subscriber-lists.ts`; API `src/routes/admin.ts:506–660`, mounted `:1925–1931`.
- **No delete and no rename exist** — audiences are create-only and permanent.

### Donors (the crux)
Donors are **never rows** in `list_subscribers`. They are resolved at send time, and **only when the
chosen list's slug is literally `"newsletter"`** — `src/db/newsletters.ts:155` then the union at
`:157–163`. Consequences: the promise is slug-coupled (rename the row and donors silently vanish);
`memberCount` excludes donors (`src/db/subscriber-lists.ts:16,56-57`) so pickers show "Newsletter (3)"
while the real send reaches every consenting donor.

### Known live defects to fix as part of this
- **Import can land in the WRONG audience.** `importState` (`app.js:3204`) is not invalidated when
  `#audiencePick` changes (its only listener, `app.js:3112`, just reloads members). Preview against
  Volunteers → switch picker to Newsletter → Import ⇒ the Volunteers rows go into Newsletter.
- **Two different "add" forms 20 lines apart** writing to different tables: "Add a subscriber"
  (`admin.html:279–285` → `POST /api/admin/newsletters/subscribers`) writes a **donors** row and has
  **no audience choice**; "Add to audience" (`admin.html:303–308`) writes `list_subscribers`.
- **The send confirm never names the audience.** `nlShowSendConfirm` (`app.js:3347–3409`) hardcodes
  "This will be sent to N consenting subscriber(s)" (`app.js:3400`), and the failure fallback
  (`:3406`) claims it reaches "all consenting subscribers" whatever list is picked.
- **History has no audience column**; `listNewsletters` (`src/db/newsletters.ts:75-84`) doesn't even
  select `list_id`, so the stamped audience is write-only.

---

## The work

### A. Donors as a live audience (DB + send)
- Migration (additive): seed a `donors` row in `subscriber_lists`; add `kind` (or `is_dynamic`)
  defaulting to `'manual'`, set `'dynamic'` for `donors` and `'everyone'` for `newsletter`. Add
  `archived_at timestamptz NULL` for decision 2. **Check it sorts last** — see CLAUDE.md, TASK-250 hit
  a numbering trap; `ls migrations | sort | tail`.
- `listRecipientsForList` (`src/db/newsletters.ts:143`): slug `donors` ⇒ `listNewsletterRecipients()`
  only; slug `newsletter` ⇒ subscribers ∪ donors (unchanged); manual lists ⇒ members only.
- Member counts must report the *true* reach for dynamic lists (count consenting donors), so the
  picker no longer disagrees with the send.
- Keep the existing unsubscribe split (donor token revokes global consent; subscriber token leaves one
  list — `admin.ts:804–806`) and make it explicit in the UI copy.

### B. Archive an audience
- `PATCH`/`DELETE` route setting `archived_at`; archived lists vanish from both pickers and can't be
  sent to; past sends keep their `list_id` and history label. Built-ins (`newsletter`, `donors`)
  cannot be archived. Add an "Archived" reveal to restore.

### C. Import targets an explicit audience
- Import gets its **own** audience selector (not the browse picker), the target name echoed in the
  preview and on the confirm button ("Import 42 people into **Volunteers**").
- **Invalidate `importState` whenever the target changes** — this is the data-integrity fix.

### D. Add-a-subscriber picks its list
- One "add a person" form with an explicit audience picker. Keep the donors-row behaviour reachable
  (adding to Donors is not a manual action — it follows consent), and say so in the UI rather than
  silently writing a donors row.

### E. Send: name the audience and confirm it
- The send control states the audience inline ("Sending to: **Volunteers** — 42 people").
- The confirm dialog must **name the audience**, show the true count, and require confirmation — this
  is the "don't let volunteer comms go to donors" guard the user asked for. Fix the misleading
  fallback copy at `app.js:3406`.
- History gains an **Audience** column (select `list_id` in `listNewsletters`, join the name).

### F. Layout — the four stages
Reorder `admin.html`'s newsletter section into: **1 Audiences & people** (audiences, their members,
import, add person — import/add nested *inside* the audience they act on) → **2 Compose** (the
existing `.nl-builder`, moved wholesale, markup untouched) → **3 Send** (audience + confirm) →
**4 History** (with audience + stats). Explain in plain words on the page: *"Donors updates itself
from consent. Newsletter = subscribers + donors. Other audiences are exactly the people you add."*

---

## Constraints & gotchas

- **Do not touch** `.nl-builder` internals, block palette, preview iframe, templates, or documents —
  move the markup, don't rewrite it. No data deletion.
- **Tests that break first:** `test/unit/newsletter-builder-ui.test.ts` (big jsdom suite; audiences at
  `:1002–1070`, send-confirm `:360/:378/:388`, manual add `:426`, read mode `:402`),
  `test/unit/admin-shell.test.ts:63–90` (section id lists), `test/unit/admin-permissions.test.ts:19,36`.
  Logic: `subscriber-lists-db.test.ts`, `subscriber-import-parse.test.ts`. BDD:
  `features/newsletter.feature` (TASK-259 audience, TASK-260 import, TASK-261 signup scenarios).
- **Page-weight budget**: `donate.html` is at ~99.8% of the 255KB first-paint budget (~460 bytes
  spare). Admin assets aren't on that page, but `assets/css/styles.css` and `assets/js/main.js` are —
  don't grow them. On Windows (`core.autocrlf=true`) `perf-budget` fails **locally only**; CRLF adds
  ~3.8KB. Compute the LF total before believing a regression.
- **Local env**: this machine's network policy blocks the npm registry, so `exceljs` can't install →
  `tsc` and `subscriber-import-parse.test.ts` cannot run locally. CI covers both. Do not attempt to
  bypass the block.
- Suggested split: **PR 1** = A+B+C+D+E (data & behaviour, where the real risk is);
  **PR 2** = F (the visual restructure). Each ships green per CLAUDE.md, via `/ship`.
