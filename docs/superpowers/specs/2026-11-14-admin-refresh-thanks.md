# Admin refresh: Thank you (2026-11-14)

One area of the admin refresh (`2026-11-14-admin-refresh-design.md`): the screen under Content where
the team picks a donor, writes them a thank you letter and emails it (`#view-thank-you`). The email
itself, the letter's design and wording, and the page a donor prints are not touched: this is the admin
screen around them.

## What the screen is for

A trustee or editor writes a personal letter to anyone who gave £1,000 or more in one gift, or gave
something in kind, emails it, and can look back at every letter sent. A few times a month, most from
November to January, often on an iPhone.

## What was wrong (the audit, section 4)

1. **It said "Sent" when the email had failed.** The server recorded the letter, marked the donor
   thanked and swallowed the send error, so the reply was a 201 either way.
2. **The form was not cleared after sending**, so a second press sent the same letter again. "Thank
   again" gave no warning.
3. **The letter could not be read on a phone**: the A4 sheet was shrunk to the screen, about 6px words.
4. **The history stopped at 50** with no way to see more.
5. Nothing on the form said whose letter it was; the donor list was a five column table with no phone
   layout; Send emailed a donor the moment it was pressed, with no question and no line under it; a
   failed delete replaced the whole history with one line; jargon ("threshold", "Compose", "Monetary",
   "uplift", "CC", "Opted out").

## The design

The kit's look (`ak`), in three parts behind the kit's bar. One part shows at a time.

### Who to thank

- Three tiles that filter, each a count: **Ready to thank**, **Thanked**, **Cannot be emailed**. It
  opens on Ready to thank when anyone is waiting, otherwise on everyone. Pressing the chosen tile
  again, or "Show everyone", shows everyone. A dot on the part's button says someone is waiting.
- Each donor is a card with the amount large, as Donations: the name (it opens their donor page for
  someone who may open Donations), the email, marks (Ready, Thanked with the date, No email address,
  Does not want emails, Gift Aided, Asked to stay anonymous), what they have given since they were last
  thanked, and Write or Thank again. For someone who cannot be emailed the card says what can be done
  instead.
- "Single donation over £" is remembered on this device (`localStorage`, a number only).

### Write the letter

- A line at the top says whose letter it is: "This letter is for X", with a way to start a new one
  instead. Write on a donor brings you here.
- The form on the left, the letter on the right; on a phone the form, then the letter, then Send, so
  the letter is read before it is sent.
- **The letter on a phone** is the same words at normal size in one column. "See it as a page" shows
  the A4 sheet, and "Read it at normal size" comes back. A laptop opens on the page. The sheet is
  fitted when the part is shown, since a hidden letter has no width to fit to.
- **Send** has a line under it, "Emails this letter to x@y now and keeps a record.", and asks first, in
  the page beside the button. When this donor has already been thanked, a warning sits over the button
  and in the question.
- After a send the form is cleared, the line under the button says who was thanked, and the next
  person waiting is offered ("Next to thank: Y"). A second press cannot send the same letter again.
- **When the email does not go** the page says so, nothing is recorded, the donor is not marked
  thanked and the form is left as it was to try again.

### Letters sent

- Cards that open in place: who, the gift and the date; inside, who it was addressed to, the email, who
  was copied, who signed it, who sent it, the personal message (it always came back and was never
  shown), View letter, Copy the link, and Delete with a line saying what it does and a question in the
  card. A failed delete says so in the card and leaves the list alone.
- A search box over the letters loaded, and "Show more" while the server has more (`total`).

## The server

- `POST /api/admin/thank-you/send`: the email is sent inside the transaction that records the letter
  (`recordThankYouSent(input, send)`). A letter is kept only when its email went. The reply is 201 with
  `emailed: true`, or 502 with `emailed: false`, `recorded: false` and a sentence. No new route, no
  migration.
- `GET /api/admin/thank-you/eligible`: each donor gains `givenSinceThankedPence` and
  `giftsSinceThanked` (null when they have never been thanked).

## Approaches considered for a failed email

1. **Roll the record back (chosen).** The row, its audit entry and the email stand or fall together,
   as Contact businesses already does ("Nothing has been recorded"). Nothing anywhere claims a letter
   was sent that was not.
2. Keep the record and add `emailed: false` to the reply. The screen could say so at the time, but the
   donor would still show as thanked to the next person, with a "sent" letter in the history.
3. Record, then delete on failure. Two audit rows for something that did not happen.

## Left out, and why

- **Recording a posted letter without emailing.** A new way to write data (send insists on an email).
  Worth doing next: the cards for "No email address" and "Does not want emails" would gain "I posted
  them a letter".
- **The "Copy in" list from the team** (it is still four addresses in the page). It needs a new read
  route for someone who may see Thank you but not Team.
- **The letter drawn by the server.** The screen's letter is a copy of the print page's wording
  (`src/thank-you/letter-page.ts`); a test now pins the two together instead.
