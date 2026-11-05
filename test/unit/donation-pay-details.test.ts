import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// How a gift was paid (Donations gift log, Task 2), read from Stripe after the gift is saved. DB-free:
// the database and Stripe are stand-ins handed in, and every id below is invented. What is proved:
//   - only the payment method's type, a card's brand, last four, country and wallet are ever kept;
//   - the charge is found by the charge id, then the payment intent, then the checkout session (and a
//     monthly gift's first invoice), then an invoice named by the webhook;
//   - it is written once, stamped as checked even when Stripe has nothing, and it never throws.

vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/test", STRIPE_SECRET_KEY: "sk_test_placeholder" },
}));
vi.mock("../../src/db/pool", () => ({ pool: { connect: vi.fn() } }));

import { payDetailsFromCharge } from "../../src/donations/pay-details";
import { fillPayDetails, recordPayDetails, payDetailsLater, PAY_DETAILS_ROW_SQL, WRITE_PAY_DETAILS_SQL } from "../../src/db/donation-pay-details";
import { stripeIsOfflineStub } from "../../src/clients/stripe";

const charge = (details: Record<string, unknown> | null): Stripe.Charge =>
  ({ id: "ch_test_1", object: "charge", payment_method_details: details }) as unknown as Stripe.Charge;

const visa = { brand: "visa", last4: "4242", country: "GB", wallet: null };

describe("payDetailsFromCharge", () => {
  it("reads a card's brand, last four digits and country", () => {
    expect(payDetailsFromCharge(charge({ type: "card", card: visa }))).toEqual({
      method: "card",
      wallet: null,
      brand: "visa",
      last4: "4242",
      country: "GB",
    });
  });

  it("names Apple Pay", () => {
    const d = payDetailsFromCharge(charge({ type: "card", card: { ...visa, wallet: { type: "apple_pay", apple_pay: {}, dynamic_last4: "9999" } } }));
    expect(d).toEqual({ method: "card", wallet: "apple_pay", brand: "visa", last4: "4242", country: "GB" });
  });

  it("names Google Pay", () => {
    const d = payDetailsFromCharge(charge({ type: "card", card: { brand: "mastercard", last4: "4444", country: "IE", wallet: { type: "google_pay" } } }));
    expect(d).toEqual({ method: "card", wallet: "google_pay", brand: "mastercard", last4: "4444", country: "IE" });
  });

  it("calls any other card wallet other", () => {
    expect(payDetailsFromCharge(charge({ type: "card", card: { ...visa, wallet: { type: "masterpass" } } }))?.wallet).toBe("other");
  });

  it("keeps nothing but the method for a Direct Debit, not even the bank account's digits", () => {
    expect(
      payDetailsFromCharge(charge({ type: "bacs_debit", bacs_debit: { last4: "2345", sort_code: "108800", fingerprint: "fp_test" } })),
    ).toEqual({ method: "bacs_debit", wallet: null, brand: null, last4: null, country: null });
  });

  it("reads a card reader's tap, with its wallet", () => {
    expect(payDetailsFromCharge(charge({ type: "card_present", card_present: { brand: "amex", last4: "0005", country: "US", wallet: null } }))).toEqual({
      method: "card_present",
      wallet: null,
      brand: "amex",
      last4: "0005",
      country: "US",
    });
    expect(
      payDetailsFromCharge(charge({ type: "card_present", card_present: { brand: "visa", last4: "4242", country: "GB", wallet: { type: "apple_pay" } } }))?.wallet,
    ).toBe("apple_pay");
  });

  it("names Link, and calls anything else other", () => {
    expect(payDetailsFromCharge(charge({ type: "link", link: { country: "GB" } }))).toEqual({
      method: "other",
      wallet: "link",
      brand: null,
      last4: null,
      country: null,
    });
    expect(payDetailsFromCharge(charge({ type: "paypal", paypal: {} }))).toEqual({ method: "other", wallet: null, brand: null, last4: null, country: null });
  });

  it("keeps no value that is not the shape it should be", () => {
    const d = payDetailsFromCharge(charge({ type: "card", card: { brand: "x".repeat(80), last4: "4242 4242", country: "Great Britain", wallet: { type: 7 } } }));
    expect(d).toEqual({ method: "card", wallet: null, brand: null, last4: null, country: null });
  });

  it("is null when there is no charge or nothing about its payment method", () => {
    expect(payDetailsFromCharge(null)).toBeNull();
    expect(payDetailsFromCharge(charge(null))).toBeNull();
    expect(payDetailsFromCharge(charge({}))).toBeNull();
  });
});

