# The Festive Ball ticket report

Date: 2026-09-30. Approved by Jaimie in chat.

## Why

The Ball's organiser and sponsor (The Designer Rooms, and the people they work with) want to see how
tickets are selling without asking. Twice a week they get one branded email with the numbers: no
names, no emails, no booking details, no money.

## What staff see

On Admin → Events, a panel **Festive Ball ticket report**, for anyone who can edit Events (viewers
see it read only):

- an on/off switch, **off when it ships**;
- the recipients: a name and an email address each, added and removed one at a
  time, with a line above the list: everyone on it sees everyone else's address, so only add people
  who already work together;
- "Mondays and Thursdays at 8am" (Tuesdays until TASK-467) and when it last went, to how many people;
- **Send a test to me**: the real email, to the signed-in person only, marked as a test;
- a preview of the exact email with today's numbers.

## The email

One email, From and Reply-To `events@nbcc.scot` (`BALL_FROM_EMAIL`), To every recipient, so a reply
can go to all. In the Ball's own frame (`ballEmailShell`: NBCC letterhead, The Designer Rooms band,
the Ball's phone and inbox). Subject: "Festive Ball tickets: Tuesday 6 October update".

Friendly and professional (Jaimie's words). It opens with when the next one comes and how to reach
us, then the numbers:

> Hello,
>
> Here's how Festive Ball ticket sales stand this morning. Your next update will be on Thursday 8
> October. Any questions in the meantime, call us on 01292 811 015 or email events@nbcc.scot.

The next update is the next Monday or Thursday after today. When that would fall after the Ball,
the line says instead that this is the last update before the Ball on Saturday 7 November. The
numbers:

- Seats sold, of 400, and how full: whole tables and single seats.
- Sold since the last update, or "This is the first update".
- The last 7 days, next to the 7 days before.
- Still available: seats, including whole tables; and how many are kept back for guests.
- The waiting list: how many people are still waiting (anyone already offered a place is being
  looked after) and the seats they want, or "Nobody on the waiting list".
- Days to go.

Sold means paid: a booking still waiting for its card payment is not counted, and a refunded or
cancelled one comes off. Everything is counted up to the moment the report runs, and "since the
last update" counts on from exactly the moment the last scheduled report counted to, so a sale is in
one report's "since the last update", never two and never none. No links that change anything (the deliverability rule): the email carries none at all
beyond the shell's own.

## When

The existing daily 8am job (`npm run reminders`, which already runs the Ball's run-up emails) gets
one more step, in its own try/catch. On a Monday or Thursday (UK time), with the switch on, at
least one recipient, the Ball not yet past, and no scheduled send recorded for today, it builds the
numbers, sends, and records the send. The day is claimed first (a unique index on the date), so a
second run the same day sends nothing; a failed send releases the claim, and a send that went
keeps it even if recording it fails, so nothing can send it twice. No infrastructure change.

## Data

Additive only:

- `ball_settings` gains `report_on boolean not null default false` and
  `report_recipients jsonb not null default '[]'` (a list of `{ email, name }`).
- A new table `ball_report_sends`: `id`, `sent_on date` (UK), `kind` ('scheduled' or 'test'),
  `recipients text[]`, `figures jsonb` (the numbers that went out), `counted_to` (the moment they
  were counted to), `sent_at`, `sent_by`. A unique index on `sent_on` for scheduled sends.

Every change from the admin writes an `audit_log` row in the same transaction: recipients changed,
switched on or off, test sent. Each email also lands in the email log, one row per recipient.

## Pieces

- `src/ball/sales-report.ts`, pure: the figures from paid bookings, availability and the waiting
  list; the due check (weekday, switch, recipients, date, already sent); the subject, HTML and text.
- `src/db/ball-report.ts`: read and write the settings, claim and record sends, read the inputs.
- `src/clients/ses-request.ts` and `src/clients/email.ts`: an optional `alsoTo` list, so one message
  can go to several people; every existing email is unchanged.
- `src/routes/admin-ball-report.ts`: `GET /api/admin/ball-report` (settings, last sends, preview),
  `PUT /api/admin/ball-report` (switch and recipients, `events:edit`),
  `POST /api/admin/ball-report/test` (`events:edit`). Each also needs `ball:view`: the numbers are
  the Ball's (every role has it by default).
- `src/newsletter/ses-events.ts`, `src/routes/ses-webhook.ts`, `src/db/email-log.ts`: one email to
  several people means one SES event can name several. Each event's own recipients (the bounced,
  the complainants, the delivered) are used, and the email log, the newsletter events and the
  suppression list are updated per person, so a bounce from one never lands on another.
- `src/scripts/send-reminders.ts`: the step.
- The panel in `admin.html`, `assets/js/admin/app.js`, `assets/css/admin.css`, matching the Events
  page.

## Tests

- Unit: the figures (paid only, refunds off, since last, weeks), the due check (every weekday, the
  switch, no recipients, after the Ball, already sent), the email (every line, no money, no names,
  house style), `alsoTo` in the SES request.
- BDD against Postgres: the settings need a session, `events:edit` and `ball:view`; a viewer cannot
  change them; the numbers from seeded paid, pending, refunded and cancelled bookings; a bounce on
  an email to several people lands on one person;
  recipients are validated; a test send goes only to the signed-in person and is recorded as a test;
  the audit rows.

## Not doing

- Money in the report (Jaimie chose counts only).
- Separate emails per recipient: everyone on the list already works together (Jaimie's call). If
  the list ever goes wider, this is the thing to change.
- A second schedule or any Terraform change.
