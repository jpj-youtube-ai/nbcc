# Keyboard focus on the Events screen, finished: design

Date: 2026-09-30. Task: TASK-468. These are follow-ups from the TASK-465 code review; the client
asked for them as described in that follow-up.

## The gaps

1. **Deleting an event drops focus.** `evDelete` hides the editor, and the Delete button inside it
   had focus, so keyboard focus falls back to the page.
2. **Arriving on an empty list moves focus.** With no events and edit access, `loadEvents` calls
   `evOpenNew()`, which focuses the name field. That breaks the TASK-465 rule that arriving on the
   screen never moves focus.
3. **Events that share a name sound the same.** A recurring event, such as "Red Bag packing
   morning", gives every row the same button name for a screen reader.

## Decisions

- **After a delete, focus goes to "Add an event" (`#evAdd`).**
  - Only someone who may edit can delete, and for them that button is always shown.
  - It sits just above the list, and adding is the likeliest next step.
  - "Deleted." is still announced through the switch status line.
  - If the delete fails, focus stays on Delete, which is still there.
- **`evOpenNew()` no longer moves focus.** The "Add an event" button's handler focuses the name
  field instead, after opening the blank event, so focus moves only when a person asks for a new
  event. Arriving on an empty list opens the blank event without moving anything.
- **Each button's name gains the event's short date**, with the visible word still first:
  "Edit Red Bag packing morning, 18 Sep". The date comes from `evShortDate(e.date)`, the list's own
  format. The visible text is unchanged.

## Testing

- **Test first, in `test/unit/admin-app.test.ts`**, in the TASK-465 describe:
  - the existing exact labels gain their dates;
  - two events with the same name get different names;
  - arriving on an empty list leaves focus alone, while pressing "Add an event" focuses the name
    field;
  - after a confirmed delete, focus is on "Add an event".
- **In a real browser**, using the stand-in and headless Chrome, check focus after delete, focus
  after "Add an event", and the new names.
