import { describe, it, expect } from "vitest";
import {
  computeRetentionExpiry,
  RETENTION_YEARS,
} from "../../src/declarations/retention";

// TASK-068 (REQ-046) · TASK-134: the pure, DB-free declaration retention-expiry calculator. An
// immutable declaration is retained six years after the END OF THE ACCOUNTING PERIOD (proxied by
// the UK tax year, ending 5 April) of the MOST RECENT claimed donation, and permanently while an
// enduring / monthly declaration's subscription is active; on cancellation the clock is anchored to
// the FINAL charge's tax-year-end, not the cancellation timestamp (REQ-046).

// Six years after the 5 April that ends the UK tax year of the given instant (UTC, deterministic).
function expectedExpiry(iso: string): number {
  const d = new Date(iso);
  const onOrBeforeApr5 = d.getUTCMonth() < 3 || (d.getUTCMonth() === 3 && d.getUTCDate() <= 5);
  const endYear = (onOrBeforeApr5 ? d.getUTCFullYear() : d.getUTCFullYear() + 1) + RETENTION_YEARS;
  return Date.UTC(endYear, 3, 5);
}

describe("computeRetentionExpiry (REQ-046)", () => {
  it("retains indefinitely (null) while an enduring declaration's subscription is active", () => {
    const expiry = computeRetentionExpiry({
      scope: "all_donations",
      subscriptionActive: true,
      lastClaimedDonationAt: new Date("2024-01-10T09:00:00Z"),
      cancelledAt: null,
    });
    expect(expiry).toBeNull();
  });

  it("retains indefinitely for a monthly (enduring) declaration with an active subscription", () => {
    // A monthly gift is always enduring (REQ-041) and persists scope = all_donations.
    const expiry = computeRetentionExpiry({
      scope: "all_donations",
      subscriptionActive: true,
      lastClaimedDonationAt: null, // even before the first charge is claimed
      cancelledAt: null,
    });
    expect(expiry).toBeNull();
  });

  it("anchors the six-year clock to the FINAL claimed charge on cancellation, not the cancellation time", () => {
    const finalCharge = new Date("2023-11-05T12:30:00Z");
    // Cancellation happened a year AFTER the final charge — it must NOT move the clock.
    const cancelledAt = new Date("2024-12-01T08:00:00Z");
    const expiry = computeRetentionExpiry({
      scope: "all_donations",
      subscriptionActive: false,
      lastClaimedDonationAt: finalCharge,
      cancelledAt,
    });
    expect(expiry).not.toBeNull();
    expect(expiry!.getTime()).toBe(expectedExpiry("2023-11-05T12:30:00Z"));
    // Explicitly NOT six years after the cancellation timestamp.
    expect(expiry!.getTime()).not.toBe(expectedExpiry("2024-12-01T08:00:00Z"));
  });

  it("treats a cancelledAt as inactive even if subscriptionActive is still true", () => {
    const finalCharge = new Date("2022-06-15T00:00:00Z");
    const expiry = computeRetentionExpiry({
      scope: "all_donations",
      subscriptionActive: true, // stale flag; the cancellation wins
      lastClaimedDonationAt: finalCharge,
      cancelledAt: new Date("2022-07-01T00:00:00Z"),
    });
    expect(expiry!.getTime()).toBe(expectedExpiry("2022-06-15T00:00:00Z"));
  });

  it("expires a this_donation declaration six years after its single donation's tax-year-end", () => {
    const donation = new Date("2021-04-20T15:45:00Z");
    const expiry = computeRetentionExpiry({
      scope: "this_donation",
      subscriptionActive: false,
      lastClaimedDonationAt: donation,
      cancelledAt: null,
    });
    expect(expiry!.getTime()).toBe(expectedExpiry("2021-04-20T15:45:00Z"));
  });

  it("accepts an ISO string for the last-claimed date, not just a Date", () => {
    const expiry = computeRetentionExpiry({
      scope: "this_donation",
      subscriptionActive: false,
      lastClaimedDonationAt: "2020-02-29T00:00:00Z", // tax year ends 2020-04-05 → +6 = 2026-04-05
      cancelledAt: null,
    });
    expect(expiry!.getTime()).toBe(expectedExpiry("2020-02-29T00:00:00Z"));
  });

  // Documented edge case: an inactive/one-off declaration with NO claimed donation has no
  // anchor to run the six-year clock from — there is nothing to retain against. The
  // calculator returns null deterministically rather than throwing; the caller (the REQ-063
  // admin retention queue) reads null as "no computable expiry", not "retain forever".
  it("returns null when there is no claimed donation to retain against (no throw)", () => {
    const expiry = computeRetentionExpiry({
      scope: "this_donation",
      subscriptionActive: false,
      lastClaimedDonationAt: null,
      cancelledAt: null,
    });
    expect(expiry).toBeNull();
  });

  it("returns null for a cancelled enduring declaration that was never charged", () => {
    const expiry = computeRetentionExpiry({
      scope: "all_donations",
      subscriptionActive: false,
      lastClaimedDonationAt: null,
      cancelledAt: new Date("2024-03-01T00:00:00Z"),
    });
    expect(expiry).toBeNull();
  });

  it("does not mutate the supplied last-claimed Date", () => {
    const donation = new Date("2021-04-20T15:45:00Z");
    const before = donation.getTime();
    computeRetentionExpiry({
      scope: "this_donation",
      subscriptionActive: false,
      lastClaimedDonationAt: donation,
      cancelledAt: null,
    });
    expect(donation.getTime()).toBe(before);
  });

  it("uses a six-year retention window", () => {
    expect(RETENTION_YEARS).toBe(6);
  });
});
