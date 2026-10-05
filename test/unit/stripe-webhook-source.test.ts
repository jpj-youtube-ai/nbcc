import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Stripe from "stripe";

// Recording where a gift was started (Fill a Red Bag). DB-free: the pool and the email client are
// mocked, as in stripe-webhook-bacs.test.ts. What is proved here:
//   - the donation is saved by exactly the same statements, with exactly the same values, whether
//     or not the session carries the Red Bag mark;
//   - the mark is written by ONE separate statement, after COMMIT and after the thank you email;
//   - whatever goes wrong writing it, the webhook answers as it would have and nothing is thrown.

const { queryMock, mockClient, connect, order } = vi.hoisted(() => {
  const order: string[] = [];
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, mockClient, connect, order };
});

vi.mock("../../src/db/pool", () => ({ pool: { connect } }));

const { sendDonationConfirmation } = vi.hoisted(() => ({ sendDonationConfirmation: vi.fn() }));
vi.mock("../../src/clients/email", () => ({
  sendDonationConfirmation,
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

import {
  processWebhookEvent,
  tagDonationSource,
  TAG_CHECKOUT_SOURCE_SQL,
  TAG_RENEWAL_SOURCE_SQL,
} from "../../src/db/stripe-webhook";

const DONOR_ID = 10;
const DONATION_ID = 99;
const SESSION_ID = "cs_test_redbag";
const SUB_ID = "sub_test_redbag";

const isTag = (sql: string): boolean => /update donations\s+set source/i.test(sql);

let claimed: Set<string>;
let parentRow: Record<string, unknown> | undefined;
let failOn: RegExp | null;
let tagError: Error | null;

function installQuery() {
  claimed = new Set();
  failOn = null;
  tagError = null;
  parentRow = {
    donor_id: DONOR_ID,
    gift_aid: false,
    declaration_id: null,
    plan: null,
    donor_type: "individual",
    full_name: "Robin Example",
    email: "robin@example.com",
    email_consent: false,
  };
  queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/^\s*commit/i.test(sql)) order.push("commit");
    if (isTag(sql)) {
      order.push("tag");
      if (tagError) throw tagError;
      return { rowCount: 1, rows: [] };
    }
    if (failOn && failOn.test(sql)) throw new Error("the database fell over");
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/insert into stripe_webhook_events/i.test(sql)) {
      const id = String(params?.[0]);
      if (claimed.has(id)) return { rowCount: 0, rows: [] }; // redelivery
      claimed.add(id);
      return { rowCount: 1, rows: [] };
    }
    if (/insert into donors/i.test(sql)) return { rows: [{ id: DONOR_ID }], rowCount: 1 };
    if (/insert into donations/i.test(sql)) return { rows: [{ id: DONATION_ID }], rowCount: 1 };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/select 1 from donations where stripe_payment_intent_id/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/^\s*select[\s\S]*from donations/i.test(sql)) return { rows: parentRow ? [parentRow] : [], rowCount: parentRow ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  });
}

type Call = [string, unknown[] | undefined];
const calls = (): Call[] => queryMock.mock.calls.map((c) => [String(c[0]), c[1] as unknown[] | undefined]);
const tagCalls = (): Call[] => calls().filter(([sql]) => isTag(sql));
const untagged = (): Call[] => calls().filter(([sql]) => !isTag(sql));

const checkout = (metadata: Record<string, string>, over: Record<string, unknown> = {}): Stripe.Event =>
  ({
    id: "evt_test_redbag",
    type: "checkout.session.completed",
    created: 1791000000,
    data: {
      object: {
        id: SESSION_ID,
        object: "checkout.session",
        created: 1791000000,
        amount_total: 5410,
        currency: "gbp",
        mode: "payment",
        payment_status: "paid",
        payment_intent: "pi_test_redbag",
        subscription: null,
        customer_details: { name: "Robin Example", email: "robin@example.com" },
        metadata: {
          mode: "once",
          plan: "",
          giftAid: "false",
          donorType: "individual",
          fullName: "Robin Example",
          email: "robin@example.com",
          ...metadata,
        },
        ...over,
      },
    },
  }) as unknown as Stripe.Event;

const renewal = (over: Record<string, unknown> = {}, type = "invoice.paid", id = "evt_test_renewal"): Stripe.Event =>
  ({
    id,
    type,
    created: 1793600000,
    data: {
      object: {
        id: "in_test_redbag",
        object: "invoice",
        amount_paid: 1000,
        currency: "gbp",
        subscription: SUB_ID,
        payment_intent: "pi_test_renewal",
        charge: "ch_test_renewal",
        billing_reason: "subscription_cycle",
        ...over,
      },
    },
  }) as unknown as Stripe.Event;

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  queryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  sendDonationConfirmation.mockReset();
  sendDonationConfirmation.mockImplementation(async () => {
    order.push("email");
  });
  order.length = 0;
  installQuery();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorLog.mockRestore();
});

