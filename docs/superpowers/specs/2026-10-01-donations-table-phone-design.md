# The donations table on a phone: design

Date: 2026-10-01. Task: TASK-483. The client chose "A: labelled cards" on 2026-10-01.

## The problem

At 375px the admin's donations table squeezes its nine columns to about 38px each, so every word
wraps one letter per line ("D/O/N/O/R"). Nothing scrolls sideways (TASK-442's fixed layout), but
nothing can be read either. The same table (`donationsTable` in `assets/js/admin/app.js`) draws
three lists:
- the Donations screen;
- the Overview's recent donations;
- donation search results.

## What staff see

Where the list is narrow, each donation becomes a card:
- **The donor's name is the card's heading.**
- **Every other fact is on its own labelled line,** in table order: ID, Donation, Amount, Gift Aid,
  Claim, Payment, Date (with any New pill).
- **The View button comes last,** with a target a thumb can hit (44px).
- **No Gift Aid line** when the gift has none. That cell is empty on the desktop table too, and
  the house stacks hide empty cells (`.monthly-table td:empty`).

This is the house pattern from Monthly givers and the thank-you letter history.

Wide, the table is exactly as it is today.

## When it switches

- **On the list's own width, not the screen's:** a container query, as the Events list does
  (TASK-460).
- **Why:** the three lists sit in different places, and the side menu takes its share up to 860px.
  A screen width standing in for the list's would be right for one of them at most.
- **How:** `donationsTable` wraps its table in `<div class="dn-list">`, which is the container
  (`dnlist`). The table stacks when that is narrower than 760px, about 84px for each of the nine
  columns, below which dates and amounts start to break.

## How

- **CSS:** `assets/css/admin.css` gets `.dn-list` and `.dn-table` rules inside
  `@container dnlist (max-width:759px)`:
  - the table, its body, rows and cells become blocks;
  - the headings are hidden the accessible way, so screen readers still read them;
  - each cell becomes a label and its value side by side (see "Changed while building"), with the label from `data-label`;
  - the donor cell moves to the top with `order:-1` and loses its label.
- **Labels:** every cell gets a `data-label` in `donationsTable`. The donor cell gets "Donor" for
  completeness, though it is not shown.
- **Nothing else changes,** including the New pills: only the Donations screen marks rows.

## Changed while building (seen in the browser at 375 and 320px)

- **Each line is a row with a fixed-width label, not the house grid.** In a grid every piece of a
  cell is a grid item, so the Payment and Gift Aid pills stretched to the column's width and a
  date's New pill dropped to a line of its own under the labels.
- **The label is 6rem, not 7.5rem.** At 320px a date and its New pill need the room; at 7.5rem the
  date broke as "30/09/202" and "6".

## Testing

- **`test/unit/admin-fits-a-phone.test.ts`,** a new describe in the Events list's pattern:
  - the container and its query;
  - the blocks;
  - headings hidden but read;
  - the donor first, with no label;
  - labels from `data-label`;
  - empty cells hidden;
  - no other rule changes how the rows lay out;
  - the View target;
  - and that it depends on the columns app.js draws, in order.
- **`test/unit/admin-app.test.ts`:** every cell carries its label, and the three lists all draw the
  wrapper.
- **Browser:** headless Chrome with the stand-in, at 320, 375, 768 and 1280px. Every width must
  keep `scrollWidth` equal to the viewport, the cards must read top to bottom, and the desktop must
  be unchanged.
