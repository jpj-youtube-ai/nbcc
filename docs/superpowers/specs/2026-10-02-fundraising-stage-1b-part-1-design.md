# Community fundraising, stage 1b part 1: ready to open

Date: 2026-10-02. Follows `2026-10-02-community-fundraising-design.md` (stage 1, live and switched
off). Every item here was chosen by Jaimie, one question at a time. Fundraising stays switched off
until all of part 1 is live and Jaimie switches it on. Part 2 (profile picture, live preview,
online sponsor form, thank your supporters, news updates, in memory pages, team pages, impact
markers, welcome pack, countdown) and the separate event ticketing follow afterwards.

The rules from stage 1 still hold: staff approve everything public, no inner scrollbars, phone
width works, recipients are set in the admin and never in code, fundraising emails come from and
reply to the events inbox, organisers never see givers' email addresses, only real money counts on
the meter, and nothing in the admin that works today may break.

## The pull requests

Each is its own task, reviewed and shipped on green, in this order (later ones build on earlier):

1. **Emails** (wording Jaimie signed off).
2. **The sign up form** (address fields, split requests, the event questions, and the card fix).
3. **The private area** (sign in code, QR code, pay in, "I've finished").
4. **Giving** (Gift Aid shown, the message after paying).
5. **The team's tools** (invite, Monday summary, time to call, finishing prompt).
6. **The help page** (a draft for Jaimie to sign off before it goes live).

## 1. Emails

All fundraising emails get the wording Jaimie approved on 2026-10-02:

- warmer and more enthusiastic;
- a "Got any questions?" box with the phone number and the events inbox side by side, equally
  prominent (left out of the two internal emails to the team);
- a signed close: a varied, friendly line above "NBCC Team".

Specific choices:

- **Thanks for signing up** greets "Hi there <first name>,". The first name comes from the form, so
  for safety it is only the first word, letters only (and apostrophes or hyphens inside it), at
  most 20 characters; anything else falls back to "Hi there,". The email still carries no other
  typed text.
- **"You're approved" while fundraising is off** is retired. Instead, anyone approved while it is
  off is marked as waiting, and the "Your page is live" email goes to each of them when an admin
  switches fundraising on.
- **The old change link email** is retired in favour of the sign in code (3 below).
- **Your update is live / About your update** are sent when staff approve or reject a change.
- **Target reached** encourages them to beat it, with a button to raise their target from their
  private area.
- **The invite** is signed by the staff member who sent it ("Warmest wishes, <first name>",
  then "NBCC Team"), so the organiser recognises who they spoke to.

## 2. The sign up form

- **Address** for posted materials becomes separate fields: two address lines, town and
  postcode (UK postcode checked). The single field stays readable for sign ups made before.
- **Requests** split into posters, leaflets, collection buckets and collection tins, each with its
  own number. Old sign ups keep their combined numbers and show as before.
- **Event questions**, only when "I'm holding an event" is chosen, matching the admin's own
  events editor:
  - a one line summary for the front of the card;
  - finish time, and "the time is still to be confirmed";
  - the venue (now required), plus the full address and postcode;
  - access: "Tick only what the venue has confirmed", with step free entry, accessible toilets,
    hearing loop and blue badge parking ("Printed on the back, so a disabled guest can decide
    without having to ask");
  - price;
  - booking: a ticket link on another website, pay on the door, or free with no booking (NBCC
    selling the tickets comes with the separate ticketing stage);
  - age limit, dress code and what is included;
  - "Credit it to" (their name, group or business).
- **The card fix:** a community event's card on Get involved is built from these answers. Today
  every community card says "No need to book. Just come along", even for a ticketed event. It
  must show the price, the booking link or "pay on the door", and the access ticks.
- Staff can edit every new field in Admin > Fundraising, and the staff email shows them.

## 3. The private area

- **Sign in code:** the organiser enters their email at `/fundraise/manage`; if it has an
  approved fundraiser, a 6 digit code is emailed. It works for 10 minutes, is stored hashed, and
  allows a few tries, with request limits per email and per IP. A correct code starts a short
  signed in session (an http only cookie). The 24 hour link is retired.
- **What's inside:** their page's details to change (each change still waits for staff), their
  QR code (moved here from the public page; staff also see it in the admin), their latest gifts
  and messages (no givers' email addresses), and the buttons below.
- **Pay in what you collected:** the organiser pays in collected cash or sponsor money by card,
  through the same Stripe checkout. It counts on their meter like any gift and is marked as paid
  in by the organiser. Bank transfer, dropping it in, and staff added cash all still work.
- **"I've finished":** tells staff they are done (it does not close anything).

## 4. Giving

- **Gift Aid shown:** the wall shows "£20 + £5 Gift Aid" for a gift with Gift Aid. The meter
  shows "+ £45 Gift Aid" underneath the total. Gift Aid never counts towards the target.
- **The message after paying:** the message and the show my name choice leave the give form and
  become an optional step on the thank you screen, clearly marked optional. Each one is tied to
  the paid Stripe checkout session, so only a real giver can add one, and only once.

## 5. The team's tools

- **Invite:** from Admin > Fundraising, staff enter a name, email and optional personal note. It
  is signed by the logged in staff member by default, or another chosen. It is sent from the
  events inbox, with replies to the events inbox. The link opens `/fundraise` already filled in,
  through a signed invite token. The list shows "Invited by <name>" until they sign up, with
  Resend.
- **Monday summary at 8am**, to recipients set in Admin > Fundraising, report style:
  - money this week (online, paid in, Gift Aid to claim, totals);
  - new sign ups;
  - what is waiting:
    - approvals and changes to check;
    - posters, leaflets, buckets and tins to send;
    - shout outs, and requests for someone to attend;
    - calls due;
    - invites not taken up after a week;
    - fundraisers four weeks past their date;
  - what is coming up.
- **Time to call:** a "Time to call" pill a week before and a week after each fundraiser's date,
  with "Called" and a note, like business supporters.
- **Finishing:** the giving link works for good. Four weeks after the date, or when the organiser
  presses "I've finished", the admin shows "Take off Get involved?". Staff take it off by hand. On
  finishing, the thank you email goes out (its certificate arrives with stage 2 materials) and the
  page shows its final total with "You can still give".

## 6. The help page

`/fundraise/help`, linked from the form, the private area and the emails:
- an A to Z of ideas;
- how to pay money in;
- Gift Aid in plain English;
- staying safe and legal in Scotland (street collection permits, raffles, home baking), linking
  to official sources rather than giving advice;
- using NBCC's logo.

Claude drafts it and Jaimie signs it off before it goes live.

## Tests

Every PR adds unit tests for its rules (name safety, address and postcode, the code's hash, expiry
and tries, the Gift Aid sums, the after payment tie to the paid session, the summary's counts, the
call dates) and BDD scenarios for its routes, and checks the admin and public pages at 1280px and
390px. Nothing in Admin > Events, the Ball or Donate changes.
