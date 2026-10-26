# Festive Ball: chasing guest names and meal choices before the deadline

Status: draft for Jaimie's approval, 26 October 2026. The Ball is Saturday 7 November 2026.

## Why

The Park Hotel needs every booking's guest names and meal choices. Many paid bookings still have
seats nobody has named, or named guests who have not chosen their meals. Today the site sends one
"the menu is here" email per booking (staff press a button) and, if a guest details deadline is set,
one automatic "please name your guests" nudge and one last call (TASK-338). There is no repeated
reminder about meals at all, and staff chase by hand from the admin's lists.

Jaimie, 26 October 2026: "send reminders every other day to those who haven't selected meals and
guests", with a deadline of **10am on Wednesday 4 November**, a countdown in every email, because
"we need their responses". The four volunteers doing the phoning want an email listing who still
needs chasing, with phone numbers where given.

Success: by 10am on 4 November almost every booking is complete, and the volunteers know exactly
whom to ring for the rest.

## What Jaimie decided

- Reminders go **every other day** to bookings still missing guest names or meal choices, each with
  a **countdown** to the deadline.
- The deadline is **10am, Wednesday 4 November 2026** ("is it safer to say 10am": yes).
- **Nothing closes automatically and nothing is chosen for anyone.** "Admin can still call and add
  their options, our discretion when the cut off is." The guest page keeps taking names, meals and
  dietary notes after the deadline; staff enter choices after a phone call through the booking's
  own link, as they can today.
- The **volunteers** (four people, all with nbcc.scot addresses and admin logins) get an email
  listing who still needs chasing, with the booker's phone number where one was given.

## The design

### Who gets a reminder

A booking is chased when all of these hold:

- status `paid`, a buyer email, and a guest token (the link the email exists to carry);
- it is **incomplete**: fewer guests named than seats paid for, **or** a named guest has not
  answered every course the menu asks (`hasChosen`, `src/ball/menu.ts`, the test the "Who has chosen"
  list already uses). When the menu asks nothing, only names count.

The email goes to the booker (the only address we hold). The moment a booking is complete it drops
out of every later round. A booking that becomes incomplete again (a guest changed) comes back in.

**One email per address, not per booking** (Claude's call). Someone holding two bookings (a table
and extra seats) gets one reminder per round listing each booking's gaps and link, never two.

### When

