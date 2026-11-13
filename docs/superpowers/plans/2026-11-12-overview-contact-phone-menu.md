# Overview, Contact form and phone menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin's Overview, Contact form and phone menu look and work like the Donations gift log, above all on a phone.

**Architecture:** One new stylesheet carrying the gift log's look by value. The Overview's and Contact form's renderers in `assets/js/admin/app.js` are rewritten to draw cards; their element ids, loaders, click routing and failure paths are kept. The phone menu is restyled by CSS over its existing markup, below 860px only. A bottom bar is added for phones that mirrors its menu links, so permissions, New and "where you are" come from the existing, tested machinery.

**Tech Stack:** vanilla JS admin SPA, CSS (container queries, grid), Express + TypeScript for the two additive server fields, Vitest (jsdom), Cucumber.

**Spec:** `docs/superpowers/specs/2026-11-12-overview-contact-phone-menu-design.md`

## Global Constraints

- **Phone means below 860px**, the breakpoint app.js and admin.css already share. Never another.
- **The desktop banner is unchanged** — `test/unit/admin-top-banner.test.ts` must pass untouched.
- **Search keeps `donationsTable()`.** The Overview gets its own gift cards.
- New classes prefixed `ov-` (Overview), `ct-` (Contact form), `pm-` (phone menu and bar). No `!important`, no side stripes, no gradient text; motion only under `prefers-reduced-motion: no-preference`, only `transform` and `opacity`. Nothing scrolls inside a box.
- Stylesheet `assets/css/admin-overview.css`, linked only from `admin.html`, after `admin.css` so it wins on order alone.
- Tokens copied by value from `assets/css/admin-donations.css`: ink `#3A0B0B`, maroon `#800000`, crimson `#C02238`, holly `#1A531A`, gold `#D9A93E`, card `#FFFDFA`, edge `2.5px solid ink`, shadow `3px 4px 0 ink`, pressed `1px 1px 0 ink`.
- Words kept exactly: "Nothing needs you right now.", "Could not check: … Open Overview again in a moment.", "The overview could not load. Open it again in a moment.", "Recent donations are not part of your access.", "Could not load this enquiry. Please try again."
- Level headings: 1 **Urgent**, 2 **Waiting on you**, 3 **Coming due**.
- Bottom bar tabs, in order: Overview (`overview`), Donations (`donations`), Get involved (`get-involved`), Contact (`contact`), Everything (opens the menu).
- Menu groups, screens and order unchanged.
- Every user-supplied string escaped with `H.escapeHtml` in every new renderer.

## Review Focus

1. **Tapping an action inside an opened message** (Reply in Gmail, Archive…) must not re-open or redraw that message. Only the message's summary button carries `data-contact`; the opened part sits outside it — Task 3.
2. **Opening a second message closes the first.** `#contactDetail` and `#contactActionStatus` stay unique — Task 3.
3. **A tab for a screen the person cannot open** must not appear, by the same gate as its menu link — Task 5.
4. **The bottom bar covering the last thing on a page** — body padding below 860px — Task 5.
5. **Markup in a contact message, a name, a need line or a number** is shown as text, never run — a `<img src=x onerror>` test in each renderer's task.

---

### Task 1: The figure separately, so a card can show it large

**Files:** Modify `src/admin/overview.ts`, `src/admin/overview-numbers.ts`. Test `test/unit/admin-overview.test.ts`, `test/unit/admin-overview-numbers.test.ts`.

**Interfaces:** Produces `NeedLine.count: number` and `NeedLine.words: string` (the text after the count, including any money suffix); `NumberLine.figure: string` and `NumberLine.rest: string`; and pure `splitHeadline(headline: string): { figure: string; rest: string }`. `text` and `headline` are unchanged.

- [ ] **Step 1: Failing tests**

