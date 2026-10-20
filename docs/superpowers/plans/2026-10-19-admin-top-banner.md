# Admin top banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a laptop, the admin's left side menu becomes one pinned banner across the top with a drop down per group, freeing the width it took and never needing a scroll to reach.

**Architecture:** The same `<nav class="admin-nav">` and the same 23 `.admin-nav-link` buttons, regrouped in the markup into five `li.admin-nav-group` items, each with a phone label, a laptop head button and a panel. Wider than 860px the stylesheet makes the nav a 60px banner pinned at the top (the top bar scrolls away, as on a phone) and the panels drop downs; app.js opens and closes them. At 860px and below nothing changes: the Menu button, its list, its tests.

**Tech Stack:** Plain HTML, CSS and the admin's classic script (`assets/js/admin/app.js`); Vitest with jsdom.

**Spec:** Jaimie, 19 October 2026: "a banner across the top that has drop downs for each of the sections. If there's like a new pill ... have that on the banner at the top itself for the section, and then when you hover or click on the section, you see it next to the actual part of that as well. It frees up more horizontal space, and it means that you don't have to keep scrolling down all the way". She skipped the questions ("just get started and show me a preview"). The calls below are mine, shown to her in the preview.

## Design (my calls)

- The five groups as they are, in order: Monitor, Giving, Content, Governance, Admin. Each screen stays in its group.
- A drop down opens on click (any device) and on hover (a mouse only), one at a time. Escape, a click elsewhere, leaving it by keyboard, or choosing a screen closes it.
- New on a group's head when any screen shown in it is new; New beside the screen inside, as today.
- The group holding the screen on view is marked on the banner.
- The banner is the one pinned bar, 60px tall, so everything that pins under the 60px top bar today (the Festive Ball's sections, the newsletter's composer bar) fits under it unchanged.
- The content takes the 210px the side menu used, up to 1280px wide.
- A group shows while any screen in it shows (it used to be only the Admin label, and only for Team or Analytics).

## Global Constraints

- Every `.admin-nav-link` keeps its `data-view`, `data-edit-gate`, `data-view-gate`, `data-view-gate-any`, words and order.
- `#adminNavToggle`, `#adminNavList`, `#teamNavGroup` stay; every rule and test for the phone menu (admin-fits-a-phone, admin-app's phone menu, admin-ball-layout) passes unchanged.
- A closed panel is hidden with `visibility`, never `display:none`: restorableView (TASK-443) reads a link with no offsetParent as one your permissions hide.
- Visible words: no en or em dashes, no new hyphenated words. Nothing scrolls sideways; no box has its own scrollbar; 44px targets.
- Preview before anything goes live (the Festive Ball rule: this frame surrounds the Ball screen).

## Review Focus

- A mouse that crosses from one head to the next: the first closes and the next opens, never both.
- Hover opens, then a click on the same head: it stays open (a click must not close what hover just opened).
- A touch on a tablet wider than 860px: tapping a head opens it and a second tap closes it (no hover ghost).
- Resizing from a laptop to phone width with a drop down open: it closes, and the phone menu is untouched.
- A user who can see only some screens of a group: the group shows with only those; a group with none is hidden.

---

### Task 1: The markup, regrouped

**Files:**
- Modify: `admin.html` (the `<nav class="admin-nav">` list)
- Test: `test/unit/admin-top-banner.test.ts` (new)

**Interfaces:**
- Produces: `li.admin-nav-group[data-nav-group]` (monitor, giving, content, governance, admin; the last keeps `id="teamNavGroup"`), each holding `span.admin-nav-grouplabel[aria-hidden="true"]`, `button.admin-nav-grouphead[aria-expanded="false"][aria-controls]` and `ul.admin-nav-panel[id]` (`adminNavMonitor`, `adminNavGiving`, `adminNavContent`, `adminNavGovernance`, `adminNavAdmin`).

- [ ] Test "keeps every screen's link, with its gates, words and order": a BEFORE list of the 25 links as `[data-view, gate attributes, text]` taken from the current markup equals the list read from the new markup.
- [ ] Test "groups them in five, in order, under a label and a head": group keys, label and head text, `aria-controls` naming its own panel, and each group's `data-view`s.
- [ ] Run: `npx vitest run test/unit/admin-top-banner.test.ts`; expected FAIL.
- [ ] Regroup the list; run again; expected PASS; commit.

### Task 2: The script: groups, New, and the drop downs

**Files:**
- Modify: `assets/js/admin/app.js` (`applyNavFiltering`, `renderNewPills`, a new block after the phone menu's)
- Test: `test/unit/admin-top-banner.test.ts`

**Interfaces:**
- Consumes: Task 1's classes and ids.
- Produces: `navGroupOpen(group, how)` (`how` is "click" or "hover"), `navGroupClose(group)`, `navGroupsClose()`; a group open carries `is-open`, its head `aria-expanded="true"`.

- [ ] Tests: a group hides when none of its screens shows and shows with any (an editor; a viewer given Analytics); New on a head when a shown screen in it is new and not otherwise; a click opens a group and closes any other, and a second click closes it; choosing a screen closes it; Escape closes and puts focus on the head; a click elsewhere closes it; with a mouse (matchMedia stubbed) hover opens and leaving closes after its delay, and a click on a hover-opened head keeps it open; ArrowDown on a head opens it and focuses its first shown screen.
- [ ] Run; expected FAIL. Implement; run; expected PASS; commit.

### Task 3: The stylesheet

**Files:**
- Modify: `assets/css/admin.css` (the app shell, and the 860px block)
- Test: `test/unit/admin-top-banner.test.ts`

- [ ] Tests (read from the CSS): wider than 860px the top bar is static, the grid a block, the nav sticky at `top:0` and 60px tall, a closed panel hidden by `visibility:hidden` and never `display:none`, the content `max-width:1280px`; at 860px and below the head is `display:none` and the label shown.
- [ ] Run; expected FAIL. Implement; run with admin-fits-a-phone, admin-app, admin-ball-layout; expected PASS; commit.

### Task 4: Real browser, README, preview

- [ ] Pictures at 1280, 1024 and 900 (a drop down open, New on a head) and 390 (the Menu open); a sweep from 320 to 1366: nothing sideways, no inner scrollbars, targets at least 44px, the Ball's sections and the newsletter composer bar pinned under the banner.
- [ ] README: the admin shell section, and The admin fits a phone's note on the desktop nav.
- [ ] Show Jaimie; nothing goes live until her yes.
