# A Read tick on Stories

Date: 2026-10-05. Asked for by Jaimie ("on the stories page, I would like to be able to tick them
to say that the story has been read so that it doesn't appear in the overview anymore"). Approved
in chat: read counts for "The whole team", then "Looks right, build it".

## Why

The Overview's "Needs you" card says "N new stories are waiting to be read". That number is the
live stories whose status is still New (`listStories({ status: "new" })`,
`src/routes/admin-overview.ts`). Today the only way to take a story off it is to open the story,
choose a Status, and press Save changes. The stories brought in from the old website all arrived as
New, so the number is large and clearing it is slow.

"Read" already has a status: **Reviewed**. So the tick is a faster way to set a status that exists,
not a new idea to store. Three approaches were considered:

- **A tick that sets Reviewed, for everyone (chosen).** No new data. The Overview, which counts New,
  and the Stories screen can never disagree.
- A separate "read" flag on each story. A story could then be New and read at once, and the
  Overview would have to count something the Stories screen does not show.
- Read per person. Staff accounts live in the main database and stories in their own, which
  stories code must never join, and nobody could see what the rest of the team had dealt with.

## What staff see

**The Stories list** gains a **Read** column, first in the table: one tick box a story.

| The story's status | Its tick |
|---|---|
| New | Not ticked. Ticking it makes the story Reviewed. |
| Reviewed | Ticked. Unticking it makes the story New again. |
| Used, Withdrawn | Ticked and locked. Those statuses say more than "read", and a stray click must never undo them. |

- Ticking saves at once. The row stays where it is, its Status changes in place, and the tick can
  be taken straight back off: nothing jumps, even when the list is filtered to New.
- If the save fails the tick goes back to how it was, and a line under the filters says
  "Could not mark that story as read. Please try again." (or "as new"). That line keeps its room
  while it is empty, so its words never move a row under the pointer.
- While a tick is saving it cannot be pressed again.
- Each tick box is named for a screen reader: "Story 12 read".

**An open story** gains one button, directly under the story's words, where reading ends:

- New: **Mark as read**, the admin's small button. Reviewed: the line "Marked as read." with
  **Mark as new** beside it as a plain link, so Save changes stays the one loud button.
- Used and Withdrawn: no button. The Status row above already says where the story is.

**Who.** Only someone who can edit Stories, as for every other change to a story. Someone who can
only view Stories sees the ticks, locked, and no button.

**The Overview** is unchanged. A ticked story is Reviewed, so the count drops by itself, for
everyone, the next time the Overview is opened.

## What changes

- `assets/js/admin/app.js`: the Read column in `storiesTable`, one delegated `change` listener that
  sends the status, and the button in `renderStory`.
- `admin.html`: a status line for the list, `#storiesListStatus`.
- `assets/css/admin.css`: the tick column's width and a finger-sized target on a phone.
- `README.md`: the Stories and Overview sections.

Nothing changes on the server. `PATCH /api/admin/stories/:id` already takes `{ "status": … }` on
its own (Withdraw sends exactly that), needs stories edit, and answers the updated story. There is
no migration and no new table.

## What does not change

- The four statuses, their names, and the status filter.
- Archive, restore and erase. An archived story can still be marked, though it was never counted.
- The menu's New pill for Stories, which is about each person's own last visit.
- Where the Overview's Stories button lands: the list, with whatever filter was last chosen.

## Tests

- **The screen, in jsdom** (the admin's own harness: `admin.html`, a fake `fetch`, `app.js`):
  - the tick for each of the four statuses;
  - ticking and unticking send the right status to the right story, and the row's Status follows;
  - a failed save puts the tick back and says so;
  - a viewer's ticks are locked and send nothing;
  - the open story's button for New and for Reviewed, none for Used or Withdrawn, none for a viewer.
- **The styles**: `admin-screen-styles.test.ts` and the no-sideways-scroll tests still pass.
- **BDD**: a story marked Reviewed is no longer counted on the Overview.
- **Real browser**: the list and an open story at 1280px and 390px, nothing scrolling sideways.
  Pictures go to Jaimie before it is live.

## Not doing

- "Mark all as read". Offered and not chosen.
- Colouring the New status, or filtering the list to New from the Overview. Neither was asked for.
