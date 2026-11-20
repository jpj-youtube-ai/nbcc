# Admin refresh: Contact businesses, and one business's page (2026-11-14)

Part of the whole admin in the Donations look (`2026-11-14-admin-refresh-design.md`). Built from the
kit (`assets/css/admin-kit.css`, `assets/js/admin/kit.js`); what only these two screens need is in
`assets/css/admin-outreach.css`, every rule named through `#view-outreach` or `#view-business`.

## What each screen is for

- **Contact businesses** (`#view-outreach`, Content > Contact businesses). A volunteer asks local
  businesses, one at a time, to become monthly supporters: adds one, checks nobody has asked it
  already, writes a line of their own, sends, then follows up. The daily reason to open it is the to do
  list.
- **One business** (`#view-business`). Opened from a name or a to do row. Everything known about one
  business before ringing or writing, what happened, and a note for the next person.

## What must not change

Who can be emailed or phoned, the consent rule for a sole trader, the Telephone Preference Service
(TPS) rule, the words of the two emails and the sending itself. Nothing here touches
`invitation-email.ts`, `nudge-email.ts`, `lawful-basis.ts`, the send route or the follow-up route.

## Contact businesses, as it is laid out now

1. The title and its sentence, then **progress in one line**: "34 of 120 emailed, 6 replied, 2 signed
   up", from the server's true counts.
2. **A bar of five parts** (`AdminKit.wireParts`), one showing at a time, each opening with one
   sentence:
   - **To do** (a dot when something is waiting): "Needs you today", whose list, and the rows. A
     Ready to send row has **Write to them** under it.
   - **Add a business**: "1. Who are we writing to?", the form, and the fold "Adding several at once",
     which now asks the kind of business and where the details came from itself.
   - **Write and send**: "2. Write and send". The subject line sits above the preview, and the frame
     grows to the email's height, so nothing scrolls inside a box.
   - **Everyone**: "3. Everyone we have contacted". Count tiles that filter the list (On the list,
     Waiting to be emailed, Emailed and no answer, Interested, Signed up, Said no, Mine), search, tag,
     the spreadsheet. A ledger on a laptop; a card per business on a phone, with where it stands,
     "emailed 12 days ago", who looks after it, the email as a link with Copy, and the latest note.
     Thirty at a time, with "Show more".
   - **How it is going**: "Is it working?", unchanged.
3. The headings the tests pin are kept, in the same order.

### Faults fixed

- **Ready to send opened a page that could not send.** "Write to them" opens Write and send with that
  business chosen; so does the button offered straight after adding one, and "Write their first email"
  on the business's own page.
- **The list and its counts stopped at 200.** `GET /api/admin/outreach` takes `limit` and `offset`
  and answers with `total` and `counts` (worked out over every business in
  `src/outreach/list-counts.ts`). The screen fetches the list a page at a time until it has all of it,
  and the tiles and the progress line use the server's counts.
- **The preview scrolled inside a box.** The frame is as tall as the email.
- **A phone number showed on the list but was hidden on the business page.** The list follows the
  stricter rule: a number shows only once somebody has recorded that it was checked against the TPS
  register. The to do list's "Call 01292..." follows it too (`src/outreach/todo.ts`).
- A pasted list was added as a limited company with whatever the form above happened to say.

## One business, as it is laid out now

1. Back to the list; **Previous** and **Next** through the list you came from ("2 of 14").
2. The business's name, and one sentence.
3. **What to do next**, in the to do list's own words (the server works it out with the same rule,
   `whatIsNeeded`, and sends it with the business). "Write their first email" when they have not been
   emailed; "Add their email address" when there is none.
4. **A bar of four parts**:
   - **At a glance**: where it stands, the contact (Copy for the email, and for the number once it is
     checked), their tags, who looks after them, the supporter they became with "See their giving";
     then What happened?; then the one follow-up, with who it is from chosen here.
   - **Notes**: the note box and every note.
   - **Their details**: the rest of the facts, and **Change their details** (new).
   - **If they ask what we hold**: unchanged, but the text no longer scrolls inside a box.

### Faults fixed

- **The supporter picker carried over from the last business opened**, so the wrong donor could be
  linked. Opening a business now empties the picker, the ask again date and the note box, and an
  answer that arrives for a business no longer open is thrown away.
- **"Saved." and "Sent. They will not be chased again." were wiped at once.** Opening a business
  clears the messages; redrawing it after a save does not (`businessReload`).
- Someone who may only look no longer sees "What happened?" with nothing under it.

### Change their details (new way to change data)

`PATCH /api/admin/outreach/:id`, beside its neighbours, guarded by `authorizeSection(…, "outreach",
"edit")`. Name, contact, phone, who knows them, who looks after them, tags. No migration: the
columns exist.

- **Not the email address** (review of #757). How a sole trader agreed to hear from us is recorded
  against the address we have, so a new address would carry an agreement it was never given. A
  change of address, adding one where there was none, or taking one away, is refused with a sentence
  saying why, until the business page has a form that asks again. The same address in other capitals
  is not a change.

- Validated by `outreachUpdateSchema`, made of the same pieces as the add form's.
- The do not contact rule holds: a new name is put through the same matcher as a new
  business, and a match against a business that said no is refused unless the volunteer says it is a
  different business. A business that itself said no cannot have its name or email changed, since
  those are what the matcher knows it by.
- **A changed phone number clears the TPS checked mark**, so it must be checked again.
- Kind of business, where the details came from and how a sole trader agreed cannot be changed here:
  those decide who may be emailed.
- An audit row, `outreach.details_changed`, naming which details changed (not their values).

## Left out, and why

- **The spreadsheet** now follows the screen's rule too (review of #757): a phone number is left out
  until its register check is recorded, and a cell that would run as a formula is kept as words.
- **Sending from the business page.** The first email is written in Write and send, where the preview
  is; the page takes you there with the business chosen.
- **Editing or deleting a note.** They are permanent on purpose.
