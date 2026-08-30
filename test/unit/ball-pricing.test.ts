import { describe, it, expect } from "vitest";
import {
  SEAT_PRICE_PENCE,
  TABLE_PRICE_PENCE,
  lineTotalPence,
  stripeFeePence,
  orderTotalPence,
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

describe("stripeFeePence", () => {
  it("is 1.5% + 20p on a £100 seat", () => {
    expect(stripeFeePence(10_000)).toBe(170);
  });
  it("is £15.20 on a £1,000 table", () => {
    expect(stripeFeePence(100_000)).toBe(1_520);
  });
  it("rounds up so NBCC is never left short a penny", () => {
    expect(stripeFeePence(3_333)).toBe(70);
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
    expect(t.feeCoverPence).toBe(170);
    expect(t.totalPence).toBe(10_170);
  });

  it("covers the fee on a table at £15.20", () => {
    const t = orderTotalPence({ order: { kind: "table", quantity: 1 }, coverFee: true });
    expect(t.ticketsPence).toBe(100_000);
    expect(t.feeCoverPence).toBe(1_520);
    expect(t.totalPence).toBe(101_520);
  });

  it("adds an optional donation, and the fee cover is calculated on the whole amount", () => {
    const t = orderTotalPence({
      order: { kind: "seat", quantity: 1 },
      donationPence: 2_500,
      coverFee: true,
    });
    expect(t.ticketsPence).toBe(10_000);
    expect(t.donationPence).toBe(2_500);
    expect(t.feeCoverPence).toBe(208);
    expect(t.totalPence).toBe(12_708);
  });

  it("rejects a negative donation", () => {
    expect(() =>
      orderTotalPence({ order: { kind: "seat", quantity: 1 }, donationPence: -1 }),
    ).toThrow();
  });
});
