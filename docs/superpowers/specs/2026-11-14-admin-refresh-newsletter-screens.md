# Admin refresh: the Newsletter's own screens (2026-11-14)

Part of `2026-11-14-admin-refresh-design.md`. This is the Newsletter section's Overview, "Audiences &
people", "All newsletters" and Results, in the kit's look, with the faults the audit found put right and
the features below added. Jaimie: "I don't want you to take any features away, but I would love you to
add features to the newsletter area."

The composer (Write, Who, Send) is shared. Another change is adding block types to it at the same time,
and a later pass does the composer's own features. Here the composer gets CSS only, so that it looks
right and works on a phone once the section carries the class `ak`.

## What each screen is for

| Screen | The question it answers |
|---|---|
| Overview | What needs me, how are our newsletters doing, and where do I start one? |
| Audiences & people | Who is on each audience, and how do I add, find or take someone off? |
| All newsletters | Every newsletter, sent or not: open it, see how it did, use it again. |
| Results | How did this one do, who got it, and what should I do about it? |

## The faults, and what was done

- **"Usually delivered"** counted a send from before deliveries were recorded as none delivered. It now
  counts only sends that have delivery figures (`deliveredCount` is not null), and says how many those are.
- **"Start writing"** opened whatever was newest, perhaps a sent newsletter. It now carries on the latest
  unsent draft, or starts a new empty one, and the button and the composer's bar say which.
- **Donors** showed a count and "No one on this audience yet.". It now says those people are the donors
  who agreed to email, kept under "Donors who get our emails" (the old "Manage subscribers"), with a
  button that opens it. "Stop their emails" there (the old "Remove") asks first and says it switches off
  all our emails to that person.
- **Raw words**: `elf`, "by not recorded", `draft` and `sent` each have a plain phrase.
- **Someone who may only look** was shown an empty Audiences panel. It now says why.
- **Results "Back"** went to the Overview whatever you came from. It goes back where you came from.
- **"Who got it"** scrolled 11,442px inside a 506px box. It is in the page now: a card per person on a
  phone, the first fifty with "Show more", a search box, a filter by what happened, and a download.
- A failed download of the donors list handed over a file holding the error. It says so in the page.
- Messages now sit beside what was pressed (`is-ok`, `is-error`), not at the foot of the panel.
- A long link no longer pushes the Results page sideways on a phone.

## Layout

**Every screen**: the title, one plain sentence, then the row of three places and "Write a newsletter".

**Overview**: a send on its way (if any); four tiles that are buttons (people you can reach goes to
Audiences, sent this year and usually delivered go to All newsletters, blocked opens Blocked addresses);
"Worth a look" as cards that go to the thing; the band that starts or carries on a newsletter; recent
sends (a table on a laptop, a card each on a phone, with Open and Results); your audiences as cards that
open that audience.

**Audiences & people**: the audience picker and what can be done to the audience (new, rename, archive,
private or public); "Add a person" and "Import a spreadsheet" as two folds above the list; a search box,
a count with how many joined this month, and "Download this audience"; the people (table, cards on a
phone, fifty at a time); then the folds for the less common jobs.

**All newsletters**: a table on a laptop, a card each on a phone: the newsletter, whether it is sent, how
many it was sent out to, delivered and clicked, and Open, Results, Use this again and Delete.

**Results**: back to where you came from; the title; tiles (sent out, delivered, clicked, bounced,
unsubscribed, marked as spam), delivered and clicked set against the send before; what people clicked
(links you can press); the addresses that bounced, with a copy button; the record; who got it.

## Features added

1. Tiles that go where their number lives.
2. "Worth a look" that works: a draft waiting, a send with failures, the last measured send under 90%
   delivered, blocked addresses. Each is a card that opens the thing.
3. Open and Results on every recent send and every newsletter, at 44px.
4. Search within an audience, fifty at a time, "Download this audience", joined this month.
5. "See the rows before importing": every row of the sheet and what will happen to it.
6. Rename an audience (`POST /api/admin/subscriber-lists/:id/name`, `newsletter` edit, audit row).
7. "Use this again": a past newsletter's content as a new, unsaved draft with its subject.
8. Results: delivered and clicked against the send before, in words; links that open; "Copy the
   addresses that bounced"; marked as spam as a tile of its own.
9. "Who got it": search, filter by what happened, "Download this list".
10. Delivered and clicked on every row of All newsletters.

## Words

One word for one thing: an **audience** is a list, **people** are who is on it. "Accepted" is now "Sent
out", explained once where it appears (our mail service took it; "Delivered" is a mailbox confirming it
arrived). "Export CSV" is "Download as a spreadsheet". Open tracking is off on purpose (see the README),
so nothing here shows or implies an open rate.

## The composer, CSS only

In `assets/css/admin-newsletter.css`: the kit's button, pill and table rules no longer flatten the block
styles row, the foot's main button or the composer's tables; every field is 16px; every control is 44px;
on a phone the foot sits above the bottom tab bar, and the preview shows whole, not in a scrolling box.

## Left out, and why

- Saving as you go, undo, the phone preview, the test to five people, the subject helper, moving a
  scheduled send: the composer pass.
- The laptop preview still scrolls inside its box: it is what keeps the preview beside the block being
  edited, and putting that right needs the preview code. The recipient list in the send confirmation is
  still a tooltip: showing hundreds of addresses in the page needs its code too.
- Who never clicks, and sending again to those who did not click: a new endpoint, and to be weighed
  against "aggregates only".
- List growth over time for Donors and Newsletter: a new endpoint.
