# Admin > Fundraising (TASK-495) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin screen for community fundraising stage 1: the switch, every sign up with its pills
and status filter, and one sign up opening below its row with everything staff need to approve it,
check changes, record cash and look after the supporter wall.

**Architecture:** Plain JS in `assets/js/admin/app.js` (one new block, prefix `fr`), markup in
`admin.html` (one nav link, one `#view-fundraising` section), styles in `assets/css/admin.css`
(scoped to `#view-fundraising`, reusing the Business supporters `fx-*` detail panels, `.admin-pill`,
`.admin-segmented` and the Events and Analytics switch card). Everything talks to the core's admin
API (README, "Community fundraising (TASK-493)"); nothing on the server changes.

**Tech Stack:** Vanilla JS (ES5 style, like the rest of app.js), Vitest with jsdom (the admin
harness: admin.html's body, a fake fetch, app.js evaluated against it).

Builds on #615 (`task-493-fundraising-core`) and must merge after it.

---

## Files

- Modify `admin.html`: the nav link `data-view="fundraising"` after Events (gated by
  `applyNavFiltering` on `fundraising:view`, no extra attribute), and `#view-fundraising`: heading,
  intro, switch card (`frSwitch`, `frSwitchState`, `frSwitchWho`, `frSwitchBtn`, `frSwitchNote`,
  `frSwitchStatus`), filter (`#frFilter`, buttons `data-frfilter="" | new | approved | declined |
  finished` with `data-frcount` counts), the list (`#frList`) and `#frStatus`.
- Modify `assets/js/admin/app.js`: `selectView` loads it (`loadFundraising`); the new block.
  `evUpload` takes an optional upload address so the photo goes to `/api/admin/fundraiser-images`.
- Modify `assets/css/admin.css`: `#view-fundraising` rules (switch card like Events, the meter,
  the waiting change table that becomes stacked lines on a phone, forms).
- Create `test/unit/admin-fundraising-page.test.ts`: the jsdom tests.
- Modify `test/unit/admin-shell.test.ts`: the nav list gains "fundraising" after "events".
- Modify `README.md`: Admin > Fundraising section in the community fundraising part.

## Task 1: Nav gating and the switch

Tests (write first, see them fail):
- the link shows for admin, editor and viewer presets, and is hidden with `fundraising: "none"`;
- admin sees "Switch fundraising on" (button), editor and viewer see the read only note, no button;
- flipping asks `window.confirm`, PATCHes `{ pageOn: true }`, then says it is on; a refusal shows
  the server's words; a failed settings load says "Could not check".

Implementation: `frRenderSwitch()` mirrors `evRenderSwitch()` with `mayFlip = isAdmin() &&
canEdit("fundraising")`; `frFlipSwitch()` mirrors `anFlipSwitch()` (okJsonOrSaid).

## Task 2: The list

Tests: one row per sign up with its title, organiser, path words ("Raising money", "Holding an
event"), date, status pill (New, Approved, Declined, Finished), raised and target ("£60 of £250",
"£60 raised", nothing for an event with no money); the per person New pill (row created after the
last visit, via `rowNewPill("fundraising", createdAt)`); "Changes to check" pill when `editWaiting`;
the filter chips with counts filter the rows; empty list words; a failed load says it could not
load; over 25 rows shows 25 and "Show all 30".

Implementation: `loadFundraising()` loads settings and list in parallel, `frRenderList()` draws an
`fx-table fr-table` of `tr.fx-summary[data-frtoggle]` rows; the open row has a `fx-detail-row`.

## Task 3: One sign up

Tests: clicking a row GETs `/api/admin/fundraisers/:id` and history; shows the description, kind,
date, place, target, public or private, requests (leaflets n, buckets n, shout out, attend, post
address), consents, contact with `tel:` and `mailto:` links, the Facebook link (only an http(s)
address becomes a link); a failed detail load says it could not load.

## Task 4: Approve, decline, finish

Tests: Approve only on New or Declined, Decline on New or Approved, Mark finished on Approved; each
asks to confirm (cancel sends nothing); Decline sends the typed reason (or no reason) and shows the
reason afterwards as internal; a 409 shows the server's words; viewers get no buttons.

## Task 5: Editing directly, and the photo

Tests: the edit form holds title, kind, description, date, time, venue, town, target (pounds),
public, slug; Save sends only what changed (target in pence, empty target as null); a 400 with
`fields` puts each message under its field; a 409 slug message lands under the slug; a photo upload
POSTs to `/api/admin/fundraiser-images` and then PATCHes `imageSrc`.

## Task 6: The waiting change

Tests: a table of field, live now, their change; Approve change POSTs `/edits/:editId/approve`,
Reject change `/reject`, both after a confirm; afterwards the detail and list reload.

## Task 7: Cash and the meter

Tests: the meter shows raised, target and percentage (`role="progressbar"`, aria values, bar held
at 100); Add cash POSTs `{ amountPence, paidInOn, note }` from pounds; a bad amount is caught before
sending; field errors from the API show; Remove asks first then DELETEs; the meter reloads.

## Task 8: The supporter wall and History

Tests: every gift with full name, shown name, amount, message, Hidden pill; Hide and Show POST to
`/wall/:donationId/hide|show`; more than 10 shows 10 and "Show all"; History lists plain English
actions with who and when, 10 then Show all.

## Task 9: Hostile text and failures

Tests: a title, name, message, note, description and social link holding `<img onerror>` and
`javascript:` render as text, no element created, no javascript: href; a 401 on the list goes back
to sign in.

## Task 10: Design pass, README, verification

- `redesign-existing-projects`, `polish`, `audit` against the Events and Business supporters screens.
- README: the Admin > Fundraising screen.
- `npm run lint`, `npm run build`, the admin tests, cucumber dry run; stand in server check at
  1280px and 390px with invented data.