```ts
it("gives the count and the words apart, as well as the sentence", () => {
  const [line] = needsLines({ contact: { count: 3 } } as NeedCounts);
  expect(line.count).toBe(3);
  expect(line.words).toBe(line.text.slice("3 ".length));
  expect(line.text).toBe(`3 ${line.words}`);
});
it("keeps a money suffix with the words, not the count", () => {
  const line = needsLines({ giftAid: { count: 38, pence: 121450 } } as NeedCounts).find((l) => l.key === "giftAid")!;
  expect(line.count).toBe(38);
  expect(line.words).toContain("£1,214.50");
});
it.each([
  ["£4,210 this month so far", "£4,210", "this month so far"],
  ["120 of 200 seats sold", "120", "of 200 seats sold"],
  ["2,904 visitors in the last 7 days", "2,904", "visitors in the last 7 days"],
  ["Nothing yet", "Nothing", "yet"],
  ["£0", "£0", ""],
])("splits %s at its first space", (headline, figure, rest) => {
  expect(splitHeadline(headline)).toEqual({ figure, rest });
});
it("puts figure and rest on every numbers line", () => {
  for (const n of numbersLines(SAMPLE)) expect(`${n.figure} ${n.rest}`.trim()).toBe(n.headline);
});
```

(Use the fixture each file already has for `NeedCounts` / `numbersLines`; check the real key names in `NEEDS` before writing the first two.)

- [ ] **Step 2: Run, watch them fail** — `npx vitest run test/unit/admin-overview.test.ts test/unit/admin-overview-numbers.test.ts`
- [ ] **Step 3: Implement.** In `needsLines`, add `count: c.count, words: \`${words}${extra}\`` beside `text`. In `overview-numbers.ts`, export `splitHeadline` and spread its result onto each returned line where the headline is built.
- [ ] **Step 4: Run** — PASS, plus `test/unit/admin-overview-route.test.ts` still green.
- [ ] **Step 5: Commit** — `feat: the Overview's lines carry their figure apart from their words`

---

### Task 2: The Overview, in cards

**Files:** Create `assets/css/admin-overview.css`. Modify `admin.html` (the `<link>`, and `#view-overview`), `assets/js/admin/app.js` (`needsHtml`, `numbersHtml`, `comingHtml`, the recent-donations call in `loadOverview`). Test `test/unit/admin-overview-screen.test.ts` (new), and update `test/unit/admin-app.test.ts` and `test/unit/admin-could-not-load.test.ts` where they pin the old markup.

**Interfaces:** Consumes Task 1's `count`, `words`, `figure`, `rest`. Keeps ids `overviewNeeds`, `overviewNumbers`, `ovNumbersCard`, `overviewComing`, `ovComingCard`, `overviewRecent`, `overviewUpdated`, and the delegated `[data-ov-view]` / `data-ov-key` click routing. Produces `ovGiftsHtml(rows): string`.

- [ ] **Step 1: Failing tests (new file)**

```ts
it("draws each need as one card that is the button, count first", async () => {
  // needs: [{ level: 1, key: "transfers", count: 2, words: "bank transfers are past their pay-by date", text: "2 bank…", view: "ball", button: "Festive Ball" }]
  const card = el("overviewNeeds").querySelector("button.ov-need")!;
  expect(card.getAttribute("data-ov-view")).toBe("ball");
  expect(card.querySelector(".ov-need__count")!.textContent).toBe("2");
  expect(card.querySelector(".ov-need__where")!.textContent).toBe("Festive Ball");
});
it("groups the needs under Urgent, Waiting on you and Coming due, leaving out an empty group", ...);
it("falls back to the sentence when a line has no count", ...);          // an older server
it("draws each number as a scoreboard tile, figure large", ...);          // .ov-tile__figure = "£4,210"
it("draws coming up as slim cards under day headings", ...);              // .ov-day-label, .ov-event-when, .ov-event-text kept
it("draws recent donations as gift cards, not a table", async () => {
  expect(el("overviewRecent").querySelector("table")).toBeNull();
  expect(el("overviewRecent").querySelectorAll(".ov-gift")).toHaveLength(2);
});
it("leaves Search's donations table alone", ...);                        // search results still render a <table>
it.each(["need words", "need where", "number figure", "number detail", "event text", "donor name"])(
  "shows markup in the %s as text", ...);                                 // Review Focus 5
it("lays Needs you beside the rest on a wide screen", () => {
  expect(css).toMatch(/@media \(min-width: 1000px\)[\s\S]*\.ov-cols\s*\{[^}]*grid-template-columns/);
});
```

