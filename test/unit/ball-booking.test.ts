import { describe, it, expect } from "vitest";
import {
  purchaseSchema,
  makeReference,
  isBallSession,
  bookingFromSession,
  ballMetadata,
} from "../../src/ball/booking";

describe("purchaseSchema", () => {
  const valid = {
    kind: "seat",
    quantity: 2,
    buyerFirstName: "Jo",
    buyerSurname: "Smith",
    buyerEmail: "jo@example.com",
    termsAccepted: true,
  };

  it("accepts a minimal seat purchase and defaults the extras off", () => {
    const p = purchaseSchema.parse(valid);
    expect(p.donationPence).toBe(0);
    expect(p.coverFee).toBe(false);
    expect(p.giftAid).toBe(false);
    expect(p.newsletterOptIn).toBe(false);
  });

  it("trims the name and lowercases the email", () => {
    const p = purchaseSchema.parse({
      ...valid,
      buyerFirstName: "  Jo  ",
      buyerSurname: "  Smith  ",
      buyerEmail: "JO@Example.COM",
    });
    expect(p.buyerFirstName).toBe("Jo");
    expect(p.buyerSurname).toBe("Smith");
    // Derived, never sent by the client, so it is assembled identically every time.
    expect(p.buyerName).toBe("Jo Smith");
    expect(p.buyerEmail).toBe("jo@example.com");
  });

  it("rejects a bad email", () => {
    expect(() => purchaseSchema.parse({ ...valid, buyerEmail: "not-an-email" })).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => purchaseSchema.parse({ ...valid, buyerFirstName: "   " })).toThrow();
    expect(() => purchaseSchema.parse({ ...valid, buyerSurname: "   " })).toThrow();
  });

  it("enforces the per-order seat cap", () => {
    expect(() => purchaseSchema.parse({ ...valid, quantity: 10 })).toThrow();
    expect(purchaseSchema.parse({ ...valid, quantity: 9 }).quantity).toBe(9);
  });

  it("enforces the per-order table cap", () => {
    expect(() => purchaseSchema.parse({ ...valid, kind: "table", quantity: 5 })).toThrow();
    expect(purchaseSchema.parse({ ...valid, kind: "table", quantity: 4 }).quantity).toBe(4);
  });

  it("rejects a zero or negative quantity", () => {
    expect(() => purchaseSchema.parse({ ...valid, quantity: 0 })).toThrow();
    expect(() => purchaseSchema.parse({ ...valid, quantity: -2 })).toThrow();
  });

  it("caps a runaway donation at a sane ceiling", () => {
    expect(() => purchaseSchema.parse({ ...valid, donationPence: 100_000_001 })).toThrow();
  });

  it("rejects Gift Aid claimed without a donation", () => {
    expect(() => purchaseSchema.parse({ ...valid, giftAid: true, donationPence: 0 })).toThrow();
  });

  it("allows Gift Aid alongside a real donation", () => {
    const p = purchaseSchema.parse({ ...valid, giftAid: true, donationPence: 2_500 });
    expect(p.giftAid).toBe(true);
  });
});

