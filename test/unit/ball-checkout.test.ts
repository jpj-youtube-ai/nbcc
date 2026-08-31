import { describe, it, expect } from "vitest";
import { purchaseSchema } from "../../src/ball/booking";
import { buildBallSessionParams, SESSION_TTL_MS } from "../../src/ball/checkout";

const BASE = "https://nbcc.scot";
const NOW = new Date("2026-09-04T09:00:00Z");

const seat = purchaseSchema.parse({
  kind: "seat",
  quantity: 2,
  buyerName: "Jo Smith",
  buyerEmail: "jo@example.com",
});

const tableWithExtras = purchaseSchema.parse({
  kind: "table",
  quantity: 1,
  buyerName: "Ayrshire Bakery",
  buyerEmail: "orders@example.com",
  donationPence: 5_000,
  coverFee: true,
  giftAid: true,
  newsletterOptIn: true,
});

describe("buildBallSessionParams", () => {
  it("is a one-off payment in sterling, not a subscription", () => {
    const p = buildBallSessionParams({ purchase: seat, reference: "BALL-ABC234", seats: 2, baseUrl: BASE, now: NOW });
    expect(p.mode).toBe("payment");
    expect(p.line_items!.every((li) => li.price_data!.currency === "gbp")).toBe(true);
  });

  it("charges two seats as a single £200 line", () => {
    const p = buildBallSessionParams({ purchase: seat, reference: "BALL-ABC234", seats: 2, baseUrl: BASE, now: NOW });
    expect(p.line_items).toHaveLength(1);
    expect(p.line_items![0].quantity).toBe(2);
    expect(p.line_items![0].price_data!.unit_amount).toBe(10_000);
  });

  it("breaks a donation and a fee cover into their own visible lines", () => {
    const p = buildBallSessionParams({
      purchase: tableWithExtras, reference: "BALL-XYZ789", seats: 10, baseUrl: BASE, now: NOW,
    });
    expect(p.line_items).toHaveLength(3);
    const names = p.line_items!.map((li) => li.price_data!.product_data!.name);
    expect(names[0]).toMatch(/table/i);
    expect(names[1]).toMatch(/donation/i);
    expect(names[2]).toMatch(/fee/i);
  });

  it("the lines add up to exactly what the pricing model says", () => {
    const p = buildBallSessionParams({
      purchase: tableWithExtras, reference: "BALL-XYZ789", seats: 10, baseUrl: BASE, now: NOW,
    });
    const sum = p.line_items!.reduce(
      (t, li) => t + li.price_data!.unit_amount! * (li.quantity ?? 1), 0,
    );
    // £1,000 table + £50 donation = £1,050. The fee cover is calculated on the TICKETS
    // ONLY at the 1.2% + 20p charity rate: ceil(100000*120/10000) = 1200, +20 = 1220. The
    // donation is deliberately excluded — NBCC does not surcharge a gift (TASK-317).
    expect(sum).toBe(100_000 + 5_000 + 1_220);
  });

  // TASK-317 near-miss. The line items are priced from the live rate in ball_settings, but
  // the metadata was still stamped from the compiled-in default. The webhook writes the
  // booking row from that METADATA, so the moment anyone edited the rate in admin, Stripe
  // would have charged one amount and the database recorded another — and only the database
  // figure is ever seen again.
  it("prices the line items and the metadata from the SAME rate", () => {
    const rate = { percentBp: 250, fixedPence: 45 };
    const p = buildBallSessionParams({
      purchase: tableWithExtras, reference: "BALL-XYZ789", seats: 10, baseUrl: BASE, now: NOW,
      cardFee: rate,
    });
    const sum = p.line_items!.reduce(
      (t, li) => t + li.price_data!.unit_amount! * (li.quantity ?? 1), 0,
    );
    expect(p.metadata!.totalPence).toBe(String(sum));

    // And the fee line itself is the non-default rate, not the 1.2% default.
    const feeLine = p.line_items!.find((li) => /fee/i.test(li.price_data!.product_data!.name!));
    expect(feeLine!.price_data!.unit_amount).toBe(2_545);
    expect(p.metadata!.feeCoverPence).toBe("2545");
  });

  it("stamps the metadata the webhook reads back", () => {
    const p = buildBallSessionParams({
      purchase: tableWithExtras, reference: "BALL-XYZ789", seats: 10, baseUrl: BASE, now: NOW,
    });
    expect(p.metadata!.product).toBe("ball");
    expect(p.metadata!.reference).toBe("BALL-XYZ789");
    expect(p.metadata!.seats).toBe("10");
    expect(p.metadata!.giftAid).toBe("true");
  });

  it("expires in 30 minutes so abandoned seats come back", () => {
    const p = buildBallSessionParams({ purchase: seat, reference: "BALL-ABC234", seats: 2, baseUrl: BASE, now: NOW });
    expect(SESSION_TTL_MS).toBe(30 * 60 * 1000);
    expect(p.expires_at).toBe(Math.floor((NOW.getTime() + SESSION_TTL_MS) / 1000));
  });

  it("pre-fills the buyer's email so they never retype it", () => {
    const p = buildBallSessionParams({ purchase: seat, reference: "BALL-ABC234", seats: 2, baseUrl: BASE, now: NOW });
    expect(p.customer_email).toBe("jo@example.com");
  });

  it("returns the buyer to the ball thank-you page, carrying the session id", () => {
    const p = buildBallSessionParams({ purchase: seat, reference: "BALL-ABC234", seats: 2, baseUrl: BASE, now: NOW });
    expect(p.success_url).toBe("https://nbcc.scot/ball/thank-you?session_id={CHECKOUT_SESSION_ID}");
    expect(p.cancel_url).toBe("https://nbcc.scot/ball");
  });

  it("uses Stripe's embedded UI when asked, with a return_url instead", () => {
    const embedded = purchaseSchema.parse({ ...seat, uiMode: "embedded" });
    const p = buildBallSessionParams({
      purchase: embedded, reference: "BALL-ABC234", seats: 2, baseUrl: BASE, now: NOW, embedded: true,
    });
    expect(p.ui_mode).toBe("embedded_page");
    expect(p.return_url).toBe("https://nbcc.scot/ball/thank-you?session_id={CHECKOUT_SESSION_ID}");
    expect(p.success_url).toBeUndefined();
  });

  it("falls back to the hosted redirect when no publishable key is configured", () => {
    const embedded = purchaseSchema.parse({ ...seat, uiMode: "embedded" });
    const p = buildBallSessionParams({
      purchase: embedded, reference: "BALL-ABC234", seats: 2, baseUrl: BASE, now: NOW, embedded: false,
    });
    expect(p.ui_mode).toBeUndefined();
    expect(p.success_url).toBeTruthy();
  });

  it("tolerates a base URL with a trailing slash", () => {
    const p = buildBallSessionParams({
      purchase: seat, reference: "BALL-ABC234", seats: 2, baseUrl: "https://nbcc.scot/", now: NOW,
    });
    expect(p.cancel_url).toBe("https://nbcc.scot/ball");
  });
});