// ---- fillPayDetails ------------------------------------------------------------------------------

type Row = { stripe_charge_id: string | null; stripe_payment_intent_id: string | null; stripe_session_id: string | null; pay_method: string | null };
const ROW: Row = { stripe_charge_id: null, stripe_payment_intent_id: null, stripe_session_id: null, pay_method: null };

function fakeDb(row: Row | null) {
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    void params;
    if (sql === PAY_DETAILS_ROW_SQL) return { rows: row ? [row] : [] };
    return { rows: [], rowCount: 1 };
  });
  const writes = () => query.mock.calls.filter(([sql]) => sql === WRITE_PAY_DETAILS_SQL).map(([, p]) => p);
  return { query, writes };
}

const visaCharge = charge({ type: "card", card: { ...visa, wallet: { type: "apple_pay" } } });

function fakeStripe(over: Record<string, unknown> = {}) {
  return {
    charges: { retrieve: vi.fn(async () => visaCharge) },
    paymentIntents: { retrieve: vi.fn(async () => ({ id: "pi_test_1", latest_charge: visaCharge })) },
    checkout: { sessions: { retrieve: vi.fn(async () => ({ id: "cs_test_1", payment_intent: { id: "pi_test_1", latest_charge: visaCharge }, invoice: null })) } },
    invoicePayments: { list: vi.fn(async () => ({ data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_test_inv" } }] })) },
    ...over,
  };
}

const APPLE = ["donation", "card", "apple_pay", "visa", "4242", "GB"];
const withId = (id: number, p: unknown[]) => [id, ...p.slice(1)];

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorLog.mockRestore();
});

describe("the statements", () => {
  it("reads only the Stripe ids and whether it is noted already", () => {
    expect(PAY_DETAILS_ROW_SQL.replace(/\s+/g, " ").trim()).toBe(
      "SELECT stripe_charge_id, stripe_payment_intent_id, stripe_session_id, pay_method FROM donations WHERE id = $1",
    );
  });
  it("writes the five details and the time it asked, only where nothing is noted yet", () => {
    expect(WRITE_PAY_DETAILS_SQL.replace(/\s+/g, " ").trim()).toBe(
      "UPDATE donations SET pay_method = $2, pay_wallet = $3, card_brand = $4, card_last4 = $5, card_country = $6, pay_checked_at = now() " +
        "WHERE id = $1 AND pay_method IS NULL",
    );
  });
});

describe("fillPayDetails", () => {
  it("finds the charge by its id first", async () => {
    const db = fakeDb({ ...ROW, stripe_charge_id: "ch_test_1", stripe_payment_intent_id: "pi_test_1", stripe_session_id: "cs_test_1" });
    const s = fakeStripe();
    const d = await fillPayDetails(41, {}, { query: db.query, stripe: s as never });
    expect(d).toEqual({ method: "card", wallet: "apple_pay", brand: "visa", last4: "4242", country: "GB" });
    expect(s.charges.retrieve).toHaveBeenCalledWith("ch_test_1");
    expect(s.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(s.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith(PAY_DETAILS_ROW_SQL, [41]);
    expect(db.writes()).toEqual([withId(41, APPLE)]);
  });

  it("then by the payment intent, with its latest charge", async () => {
    const db = fakeDb({ ...ROW, stripe_payment_intent_id: "pi_test_1", stripe_session_id: "cs_test_1" });
    const s = fakeStripe();
    await fillPayDetails(42, {}, { query: db.query, stripe: s as never });
    expect(s.paymentIntents.retrieve).toHaveBeenCalledWith("pi_test_1", { expand: ["latest_charge"] });
    expect(s.charges.retrieve).not.toHaveBeenCalled();
    expect(s.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(db.writes()).toEqual([withId(42, APPLE)]);
  });

  it("then by the checkout session", async () => {
    const db = fakeDb({ ...ROW, stripe_session_id: "cs_test_1" });
    const s = fakeStripe();
    await fillPayDetails(43, {}, { query: db.query, stripe: s as never });
    expect(s.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_test_1", { expand: ["payment_intent.latest_charge"] });
    expect(db.writes()).toEqual([withId(43, APPLE)]);
  });

  it("finds a monthly gift's first payment through its checkout session's invoice", async () => {
    const db = fakeDb({ ...ROW, stripe_session_id: "cs_test_monthly" });
    const s = fakeStripe({
      checkout: { sessions: { retrieve: vi.fn(async () => ({ id: "cs_test_monthly", payment_intent: null, invoice: "in_test_first" })) } },
    });
    await fillPayDetails(44, {}, { query: db.query, stripe: s as never });
    expect(s.invoicePayments.list).toHaveBeenCalledWith({ invoice: "in_test_first", status: "paid", limit: 1 });
    expect(s.paymentIntents.retrieve).toHaveBeenCalledWith("pi_test_inv", { expand: ["latest_charge"] });
    expect(db.writes()).toEqual([withId(44, APPLE)]);
  });

  it("finds a renewal through the invoice the webhook names, when the row has no Stripe ids of its own", async () => {
    const db = fakeDb(ROW);
    const s = fakeStripe({
      invoicePayments: { list: vi.fn(async () => ({ data: [{ status: "paid", payment: { type: "charge", charge: "ch_test_inv" } }] })) },
    });
    await fillPayDetails(45, { invoiceId: "in_test_renewal" }, { query: db.query, stripe: s as never });
    expect(s.invoicePayments.list).toHaveBeenCalledWith({ invoice: "in_test_renewal", status: "paid", limit: 1 });
    expect(s.charges.retrieve).toHaveBeenCalledWith("ch_test_inv");
    expect(db.writes()).toEqual([withId(45, APPLE)]);
  });

  it("stamps a gift as checked when Stripe has nothing, so it is not asked again", async () => {
    const db = fakeDb({ ...ROW, stripe_payment_intent_id: "pi_test_1" });
    const s = fakeStripe({ paymentIntents: { retrieve: vi.fn(async () => ({ id: "pi_test_1", latest_charge: null })) } });
    expect(await fillPayDetails(46, {}, { query: db.query, stripe: s as never })).toBeNull();
    expect(db.writes()).toEqual([[46, null, null, null, null, null]]);
  });

  it("stamps a gift with no Stripe ids at all as checked, without asking Stripe", async () => {
    const db = fakeDb(ROW);
    const s = fakeStripe();
    expect(await fillPayDetails(47, {}, { query: db.query, stripe: s as never })).toBeNull();
    expect(s.charges.retrieve).not.toHaveBeenCalled();
    expect(s.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(s.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(db.writes()).toEqual([[47, null, null, null, null, null]]);
  });

  it("stamps as checked when Stripe says the payment is not there", async () => {
    const db = fakeDb({ ...ROW, stripe_charge_id: "ch_test_gone" });
    const missing = Object.assign(new Error("No such charge"), { type: "StripeInvalidRequestError", statusCode: 404, code: "resource_missing" });
    const s = fakeStripe({ charges: { retrieve: vi.fn(async () => Promise.reject(missing)) } });
    expect(await fillPayDetails(48, {}, { query: db.query, stripe: s as never })).toBeNull();
    expect(db.writes()).toEqual([[48, null, null, null, null, null]]);
  });

  it("leaves a gift whose payment method is already noted, without asking Stripe", async () => {
    const db = fakeDb({ ...ROW, stripe_charge_id: "ch_test_1", pay_method: "bank_transfer" });
    const s = fakeStripe();
    expect(await fillPayDetails(49, {}, { query: db.query, stripe: s as never })).toBeNull();
    expect(s.charges.retrieve).not.toHaveBeenCalled();
    expect(db.writes()).toEqual([]);
  });

  it("does nothing for a donation that is not there", async () => {
    const db = fakeDb(null);
    expect(await fillPayDetails(50, {}, { query: db.query, stripe: fakeStripe() as never })).toBeNull();
    expect(db.writes()).toEqual([]);
  });

  it("never throws: Stripe down leaves it unchecked, to be asked again later, and says so without details", async () => {
    const db = fakeDb({ ...ROW, stripe_charge_id: "ch_test_1" });
    const down = Object.assign(new Error("connection reset for ch_test_1"), { type: "StripeConnectionError" });
    const s = fakeStripe({ charges: { retrieve: vi.fn(async () => Promise.reject(down)) } });
    await expect(fillPayDetails(51, {}, { query: db.query, stripe: s as never })).resolves.toBeNull();
    expect(db.writes()).toEqual([]);
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog.mock.calls[0].join(" ")).toContain("donation 51");
    expect(errorLog.mock.calls[0].join(" ")).toContain("StripeConnectionError");
    expect(errorLog.mock.calls[0].join(" ")).not.toContain("ch_test_1");
  });

  it("never throws when the database fails", async () => {
    const query = vi.fn(async () => Promise.reject(Object.assign(new Error("relation is gone"), { code: "42P01" })));
    await expect(fillPayDetails(52, {}, { query, stripe: fakeStripe() as never })).resolves.toBeNull();
    expect(errorLog.mock.calls[0].join(" ")).toContain("42P01");
  });

  it("asks nothing, writes nothing and says nothing with the offline Stripe stand-in used outside production", async () => {
    expect(stripeIsOfflineStub).toBe(true);
    const db = fakeDb({ ...ROW, stripe_charge_id: "ch_test_1", stripe_payment_intent_id: "pi_test_1", stripe_session_id: "cs_test_1" });
    expect(await fillPayDetails(53, {}, { query: db.query })).toBeNull();
    const db2 = fakeDb({ ...ROW, stripe_session_id: "cs_test_1" });
    expect(await fillPayDetails(54, { invoiceId: "in_test_1" }, { query: db2.query })).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
    expect(db2.query).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });
});

describe("payDetailsLater", () => {
  const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

  it("starts nothing in line: the caller carries straight on, and the card reader's charge is written after", async () => {
    const db = fakeDb(ROW);
    const tap = charge({ type: "card_present", card_present: { brand: "visa", last4: "4242", country: "GB", wallet: null } });
    expect(payDetailsLater(62, { charge: tap }, { query: db.query })).toBeUndefined();
    expect(db.query).not.toHaveBeenCalled();
    await nextTurn();
    await nextTurn();
    expect(db.writes()).toEqual([[62, "card_present", null, "visa", "4242", "GB"]]);
  });

  it("asks Stripe for a gift without its charge in hand, naming the invoice it was given", async () => {
    const db = fakeDb(ROW);
    const s = fakeStripe();
    payDetailsLater(63, { invoiceId: "in_test_renewal" }, { query: db.query, stripe: s as never });
    expect(s.invoicePayments.list).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i++) await nextTurn();
    expect(s.invoicePayments.list).toHaveBeenCalledWith({ invoice: "in_test_renewal", status: "paid", limit: 1 });
    expect(db.writes()).toEqual([withId(63, APPLE)]);
  });

  it("never throws later either", async () => {
    const query = vi.fn(async () => Promise.reject(new Error("down")));
    payDetailsLater(64, {}, { query, stripe: fakeStripe() as never });
    for (let i = 0; i < 3; i++) await nextTurn();
    expect(errorLog).toHaveBeenCalled();
  });
});

describe("recordPayDetails", () => {
  it("writes details already in hand (a card reader's charge) without asking Stripe", async () => {
    const db = fakeDb(ROW);
    const ok = await recordPayDetails(60, { method: "card_present", wallet: null, brand: "visa", last4: "4242", country: "GB" }, { query: db.query });
    expect(ok).toBe(true);
    expect(db.writes()).toEqual([[60, "card_present", null, "visa", "4242", "GB"]]);
  });

  it("never throws", async () => {
    const query = vi.fn(async () => Promise.reject(new Error("down")));
    await expect(recordPayDetails(61, null, { query })).resolves.toBe(false);
  });
});
