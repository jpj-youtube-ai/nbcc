# TASK-127 — Reframe Gift Aid eligibility around UK tax, not a postcode flag

## Problem

The Channel Islands / Isle of Man handling (SPEC §A3 / REQ-043) is framed
backwards. The `nonUk` checkbox reads as a residency-based eligibility route:

> I live outside the UK (Channel Islands or Isle of Man), so I have no UK postcode.

That implies a CI/IoM resident can Gift Aid simply by omitting a UK postcode.
Gift Aid eligibility actually depends on whether the donor pays UK **Income Tax
or Capital Gains Tax** — which is exactly the verbatim HMRC liability statement
the donor already agrees to on submit (`src/declarations/wording.ts`,
`giftaid-statement`). A CI/IoM resident who pays no UK tax cannot validly Gift
Aid at all. The "overseas address, no UK postcode" path is really for **UK
taxpayers who happen to live abroad**. So the address/postcode is a **matching
detail**, not the eligibility test.

## What is already correct (no logic change)

- The HMRC liability statement is the eligibility gate; submitting the form is
  agreeing to it, and `confirmed_taxpayer` is set true on opt-in
  (`src/db/stripe-webhook-model.ts`).
- `nonUk` only omits the UK postcode (and relaxes the house-name/number matching
  key) in `src/declarations/fields.ts` and hides the postcode field in
  `assets/js/main.js`. That behaviour stays.

This task changes **framing only** — donor-facing copy and misleading code
comments — so nothing about validation, persistence, or HMRC claim output moves.

## Changes

### 1. Checkbox copy (lead with the postcode fact; address as a matching detail)

- Donor, `gift-aid.html` and `donate.html`:
  > I have no UK postcode — for example, my home address is in the Channel
  > Islands or Isle of Man.
- Partner, `donate.html`:
  > This partner has no UK postcode — for example, a home address in the Channel
  > Islands or Isle of Man.

### 2. Reinforce the real gate

Add one short help note by the declaration (both `gift-aid.html` and the
`donate.html` give widget):

> Gift Aid depends on paying UK Income Tax or Capital Gains Tax, not on where you
> live — you can still Gift Aid from an overseas address if you are a UK
> taxpayer.

No new control: the eligibility affirmation remains agreeing to the verbatim HMRC
statement (the HMRC model declaration is itself the confirmation).

### 3. Code comments

Reframe the misleading comments so the flag is described as an **overseas / non-UK
*address* (no UK postcode)** — a matching detail that only hides the postcode
field, explicitly *not* the eligibility test (eligibility is the UK-taxpayer
liability statement):

- `src/declarations/fields.ts` — the header note (lines ~7-8), the refinement
  comments (~47-62), and the row-builder note (~89-91).
- `assets/js/main.js` — the wiring comment (~257).

### 4. Identifiers unchanged

The `nonUk` input/field name and the `non_uk` column stay. They are internal
labels; renaming the column would be a destructive migration (against
expand-contract) and renaming the wire key would churn the metadata contract,
webhook model and tests for no correctness gain. Scope is framing, not a rename.

## Tests (TDD)

- New guard (Vitest, reads the static HTML): `gift-aid.html` and `donate.html`
  contain the reworded checkbox text and the UK-taxpayer note, and do **not**
  contain the old `I live outside the UK (Channel Islands or Isle of Man), so I
  have no UK postcode` eligibility framing.
- Update any existing test that pins the old copy (`gift-aid-render`, copy-rules
  / accessibility guards if they assert the checkbox string).
- Behaviour tests (`declaration-fields`, webhook model) are unchanged — logic
  does not move; run them to prove no regression.
- Full unit suite + BDD green.

## Out of scope

- **`SPEC.md:317`** carries the same "non-UK donor flag … that omits the
  postcode" wording, but `SPEC.md` is a generated projection of the requirement
  log and must never be hand-edited. Flag REQ-043 for the requirement-log owner
  to reword upstream; this task does not touch SPEC.md.
- No identifier/column rename, no migration, no infra, no change to HMRC claim
  output.

## Process

One PR, title `[TASK-127] …`, branch `task-127-giftaid-uk-tax-gate-reframe`.
Lint + build + unit + BDD green before self-merge. README updated if it repeats
the old framing.
