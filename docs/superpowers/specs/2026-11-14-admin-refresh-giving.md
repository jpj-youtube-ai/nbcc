# Giving: Claims, GASDS and Subscriptions, in the kit's look (2026-11-14)

One area of the admin refresh (`2026-11-14-admin-refresh-design.md`). Three screens under Giving that
were bare tables drawn by `app.js`: no phone layout, raw database words, pop-ups for messages, and some
failures that said nothing at all. Built from an inventory of everything on them, so nothing is lost.
The look is the kit's; this is about what each screen is for, what it says, and what it now does.

## Where the code lives

- `assets/js/admin/giving.js` (`window.AdminGiving`), a file of its own beside `app.js` as the gift log
  and Santa Sleigh are. `app.js` hands it its own `authFetch`, `canView` and `canEdit` and calls
  `openClaims()`, `openGasds()` and `openSubs()` when a screen is chosen. A donor's name is a
  `[data-donor]` button and the link to Monthly givers a `[data-goto-section]` one, both of which
  `app.js` already answers for every screen.
- `assets/css/admin-giving.css`: only what the kit lacks, every selector named through one of the three
  views or starting `.gv-`.
- The server: `src/routes/admin.ts` and `src/db/admin.ts`, beside what was there.

## Claims (`#view-claims`)

**For:** whoever files the Gift Aid claim, a few times a year: pick the donations, download them for
HMRC's spreadsheet, record that the claim has gone. The Overview sends people here with five lines.

**Layout.** Title and its sentence; seven tiles, each a button that opens its part; the step by step
guide as a fold; then a bar of four parts with one showing at a time, a dot on any with something
waiting:

| Part | What is in it |
|---|---|
| Ready to claim | the pick list; Tick all; a running line ("12 ticked, £340 given, about £85 to claim back"); a warning past 1,000 in one batch (the guide's limit); "Add to batch" |
| Claims | a card per batch: its state in plain words, how many donations, the total and about what comes back, when it was started and sent; "Download for HMRC", "Mark as sent to HMRC", and "See the donations" which opens them in place |
| To repay | donations refunded after they were claimed |
| Declarations | the three lists the Overview points here for and the screen never showed: not come back, due a review, reaching the end of their keep date |

**Changed on purpose.**
- "Submit" recorded that a claim had gone and sent nothing, and asked "Submit claim batch 7 to HMRC?".
  It is "Mark as sent to HMRC", says under it that it only records, and asks a question that matches.
- "Export CSV" is "Download for HMRC". When the server refuses, the reason is said in the batch's card
  and no file is handed over (it used to hand over a file holding the error).
- `open`, `submitted` and `adjustment_due` read "Being put together", "Sent to HMRC" and "To repay".
- Every action says what happened beside its button. No pop-ups, no silent failures. A new batch that
  was started but could not be filled says so and names the batch.
- The pick list is a row per donation on every size (a tick, the name, the amount, then the postcode,
  date and number), not a six column table: a hundred of them stay readable on a phone.

**Added.** The tiles and their counts; the three declaration lists; Tick all and the running line;
the donations inside a batch (`GET /api/admin/claim-batches/:id/donations`, Claims view); a donor's
name opens their page for someone who may open Donations (`donor_id` added to the ready list); when a
batch was started and its HMRC reference, which the answer always carried and the screen never showed.

## GASDS (`#view-gasds`)

**For:** the same person, about once a year: make sure small card machine gifts are counted in a small
donations claim before their two year deadline, then tick them off.

**Layout.** Title; a sentence that says the acronym in words; three tiles that filter (Not yet claimed,
Deadline within six months, Too late to claim), each with its count and total; "Download this list";
a card per tax year; what was marked lately, with Undo; this year's three figures; a fold on how the
scheme works.

**A tax year's card** says "6 April 2024 to 5 April 2025", how many small donations, their total and
"Claim by 5 April 2027". "Copy the total" for HMRC's form. "Mark all 143 as claimed" asks first and
says underneath what it does and how to undo it. "Tick them off one by one" opens the donations in
place with a tick each and "Mark the ticked ones as claimed". One year is open at a time. Years whose
deadline is closest come first; years already too late come last, drawn quietly.

**Changed on purpose.** The list is every small donation not yet marked, not only those within six
months of the deadline (`?all=1` on the existing queue; without it the answer is unchanged, so the
Overview's count is too). The deadline and the state were columns repeated on every row; they are the
same for a whole tax year, so they sit on the year's card. `expired` and `expiring` read "Too late to
claim" and "Deadline within six months". The three figures keep their sums and names and gain a plain
line each; the line under "Remaining GASDS headroom" says to check it with the treasurer, because the
code itself marks that sum as awaiting finance sign-off.

**Added.** Undo (`POST /api/admin/queues/gasds-deadline/unmark-claimed`, GASDS edit, audited as
`gasds.unclaimed`) and the list it works from (`GET /api/admin/queues/gasds-claimed`: the last twenty
`gasds.claimed` audit rows, who and when, and which of their donations are still marked by that mark).
The fold uses only rules the repo encodes (`src/gasds/caps.ts`, `deadline.ts`) and ends "This is not
tax advice" with a link to HMRC's own page.

## Subscriptions (`#view-subscriptions`)

**For:** whoever looks after supporters, every week or two: whose monthly card payment is failing or
has stopped, so someone can get in touch.

**Layout.** Title and its sentence; "See everyone giving monthly"; four tiles that each show or hide
their group (Card failing, Stopped, Cancelled, Back to normal), opening on the first two; then a card
per person under their group's heading.

**A person's card:** their name, the pill as before (At risk, Lapsed, Cancelled, Active), plain words
("Card failed twice. Stripe is still trying.", "Stopped on 3 November 2026 after 4 tries.", "They
cancelled on 3 November 2026."), what they give and since when, when it last changed, their email with
Copy and "Email them", a phone number where one is held, and "Open their page" for someone who may open
Donations. The email, the donor and the last change were always in the answer and thrown away.

**Changed on purpose.** One name, "monthly gift", in every message (it was also "subscription" and
"flagged subscription"). The Failed count and the Ended date are in the sentence, not columns.

**Added on the server.** `monthly_pence` and `first_paid_at` (the latest and first paid charge of that
subscription) and `phone` (a business supporter's number; individuals have none on record).

## Left out, and why

- **A "claim by" date on each donation** and **a copyable total for the adjustment box**. The
  adjustment figure is the refunded part of the gift; HMRC's box may want the tax. Jaimie's to settle.
  Part 3's explanation is unchanged.
- **Taking a donation out of a batch, deleting an empty batch, HMRC's reference and a paid date.** New
  ways to change claim data; not in this brief.
- **Naming the donation that stops a download.** Needs the export to report which declaration is
  short; the message names the usual cause instead.
- **"Contacted" on a monthly gift**, and a way to write off small donations that are too late. Both
  need a migration.
- **The GASDS figures by tax year.** They count the calendar year; changing that changes the sums.