- [ ] **Step 2: Run, watch it fail** — `npx vitest run test/unit/admin-overview-screen.test.ts`
- [ ] **Step 3: Write the stylesheet's tokens and the Overview's rules**, from the mockup (`scratchpad/mockups/shared.css`): `.ov-need` cards (count `2.9rem` column, Playfair 800 1.75rem, crimson for level 1), `.ov-group` headings with the three pills, `.ov-tiles` scoreboard (2 columns, 4 from 760px, 2 again inside `.ov-side` from 1000px), `.ov-event` and `.ov-gift` slim cards, `.ov-cols` / `.ov-side`.
- [ ] **Step 4: Rewrite the three renderers and add `ovGiftsHtml`.** Each card is a `<button type="button" data-ov-view=…>`. Where a line has no `count`, show `text` alone. "See them all" is `data-ov-view="donations"`. Wrap the sections in `.ov-cols` and `.ov-side` in `admin.html`; add `<p class="ov-summary" id="overviewSummary">` saying "9 things need you." (or nothing when there are none or it failed).
- [ ] **Step 5: Update the pinned tests on purpose.** Each promise kept: the quiet line, "Could not check", the could-not-load message, never last visit's numbers, escaping, routing to the view, `ovButtonWords` naming Get involved, recent donations never carrying a New pill.
- [ ] **Step 6: Run** — the new file, `admin-app`, `admin-could-not-load` — PASS.
- [ ] **Step 7: Commit** — `feat: the Overview in cards, the Donations way`

---

### Task 3: The Contact form, in cards, opening in place

**Files:** Modify `assets/js/admin/app.js` (`contactTable`, `loadContact`, `openContact`, `renderContact`, the status filter), `admin.html` (`#view-contact`, retire `#view-contact-detail` by moving `#contactDetail` and `#contactActionStatus` into the opened card), `assets/css/admin-overview.css`. Test `test/unit/admin-contact-screen.test.ts` (new); update `admin-could-not-load.test.ts:379`.

**Interfaces:** Keeps `GET /api/admin/contact` and `/:id`, `wireContactActions(c)` and its button ids. Produces `ctListHtml(rows, openId): string`, `ctDayLabel(iso, now): string`.

- [ ] **Step 1: Failing tests**

```ts
it("draws messages as cards under day headings, newest first", ...);         // "Today", "Yesterday", "Monday 9 November"
it("shows the three filters as tiles with their counts", ...);                // All 6, Waiting 4, Replied 2, from one fetch
it("marks a waiting message, and says who replied to a replied one", ...);
it("opens a message in place, with its email, when, and actions", async () => {
  click(summaryOf(701));
  expect(cardOf(701).querySelector("#contactDetail")!.textContent).toContain("callum.reid@example.com");
  expect(el("contactReplyBtn")).not.toBeNull();
});
it("does not redraw an open message when one of its actions is pressed", ...); // Review Focus 1
it("closes the first message when a second is opened", () => {                  // Review Focus 2
  click(summaryOf(700)); click(summaryOf(701));
  expect(document.querySelectorAll("#contactDetail")).toHaveLength(1);
});
it("says so in place when a message could not be loaded", ...);                 // the kept words
it("shows markup in a name or a message as text", ...);                        // Review Focus 5
it("offers Restore and Erase only on an archived message, as before", ...);
```

- [ ] **Step 2: Run, watch it fail**
- [ ] **Step 3: Implement.** Fetch the unfiltered list once (`listEnquiries` has no cap); count All / Waiting (`status === "new"`) / Replied client-side; filter client-side. Each card: a `<button class="ct-msg__summary" data-contact="ID">` holding name, time, two clamped lines and the mark; below it, only when open, `<div id="contactDetail">` and `<p id="contactActionStatus">`. `openContact(id)` sets `ctOpenId`, redraws the list with that card open, then fetches `/:id` into `#contactDetail` and calls `renderContact`. Pressing the open card's summary again closes it. Day headings by the Europe/London date.
- [ ] **Step 4: Retire `#view-contact-detail`** from `admin.html`; grep proves nothing else references it.
- [ ] **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** — `feat: the Contact form in cards, each message opening where it is`

---

### Task 4: The phone top bar and menu

**Files:** Modify `assets/css/admin-overview.css`, `admin.html` (a `.pm-me` block after `#adminNavList`, inside the nav). `assets/js/admin/app.js` (wire `pmAccountBtn`, `pmLogoutBtn` to `el("accountBtn").click()` / `el("logoutBtn").click()`; fill `pmWho`). Test `test/unit/admin-phone-menu.test.ts` (new).

- [ ] **Step 1: Failing tests**

