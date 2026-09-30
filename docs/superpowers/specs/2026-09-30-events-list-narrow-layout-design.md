# The Events list where the table does not fit: design

Date: 2026-09-30. Task: TASK-460. Approved by the client: option B, compact rows, chosen from the
two prototypes rendered at 320px and 960px.

## The problem, measured

Measured in headless Chrome against the real `admin.html` and stylesheets, listing the two events
production holds (EmpowHer ’26, run by AD Autocare; Festive Ball 2026, run by The Designer Rooms)
plus one scheduled and one of NBCC's own.

The list is a five-column table (Date, Event, Run by, Website, Open) with fixed shares of its width.
It needs the list to be about **850px wide**. Below that it breaks, a little more at each step:

- **Below about 850px**, the Open and Edit buttons break their own label mid-word ("Ed / it",
  "O / pe / n").
- **Below about 700px**, the times break mid-word ("6.30 / pm"), and the date badge runs into the
  event's name.
- **Below about 520px**, the list also scrolls sideways inside its box, by 23px on a 320px phone.
  The Website heading and the "On the page" pill then stand one letter per line.

The list is narrower than 850px on every phone and tablet. It is also narrower on laptops up to
about 1150px wide, where the 210px side menu takes the room. The page itself never widens, which is
why TASK-454 measured the admin clean.

## Decision

Where the list is narrower than 900px, each event becomes a **compact row** (option B). From 900px
up the table is exactly as it is now.

900 rather than 850 leaves a margin. The tightest fit at 850 is the button's label, and "Open" is
already the longest one the list uses. A longer time such as "12.30pm" still has 95px of room in the
Date column at 900px.

### Option B, chosen: compact rows

Each event reads top to bottom, like a diary entry:

1. the date badge, with the weekday and the time beside it (the existing `.ev-admin-when`);
2. the event's name, with its venue and town underneath;
3. "Run by NBCC", or "Run by" and the partner's name, with the words "Run by" drawn by the
   stylesheet;
4. the status pill on the left and the Open / Edit / View button on the right, on one line.

There are no repeated column labels: the badge already says it is a date, and the pill already says
where the event stands. The row being edited keeps its tint across the whole row. Rows are divided by
the line the table already uses.

Measured at 320px: nothing scrolls, sticks out or breaks mid-word, and four events take 831px.

### Option A, rejected: the house stack (as `.monthly-table` and `.ty-sent-table` do)

In this pattern each cell becomes a labelled row. The prototype at 320px showed four problems:

- The label column took over a third of the width.
- The venue fell into the label column, because the Event cell holds two lines and that pattern can
  only place one.
- The button stretched to the full width.
- Four events took 1,177px, against B's 831px.

## How

- **CSS only**, in the Events block of `assets/css/admin.css`. There is no markup change: the table
  keeps its structure, and its headings stay in place for screen readers. They are visually hidden
  in the compact rows, the way the house stacks hide theirs.
- **A container query, not a media query.** The list gets `container: evlist / inline-size`, and
  the rules sit in `@container evlist (max-width: 899px)`.
  - The narrowest list is on a laptop just past 860px, with the side menu beside it, not on the
    narrowest screen. So no single screen width marks where the table stops fitting; the list's own
    width does.
  - This is the repo's first container query. Browsers without them (iOS before 16) keep today's
    table, so they are no worse off than now.
- **The row is a grid** with the areas `when`, `event`, `run` and `state open`, and 14px 16px of
  padding. Each cell is a plain block with no padding of its own.

## Testing

- **Test first.** Static assertions go in `test/unit/admin-fits-a-phone.test.ts`; its CSS parser
  learns to read `@container`. They check that:
  - the list is a size container;
  - inside the query, the table, its body and its rows stop being a table;
  - the headings are visually hidden, never `display:none`;
  - every cell has its grid area, and "Run by" is supplied;
  - no rule in the list stops text wrapping.
- **In a real browser**, using the stand-in server and headless Chrome:
  - at 320, 375, 390, 430, 768, 861, 960, 1024, 1100, 1180, 1200 and 1280px, no box scrolls
    sideways, nothing sticks out of its cell, and no word breaks mid-word;
  - screenshots at 1200 and 1280px are identical before and after, because the table is untouched
    wherever it fits.

## Out of scope

- The table's own column shares. They stay as they are, and the compact rows take over wherever
  the shares fall short.
- The event editor and the two previews below the list, which already fit.
