// TASK-205 (business-supporter thank-you & fulfilment — DATA-MODEL FOUNDATION): the pure banding +
// perk model. NO pool, NO config, NO clock — importing this file touches nothing external, so it is
// unit-tested DB-free per CLAUDE.md golden rule 5. Mirrors the pure-model style of
// src/donors/confirmation.ts and the existing tier logic in src/db/donations-model.ts
// (supporterTierForAmount). The persisted shape it underpins is the business_supporter_fulfilment
// table (migration 1783961442118); the thank-you page, reminders and admin fulfilment UI that
// consume it are later tasks and out of scope here.
//
// IMPORTANT (HMRC): every perk below is a £0-value recognition perk — public listing, our donor
// newsletter, a social thank-you, a digital badge, a certificate. None has a monetary value to the
// donor, so none counts toward the Gift-Aid donor-benefit cap; a business supporter's monthly gift
// stays fully Gift-Aid-able. Do not add a perk of real value here without revisiting that.

// The four recognition bands, ascending. These mirror the existing monthly-plan tiers
// (bronze/silver/gold/platinum) used across the donate flow.
export type SupporterBand = "bronze" | "silver" | "gold" | "platinum";

// Ascending order — lowest gift to highest. This is the canonical band order (rendering, iteration).
export const SUPPORTER_BANDS: readonly SupporterBand[] = ["bronze", "silver", "gold", "platinum"];

// Band a supporter by their MONTHLY gift amount, in integer pence. Thresholds match the monthly plan
// tiers on donate.html: bronze £10, silver £25, gold £50, platinum £100. Below £10/month is the
// monthly minimum — such a gift is not banded, so this returns null. Checked high-to-low so each
// band is the half-open range [threshold, next):
//   < 1000            -> null      (below the £10 monthly minimum — not a business supporter band)
//   1000 .. 2499      -> "bronze"  (£10.00 – £24.99)
//   2500 .. 4999      -> "silver"  (£25.00 – £49.99)
//   5000 .. 9999      -> "gold"    (£50.00 – £99.99)
//   >= 10000          -> "platinum" (£100.00+)
// Pure — a plain function on a number, like supporterTierForAmount.
export function bandForMonthlyAmount(pence: number): SupporterBand | null {
  if (pence >= 10000) return "platinum";
  if (pence >= 5000) return "gold";
  if (pence >= 2500) return "silver";
  if (pence >= 1000) return "bronze";
  return null;
}

// The top band, platinum, unlocks the recognition extras (social thank-you, digital badge,
// certificate). This predicate captures that "platinum only" rule in one place so perksForBand and
// any caller stay consistent.
export function bandHasPlatinumPerks(band: SupporterBand): boolean {
  return band === "platinum";
}

// The recognition perks a band earns. All are £0-value (see the file header):
//  - supportersListing: appear on the public Supporters page — SUBJECT TO the donor opting in
//    (list_on_supporters on the fulfilment record); this flag means the band is eligible, not that
//    they are shown regardless of consent.
//  - newsletter: receive our donor newsletter.
//  - socialThankYou / digitalBadge / certificate: the platinum-only recognition extras.
export interface BandPerks {
  supportersListing: boolean;
  newsletter: boolean;
  socialThankYou: boolean;
  digitalBadge: boolean;
  certificate: boolean;
}

// The perks for a band. EVERY band gets the supporters listing (subject to opt-in) and the
// newsletter; PLATINUM additionally gets the three recognition extras. Pure.
export function perksForBand(band: SupporterBand): BandPerks {
  const platinum = bandHasPlatinumPerks(band);
  return {
    supportersListing: true,
    newsletter: true,
    socialThankYou: platinum,
    digitalBadge: platinum,
    certificate: platinum,
  };
}
