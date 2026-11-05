# Invoices for donations: send one from the admin, and it lands in Donations when paid

Asked by Jaimie on 2026-11-05: "add an admin tab under donations that allows us to send an invoice out to
someone that will then come through into our donations".

## Why

Some givers, most often businesses, schools, churches and clubs and sometimes individual people, will
only pay a gift once they have a proper invoice from us. Today staff make one by hand outside the
website, chase it by hand, and type the gift in afterwards (or it never reaches Donations at all). This
puts the invoice, the payment and the donation record in one place.

## What Jaimie decided

1. **Who for:** anyone. Businesses and groups, and individual people too.
2. **Paying:** by card **or** by bank transfer. A card payment lands in Donations by itself. For a bank
   transfer, staff tick Paid when the money arrives, and it lands in Donations then.
3. **Gift Aid:** offered when the invoice is for a person (never for a business), and taken when they pay.
   It goes into the Gift Aid claims as normal.
4. **What's on it:** one amount and one line saying what it is for, plus an optional note from us.
5. **Reminders:** none are sent automatically. An unpaid invoice past its due date shows as **Overdue**
   in the admin, and staff chase it themselves.
6. **Groups:** the form offers three choices: a **person**, a **business**, or a **group** (a school,
   church, club and so on). A group is kept out of Gift Aid like a business, but gets a plain thank-you
   receipt rather than the business receipt that mentions Corporation Tax.
7. **Sign-off:** Jaimie sees pictures of the screen, the invoice page and every email (on a stand-in with
   invented details) and says yes before anything is merged, because merging puts it live.

## Goals

- Staff send an invoice in under a minute from **Admin > Giving > Invoices**.
- The person gets an email with a link to a private invoice page that they can pay, print or save as a PDF.
- Every paid invoice becomes a normal donation, labelled as coming from an invoice, so totals, receipts,
  the donor record and Gift Aid all work as they do for any other gift.
- Staff can see at a glance what is waiting, what is overdue, what is paid and what is cancelled.

## Not doing (non-goals)

