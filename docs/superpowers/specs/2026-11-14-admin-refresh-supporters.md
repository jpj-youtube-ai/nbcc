# Admin refresh: Business supporters, Monthly givers, Invoices (2026-11-14)

Part of the whole-admin refresh (`2026-11-14-admin-refresh-design.md`). Three screens under Giving, built
from the kit (`assets/css/admin-kit.css`, `assets/js/admin/kit.js`); what only they need is in
`assets/css/admin-supporters.css`, every rule named through its own screen and pinned by
`test/unit/admin-supporters-styles.test.ts`. Inventory: the audit `audit-giving-2.md`, sections 1, 3 and 4.

## Business supporters (`#view-fulfilments`)

**For:** whoever looks after the businesses that give monthly, to see who needs something: a thank you
call every three months, a certificate posted, a social post, an invite sent.

**Was:** a three column table at every width (about 87px for a name on a phone), seven panels inside one
table cell when opened, messages under the whole table or beside a different button, browser question
boxes, every press blanking the list to "Loading", newest record first.

**Now:**
- One plain sentence; "2 businesses are due a call" kept above six tiles that count and filter: Time to
  call, Things to do, Waiting for their form, Invite not sent, All done, Everyone. Find a business (name or
  contact's name). Tiles and search work from the list already held; nothing is asked of the server.
- Whoever needs something first: a call due, then jobs, then an invite to send, under "Needs you"; then
  the rest under "Nothing needed just now". The server's newest first order is kept inside each rank.
- A card per business (`ak-item`) that opens where it is. Its face: name, contact, band, what they give a
  month (when the server says), Time to call, Stopped giving, New, where they are up to, Next call.
- Opened: what they give, their email as a link, See their giving (only for someone who may see
  Donations), then a bar of three parts: What to do (the call, the jobs, the invite; a dot when something
  waits), What they asked for (their answers with Copy buttons, what went by itself, the letter), History.
- Mark done, Mark as called and Send catch up invites ask in the page, under the button, naming the job
  and the business; what happened is said in the panel the button was in (and once to a screen reader
  from `#fulfilmentActionStatus`). A save re-reads the list without blanking it.
- Send catch up invites moved to its own card at the foot, saying under it what it does and how many it
  will email (counted from the list), disabled when there is nobody.
- Dates as people say them ("15 September 2026", "Next call 15 December").

**Tests changed on purpose:** `admin-app.test.ts` (the list is no longer a table; Mark done asks in the
page), `admin-business-calls-page.test.ts` (dates in words; Mark as called asks in the page, with two new
tests for the question), `admin-business-page.test.ts` (the letter's date through `fxDate`).

## Monthly givers (`#view-monthly`)

**For:** anyone who may see Donations: who gives monthly, what comes in, whose card is failing, who has
not been thanked, who has no Gift Aid.

**Now:** the email is its own line under the name (the unstyled `.admin-sub` ran it on). Five tiles that
count and filter (Still giving with £ a month, Needs attention, Not thanked yet, No Gift Aid, Everyone),
kept in step with the Show list, which keeps its id and gains the two new choices. Find a giver (name or
email) and Order (latest payment, biggest gift, giving longest, given most). The summary line is exactly
as it was; under it, a year at today's amounts and "about" the Gift Aid, only on gifts that carry it. A
table on a laptop, a card per giver on a phone (`ak-cards`). Each giver: last paid, cancelled on, a plain
next step on anyone needing attention with an Email them button (a `mailto:`), and Thank them beside Not
thanked yet (to the Thank you tab). Copy everyone's email and the spreadsheet both take what is showing.
"Lapsed" is "Stopped" and "Payment failing (2)" is "Payment failing, 2 tries".

## Invoices (`#view-invoices`)

**For:** whoever handles money: send an invoice, and mark it paid when a transfer arrives.

**Now:** five tiles that count, total and filter (Waiting, Overdue, Paid, Cancelled, All); they carry the
old filter's `data-inv-filter`, so Overdue gains a button of its own and the old bar is gone. On a phone
the form waits behind one big "Send an invoice" button so the list comes first. Each card adds where it
went, how often and when it was last emailed, days overdue, the note and who made it; its buttons are the
kit's (they were 33px underlined words). Send another like this fills the form from an old invoice. Mark
paid's question says it puts the gift in Donations and emails the receipt; Remove them (bank details) says
what stops and asks first. Find an invoice (name, email or number), See it in Donations on a paid card,
and a spreadsheet of what is showing. A paid after cancelling invoice wears "Paid, was cancelled".

## Left out, and why

- What a business gives a month and their email come from two fields (`monthly_pence`, `donor_email`)
  the list route does not return yet. The card shows them when they are there; the server change was a
  "should" item and was left for time.
- Monthly givers' "Still giving" leaves out a failing card, as the summary line always has.