```ts
it("keeps the top bar to one line on a phone, the account moving into the menu", () => {
  expect(phoneRules).toMatch(/\.admin-user\s*\{[^}]*display:\s*none/);
});
it("draws the open menu as a two-column grid of tiles", () => {
  expect(phoneRules).toMatch(/\.admin-nav-panel\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});
it("presses in the screen you are on", ...);                                  // .admin-nav-link.is-active
it("puts who is signed in, My account and Sign out at the foot of the menu", ...);
it("makes the menu's own account buttons do exactly what the top bar's do", ...); // clicks the originals
it("leaves the desktop banner to its own rules", () => {
  expect(css.match(/@media[^{]*\(max-width:\s*860px\)/g)!.length).toBeGreaterThan(0);
  expect(css).not.toMatch(/@media[^{]*min-width:\s*861px[^{]*\{[^}]*admin-nav/);
});
it("adds no group to the menu list, so it stays five", ...);                  // .pm-me sits outside #adminNavList
```

- [ ] **Step 2: Run, watch it fail**
- [ ] **Step 3: Implement** the phone rules inside `@media (max-width: 860px)`: `.admin-user { display: none }`; the open panel as a 2-column grid; each `.admin-nav-link` a tile (`min-height: 46px`, edge, `2px 3px 0` shadow, presses in); `.is-active` maroon; `.pm-me` shown only when the menu is open (follow `adminNavToggle`'s `aria-expanded`), hidden on desktop.
- [ ] **Step 4: Run** this file plus `admin-fits-a-phone` and `admin-top-banner` — all PASS, top banner untouched.
- [ ] **Step 5: Commit** — `feat: on a phone the menu is a grid of tiles and the top bar one line`

---

### Task 5: The bar along the bottom

**Files:** Modify `admin.html` (a `<nav class="pm-bar" aria-label="Quick links">` before `</body>`), `assets/js/admin/app.js` (`syncTabBar()`), `assets/css/admin-overview.css`. Test `test/unit/admin-bottom-bar.test.ts` (new).

**Interfaces:** Produces `syncTabBar(): void`, called at the end of `applyNavFiltering`, `renderNewPills` and `selectView`. Tabs are `<button class="pm-tab" data-pm-view="…">` — **not** `.admin-nav-link`, so nothing counting menu links counts them.

- [ ] **Step 1: Failing tests**

```ts
it("offers Overview, Donations, Get involved, Contact and Everything, in that order", ...);
it("is not a menu link, so the menu still counts its own screens", () => {
  expect(doc.querySelector(".pm-bar .admin-nav-link")).toBeNull();
});
it("hides a tab whose screen this person may not open", async () => {   // Review Focus 3
  perms = { ...viewer, donations: "none" };
  await signIn();
  expect(tab("donations").hidden).toBe(true);
});
it("shows a dot on a tab whose screen is new, and marks where you are", ...);
it("opens the whole menu from Everything", ...);
it("shows only on a phone", () => { expect(css).toMatch(/\.pm-bar\s*\{[^}]*display:\s*none/); });
it("leaves room so it never covers the last thing on a page", () => {     // Review Focus 4
  expect(phoneRules).toMatch(/\.admin-body\s*\{[^}]*padding-bottom/);
});
```

- [ ] **Step 2: Run, watch it fail**
- [ ] **Step 3: Implement.** Each tab mirrors its menu link: `hidden` ⇔ link hidden, `.pm-tab--new` ⇔ the link holds `.admin-new-pill`, `aria-current="page"` ⇔ the link is `.is-active`. A tab click calls `selectView(view)`; Everything clicks `adminNavToggle` and scrolls to the top. Line icons inline, as in the mockup.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat: a bar along the bottom of the admin on a phone`

---

### Task 6: Looked at, written up, reviewed, shipped

- [ ] **Step 1: Look at it** in the overview stand-in (`scratchpad/overview-standin.cjs`) at 375px and at 1280px: no horizontal overflow, every tap target ≥ 44px, the bottom bar covering nothing; Overview, Contact (one opened) and the open menu. Send Jaimie the pictures.
- [ ] **Step 2: README** — a section for the redesign: the look, the bottom bar, messages opening in place, where the phone rules live.
- [ ] **Step 3:** `npm run lint && npm run build`, and every test file that reads `admin.html` or `app.js`.
- [ ] **Step 4: Whole-branch review** by a fresh reviewer; fix what it finds.
- [ ] **Step 5: Ship** — PR, CI green, merge on Jaimie's standing go-ahead, deploy by SHA, check the live admin by GET.
