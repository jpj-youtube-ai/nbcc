# Each Events list row clear on its own: design

Date: 2026-09-30. Task: TASK-465. It follows up the TASK-460 code review. The client chose the
wording: "On the website" and "Goes up 14 Oct".

## The problems

In the compact rows TASK-460 introduced, each event is read without its column headings. Three things
then fall short:

1. **The status reads like a date.** A scheduled event's pill says "From 14 Oct". Under an event
   dated 9 Dec, with the "Website" heading out of sight, that reads as the event's own date.
2. **The list and the editor use different words.** A live event's pill says "On the page". The
   editor, and the switch card's own sentence ("Visitors see every event marked 'On the website'"),
   say **On the website**.
3. **The buttons are unnamed for screen readers.** Every row's button is "Edit", "Open" or "View",
   so a screen reader moving through the list hears the same word over and over.

There is also a fourth problem:

4. **The list reads itself out again, and loses your place.** Opening an event redraws the whole
   list (`evShowEditor` calls `evRenderList`) so that the highlight can move. `#evList` is
   `aria-live="polite"`, so a screen reader may read the entire list again. The redraw also destroys
   the button just pressed, so keyboard focus falls back to the page and the user loses their place.

## Decisions

| | Now | After |
|---|---|---|
| Live, or scheduled and already up | On the page | **On the website** |
| Scheduled, not up yet | From 14 Oct | **Goes up 14 Oct** |
| Draft, past | Draft, Past | unchanged |
| The button's accessible name | Edit | **Edit EmpowHer ’26** (and "View …", "Open …") |
| The event open in the editor | a tinted row | the row's button also carries `aria-current="true"` |
| `#evList` | `aria-live="polite"` | no live region |
| After pressing Edit or Open | focus lost | focus on the editor's heading, "Editing: EmpowHer ’26" |

- **The wording** follows the editor. Its status step offers "On the website" and "From a date:
  goes up by itself", and a scheduled save already says "Saved. It goes up on 14 Oct."
- **The buttons keep their visible text.** The event's name is added in `aria-label`, the way the
  admin already names other row controls ("Role for …", "Select donation …"). The visible word comes
  first, so someone using speech input can still say "click Edit" (WCAG 2.5.3, label in name).
- **The live region comes off this one list.** The admin's other table lists keep theirs; this one
  redraws itself whenever you open an item. Saving already announces through the
  save status, deleting through the switch status, and a load failure through the switch state
  ("Could not check."), so nothing that needed hearing goes quiet.
- **Focus moves only when a person presses a row's button.** The editor's heading gets
  `tabindex="-1"` so that it can take focus. Arriving on the screen, which opens the soonest event by
  itself, never moves focus, so the page never jumps away from where someone is. Focus moves with
  `preventScroll`, and the existing smooth scroll still does the moving.

## Rejected

- **Updating the list in place instead of redrawing it on open.** That would keep the live region
  quiet and the button alive. But it means a second path for drawing the list, and a second path is
  the thing that drifts. Moving focus to the editor is what the person asked for when they pressed
  the button anyway.
- **"On the website from 14 Oct".** It is the most explicit option, but it wraps onto two or three
  lines in the table's Website column.

## Testing

- **Test first, in `test/unit/admin-app.test.ts`.** It drives the real `app.js` against the real
  `admin.html` in jsdom. It gains stubs for the events list and the preview, and checks:
  - the four pill wordings;
  - the button names, and `aria-current` on the open event's button;
  - that `#evList` carries no live region;
  - that pressing a row's button moves focus to the editor's heading, and that arriving on the screen
    does not.
- **In a real browser**, with the stand-in and headless Chrome, check that:
  - the pills read correctly in the table (1280px) and in the compact rows (320px);
  - pressing Edit leaves focus on the editor's heading;
  - no layout changes: the TASK-460 checks still pass at every width.