describe("the statements that record the source", () => {
  it("tag a checkout's donation by its session id, and only one with no source yet", () => {
    expect(TAG_CHECKOUT_SOURCE_SQL.replace(/\s+/g, " ").trim()).toBe(
      "UPDATE donations SET source = $2 WHERE stripe_session_id = $1 AND source IS NULL",
    );
  });

  it("tag a subscription's untagged donations only when its first donation has that source", () => {
    expect(TAG_RENEWAL_SOURCE_SQL.replace(/\s+/g, " ").trim()).toBe(
      "UPDATE donations SET source = $2 WHERE stripe_subscription_id = $1 AND source IS NULL AND " +
        "(SELECT first.source FROM donations first WHERE first.stripe_subscription_id = $1 ORDER BY first.id ASC LIMIT 1) = $2",
    );
  });
});

describe("a completed Fill a Red Bag checkout", () => {
  it("records the source with one statement, for that session", async () => {
    const result = await processWebhookEvent(checkout({ redBag: "true" }));
    expect(result).toEqual({ processed: true, action: "donation.created" });
    expect(tagCalls()).toEqual([[TAG_CHECKOUT_SOURCE_SQL, [SESSION_ID, "red_bag"]]]);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("records it only after the donation has committed and the thank you has gone", async () => {
    await processWebhookEvent(checkout({ redBag: "true" }));
    expect(order).toEqual(["commit", "email", "tag"]);
  });

  it("saves the donation with the very same statements and values as the same gift without the mark", async () => {
    await processWebhookEvent(checkout({ redBag: "true" }));
    const withMark = untagged();
    const emailWithMark = sendDonationConfirmation.mock.calls;

    queryMock.mockClear();
    sendDonationConfirmation.mockClear();
    installQuery();
    await processWebhookEvent(checkout({}));
    const withoutMark = calls();

    expect(withMark.some(([sql]) => /insert into donations/i.test(sql))).toBe(true);
    expect(withMark.some(([sql]) => /insert into donors/i.test(sql))).toBe(true);
    expect(withMark).toEqual(withoutMark);
    expect(emailWithMark).toEqual(sendDonationConfirmation.mock.calls);
  });

  it("puts no source into the donation's own INSERT", async () => {
    await processWebhookEvent(checkout({ redBag: "true" }));
    const insert = calls().find(([sql]) => /insert into donations/i.test(sql));
    expect(insert?.[0]).not.toMatch(/source/i);
    expect(insert?.[1]).not.toContain("red_bag");
  });
});

describe("a checkout without the mark", () => {
  it.each([
    ["no mark", {}],
    ['a mark of "false"', { redBag: "false" }],
  ])("runs no source statement for %s", async (_what, md) => {
    const result = await processWebhookEvent(checkout(md as Record<string, string>));
    expect(result).toEqual({ processed: true, action: "donation.created" });
    expect(tagCalls()).toEqual([]);
  });
});

describe("when recording the source goes wrong", () => {
  it("answers exactly as it would have, throws nothing, and says so once", async () => {
    tagError = Object.assign(new Error('column "source" of relation "donations" does not exist'), { code: "42703" });
    const result = await processWebhookEvent(checkout({ redBag: "true" }));
    expect(result).toEqual({ processed: true, action: "donation.created" });
    expect(sendDonationConfirmation).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledTimes(1);
    // The transaction was committed, never rolled back, and the connection handed back.
    expect(calls().some(([sql]) => /^\s*rollback/i.test(sql))).toBe(false);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("logs the event and the database's error code, and nothing about the donor or the session", async () => {
    tagError = Object.assign(new Error("robin@example.com cs_test_redbag secret detail"), { code: "42703" });
    await processWebhookEvent(checkout({ redBag: "true" }));
    const logged = errorLog.mock.calls[0].map(String).join(" ");
    expect(logged).toMatch(/donation source/i);
    expect(logged).toContain("evt_test_redbag");
    expect(logged).toContain("42703");
    expect(logged).not.toContain("robin@example.com");
    expect(logged).not.toContain("Robin");
    expect(logged).not.toContain(SESSION_ID);
    expect(logged).not.toContain("secret detail");
  });

  it("is swallowed for something that is not an Error at all", async () => {
    await expect(
      tagDonationSource(checkout({ redBag: "true" }), async () => {
        throw "nope";
      }),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it("is swallowed when the query function throws straight away rather than rejecting", async () => {
    await expect(
      tagDonationSource(checkout({ redBag: "true" }), () => {
        throw new Error("no connection");
      }),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it("is swallowed for an event with nothing in it", async () => {
    const query = vi.fn();
    await expect(tagDonationSource({ id: "evt_empty", type: "checkout.session.completed" } as unknown as Stripe.Event, query)).resolves.toBeUndefined();
    await expect(tagDonationSource(null as unknown as Stripe.Event, query)).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });
});

describe("when saving the donation itself fails", () => {
  it("rolls back, throws as it always did, and never tries to record a source", async () => {
    failOn = /insert into donations/i;
    await expect(processWebhookEvent(checkout({ redBag: "true" }))).rejects.toThrow("the database fell over");
    expect(calls().some(([sql]) => /^\s*rollback/i.test(sql))).toBe(true);
    expect(tagCalls()).toEqual([]);
  });
});

describe("the same event delivered again", () => {
  it("saves nothing twice and is answered as a duplicate", async () => {
    await processWebhookEvent(checkout({ redBag: "true" }));
    queryMock.mockClear();
    sendDonationConfirmation.mockClear();
    const second = await processWebhookEvent(checkout({ redBag: "true" }));
    expect(second).toEqual({ processed: false, action: "duplicate" });
    expect(calls().some(([sql]) => /insert into (donations|donors|audit_log)/i.test(sql))).toBe(false);
    expect(sendDonationConfirmation).not.toHaveBeenCalled();
  });

  it("tries the source once more, which changes nothing on a donation already tagged", async () => {
    await processWebhookEvent(checkout({ redBag: "true" }));
    queryMock.mockClear();
    order.length = 0;
    await processWebhookEvent(checkout({ redBag: "true" }));
    expect(tagCalls()).toEqual([[TAG_CHECKOUT_SOURCE_SQL, [SESSION_ID, "red_bag"]]]);
    expect(order).toEqual(["commit", "tag"]);
  });

  it("is still answered as a duplicate when that second try fails", async () => {
    await processWebhookEvent(checkout({ redBag: "true" }));
    tagError = new Error("blip");
    const second = await processWebhookEvent(checkout({ redBag: "true" }));
    expect(second).toEqual({ processed: false, action: "duplicate" });
  });

  it("runs no source statement for a duplicate without the mark", async () => {
    await processWebhookEvent(checkout({}));
    queryMock.mockClear();
    await processWebhookEvent(checkout({}));
    expect(tagCalls()).toEqual([]);
  });
});

describe("a later monthly charge", () => {
  it("is given its subscription's source by one statement, after commit and after the thank you", async () => {
    const result = await processWebhookEvent(renewal());
    expect(result).toEqual({ processed: true, action: "donation.recurring" });
    expect(tagCalls()).toEqual([[TAG_RENEWAL_SOURCE_SQL, [SUB_ID, "red_bag"]]]);
    expect(order).toEqual(["commit", "email", "tag"]);
  });

  it("is saved by the very same statements whatever happens to the source", async () => {
    await processWebhookEvent(renewal());
    const before = untagged();
    queryMock.mockClear();
    installQuery();
    tagError = new Error("blip");
    const result = await processWebhookEvent(renewal());
    expect(result).toEqual({ processed: true, action: "donation.recurring" });
    expect(untagged()).toEqual(before);
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it("reads the subscription from the newer invoice shape too", async () => {
    await processWebhookEvent(renewal({ subscription: undefined, parent: { subscription_details: { subscription: SUB_ID } } }));
    expect(tagCalls()).toEqual([[TAG_RENEWAL_SOURCE_SQL, [SUB_ID, "red_bag"]]]);
  });

  it.each([
    ["the first invoice, which the checkout already recorded", renewal({ billing_reason: "subscription_create" }), "ignored.invoice"],
    ["an invoice with no subscription", renewal({ subscription: null }), "ignored.invoice"],
  ])("runs no source statement for %s", async (_what, event, action) => {
    const result = await processWebhookEvent(event);
    expect(result.action).toBe(action);
    expect(tagCalls()).toEqual([]);
  });

  it("runs no source statement when no donation is recorded for the charge", async () => {
    parentRow = undefined;
    const result = await processWebhookEvent(renewal());
    expect(result.action).toBe("ignored.no_parent");
    expect(tagCalls()).toEqual([]);
  });

  it("tries once more on a redelivery, and is still answered as a duplicate", async () => {
    await processWebhookEvent(renewal());
    queryMock.mockClear();
    const second = await processWebhookEvent(renewal());
    expect(second).toEqual({ processed: false, action: "duplicate" });
    expect(tagCalls()).toEqual([[TAG_RENEWAL_SOURCE_SQL, [SUB_ID, "red_bag"]]]);
    expect(calls().some(([sql]) => /insert into donations/i.test(sql))).toBe(false);
  });
});

describe("events that are not a gift being recorded", () => {
  it.each(["charge.refunded", "checkout.session.async_payment_succeeded", "customer.subscription.deleted", "invoice.payment_failed"])(
    "run no source statement (%s)",
    async (type) => {
      const query = vi.fn();
      await tagDonationSource(
        { id: "evt_other", type, data: { object: { id: SESSION_ID, subscription: SUB_ID, metadata: { redBag: "true" } } } } as unknown as Stripe.Event,
        query,
      );
      expect(query).not.toHaveBeenCalled();
    },
  );
});
