# Admin > Donations: a clear gift log, with where each gift came from and how it was paid

Asked by Jaimie on 2026-11-05, in their words: the Donations section is "really messy, it's really hard to
see"; make it look like the Elf Detective School's new backend, "really clear, really nice, really
simple", "if this was, say, like in a game"; show "where things are coming from", for example whether
Sophie Smith's £10 came "straight from the donations page" or "a get involved QR code"; show the time as
well as the date; "a click down on them"; "if it's paid by the mobile phone app stuff"; "as many filters
as we have"; "have a hard look at the Stripe data ... give us as much data as possible for each of the
payments". Jaimie skipped the questions: "I trust your judgment ... just go".

## What we know today, and what we will start to know

Known for every gift already: amount, the card fee cover on top, one off or monthly (and the monthly
level), Gift Aid and its claim (eligible, in a batch, claimed), payment state (paid, waiting for a Direct
Debit, failed, refunded or partly refunded), when it was recorded (date AND time), the donor (name, email,
business, address for a company, email consent), and where on the site it was given: the Donate page,
Fill a Red Bag, the Festive Ball's donate page, the Ball's table cards, a fundraiser or event page, a
sponsor pledge, an invoice, the card reader at an event, and (from Head Elf HQ, PR #716) Elf Detective
School entries.

Not known today, recorded from now on:

1. **What brought them** (new gifts only). On the Donate, Fill a Red Bag, Festive Ball and fundraiser
   giving forms, the page sends, with the checkout, the link tags it was opened with (`utm_source`,
   `utm_medium`, `utm_campaign`) and the page before it (`document.referrer`). Nothing is stored in the
   browser. The server sorts it with the analytics rules already used for page views
   (`classifyArrival`, `src/analytics/channel.ts`) into one of: **QR code**, **Email**, **Newsletter**,
   **Social media**, **Search**, **Another website**, **Typed in or a bookmark**, or **From another page of
   ours** (with which page: Get involved, home, and so on). A QR code is named: a named code by its name
   from Admin > QR codes (`c12` becomes "Donate billboard, High Street"), a page code by its page. Kept on
   the donation (`arrival_channel`, `arrival_detail`, `given_on`, the giving page's path). Skipped when the
   browser sends Do Not Track or Global Privacy Control, as page counting is.
2. **How it was paid.** Card, **Apple Pay**, **Google Pay**, Link, **Direct Debit (BACS)**, **card reader**,
   or **bank transfer** (an invoice marked paid), and for a card its brand (Visa, Mastercard, Amex), last
   four digits and the card's country. Read from Stripe after the gift is recorded, never in the way of it:
   new gifts straight away (best effort, after the commit), and any older gift the first time its details
   are opened (one call to Stripe, then kept). Stored on the donation (`pay_method`, `pay_wallet`,
   `card_brand`, `card_last4`, `card_country`, `pay_checked_at`).

The privacy notice's "What we collect" gains one plain sentence saying we note the link or QR code that
brought someone to give, and how they paid (for a card only its type and last four digits, from Stripe).

## The screen

The same place (Admin > Giving > Donations) in the look of Head Elf HQ: NBCC's colours and fonts, chunky
panels with a deep maroon ink edge and a hard shadow that presses in when clicked, roomy, plain words, and
no table. Its own stylesheet (`assets/css/admin-donations.css`, every class `.gl-`) with Head Elf HQ's
values but not its classes.

1. **The scoreboard.** One chunky tile per place a gift can be given (Fill a Red Bag, Festive Ball, Red bags
   at the Ball, Invoices, Elf Detective School, Donate page), each with this month's total and gift count
   and all time beneath. Pressing a tile filters the log to it, as the old "only" boxes did (they are the
   same checkboxes underneath, so Head Elf HQ's "Every payment, in Donations" keeps working).
2. **Filters**, one bar, every one a plain choice: search by name or email; from and to dates; type (one
   off, monthly); paid by (card, Apple Pay, Google Pay, Direct Debit, bank transfer, card reader); came
   from (QR code, email, newsletter, social media, search, another website, typed in, another page of
   ours); Gift Aid (with, without); payment (paid, waiting, failed, refunded); claim (eligible, in a batch,
   claimed, not eligible). Each active filter shows as a chip with a cross, and "Clear all".
3. **The log**, newest first, grouped under day headings ("Today", "Yesterday", "Thursday 5 November").
   Each gift is one card: the amount large; the donor's name; the time ("2:34pm"); a badge for where it was
   given (Donate page, Fill a Red Bag, a fundraiser's page title ...); a badge for how it was paid (Apple
   Pay, Visa ending 4242 ...); small marks for monthly, Gift Aid and anything not plainly paid (waiting,
   failed, refunded). An Elf Detective School entry is a card too, with its reference.
4. **The click down.** Pressing a card opens it in place (no pop up) to show everything, in plain groups:
   *The gift* (amount, card fee cover, total charged, one off or monthly level, recorded at date and time,
   our reference NBCC-000321), *How it was paid* (method, card, country, Stripe's payment with a link to
   it in the Stripe dashboard), *Where it came from* (given on, came from, the QR code or email or website
   by name), *Gift Aid* (declared or not, the claim, the batch), *Refunds* (how much, when), *The donor*
   (name, email, email consent, business, other gifts from the same email address, a button to open the
   donor), and the link for anything it belongs to (the fundraiser's page, the pledge, the invoice, Head Elf
   HQ). Older gifts show "We started noting this on 6 November 2026" where a thing was not recorded.
5. **Phones**: the cards and the click down stack; nothing scrolls inside a box.

The Overview's "recent donations" and Search keep their compact list.

## Rules

- Recording what brought someone and how they paid can never stop or delay a gift: both are written after
  the gift has been saved, best effort, and a failure only means the line says "Not noted".
- No new place where money is decided: amounts, Gift Aid and claims are read as they are.
- Only people who can view Donations see any of it; the Stripe look up runs only for them.
- Additive migration, numbered above 360 (Head Elf HQ's).
- Every existing test that pins the Donations screen is kept or updated on purpose; the Overview and
  Search lists stay as they are.

## Not doing

- Guessing what brought gifts made before today, from page view records: the visitor code changes daily
  and is not tied to a donation, so any guess could be wrong.
- Storing anything in the visitor's browser.
- Editing gifts from the log (refunds and corrections stay where they are).
