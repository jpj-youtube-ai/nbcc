# The Stories list on a phone: cards

Date: 2026-10-05. Asked of Jaimie the same day, when the Read tick (TASK-560) showed how the list
looked on a phone: "Yes, cards on a phone (Recommended)", as its own small task after the tick, with
pictures before it is live.

## Why

On a phone the Stories table cannot be read. Its seven columns were about 51px each before the Read
tick and are about 42px with it. Rows are 262 to 548px tall and every word is stacked a letter or
two a line. Nothing scrolls sideways, but nothing can be read either. The donations table had the
same trouble and became labelled cards in TASK-483. This follows it, rule for rule where it can.

## What staff see

Where the list is narrower than 760px, each story is a card:

- **"Story 40"** heads the card: the ID, with the word in front of it.
- Then one labelled line each: **Read** (the tick), **Role**, **Scope / consent**, **Status**,
  **Consent age**, **Submitted**.
- **View** comes last, at least 44px each way.
- The tick keeps its 44px target and behaves exactly as on the table. It saves at once and the card
  stays where it is. If the save fails, "Not saved" takes the status pill's place and no card
  moves. The three rarer sentences (somebody else changed the story, it has been erased, this
  person may no longer change stories) sit under the status, with the card's width to themselves.

Wide, the table is unchanged: the same rows at the same heights.

## 760px, the same as donations

Measured in Chrome, the stories table starts to break before that. Dates begin to split across two
lines at a list of about 845px, and every date is split at 805px. It stays a table down to 760px
all the same:

- One rule for both lists. On a window where Donations is still a table, Stories is too.
- Between 760 and 885px the table is cramped but every cell can still be read, exactly as it is
  today. Cards there would make a list of twelve stories about three times as long to scroll.

Because the rule measures the list and not the screen, a screen up to about 1025px wide with the
menu beside it also gets cards, as Donations does. That covers a tablet either way up and a narrow
laptop window.

## How

- `storiesTable` (`assets/js/admin/app.js`) wraps its table in `<div class="st-list">`, which is
  what the stylesheet measures, and gives every cell a `data-label`: Read, ID, Role, Scope / consent,
  Status, Consent age, Submitted, and an empty one for View.
- The Scope / consent and Status cells put what they hold in one box (`.st-value`). A card's line
  is a row: a label, then the value. Without the box each pill would be its own piece of that row,
  so four pills could not wrap, and the sentence would sit beside the status pill, not under it.
  On the table the box changes nothing.
- `assets/css/admin.css`: `.st-list{container:stlist / inline-size}` and, inside
  `@container stlist (max-width:759px)`, the donations cards' rules for `.stories-table`:
  - the table and its body are blocks, each row a column of lines with a rule under it;
  - the headings are clipped, not removed, so a screen reader still has them;
  - each cell is a row with a fixed 6rem label taken from its `data-label`;
  - the ID cell is moved to the top with `order:-1`, bold, with "Story " in front of it;
  - View is at least 44px each way.
- Two things the stories table has that donations does not. The first column's fixed width and the
  tick's negative margins both exist to fit a 44px target into a table row. Inside the container
  rule the column takes the card's width, and the margins become the ones a card's line needs, so
  the Read line is as tall as the lines around it and the target still reaches 44px.
- `@media (max-width:700px){.admin-read-unsaved{white-space:normal}}` goes. It was only there
  because the table's columns were narrower than the pill on a phone, and there is no table there
  now.

## Tests

- `test/unit/admin-fits-a-phone.test.ts`, beside the donations block: the container, the card
  rules, the label, the heading, the headings kept for screen readers, the first column and the
  tick's margins put right, View's target, and the order of the columns the heading depends on.
- `test/unit/admin-stories-read-tick.test.ts`: the wrapper, every cell's `data-label`, the two
  value boxes, and (already there) every press of the tick, which now runs against the new markup.
- Real Chrome at 320, 375, 390, 768 and 1024px (cards) and at 1040 and 1280px (the table, its rows
  the same height as before): nothing scrolls sideways, the tick's target is 44px, a press saves, a
  failed save moves no card.
- Pictures to Jaimie before it is live.

## Not doing

- Changing the order of the facts, or which facts show. The card has what the table has.
- The story's words on the card. The list never carries them: the full record is only read when a
  story is opened, and that is deliberate.
- Narrowing the table's ID and View columns to give the others more room between 760 and 885px. It
  would change the table everyone sees on a computer, which was not asked for.
