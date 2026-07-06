# TASK-132 — Correct the Gift Aid benefit cap to the post-2019 relevant value test

## Problem

The donor-benefit cap logic (`src/benefits/caps.ts`, REQ-045) uses the **pre-2019**
three-tier rule:

- `≤ £100 → 25%`
- `£101–£1,000 → flat £25`
- `£1,001+ → 5%`, capped at £2,500

That rule was replaced on **6 April 2019** by a single two-band "relevant value
test": **25% of the first £100, plus 5% of everything above £100, capped at
£2,500 total.** The old middle tier understates the cap for gifts above £100, so
the annualised tier caps are wrong — most visibly Platinum (£1,200/yr) reads £60
when it should be £80.

This is academic while every perk is genuinely £0 (a breach never fires), but the
reference a developer implements the "automatic cap check" against must be right.

## Correct rule

```
benefitCapPence(d) = min( floor( 0.25 * min(d, £100) + 0.05 * max(0, d - £100) ), £2,500 )
```

Corrected annualised tier caps:

| Tier | Annualised gift | Cap (was) | Cap (correct) |
|---|---|---|---|
| Bronze | £120 | £26 | **£26** |
| Silver | £300 | £30* | **£35** |
| Gold | £600 | £25* | **£50** |
| Platinum | £1,200 | £60 | **£80** |

\* under the old flat-£25 / 5% tiers Silver and Gold fell in the flat-£25 band; the
corrected figures are what the relevant value test yields.

## Changes

### `src/benefits/caps.ts`

- Replace the three-band comment (lines ~10–14) with the relevant value test.
- Constants:
  - `FIRST_BAND_MAX_PENCE = 10_000` (£100)
  - `FIRST_BAND_RATE = 0.25`
  - `ABOVE_BAND_RATE = 0.05`
  - `AGGREGATE_MAX_CAP_PENCE = 250_000` (£2,500)
  - Remove `TIER1_DONATION_MAX_PENCE`, `TIER2_DONATION_MAX_PENCE`, `TIER1_RATE`,
    `TIER2_FLAT_CAP_PENCE`, `TIER3_RATE`, `TIER3_MAX_CAP_PENCE` (only caps.ts + its
    test reference them — verified by grep).
- Rewrite `benefitCapPence`:

```ts
export function benefitCapPence(annualisedDonationPence: number): number {
  const donation = donationPenceSchema.parse(annualisedDonationPence);
  const firstBand = Math.min(donation, FIRST_BAND_MAX_PENCE);
  const aboveBand = Math.max(0, donation - FIRST_BAND_MAX_PENCE);
  const raw = Math.floor(firstBand * FIRST_BAND_RATE + aboveBand * ABOVE_BAND_RATE);
  return Math.min(raw, AGGREGATE_MAX_CAP_PENCE);
}
```

`deriveBenefitCapBreach`, `annualisePence`, the recognition-perk helpers, and all
schemas are unchanged.

### `test/unit/benefit-caps.test.ts`

Rewrite the cap assertions to the relevant value test, keeping the breach /
recognition-perk / validation tests. Add explicit tier-cap assertions:

- `benefitCapPence(£120) === £26`, `£300 → £35`, `£600 → £50`, `£1,200 → £80`.
- boundary: `£100 → £25` (25% of £100).
- just over: `£100.01 → 2500` still (5% of 1p floors to 0) — assert
  `Math.floor(2500 + 1 * 0.05) === 2500`.
- aggregate cap: `£50,000 → £2,500` (2500 + 4,990,000*0.05 = 252,000 → capped),
  and a very large gift stays at £2,500.
- Update the imports to the new constant names.

### README

Line ~1936: replace the "three tiers … ≤£100 → 25% of the donation, £101–£1,000 →
£25, £1,001+ → 5%" prose with the relevant value test (25% of the first £100 + 5%
above, capped £2,500).

### Upstream flag (no edit)

`SPEC.md:334` (REQ-045) states the old three-tier rule verbatim — the §A5/§A6
reference table. `SPEC.md` is a generated projection of the requirement log and
must not be hand-edited; flag REQ-045 for the requirement-log owner to reword to
the relevant value test.

## Tests

- `benefit-caps.test.ts` rewritten as above.
- Check `test/unit/donation-benefits.test.ts` (the transactional writer) for any
  hard-coded cap value; update if it asserts an old cap. (Recognition perks are
  £0, so the breach flag there is likely unaffected.)
- Full unit + BDD green; `npm run lint && npm run build`.

## Out of scope

- No runtime behaviour change on real data (perks are £0). No schema/migration, no
  route/UI change.
- `SPEC.md` not hand-edited (flagged upstream).

## Process

One PR, `[TASK-132]` title, branch `task-132-benefit-cap-relevant-value`. Lint +
build + unit + BDD green before self-merge. README updated in the same PR.