- No automatic reminders (Jaimie's choice).
- No several-line invoices, no VAT, no sponsorship packages. NBCC is not registered for VAT, and the
  invoice says so.
- No editing an invoice after it is sent. Cancel it and send a new one. This keeps what the person was
  sent and what we hold the same.
- No part payments. An invoice is paid in full, or it is still waiting.
- No monthly gifts by invoice.
- No change to the Festive Ball's own invoices.

## Must never happen (anti-goals)

- Money is taken and no donation is recorded, or one payment is recorded twice.
- A business or group gift is put forward for Gift Aid.
- Anyone without the private link can see an invoice, or invoice numbers can be guessed to find others.
- A cancelled or already paid invoice can still be paid by card from its page.

## How it works

### The admin screen: Giving > Invoices

A new item, **Invoices**, in the Giving menu next to Donations. Anyone who can **view** Donations can see
the screen. Only someone who can **edit** Donations can send, mark paid or cancel.

**Send an invoice** (a short form at the top):

- **Who is it for?** A person, a business, or a group (a school, church, club and so on).
- **Name**: the person's name, or the contact's name at the business or group.
- **Business or group name** (business and group only, required).
- For a business only: **Are we giving them anything in return, such as advertising or their logo on
  something?** No or Yes, nothing chosen to start with. This is the same question the Donate page asks
  businesses. A Yes means the gift is flagged for the trustees, as it is today, rather than getting a
  Corporation Tax receipt.
- **Email address** (required, so we can send it).
- **Address** and **postcode**. Optional for a person; required for a business or group, because their
  accounts team will expect it on the invoice.
- **Amount**: from £1 to £50,000.
- **What it's for**: one line, which starts as "Donation to NBCC" and can be changed (up to 120 letters).
- **A note** (optional, up to 500 letters), for example "Thank you for your Christmas jumper day".
- **Pay by**: the due date, 30 days from today to start with.
- One button: **Send invoice**. It saves the invoice and emails it at once. Once sent, the screen says
  so and shows the new invoice at the top of the list.

**The list**, newest first, each invoice on its own card (cards on a phone, as on Donations):

- the invoice number, who it is for, the amount, the date sent and the due date;
- its state: **Waiting**, **Overdue** (waiting and past its due date), **Paid** (with the date and "by card"
  or "by bank transfer", and a link to the donation), or **Cancelled**;
- buttons: **Open the invoice** (the same page the person sees), **Copy link**, **Email it again**, and,
  while it is waiting, **Mark paid** and **Cancel**.

**Mark paid** asks for the date the money arrived (today to start with), then records the donation. **Cancel**
asks once ("Cancel invoice INV-0012? The link will say it is cancelled and can no longer be paid.").

A filter at the top: All, Waiting (which includes Overdue), Paid, Cancelled.

**Bank details on invoices**: a small settings box on the same screen (account name, sort code, account
number) that only someone with Donations edit can change. Until it is filled in, invoices offer card only,
and the screen says so. My call: it is its own setting, not borrowed from the Festive Ball, so the Ball's
after-the-Ball tidy can never change it.

### The invoice number

`INV-` followed by a four-figure number, in order: INV-0001, INV-0002 and so on. The same number is the
bank transfer reference. The page itself is reached only by a long, signed private link, so knowing a
number never opens an invoice (the same method as the Ball's invoices).

### The email

Sent from the address our donation emails come from, with replies going to the usual NBCC inbox.

- Subject: "Your invoice from NBCC: INV-0012"
- Their name, our short description of NBCC (some readers will not know us), the amount, what it's for,
  the note if there is one, and the due date.
- One button: **View and pay your invoice**.
- The "Got any questions?" section and phone number, as in our other emails.

Jaimie sees the exact wording in the pictures before anything goes live.

### The invoice page (what the person sees)

A printable page in the same style as the Ball's invoice:

- NBCC's name, postal address and Scottish charity number; the invoice number, date and due date.
- **To**: the person, or the business with the contact's name, and the address if given.
- The one line and amount, the total, and the note.
- "NBCC is not registered for VAT. This is a donation, so no VAT is due."
- **For a person only, a Gift Aid box**: the usual Gift Aid tick and declaration words, with their home
  address and postcode (filled in from the invoice if we have them). It is only shown while the invoice is
  waiting.
- **Pay by card**: a button that opens Stripe's secure payment page for exactly this amount (Apple Pay and
  Google Pay included). If the Gift Aid box is ticked, the declaration goes with it.
- **Or pay by bank transfer**: our bank details and "Use INV-0012 as the reference". For a person who
  wants Gift Aid and pays by transfer, a **Save my Gift Aid declaration** button keeps the declaration with
  the invoice until we mark it paid.
- **Once paid**, the page shows a Paid stamp with the date, and no payment buttons. **Once cancelled**, it
  says "This invoice has been cancelled" and shows no payment details.

### When it is paid

- **By card**: Stripe tells our site the payment went through. The site records the donation (from a
  person, a business or a group, as the invoice says), labels it **Invoice INV-0012**, and marks the
  invoice Paid by card. A business or group is never put forward for Gift Aid. A person who ticked Gift
  Aid gets the declaration recorded, and the gift goes into the Gift Aid claims as normal.
- **By bank transfer**: staff press **Mark paid**. The same happens: the donation is recorded with the
  date the money arrived, and the invoice is marked Paid by bank transfer.
- **One email when it is paid, never two (my call).** The payer gets the receipt they would get for any
  other gift, with a line added at the top: "This pays invoice INV-0012. Thank you." and a link to the
  invoice, now marked Paid. A person gets the usual donation receipt (with Gift Aid if they ticked it). A
  business gets the usual business receipt for Corporation Tax, or, if we gave them something in return,
  the gift is flagged for the trustees as it is today. A group gets a plain thank-you receipt. It is the
  same for card and bank transfer.
- Each invoice becomes one donation. If Stripe tells us twice, or two staff press Mark paid at once, only
  one donation is made.
- **Paid twice (my call).** If money genuinely arrives twice, for example the person pays by card after a
  transfer was already marked paid, the second payment is still recorded as its own donation, because
  money taken must always be recorded. The invoice then shows **Paid twice: refund one?** in red in the
  admin, and staff are emailed, as the site already does when a pledge is paid twice. Nothing is refunded
  automatically.
- **Paid after cancelling (my call).** A card payment that completes just after an invoice was cancelled
  is still recorded, and the invoice shows **Paid after it was cancelled**. Staff can also press **Mark
  paid** on a cancelled invoice when a bank transfer turns up anyway.

### In Donations

Invoice gifts show with the label **Invoice INV-0012** (as Red Bag and Festive Ball gifts have their own
labels), and the Donations filter gains **Invoices only**. The Overview's breakdown of where gifts came
from gains its own line, **Invoices** (my call), so they never drop out of it.

## Who can do what

| | Donations view | Donations edit |
|---|---|---|
| See the Invoices screen and open an invoice | yes | yes |
| Send, email again, mark paid, cancel | no | yes |
| Change the bank details on invoices | no | yes |

Every change is written to the audit log (`invoice.created`, `invoice.sent`, `invoice.paid`,
`invoice.cancelled`, `invoice_settings.updated`).

## Builder notes (how; the builder's calls unless marked)

- New tables in one additive migration, numbered above the newest on main: `donation_invoices` (who for,
  name, business name, email, address, postcode, what it's for, note, amount in pence, sent date, due
  date, state, paid date, paid by, the Stripe checkout session, the donation it became, the Gift Aid
  declaration details while waiting, who made and changed it) and `donation_invoice_settings` (one row:
  bank details). The invoice number is made from the row's id.
- The donation is recorded through the existing donation writer, with `source = 'invoice'` added to
  `DONATION_SOURCES`, plus a link from the invoice to the donation. The label in Donations is made from that
  link.
- The card payment uses a Stripe Checkout session marked as an invoice payment. The existing webhook
  handles `checkout.session.completed` for it, inside one transaction that locks the invoice row, so a
  repeat delivery or a race with Mark paid makes nothing twice.
- The private link is a signed token with its own purpose, so a Ball invoice token can never open a
  donation invoice and the other way round.
- The email goes through the existing email sender and appears in the admin's All emails section.
- Tests: unit tests for the pure parts (the number, the states, Overdue, the form checks, the page and
  emails); a Cucumber feature for who can do what, sending, the page, marking paid making exactly one
  donation, cancelling, and a business never getting Gift Aid; admin screen tests as for other screens.
- README gets a section, "Invoices for donations".
