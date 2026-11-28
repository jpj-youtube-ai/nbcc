# Workshop drop-offs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tablet page at /workshop where people who bring things in leave their details, get an instant thank-you email and can join the newsletter, plus an admin list to send proper thank-you letters from.

**Architecture:** A root HTML page (like newsletter.html) posts JSON to a public route; the route saves a row in a new `workshop_dropoffs` table, optionally calls `subscribeSelf(..., "workshop")`, and sends one email through `sendVerbatim`. The admin reads the table through a gated API, shows it as a kit screen under Giving, and hands a row to the existing Thank you letter as a gift in kind.

**Tech Stack:** Express + TypeScript, node-pg-migrate, Vitest (+ jsdom for admin), Cucumber in CI.

**Spec:** docs/superpowers/specs/2026-11-28-workshop-dropoffs-design.md

## Global Constraints

- No dashes between words in any copy; plain friendly English.
- Every name, address and email in tests is invented (the repo is public).
- Migration must sort last (`ls migrations | sort | tail -1`); additive only.
- The page uses the home page's banner and the master footer byte for byte (site-chrome-everywhere, footer-master).
- Newsletter box starts unticked; consent must be literally `true`.
- README updated in the same PR.

## Review Focus

1. One tablet, one IP, all day: 30 people in an hour must not hit the rate limit (limit 60 an hour).
2. A typed name or "what they brought" containing `<script>` or quotes is escaped in the email and the admin.
3. The email failing must not lose the row or show the person an error: save first, send in the background.
4. Someone dropping off twice with the same email: two rows, newsletter `exists` is fine, no error.
5. The form resets fully after the thank you (no previous person's details left for the next).

---

### Task 1: Table and storage

**Files:**
- Create: `migrations/1791200000500_workshop-dropoffs.js`, `src/db/workshop-dropoffs.ts`, `test/unit/workshop-dropoffs-db.test.ts`
- Modify: `src/db/subscriber-lists.ts` (ConsentSource adds `"workshop"`), `src/newsletter/self-signup.ts` and `src/newsletter/welcome.ts` (source union adds `"workshop"`; `shouldSendWelcome("workshop")` is false)

**Interfaces:**
- Produces: `insertDropOff(d: DropOffInput): Promise<number>`; `listDropOffs(): Promise<DropOffRow[]>` (newest first, with `letterSentAt`: latest `thank_you_letters.sent_at` where `gift_type = 'in_kind'`, same email case-insensitively, at or after the drop-off); `removeDropOff(id: number): Promise<boolean>`.
- `DropOffInput = { name; email; brought; groupName: string|null; phone: string|null; newsletter: boolean }`; `DropOffRow` adds `id`, `createdAt: Date`, `letterSentAt: Date|null`.

- [ ] Test: the migration creates `workshop_dropoffs` (id, name, email, brought, group_name, phone, newsletter bool default false, created_at default now()) and widens `list_subscribers_consent_source_check` to include `'workshop'` (down restores the elf list). Mocked pool: insert passes the six values in order and returns the id; list SQL orders by `created_at DESC` and joins letters by `lower(email)`; `shouldSendWelcome("workshop") === false`.
- [ ] Run, see it fail; implement; run, see it pass; commit.

### Task 2: The thank-you email

**Files:**
- Create: `src/drop-offs/emails.ts`, `test/unit/workshop-thanks-email.test.ts`
- Modify: `src/clients/email.ts` (`sendWorkshopThanks`, kind `"workshopThanks"`, from and reply to `config.GIVING_FROM_EMAIL`), `src/email/catalogue.ts` (group `{ id: "workshop", name: "Workshop drop-offs" }`, entry `workshop-thanks` with versions "usual" and "joined the newsletter"), `test/unit/email-catalogue-guard.test.ts` (EMAIL_FOLDERS adds `src/drop-offs`), `features/fundraising-all-emails.feature` + steps if they pin the group list.

**Interfaces:**
- Produces: `buildWorkshopThanksEmail(o: { name: string; brought: string; joinedNewsletter: boolean }): BuiltEmail`; `sendWorkshopThanks(m: { email: string; name: string; subject: string; html: string; text: string }): Promise<void>`.

- [ ] Test: subject "Thank you for dropping in"; greets by safe first name ("Hello," without one); body names what they brought, escaped; joinedNewsletter adds the mailing list line, otherwise absent; no dashes between words; text version carries the same lines and FOOTER_TEXT.
- [ ] Fail, implement, pass, commit.

### Task 3: The public route

**Files:**
- Create: `src/routes/workshop.ts`, `test/unit/workshop-route.test.ts`, `features/workshop.feature`, `features/steps/workshop.steps.js`
- Modify: `src/app.ts` (mount `workshopRouter`)

**Interfaces:**
- Consumes: Task 1 `insertDropOff`, `subscribeSelf`; Task 2 builder and sender.
- Produces: `POST /api/workshop` JSON `{ name, email, brought, groupName?, phone?, newsletter?: boolean, website? }` → 201 `{ ok: true, firstName }`; 400 `{ error }`; 429.

- [ ] Test (mocked db, email, subscribeSelf): valid post saves and answers 201 with the first name; newsletter true calls `subscribeSelf({name,email,phone}, "workshop")`, false never does; honeypot filled answers 200 and saves nothing; missing name, bad email or missing brought gives 400 with a plain message; 60 posts an hour from one address pass and the 61st is 429; the email failing still answers 201.
- [ ] BDD: posting a drop-off answers 201; the honeypot answers 200 and no row appears.
- [ ] Fail, implement, pass, commit.

### Task 4: The page

**Files:**
- Create: `workshop.html`, `assets/js/workshop.js`, `assets/css/workshop.css`, `test/unit/workshop-page.test.ts`
- Modify: `_redirects` (`/workshop /workshop.html 200`, `/workshop.html /workshop 301!`), `Dockerfile` COPY list, `src/site/pages.ts` (PRIVATE_PAGES entry reach `"unlisted"`, reserved path `/workshop`), `privacy.html` (one line on drop-off details), and whichever guard tests list root pages (clean-urls, seo-metadata, copy-rules, accessibility, perf-budget).

- [ ] Test (jsdom): the page has `noindex`, the home page's banner and the master footer; five fields with labels, the three suggestion buttons fill "Who are you with?"; the newsletter box is unticked; Send posts the JSON above; on 201 the thank-you panel shows "Thank you, Margaret!" (invented), and after the timer, or a tap, the form is empty, unticked and showing again; on 400 the message shows in an `is-error` status and the details stay.
- [ ] Fail, implement (copy and look from the approved mockup), pass, commit.

### Task 5: The admin screen

**Files:**
- Create: `src/routes/admin-drop-offs.ts`, `test/unit/admin-drop-offs.test.ts`, `features/admin-drop-offs.feature` + steps
- Modify: `src/app.ts`, `admin.html` (menu item under Giving after Invoices, `data-view="drop-offs" data-view-gate="donations"`; section `#view-drop-offs` in the kit), `assets/js/admin/app.js`, `assets/css/admin.css` if needed, `src/admin/whats-new.ts` (area `"drop-offs"`, section donations view, title "Workshop drop-offs", arrival line "Someone dropped something off at the workshop", FEATURES line), `src/db/whats-new.ts` (LATEST and DETAILS: `max(created_at)` from `workshop_dropoffs`; newsletter queries include `'workshop'`).

**Interfaces:**
- Produces: `GET /api/admin/drop-offs` (donations view) → `{ dropOffs: DropOffRow[] }`; `DELETE /api/admin/drop-offs/:id` (donations edit) → 200 / 404.

- [ ] Test (route, mocked db): view needed to list, edit needed to remove, 404 for an unknown id. Test (jsdom): rows render escaped; "Letter sent" shows when `letterSentAt`; Write a thank you letter (only with thank-you edit) opens the Thank you view with gift in kind pressed, name, Dear first name, email and what they brought filled, donor id empty; Remove asks first and then deletes; the New pill area exists.
- [ ] Fail, implement, pass, commit.

### Task 6: README and finish

- [ ] README: the /workshop route, the admin screen, the new email, the consent source and the table.
- [ ] `npm run lint && npm run build` and the affected unit tests green; push; PR via /ship conventions.
