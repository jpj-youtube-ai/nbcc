# Admin > Festive Ball new look: plan

Design: `docs/superpowers/specs/2026-10-19-ball-admin-look-design.md`. Visual and UI only.

## Files

| File | What changes |
|---|---|
| `admin.html` | `#view-ball` rebuilt: band, section buttons, six parts, Set up drop downs. Every control keeps its id, element and type. |
| `assets/js/admin/app.js` | The Festive Ball block gains the section switcher, the band's two facts, the glance (stats as a composed block), Needs you, the badges and the drop downs' current values. The Overview's Ball buttons say which section to open. No request, save, send, confirm or prompt changes. |
| `assets/css/admin.css` | `#view-ball` styles: band, sections bar, parts, glance, needs, downloads, email cards, drop downs, phone. The old `.admin-band` and `.admin-jump` rules go (nothing else uses them). |
| `test/unit/admin-ball-layout.test.ts` | The safety net: all ids with element and type, ten forms, the sections and what lives in each. |
| `test/unit/admin-ball-sections.test.ts` | New, jsdom: the screen working. |
| `README.md` | The Festive Ball section describes the screen as it is. |

## Tasks (test first each time)

1. **The safety net.** Snapshot the 100 ids of today's `#view-ball` with element and type
   (taken from main at 2ad1e175, before any change) into `admin-ball-layout.test.ts`; the three
   band anchors `ball-setup`, `ball-state`, `ball-send` are listed as retired (only the jump
   links used them). Keep the ten forms, unique ids. Passes on today's markup except for the
   retired ids and the new structure, which are the next task's red.
2. **The structure, red.** Tests for the band, the six section buttons in order with the two
   kept names, one part per section, which ids sit in which part, the Emails part holding only
   the two sends, Set up's seven drop downs, no `admin-jump`, no dash in the view's visible text.
3. **Markup** in `admin.html` until 1 and 2 pass.
4. **Behaviour, red then green** in `admin-ball-sections.test.ts` (jsdom harness as in
   `admin-email-audit-remove-ui.test.ts`): opening shows Overview; a button shows its part and
   hides the others; remembered through a refresh; arrow keys; a Needs you button opens its
   section; Needs you lines from the four lists; "Nothing needs you" only when all four are in;
   a list that could not load says so; badges; the band's page state and countdown; the drop
   downs' current values; the Overview's transfer and guest buttons open those sections;
   opening the screen makes exactly the requests it made before.
5. **CSS**, then `admin-fits-a-phone.test.ts` and a real browser at 390, 768, 1040 and 1280px.
6. **README.**
7. **Verify**: lint, build, the affected tests and the full unit suite; real Chrome against a
   stand-in with invented data; pictures and a clickable preview for Jaimie before anything goes
   live.
