import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

// How a gift was paid (Donations gift log, Task 2): the webhook asks for it after its commit, without
// waiting, for every gift it has just recorded. DB-free: the pool, the email client and the look up
// itself (src/db/donation-pay-details.ts, proved in donation-pay-details.test.ts) are stand-ins.
// Invented ids throughout. What is proved here:
//   - a one off checkout, a monthly gift's first checkout, a renewal and a card reader tap each ask
//     once, after COMMIT, for the donation just recorded (a renewal names its invoice, a card reader
//     tap hands over its charge);
//   - nothing is asked for an event that recorded no gift, a redelivery or a failed transaction;
//   - the gift is saved by exactly the same statements as before.

const { queryMock, mockClient, connect, order, payDetailsLater } = vi.hoisted(() => {
  const order: string[] = [];
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  const payDetailsLater = vi.fn(() => void order.push("payDetails"));
  return { queryMock, mockClient, connect, order, payDetailsLater };
});

vi.mock("../../src/db/pool", () => ({ pool: { connect } }));
vi.mock("../../src/db/donation-pay-details", () => ({ payDetailsLater }));
vi.mock("../../src/clients/email", () => ({
  sendDonationConfirmation: vi.fn(async () => void order.push("email")),
  sendDeclarationEmail: vi.fn(),
  sendCompanyReceipt: vi.fn(),
}));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    DECLARATION_FORM_BASE_URL: "https://nbcc.test",
  },
}));

import { processWebhookEvent } from "../../src/db/stripe-webhook";

const DONATION_ID = 99;
let claimed: Set<string>;
let failInsert: boolean;

