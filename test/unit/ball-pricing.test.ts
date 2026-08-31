import { describe, it, expect } from "vitest";
import {
  SEAT_PRICE_PENCE,
  TABLE_PRICE_PENCE,
  lineTotalPence,
  stripeFeePence,
  orderTotalPence,
  DEFAULT_CARD_FEE,
  DEFAULT_CARD_FEE_BP,
  DEFAULT_CARD_FEE_FIXED_PENCE,
} from "../../src/ball/pricing";

describe("prices", () => {
  it("a seat is £100 and a table is £1,000", () => {
    expect(SEAT_PRICE_PENCE).toBe(10_000);
    expect(TABLE_PRICE_PENCE).toBe(100_000);
  });

  it("a table is exactly ten seats, no discount", () => {
    expect(TABLE_PRICE_PENCE).toBe(SEAT_PRICE_PENCE * 10);
  });
});

describe("lineTotalPence", () => {
  it("prices seats", () => {
    expect(lineTotalPence({ kind: "seat", quantity: 3 })).toBe(30_000);
  });
  it("prices tables", () => {
    expect(lineTotalPence({ kind: "table", quantity: 2 })).toBe(200_000);
  });
});

describe("the default card fee rate", () => {
  // NBCC is on Stripe's UK charity pricing, confirmed against the account. This was
  // hardcoded at the STANDARD 1.5% + 20p, so every buyer who ticked "cover the fee" was
  // handing over about 30p a ticket for a fee that was never charged.
  it("is the 1.2% + 20p charity rate, not the 1.5% standard rate", () => {
    expect(DEFAULT_CARD_FEE_BP).toBe(120);
    expect(DEFAULT_CARD_FEE_FIXED_PENCE).toBe(20);
    expect(DEFAULT_CARD_FEE).toEqual({ percentBp: 120, fixedPence: 20 });
  });
});

describe("stripeFeePence", () => {
  it("is £1.40 on a £100 seat", () => {
    expect(stripeFeePence(10_000)).toBe(140);
  });

  it("is £12.20 on a £1,000 table", () => {
    expect(stripeFeePence(100_000)).toBe(1_220);
  });

  // Stripe charges per TRANSACTION. A table of ten is one payment and carries one 20p, so
  // ten times the single-seat fee would over-collect £1.80 and make the promise on the
  // checkbox untrue.
  it("charges the fixed 20p once per order, not once per ticket", () => {
    expect(stripeFeePence(100_000)).toBeLessThan(10 * stripeFeePence(10_000));
    expect(stripeFeePence(100_000)).toBe(10 * stripeFeePence(10_000) - 9 * 20);
  });

  it("rounds up so NBCC is never left short a penny", () => {
    // 3,333 x 1.2% = 39.996p, which must not become 39p.
    expect(stripeFeePence(3_333)).toBe(60);
  });

  it("uses a rate handed to it, so the live setting wins over the default", () => {
    expect(stripeFeePence(10_000, { percentBp: 150, fixedPence: 20 })).toBe(170);
    expect(stripeFeePence(10_000, { percentBp: 0, fixedPence: 0 })).toBe(0);
  });

  it("refuses a rate outside the range the settings column allows", () => {
    expect(() => stripeFeePence(10_000, { percentBp: 1_001, fixedPence: 20 })).toThrow();
    expect(() => stripeFeePence(10_000, { percentBp: -1, fixedPence: 20 })).toThrow();
    expect(() => stripeFeePence(10_000, { percentBp: 120, fixedPence: 501 })).toThrow();
  });
});

describe("orderTotalPence", () => {
  it("is just the tickets when nothing is added", () => {
    const t = orderTotalPence({ order: { kind: "seat", quantity: 1 } });
    expect(t.ticketsPence).toBe(10_000);
    expect(t.feeCoverPence).toBe(0);
    expect(t.donationPence).toBe(0);
    expect(t.totalPence).toBe(10_000);
  });

  it("adds the fee cover when the buyer opts in", () => {
    const t = orderTotalPence({ order: { kind: "seat", quantity: 1 }, coverFee: true });
    expect(t.feeCoverPence).toBe(140);
    expect(t.totalPence).toBe(10_140);
  });

  it("covers the fee on a table at £12.20", () => {
    const t = orderTotalPence({ order: { kind: "table", quantity: 1 }, coverFee: true });
    expect(t.ticketsPence).toBe(100_000);
    expect(t.feeCoverPence).toBe(1_220);
    expect(t.totalPence).toBe(101_220);
  });

  // The rest of the site has never asked donors to cover the fee on a gift, and this page
  // does not either. NBCC absorbs ~1.2% of the donation (about 30p on £25); the ticket is a
  // fixed price where the fee eats into event income, the donation is a gift.
  it("charges the fee cover on the TICKETS only, never on the donation", () => {
    const t = orderTotalPence({
      order: { kind: "seat", quantity: 1 },
      donationPence: 2_500,
      coverFee: true,
    });
    expect(t.ticketsPence).toBe(10_000);
    expect(t.donationPence).toBe(2_500);
    expect(t.feeCoverPence).toBe(140);
    expect(t.totalPence).toBe(12_640);
  });

  it("charges the same fee cover whatever the donation is", () => {
    const none = orderTotalPence({ order: { kind: "seat", quantity: 2 }, coverFee: true });
    const big = orderTotalPence({
      order: { kind: "seat", quantity: 2 },
      donationPence: 100_000,
      coverFee: true,
    });
    expect(big.feeCoverPence).toBe(none.feeCoverPence);
  });

  it("uses the rate it is given, so an admin change reaches the charge", () => {
    const t = orderTotalPence({
      order: { kind: "seat", quantity: 1 },
      coverFee: true,
      cardFee: { percentBp: 150, fixedPence: 20 },
    });
    expect(t.feeCoverPence).toBe(170);
  });

  it("rejects a negative donation", () => {
    expect(() =>
      orderTotalPence({ order: { kind: "seat", quantity: 1 }, donationPence: -1 }),
    ).toThrow();
  });
});
