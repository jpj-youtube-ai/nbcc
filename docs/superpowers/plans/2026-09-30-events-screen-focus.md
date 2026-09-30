# Keyboard focus on the Events screen, finished: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deleting an event leaves focus on "Add an event". Arriving on an empty list moves no
focus. Each row's button name carries the event's date.

**Architecture:** Three edits in the Events section of `assets/js/admin/app.js`: `evOpenNew`, the
`#evAdd` click handler, `evDelete`, and the button markup in `evRenderList`. The tests go in the
TASK-465 describe of `test/unit/admin-app.test.ts`.

**Tech stack:** Browser JavaScript (`app.js`), and Vitest with jsdom driving the real `app.js`
against `admin.html`.

Spec: `docs/superpowers/specs/2026-09-30-events-screen-focus-design.md`.

---

### Task 1: Failing tests

- [ ] **Update the exact labels in the existing TASK-465 tests** so they carry dates:
  "Open Carols at the Cross, 20 Oct", "Edit EmpowHer ’26, 4 Nov" and "Edit Christmas Jumper Day,
  9 Dec". Do the same for the viewer's "View …" labels, the label checked after opening Christmas
  Jumper Day, and `Edit Tom & Jerry's "Big" <Night>, 20 Dec`.
- [ ] **Add the tests.** Each needs a stub `DELETE /api/admin/events/:id` answering `{ deleted: true }`.

```ts
    it("tells apart events that share a name by their dates", async () => {
      events.push(eventRecord({ id: 7, name: "EmpowHer ’26", date: "2026-11-18", status: "live" }));
      await openEvents();
      const labels = buttons().map((b) => b.getAttribute("aria-label"));
      expect(labels).toContain("Edit EmpowHer ’26, 4 Nov");
      expect(labels).toContain("Edit EmpowHer ’26, 18 Nov");
    });

    it("leaves focus alone when an empty list opens a blank event by itself", async () => {
      events = [];
      await openEvents();
      expect(el("evEditorTitle").textContent).toBe("A new event");
      expect(document.activeElement).not.toBe(el("evf-name"));
    });

    it("puts you in the name field when you ask for a new event", async () => {
      await openEvents();
      el("evAdd").click();
      await flush();
      expect(document.activeElement).toBe(el("evf-name"));
    });

    it("leaves focus on Add an event after you delete one", async () => {
      await openEvents();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      try {
        el("evDelete").focus();
        el("evDelete").click();
        await flush();
        await flush();
        expect(el("evSwitchStatus").textContent).toBe("Deleted.");
        expect(document.activeElement).toBe(el("evAdd"));
      } finally {
        confirm.mockRestore();
      }
    });
```

- [ ] **Run** `npx vitest run test/unit/admin-app.test.ts`. The label tests, "leaves focus alone …
  empty list" and "after you delete" should FAIL. "Puts you in the name field" should PASS: it guards
  behaviour that must survive the move.

### Task 2: The changes

- [ ] **The button name:** `H.escapeHtml(action + " " + e.name + ", " + evShortDate(e.date))`.
- [ ] **`evOpenNew`:** drop its two focus lines. In the `#evAdd` handler, after `evOpenNew();`, add
  `var name = el("evf-name"); if (name && name.focus) name.focus({ preventScroll: true });` before
  the scroll.
- [ ] **`evDelete`:** after `evRenderList();` on success, add
  `var add = el("evAdd"); if (add && !add.hidden && add.focus) add.focus();`.
- [ ] **Check and commit.** Run the admin tests, then lint, build and the full suite on its own.
  Commit as `[TASK-468] Keyboard focus on the Events screen, finished`.

### Task 3: Browser check, README, ship

- [ ] **Browser:** in headless Chrome with the stand-in, check the names, focus after "Add an event",
  and focus after deleting (with `confirm` stubbed to true in `PREP`).
- [ ] **README:** add a short section "Keyboard focus on the Events screen, finished (TASK-468)".
- [ ] **Ship** as for TASK-465.
