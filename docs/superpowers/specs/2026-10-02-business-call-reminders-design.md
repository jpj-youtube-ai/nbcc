# Business supporters: a reminder to call

Date: 2026-10-02. Asked for and approved by Jaimie in chat.

## Why

Businesses that give monthly deserve a personal thank you. Jaimie wants to phone each one every three
months while they are still giving, to thank them and ask if there is anything we can do, and wants a
pill in the admin to say who is due.

## What staff see

On Admin > Business supporters:

- A **"Time to call"** pill next to the business's name in the list when a call is due, and a line
  above the list: "3 businesses are due a call" (or "No calls due" when there are none; the line is
  hidden while the list is loading or failed).
- In a business's expanded details, a **Call** panel: their phone number (a tap to call `tel:` link,
  or "No phone number yet"), when they were last called, by whom, and the note; a phone number box
  to add or change the number; and **Mark as called** with an optional note (up to 500 characters).
- A call, and a change of phone number, appear in the business's History, like every other action.

## When a call is due

- **Still supporting** means the business's monthly gift is neither cancelled nor lapsed. Read it the
  way Monthly givers does for individuals (src/db/monthly-supporters.ts): `subscription_dunning`
  `cancelled_at` set means cancelled; status `lapsed` means lapsed; `active`, `past_due` or no dunning
  row (a gift with no payment trouble yet) count as supporting. A business with no paid monthly
  donation at all is not supporting. Not supporting means no pill, ever, whatever the dates.
- **Supporting since** is the date of their first paid monthly donation.
- **Due** when today (UK) is on or after the due date:
  - after a call: 3 calendar months after the last call;
  - before the first call: 3 calendar months after supporting since, but never before
    **1 September 2026**.
  So everyone who has been giving since June 2026 or earlier is due now.
- Marking a call sets the next due date to 3 months from that call. "3 calendar months" means the
  same day of the month three months on (31 May gives 31 August; 30 November gives 28 or 29
  February).

## Data

Additive only:

- `business_supporter_fulfilment` gains `phone text` (nullable, up to 40 characters, digits, spaces,
  `+`, `(`, `)` and `-`).
- A new table `business_supporter_calls`: `id`, `fulfilment_id` (references
  `business_supporter_fulfilment`, cascade), `called_at timestamptz default now()`, `called_by text`,
  `note text` (nullable, up to 500). Index on `(fulfilment_id, called_at desc)`.
- A one-off backfill in the migration: where a fulfilment's donor is linked from
  `business_outreach.donor_id` and that outreach row has a `contact_phone`, copy it into the
  fulfilment's empty `phone`. Nothing is overwritten.

Every call and phone change writes an `audit_log` row (entity `business_supporter_fulfilment`), in the
same transaction, so History shows them.

## Pieces

- `src/business/call-due.ts`, pure: `callDue({ today, supportingSince, lastCalledAt, supporting })`
  returning `{ due: boolean, dueOn: string | null }`, with the September start and calendar months.
- `src/db/fulfilment.ts` (or a new `src/db/business-calls.ts`): the list query gains `phone`,
  `last_called_at`, `last_called_by`, `last_call_note`, `supporting`, `supporting_since`; insert a
  call; set the phone.
- Routes (`business-supporters: edit`, like the rest of the section):
  `POST /api/admin/fulfilments/:id/calls` `{ note? }` and `PUT /api/admin/fulfilments/:id/phone`
  `{ phone }`, both strict zod bodies. The list route returns `callDue` and `callDueOn` per row.
- `assets/js/admin/app.js`, `admin.css`, `admin.html`: the pill (in the admin's existing pill style,
  not the green New pill), the count line, the Call panel. No inner scrollbars; phone width.
- README.

## Tests

- Unit: `callDue` for every rule (the 1 September floor, 3 months after the start, 3 months after a
  call, month ends, not supporting, cancelled, lapsed, past due, today exactly on the due date); the
  route bodies; the admin page (pill, count line, panel, tel link, marking a call clears the pill,
  failure states).
- BDD against Postgres: a supporting business due a call shows due; marking it called clears it and
  writes History; a cancelled business is never due; the phone is saved and validated; the outreach
  phone backfill.

## Not doing

- Emails or notifications about calls (the pill is the reminder).
- Call reminders for individual monthly givers.