describe("makeReference", () => {
  it("is uppercase, prefixed, and free of ambiguous characters", () => {
    const ref = makeReference(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(ref).toMatch(/^BALL-[A-Z2-9]{6}$/);
    // Only the GENERATED suffix must avoid ambiguous glyphs; the fixed prefix is known text.
    expect(ref.slice("BALL-".length)).not.toMatch(/[OIL01]/);
  });

  it("is deterministic for the same bytes", () => {
    const bytes = Buffer.from([9, 8, 7, 6, 5, 4, 3, 2]);
    expect(makeReference(bytes)).toBe(makeReference(bytes));
  });

  it("differs for different bytes", () => {
    expect(makeReference(Buffer.from([1, 1, 1, 1, 1, 1]))).not.toBe(
      makeReference(Buffer.from([2, 2, 2, 2, 2, 2])),
    );
  });
});

describe("isBallSession", () => {
  it("is true only when the product metadata says ball", () => {
    expect(isBallSession({ product: "ball" })).toBe(true);
    expect(isBallSession({ product: "donation" })).toBe(false);
    expect(isBallSession({})).toBe(false);
    expect(isBallSession(null)).toBe(false);
    expect(isBallSession(undefined)).toBe(false);
  });

  it("does not mistake a donation session carrying a giftAid flag for a ball session", () => {
    expect(isBallSession({ giftAid: "true", mode: "once" })).toBe(false);
  });
});

describe("ballMetadata / bookingFromSession round trip", () => {
  const purchase = purchaseSchema.parse({
    kind: "table",
    quantity: 1,
    buyerFirstName: "Jo",
    buyerSurname: "Smith",
    buyerEmail: "jo@example.com",
    termsAccepted: true,
    donationPence: 2_500,
    coverFee: true,
    giftAid: true,
    newsletterOptIn: true,
  });

  it("stamps every field the webhook needs back", () => {
    const md = ballMetadata(purchase, "BALL-ABC234", 10);
    expect(md.product).toBe("ball");
    expect(md.kind).toBe("table");
    expect(md.quantity).toBe("1");
    expect(md.seats).toBe("10");
    expect(md.reference).toBe("BALL-ABC234");
    expect(md.giftAid).toBe("true");
    expect(md.newsletterOptIn).toBe("true");
  });

  // TASK-317: buildBallSessionParams prices the Stripe LINE ITEMS from the live rate in
  // ball_settings. If ballMetadata stamped the compiled-in default instead, then the moment
  // anyone edited the rate in admin, Stripe would charge one figure while the booking row —
  // which the webhook writes from this metadata — recorded another. Only the metadata
  // survives into the database, so the difference would be invisible until a reconciliation.
  it("stamps the rate it was given, so the charge and the recorded booking agree", () => {
    const rate = { percentBp: 250, fixedPence: 45 };
    const md = ballMetadata(purchase, "BALL-ABC234", 10, rate);
    // 1,000 x 2.5% = 2500, + 45 = 2545.
    expect(md.feeCoverPence).toBe("2545");
    expect(md.totalPence).toBe(String(100_000 + 2_500 + 2_545));
  });

  it("falls back to the default rate when none is given", () => {
    const md = ballMetadata(purchase, "BALL-ABC234", 10);
    expect(md.feeCoverPence).toBe("1220");
  });

  it("reads back into a booking row with the money intact", () => {
    const md = ballMetadata(purchase, "BALL-ABC234", 10);
    const booking = bookingFromSession({
      id: "cs_test_123",
      metadata: md,
      customer_details: { email: "jo@example.com" },
    });
    expect(booking).not.toBeNull();
    expect(booking!.reference).toBe("BALL-ABC234");
    expect(booking!.kind).toBe("table");
    expect(booking!.quantity).toBe(1);
    expect(booking!.seats).toBe(10);
    expect(booking!.buyerName).toBe("Jo Smith");
    expect(booking!.buyerEmail).toBe("jo@example.com");
    expect(booking!.ticketsPence).toBe(100_000);
    expect(booking!.donationPence).toBe(2_500);
    // Tickets only, at the 1.2% + 20p charity rate: ceil(100000*120/10000) + 20 = 1220.
    // The £25 donation is deliberately outside the fee cover (TASK-317).
    expect(booking!.feeCoverPence).toBe(1_220);
    expect(booking!.totalPence).toBe(103_720);
    expect(booking!.giftAid).toBe(true);
    expect(booking!.stripeSessionId).toBe("cs_test_123");
  });

  it("returns null for a session that is not a ball purchase", () => {
    expect(bookingFromSession({ id: "cs_1", metadata: { mode: "once" } })).toBeNull();
  });

  it("falls back to the session customer_email when details are absent", () => {
    const md = ballMetadata(purchase, "BALL-XYZ789", 10);
    const booking = bookingFromSession({ id: "cs_2", metadata: md, customer_email: "alt@example.com" });
    expect(booking!.buyerEmail).toBe("alt@example.com");
  });
});
