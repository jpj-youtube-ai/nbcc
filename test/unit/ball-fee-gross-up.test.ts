import { describe, it, expect } from "vitest";
import {
  grossedUpFeePence,
  stripeFeePence,
  SEAT_PRICE_PENCE,
  TABLE_PRICE_PENCE,
  DEFAULT_CARD_FEE,
  type CardFeeRate,
} from "../../src/ball/pricing";

// TASK-348: covering the card fee has to leave the charity with the FULL ticket price.
//
// The property that matters is not "the fee is 1.2% + 20p" — it is that the money arriving is
// the money advertised. So these tests assert the outcome, not the arithmetic: charge the ticket
// plus the fee, subtract what Stripe takes on that total, and check what is left.

/** What the charity actually banks when the buyer covers the fee. */
const netted = (target: number, rate: CardFeeRate = DEFAULT_CARD_FEE) => {
  const charged = target + grossedUpFeePence(target, rate);
  return charged - stripeFeePence(charged, rate);
};

describe("covering the fee leaves the full ticket price", () => {
  it.each([
    ["one seat", SEAT_PRICE_PENCE],
    ["two seats", SEAT_PRICE_PENCE * 2],
    ["nine seats", SEAT_PRICE_PENCE * 9],
    ["one table", TABLE_PRICE_PENCE],
    ["four tables", TABLE_PRICE_PENCE * 4],
  ])("%s arrives whole", (_label, tickets) => {
    expect(netted(tickets)).toBe(tickets);
  });

  // The old behaviour, kept as a named example so the regression is legible rather than a number
  // somebody has to rediscover: the fee on the TICKET price ignores that Stripe's percentage
  // applies to the total it processes, which now includes the fee.
  it("is more than the fee on the ticket price alone, which was the bug", () => {
    const naive = stripeFeePence(SEAT_PRICE_PENCE);
    expect(grossedUpFeePence(SEAT_PRICE_PENCE)).toBeGreaterThan(naive);
    // And that naive figure genuinely fell short.
    const charged = SEAT_PRICE_PENCE + naive;
    expect(charged - stripeFeePence(charged)).toBeLessThan(SEAT_PRICE_PENCE);
  });

  it("costs the buyer £1.42 on a £100 seat, not £1.40", () => {
    expect(grossedUpFeePence(SEAT_PRICE_PENCE)).toBe(142);
  });

  it("costs £12.35 on a £1,000 table", () => {
    expect(grossedUpFeePence(TABLE_PRICE_PENCE)).toBe(1235);
  });
});

describe("it holds at other rates, not just today's", () => {
  // The rate is admin-editable (TASK-317). A gross-up that only works at 1.2% + 20p is a bug
  // waiting for the day Stripe changes its pricing.
  const rates: Array<[string, CardFeeRate]> = [
    ["1.4% + 20p", { percentBp: 140, fixedPence: 20 }],
    ["1.5% + 25p", { percentBp: 150, fixedPence: 25 }],
    ["2.9% + 30p", { percentBp: 290, fixedPence: 30 }],
    ["percentage only", { percentBp: 200, fixedPence: 0 }],
    ["fixed only", { percentBp: 0, fixedPence: 20 }],
    ["no fee at all", { percentBp: 0, fixedPence: 0 }],
  ];

  it.each(rates)("%s still nets the ticket price", (_label, rate) => {
    for (const tickets of [SEAT_PRICE_PENCE, TABLE_PRICE_PENCE, TABLE_PRICE_PENCE * 4]) {
      expect(netted(tickets, rate)).toBe(tickets);
    }
  });

  // Never MORE than the target either: over-collecting would mean asking buyers to cover a fee
  // larger than the one Stripe charges, which is the thing the rate being editable exists to
  // prevent.
  it.each(rates)("%s does not over-collect", (_label, rate) => {
    for (const tickets of [SEAT_PRICE_PENCE, TABLE_PRICE_PENCE]) {
      expect(netted(tickets, rate)).toBeLessThanOrEqual(tickets + 1);
    }
  });
});

describe("edges", () => {
  it("asks for nothing on a zero amount", () => {
    expect(grossedUpFeePence(0)).toBe(0);
  });

  it("still nets the target on a very small donation", () => {
    // A £1 donation costs more in fees proportionally; the guarantee must still hold.
    expect(netted(100)).toBe(100);
  });

  it("rejects a negative amount rather than inventing a credit", () => {
    expect(() => grossedUpFeePence(-1)).toThrow();
  });
});
