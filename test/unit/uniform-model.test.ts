import { describe, it, expect } from "vitest";
import { isUniformSession, uniformPaymentFromSession, UNIFORM_SOURCE } from "../../src/uniform/model";

// Uniform payments (TASK-604): school uniforms bought through a Stripe payment link marked
// product = uniform. A purchase, never a gift. These are the pure rules that read one off a Stripe
// checkout session. Every name and address here is invented.

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = (over: Record<string, unknown> = {}): any => ({
  id: "cs_test_uniform_1",
  object: "checkout.session",
  metadata: { product: "uniform" },
  payment_status: "paid",
  status: "complete",
  amount_total: 4000,
  currency: "gbp",
  payment_intent: "pi_test_uniform_1",
  payment_link: "plink_test_uniform",
  customer_details: { name: "Robin Testperson", email: "robin.uniform@example.com" },
  custom_fields: [],
  ...over,
});

describe("isUniformSession", () => {
  it("is true for product = uniform, however it was typed", () => {
    expect(isUniformSession({ product: "uniform" })).toBe(true);
    expect(isUniformSession({ product: " Uniform " })).toBe(true);
  });

  it("is false for every other session", () => {
    expect(isUniformSession({ product: "ball" })).toBe(false);
    expect(isUniformSession({ product: "event_tickets" })).toBe(false);
    expect(isUniformSession({})).toBe(false);
    expect(isUniformSession(null)).toBe(false);
    expect(isUniformSession(undefined)).toBe(false);
  });
});

describe("uniformPaymentFromSession", () => {
  it("is null for a session that is not a uniform's", () => {
    expect(uniformPaymentFromSession(session({ metadata: { product: "ball" } }))).toBeNull();
    expect(uniformPaymentFromSession(session({ metadata: {} }))).toBeNull();
  });

  it("reads the payment: its session, payment, link, amount, currency, buyer and whether it is paid", () => {
    expect(uniformPaymentFromSession(session())).toEqual({
      sessionId: "cs_test_uniform_1",
      paymentIntentId: "pi_test_uniform_1",
      paymentLinkId: "plink_test_uniform",
      amountPence: 4000,
      currency: "GBP",
      buyerName: "Robin Testperson",
      buyerEmail: "robin.uniform@example.com",
      details: [],
      paid: true,
    });
  });

  it("says when the money has not come in yet", () => {
    expect(uniformPaymentFromSession(session({ payment_status: "unpaid" }))?.paid).toBe(false);
  });

  it("takes ids from expanded objects too, and leaves out what is missing", () => {
    const w = uniformPaymentFromSession(
      session({ payment_intent: { id: "pi_test_x" }, payment_link: null, customer_details: null, amount_total: null, currency: null }),
    );
    expect(w).toMatchObject({ paymentIntentId: "pi_test_x", paymentLinkId: null, buyerName: null, buyerEmail: null, amountPence: 0, currency: "GBP" });
  });

  it("keeps what the buyer filled in on the payment link, worded as the link asked it", () => {
    const w = uniformPaymentFromSession(
      session({
        custom_fields: [
          { key: "childname", label: { type: "custom", custom: "Child's name" }, type: "text", text: { value: "Sam" } },
          {
            key: "size",
            label: { type: "custom", custom: "Size" },
            type: "dropdown",
            dropdown: { value: "age78", options: [{ label: "Age 7 to 8", value: "age78" }] },
          },
          { key: "howmany", label: { type: "custom", custom: "How many" }, type: "numeric", numeric: { value: "2" } },
          { key: "blank", label: { type: "custom", custom: "Left empty" }, type: "text", text: { value: null } },
        ],
      }),
    );
    expect(w?.details).toEqual([
      { label: "Child's name", value: "Sam" },
      { label: "Size", value: "Age 7 to 8" },
      { label: "How many", value: "2" },
    ]);
  });

  it("names its source in one place", () => {
    expect(UNIFORM_SOURCE).toBe("uniform");
  });
});
