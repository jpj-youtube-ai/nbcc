# Paying for the Festive Ball by bank transfer: design

Date: 2026-10-01. First task: TASK-484 (stage 1). Each later stage takes its own task number.
The client answered every question below one at a time on 2026-10-01 and approved the design, with
one change: only admins may mark a booking paid.

**Status (5 October 2026): all of it is live, and switched on.** The five stages shipped on
1 October 2026 as TASK-484 (#607, bookings), TASK-485 (#608, deadlines), TASK-486 (#609, invoices),
TASK-487 (#610, telling the team) and TASK-488 (#611, staff bookings). One change came after the
design: TASK-489 (#612) sends a company's accounts team their own "Payment received" email instead
of copying them on the buyer's paid confirmation, because that confirmation carries the guest
details link. The other bank transfer emails still copy them, as designed. Bank transfer was
switched on in the admin on 1 October 2026; `/api/ball/availability` answers `transferOpen: true`.

## Why

Today the Ball takes cards only (Stripe Checkout). A company wanting an invoice emails or phones, a
member of staff writes the invoice by hand and "holds" the seats by name. A hold is not a booking:
- it has no reference or buyer email;
- there is no confirmation email or guest link;
- there is no way to turn it into a paid booking.

People who simply prefer to pay by transfer cannot.

## Decisions

| Question | Answer |
|---|---|
| Invoicing: a third way, or part of this? | One route. "Pay by bank transfer", with "My company needs an invoice" as an option inside it. |
| Who sees the option | Everyone, for seats and tables alike, once an admin switches it on. |
| How long to pay | 7 days, or 14 when an invoice was asked for, but never later than the "last day for transfers" staff set. |
| When the deadline passes unpaid | A reminder 2 days before. When it passes, the booking is flagged Overdue in the admin and staff decide: mark paid, give more time, or cancel. Nothing is cancelled automatically. |
| Where the bank details are shown | Only after booking: on the screen that follows, and in an email. Never on the open page. |
| Payment reference | The booking reference (`BALL-7KQ2MZ`). |
| How the choice appears on the form | "How would you like to pay?": Card (default) or Bank transfer, above one button. |
| What an invoice asks for | Company name and address (required). Optional: a purchase order number, an accounts team email and a phone number. |
| How the invoice reaches the company | A private printable page (like the thank-you letter), linked from the email. |
| VAT | NBCC is not VAT registered, so there is no VAT line. |
| Invoice number | The booking reference. |
| Marking paid | Staff confirm that the full amount has arrived ("Has £1,000.00 arrived for BALL-7KQ2MZ?"). A short payment is sorted out with the buyer first. |
| The email when paid | The same "You're coming to the ball!" email card buyers get, with the line "Your bank transfer has arrived. Thank you." added at the top. |
| As the Ball gets close | Staff set a "last day for transfers to arrive". Deadlines shorten to fit it, and after it the page offers card only. |
| Guest details before paying | No. The guest link comes only once a booking is paid. |
| Who marks a booking paid | **Admins only** (the admin role), including bringing back a cancelled booking. Giving more time, cancelling and adding a booking by hand need Festive Ball edit access, as cancelling and holds do today. |
| Telling the team | An "Awaiting transfer" list at the top of the Festive Ball screen. Also an email to events@nbcc.scot per new booking, the New pill on Festive Ball, and a line in the twice-weekly ticket report. |
| Phone and email bookings | Staff can add a bank transfer booking in the admin, with the same fields and the same emails. Staff tick that the buyer agreed to the terms. |
| Money arriving after a cancellation | "Mark as paid" still works on a cancelled transfer booking if its seats are still free. Otherwise it says so, and staff refund by hand. |
| A switch | Bank transfer appears on the page only when an admin has entered the bank details and switched it on. |
| Safeguards (asked while planning) | At most 5 transfer bookings an hour from one connection, because a transfer booking holds seats for a week and a bot could otherwise quietly hold the whole room. **No limit per email address**: the client first agreed to one unpaid booking per email, then reversed it the same day, because a buyer who wants more must be able to book more. |

## What a buyer sees

1. **The form.** Everything is as today, plus "How would you like to pay?". Choosing Bank transfer:
   - hides "cover the card fee", since a transfer has no card fee;
   - shows "My company needs an invoice";
   - changes the button to "Book and get bank details".

   The invoice tick reveals the company name and address (required), and the purchase order
   number, accounts email and phone number (optional).
2. **After booking.** A screen shows:
   - the account name, sort code and account number;
   - the exact amount;
   - the reference to use;
   - the date to pay by;
   - with an invoice, a link to the invoice.

   The same goes in an email, with the invoice also sent to the accounts email if one was given.
3. **Two days before the deadline**, a reminder with the same details, if the booking is still unpaid.
4. **Once an admin marks it paid**, the usual confirmation email, with its added line and the "Add
   your guests" link. Any invoice page then shows Paid.
5. **If staff cancel it**, an email saying the booking has been cancelled and the seats released.

## What the team sees

- **Festive Ball settings** (admin only):
  - the account name, sort code and account number;
  - the switch;
  - the last day for transfers to arrive.

  The bank details are stored in the database and never in the code, which is public.
- **An "Awaiting transfer" list** at the top of the Festive Ball screen:
  - reference, name, amount, the deadline, and whether an invoice was asked for;
  - overdue bookings first, and flagged;
  - a search by reference, name or amount, for a payment whose reference was typed wrong.
- **Actions on a transfer booking:**
  - Mark as paid (admins only, with the amount confirmation);
  - Give more time (staff pick a new date);
  - Cancel (frees the seats and emails the buyer);
  - on a cancelled one, Mark as paid again (admins only, only if the seats are still free).

  Each action is audited with who did it and when.
- **Add a bank transfer booking** in the admin, for phone and email orders.
- **Being told:** an email to events@nbcc.scot per new transfer booking, the New pill on Festive
  Ball, and the ticket report's count and total awaiting transfer.

## Rules

- **Seats.** A transfer booking holds its seats from the moment it is made until it is paid or
  cancelled, counted like a pending card booking.
- **Guest lists and menus.** Guest details, menus and the venue's numbers only ever include paid
  bookings, as now.
- **Money figures.** Ball takings, Gift Aid figures and the "sold" figure in the ticket report count
  a transfer booking from when it is marked paid, like a card booking.
- **The invoice page** carries:
  - the charity's name ("Night Before Christmas Campaign", a Scottish Charitable Incorporated
    Organisation, SC047995);
  - the invoice number (the booking reference), the date, and the company's details and PO number;
  - the lines: tickets, and any donation shown separately as a donation;
  - the total, the bank details, the reference and the pay-by date.

  It says "Not registered for VAT". Once the booking is paid, it says Paid.

## Stages

Each stage is its own task: tested, reviewed and live before the next. The switch stays off until
the end.
1. **Transfer bookings (TASK-484):**
   - the bank details and switch in the admin;
   - the form choice;
   - the booking, the bank details screen and email;
   - the "Awaiting transfer" list;
   - Mark as paid (admins), give more time, cancel and reinstate;
   - the confirmation email's added line.

   It also fixes three existing faults it sits beside:
   - the admin says an abandoned card checkout "holds no seats", but it holds them for up to 30
     minutes;
   - if Stripe's "checkout expired" message is lost, a pending card booking's seats stay held for
     good;
   - when the in-page card payment fails to load, the fallback creates a second pending booking.
2. **Deadlines:** the reminder, the Overdue flag, and the last day for transfers.
3. **Invoices:** the fields and the printable page.
4. **Keeping the team informed:** the events@ email, the New pill and the ticket report.
5. **Staff bookings:** "Add a bank transfer booking" in the admin.

Then the client enters the bank details, makes a test booking, and switches it on.

Each stage gets its own implementation plan. The data model, the migrations and the shape of a
transfer booking are settled in stage 1's plan, since everything after builds on them.