function installQuery() {
  claimed = new Set();
  failInsert = false;
  queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/^\s*commit/i.test(sql)) order.push("commit");
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/insert into stripe_webhook_events/i.test(sql)) {
      const id = String(params?.[0]);
      if (claimed.has(id)) return { rowCount: 0, rows: [] };
      claimed.add(id);
      return { rowCount: 1, rows: [] };
    }
    if (/insert into donors/i.test(sql)) return { rows: [{ id: 10 }], rowCount: 1 };
    if (/insert into donations/i.test(sql)) {
      if (failInsert) throw new Error("insert failed");
      return { rows: [{ id: DONATION_ID }], rowCount: 1 };
    }
    if (/select 1 from donations where stripe_payment_intent_id/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/^\s*select[\s\S]*from donations/i.test(sql)) {
      return {
        rows: [{ donor_id: 10, gift_aid: false, declaration_id: null, plan: null, donor_type: "individual", full_name: "Sam Example", email: "sam@example.com", email_consent: false }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
}

const checkout = (over: Record<string, unknown> = {}, metadata: Record<string, string> = {}): Stripe.Event =>
  ({
    id: "evt_test_pay",
    type: "checkout.session.completed",
    created: 1791000000,
    data: {
      object: {
        id: "cs_test_pay",
        object: "checkout.session",
        created: 1791000000,
        amount_total: 1000,
        currency: "gbp",
        mode: "payment",
        payment_status: "paid",
        payment_intent: "pi_test_pay",
        subscription: null,
        customer_details: { name: "Sam Example", email: "sam@example.com" },
        metadata: { mode: "once", plan: "", giftAid: "false", donorType: "individual", fullName: "Sam Example", email: "sam@example.com", ...metadata },
        ...over,
      },
    },
  }) as unknown as Stripe.Event;

const renewal = (): Stripe.Event =>
  ({
    id: "evt_test_pay_renewal",
    type: "invoice.paid",
    created: 1793600000,
    data: {
      object: {
        id: "in_test_renewal",
        object: "invoice",
        amount_paid: 1000,
        currency: "gbp",
        parent: { subscription_details: { subscription: "sub_test_pay" } },
        billing_reason: "subscription_cycle",
      },
    },
  }) as unknown as Stripe.Event;

const cardCharge = (type: string): Stripe.Event =>
  ({
    id: "evt_test_pay_charge",
    type: "charge.succeeded",
    data: {
      object: {
        id: "ch_test_reader",
        object: "charge",
        amount: 500,
        currency: "gbp",
        payment_intent: "pi_test_reader",
        payment_method_details: { type, card_present: { brand: "visa", last4: "4242", country: "GB", wallet: null } },
      },
    },
  }) as unknown as Stripe.Event;

beforeEach(() => {
  queryMock.mockReset();
  mockClient.release.mockClear();
  payDetailsLater.mockClear();
  order.length = 0;
  installQuery();
});

describe("the webhook asks how a just recorded gift was paid", () => {
  it("for a one off checkout, once, after the commit and the thank you", async () => {
    const result = await processWebhookEvent(checkout());
    expect(result).toEqual({ processed: true, action: "donation.created" });
    expect(payDetailsLater.mock.calls).toEqual([[DONATION_ID, {}]]);
    expect(order).toEqual(["commit", "email", "payDetails"]);
  });

  it("for a monthly gift's first checkout", async () => {
    await processWebhookEvent(
      checkout({ mode: "subscription", payment_intent: null, subscription: "sub_test_pay", invoice: "in_test_first" }, { mode: "monthly", plan: "silver" }),
    );
    expect(payDetailsLater.mock.calls).toEqual([[DONATION_ID, {}]]);
  });

  it("for a renewal, naming its invoice", async () => {
    const result = await processWebhookEvent(renewal());
    expect(result.action).toBe("donation.recurring");
    expect(payDetailsLater.mock.calls).toEqual([[DONATION_ID, { invoiceId: "in_test_renewal" }]]);
    expect(order.indexOf("commit")).toBeLessThan(order.indexOf("payDetails"));
  });

  it("for a card reader tap, handing over the charge in the event", async () => {
    const event = cardCharge("card_present");
    const result = await processWebhookEvent(event);
    expect(result.action).toBe("donation.created");
    expect(payDetailsLater.mock.calls).toEqual([[DONATION_ID, { charge: event.data.object }]]);
    expect(order.indexOf("commit")).toBeLessThan(order.indexOf("payDetails"));
  });
});

describe("the webhook asks nothing", () => {
  it("for an online card charge, which records no gift of its own", async () => {
    await processWebhookEvent(cardCharge("card"));
    expect(payDetailsLater).not.toHaveBeenCalled();
  });

  it("for a redelivered event", async () => {
    await processWebhookEvent(checkout());
    payDetailsLater.mockClear();
    const again = await processWebhookEvent(checkout());
    expect(again.action).toBe("duplicate");
    expect(payDetailsLater).not.toHaveBeenCalled();
  });

  it("when the gift's transaction failed", async () => {
    failInsert = true;
    await expect(processWebhookEvent(checkout())).rejects.toThrow("insert failed");
    expect(payDetailsLater).not.toHaveBeenCalled();
  });

  it("for an event that is not a gift", async () => {
    const result = await processWebhookEvent({ id: "evt_test_other", type: "customer.created", data: { object: {} } } as unknown as Stripe.Event);
    expect(result.action).toBe("ignored");
    expect(payDetailsLater).not.toHaveBeenCalled();
  });
});

describe("the gift itself", () => {
  it("is saved by the same statements whatever happens to the look up", async () => {
    await processWebhookEvent(checkout());
    const before = queryMock.mock.calls.map((c) => [String(c[0]), c[1]]);
    queryMock.mockClear();
    installQuery();
    payDetailsLater.mockImplementationOnce(() => {
      throw new Error("could not even start");
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await processWebhookEvent(checkout());
    expect(result).toEqual({ processed: true, action: "donation.created" });
    expect(errorLog).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
    expect(queryMock.mock.calls.map((c) => [String(c[0]), c[1]])).toEqual(before);
  });
});
