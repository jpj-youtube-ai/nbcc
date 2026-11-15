# Get involved: Tickets and pledges, Emails and Settings in the new look (2026-11-15)

Part of the whole-admin refresh (`2026-11-14-admin-refresh-design.md`). Sign ups and Our events were redone on
13 November (`2026-11-13-get-involved-refresh-design.md`) and are the standard; they are not changed here.
The inventory of everything on these three parts before the change, with the phone measurements, was written
first and handed to the reviewer with this change.

## What each part is for

- **Tickets and pledges**: events where NBCC sells the tickets (approve kinds of ticket, the limit, close
  sales, the guest list and spreadsheet, refunds), and sponsors' promises to pay after an event.
- **Emails**: invite someone to fundraise; switch the automatic emails to organisers on or off; read every
  fundraising and events email, and approve the few that wait for an admin.
- **Settings**: whether the Get involved page and fundraising are on the website; the categories on the sign
  up form; the "could" examples on the pages; who gets the Monday summary.

## The look: scoped to the three parts, not `ak` on the section

The tab's section does not carry the kit's class `ak`. Adding it would redraw every `.admin-btn`, `.admin-seg`,
field and table in Sign ups and Our events too (they have their own rules, made yesterday), so it would need
before and after pictures of six sign up parts and the editor to prove nothing moved, and any later kit change
would reach them. Instead each of my four part boxes carries `gi-rest`, and every new rule in
`admin-get-involved.css` is named `#view-get-involved .gi-rest ...`, with the kit's values: the ink edge and the
hard shadow on every card, Playfair headings, buttons at 44px that press in, fields at 46px with 16px words,
22px tick boxes, statuses in holly or crimson, folds whose heading is the button. The kit's own `.ak-` parts
(`.ak-tiles`, `.ak-tile`, `.ak-says`, `.ak-part-dot`) are used as they are, since they work anywhere. A test
pins that every rule in the block is named through `.gi-rest`. The tickets card's own sheet
(`admin-event-tickets.css`) draws each event as a card that opens where it is, its rows as cards inside it,
and its motion now only for someone happy with it, and only transform.

## Features added

- **Tickets**: tiles for tickets sold and ticket money across every event, and "Waiting for you" (events with
  tickets, a limit or a refund to look at), which is a button: pressed, the list shows only those events;
  pressed again, all of them.
- **Pledges**: tiles for promised, paid (online and in cash), still owed, and "To chase" (unpaid two weeks after
  the event); the fundraisers with pledges to chase are listed first. "Download as a spreadsheet" of every
  pledge listed (`AdminKit.downloadCsv`, a formula kept as words), saying in the page how many went or why
  not. "Copy email" beside each sponsor's email, saying in the page whether it copied. A line under each
  pledge's buttons saying what Send pay link and Cancel pledge do.
- **Emails**: a "Waiting for sign off" tile at the top, and a dot on the Emails button (with the words for a
  screen reader) whenever something waits, from any section of the tab: the count is read when the tab opens
  (it reads only the sign offs, so it is cheap). Pressing the tile opens All emails at the first email
  waiting. "Find an email" searches the emails' names, subjects and who they go to, opening the groups that
  match. Each email already said in one line when it goes and to whom (the catalogue's `who`).
- **Settings**: two plain headings ("On the website", "The sign up form and the pages"); a line under each
  website switch saying what pressing it does on the website, now, for its current state, and that you are
  asked first. What happened is already said beside each switch (`frSwitchStatus`, `evSwitchStatus`).

## Phones

Before: 27 buttons under 44px in an opened ticket event, the invite and automatic email buttons at 39px, the
fundraising switch at 36px, tick boxes at 18px. After: none under 44px in the three parts (a tick box is 22px
inside a 44px label). The page is 390 wide in every state and nothing scrolls inside a box, before and after.

## Left out, and why

- Send pay link does not newly ask first: its line says what it does, but a question would change a button
  staff already use daily. Jaimie to say.
- No filter on the pledges list beyond chase-first ordering, and no Copy on ticket buyers' emails (the buyer's
  email is only shown to editors and sits in the server's CSV already): time.
- The section buttons themselves (shared with Sign ups and Our events) are left as they are.