The daily 8am job (`npm run reminders`, EventBridge `cron(0 8 * * ? *)` Europe/London, already
running) gains one more pass. It does nothing unless the **guest details deadline** setting (the
existing `guestDetailsLockAt`, set in the Festive Ball admin's Set up) is set. Counting by the day in
the UK, a reminder round falls on the days **7, 5, 3 and 1 before the deadline day**. With the
deadline at 10am on Wednesday 4 November that is:

| Day | Reminder to bookers | Chase list to volunteers |
|---|---|---|
| Wed 28 Oct | 7 days to go | yes |
| Fri 30 Oct | 5 days to go | yes |
| Sun 1 Nov | 3 days to go | yes |
| Tue 3 Nov | Last chance: by 10am tomorrow | yes |
| Wed 4 Nov | none (the deadline is two hours after the run) | yes: "2 hours to go" |

Moving the deadline in Set up moves every round with it. A round day that is missed (the pass did
not run, or this ships late) is **not** caught up the next morning; the next round goes as normal.
Nothing goes after the deadline day, and nothing ever goes on or after the Ball.

Each booking gets **at most one reminder per round**, however many times the pass or a staff button
runs that day: the round is claimed per booking before sending, and a failed send gives the claim
back so a rerun can try again (the same rule as the ticket report, `src/ball/sales-report-runner.ts`).
This needs one additive migration (for example a `ball_chase_sends` table, unique on booking and
day). The volunteers' list is claimed per day in the same way.

### What replaces what

The new rounds **replace TASK-338's guest "chase" and "final-call" stages** (`src/ball/run-up.ts`):
they ask for the same names, so leaving both on would send two emails some mornings. The "menu is
here" email and its button stay as they are.

The "practical" week-to-go email stays exactly as it is. It goes to most people on Saturday 31
October, which is not a round day, but it also goes on later mornings to anyone who booked in the
last week or whose earlier send failed, and a moved deadline can put a round on the 31st. **On a
morning when the practical email is due to someone, it goes and that morning's reminder is skipped
for them** (Claude's call): it already carries their guest link, and the next round reaches them if
they are still incomplete. The planner therefore runs after, and knows about, the practical stage.

**Release order:** the old chase window is already open for a 4 November deadline, so the old
stages are switched off in this release, and the deadline is set in Set up only once it is live.

### What the reminder says

Built on the existing Ball email shell (`src/ball/email-shell.ts`), with a plain-text part, like
every Ball email. For each booking:

- **The countdown**, worked out on the morning it is sent: "7 days to go", "5 days to go",
  "3 days to go", then "Last chance: we need everything by 10am tomorrow". Always the exact deadline
  in words: "by 10am on Wednesday 4th November". It is fixed text on the day it is sent; an email
  cannot tick down live (that needs an outside image service, and is not wanted here).
- **Exactly what this booking is missing**: "4 of your 10 seats still need a name" and/or "2 of
  your guests still need to choose their meals".
- **Their own link**, as a button, to fill it in.
- A friendly line about after the deadline: "If we haven't heard from you by then, one of our team
  will give you a ring." No threat, no default meal.
- The Ball's contact panel, as the other Ball emails have.

Subjects carry the countdown too, for example "7 days to go: your Festive Ball guests and meals",
and on the last round "Last chance: your Festive Ball guests and meals by 10am tomorrow".

### The chase list for the volunteers

Sent on each of the five days above, after that morning's reminders, to a new list of addresses
typed into Set up ("Chase list goes to"). The repo is public, so **no address is written into the
code**. Addresses must end in `@nbcc.scot`, because the email carries people's names and phone
numbers. It lists:

- the counts: bookings complete, bookings still to chase, seats still unnamed, guests still to choose;
- for each booking still to chase, most missing first: booker name, phone number (or "no phone
  given"), email, reference, seats named "6 of 10", meals chosen "4 of 6", and their guest link so a
  volunteer can enter choices after a call;
- on the deadline day, a heading that says it is the last list before 10am.

Two more groups go on the list in their own clearly labelled sections, because only a phone call
reaches them (Claude's call): **paid bookings we cannot email** (no address, or no guest link yet),
and **bank-transfer bookings not yet paid** (marked "awaiting payment"; their guest link starts
working once they pay, and they already get the transfer reminders). Neither gets a reminder email.

After the deadline the admin's existing "Who has chosen" and guest progress lists show the live
picture; no further lists are emailed.

### The admin

- Set up: the existing deadline field is where 10am on 4 November is set; a new "Chase list goes
  to" box for the volunteers' addresses (nbcc.scot only, checked on save).
- Emails section: a short line saying what the chase does and when the next round is ("Next
  reminder: Friday 30 October, to 23 bookings"), and **"Send me a test"** buttons for the reminder
  and for the chase list, which send an example to the signed-in staff member only. **Both tests
  use made-up example bookings, never real ones** (Claude's call): admin logins are not all
  nbcc.scot addresses, and a test must never carry real names or phone numbers. The real picture
  is already on screen in the admin. The reminders have no button: they are automatic.
- The All emails section gets both new emails, as every email has.

## Goals, non-goals, anti-goals

Goals: every incomplete booking hears from us four times with a countdown; the volunteers have an
accurate list each round; staff can see and test it before the first send.

Non-goals: a live ticking countdown; text messages; emailing guests directly; a hard lock on the
guest page; choosing meals for people automatically; changing the menu email or the week-to-go email.

Anti-goals (a failure even if it "works"): two Ball emails to the same booker on the same morning;
emailing a booking that is already complete; any email after the deadline day or the Ball; names
and phone numbers going anywhere but nbcc.scot inboxes; anything that breaks booking, the guest page
or the existing Ball emails before 7 November.

## Constraints

- Jaimie's Festive Ball rule: this is explicitly asked for, but nothing else Ball-related changes.
- The first round is Wednesday 28 October at 8am, so it must be live by the evening of Tuesday 27th.
- Golden rules: tests with the change (Vitest for the pure planner and the emails, Cucumber for the
  routes and the pass against the real database in CI); an additive migration that sorts last;
  README updated; no real names, emails or phone numbers in code, tests or docs.
- No infrastructure change: the 8am job already exists.

## Left to the builder

The migration's exact shape, the planner/runner split (follow `run-up.ts` / `run-up-runner.ts` and
the ticket report's claim-the-day pattern), email layout within the Ball shell, the admin wiring, and
test structure.
