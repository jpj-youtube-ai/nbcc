import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Stripe from "stripe";

// What brought someone to give, copied onto the donation from the session the checkout stamped
// (Donations gift log, Task 1). DB-free: the pool and the email client are mocked, as in
// stripe-webhook-source.test.ts. What is proved here:
//   - the donation is saved by exactly the same statements whether or not the session says;
//   - it is written by ONE separate statement, after COMMIT, after the emails and the source;
//   - only for a checkout's first gift (donation.created), never for a monthly renewal;
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
  tagDonationArrival,
  SOURCE_TAG_TIMEOUT_MS,
  TAG_CHECKOUT_ARRIVAL_SQL,
} from "../../src/db/stripe-webhook";

const SESSION_ID = "cs_test_arrival";
const isArrival = (sql: string): boolean => /update donations\s+set arrival_channel/i.test(sql);
const isSource = (sql: string): boolean => /update donations\s+set source/i.test(sql);

let claimed: Set<string>;
let arrivalError: Error | null;
let arrivalStuck: Promise<unknown> | null;
let sourceStuck: Promise<unknown> | null;

function installQuery() {
  claimed = new Set();
  arrivalError = null;
  arrivalStuck = null;
  sourceStuck = null;
  queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/^\s*commit/i.test(sql)) order.push("commit");
    if (isArrival(sql)) {
      order.push("arrival");
      if (arrivalError) throw arrivalError;
      if (arrivalStuck) return arrivalStuck;
      return { rowCount: 1, rows: [] };
    }
    if (isSource(sql)) {
      order.push("source");
      if (sourceStuck) return sourceStuck;
      return { rowCount: 1, rows: [] };
    }
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/insert into stripe_webhook_events/i.test(sql)) {
      const id = String(params?.[0]);
      if (claimed.has(id)) return { rowCount: 0, rows: [] };
      claimed.add(id);
      return { rowCount: 1, rows: [] };
    }
    if (/insert into donors/i.test(sql)) return { rows: [{ id: 10 }], rowCount: 1 };
    if (/insert into donations/i.test(sql)) return { rows: [{ id: 99 }], rowCount: 1 };
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

type Call = [string, unknown[] | undefined];
const calls = (): Call[] => queryMock.mock.calls.map((c) => [String(c[0]), c[1] as unknown[] | undefined]);
const arrivalCalls = (): Call[] => calls().filter(([sql]) => isArrival(sql));

const checkout = (metadata: Record<string, string>): Stripe.Event =>
  ({
    id: "evt_test_arrival",
    type: "checkout.session.completed",
    created: 1791000000,
    data: {
      object: {
        id: SESSION_ID,
        object: "checkout.session",
        created: 1791000000,
        amount_total: 1000,
        currency: "gbp",
        mode: "payment",
        payment_status: "paid",
        payment_intent: "pi_test_arrival",
        subscription: null,
        customer_details: { name: "Sam Example", email: "sam@example.com" },
        metadata: { mode: "once", plan: "", giftAid: "false", donorType: "individual", fullName: "Sam Example", email: "sam@example.com", ...metadata },
      },
    },
  }) as unknown as Stripe.Event;

const QR = { arrChannel: "qr", arrCampaign: "c12", givenOn: "/donate" };

const renewal = (): Stripe.Event =>
  ({
    id: "evt_test_arrival_renewal",
    type: "invoice.paid",
    created: 1793600000,
    data: {
      object: {
        id: "in_test_arrival",
        object: "invoice",
        amount_paid: 1000,
        currency: "gbp",
        subscription: "sub_test_arrival",
        payment_intent: "pi_test_renewal",
        charge: "ch_test_renewal",
        billing_reason: "subscription_cycle",
        metadata: QR,
      },
    },
  }) as unknown as Stripe.Event;

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  queryMock.mockReset();
  mockClient.release.mockClear();
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

describe("the statement that records what brought the giver", () => {
  it("fills in a checkout's donation by its session id, only where nothing is noted yet", () => {
    expect(TAG_CHECKOUT_ARRIVAL_SQL.replace(/\s+/g, " ").trim()).toBe(
      "UPDATE donations SET arrival_channel = $2, arrival_source = $3, arrival_campaign = $4, given_on = $5 " +
        "WHERE stripe_session_id = $1 AND arrival_channel IS NULL",
    );
  });
});

describe("a completed checkout that says what brought the giver", () => {
  it("records it with one statement, for that session", async () => {
    const result = await processWebhookEvent(checkout(QR));
    expect(result).toEqual({ processed: true, action: "donation.created" });
    expect(arrivalCalls()).toEqual([[TAG_CHECKOUT_ARRIVAL_SQL, [SESSION_ID, "qr", null, "c12", "/donate"]]]);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("records it after the donation has committed, the thank you has gone and the source is written", async () => {
    await processWebhookEvent(checkout({ ...QR, redBag: "true" }));
    expect(order).toEqual(["commit", "email", "source", "arrival"]);
  });

  it("saves the donation with the very same statements and values as a session that says nothing", async () => {
    await processWebhookEvent(checkout(QR));
    const withArrival = calls().filter(([sql]) => !isArrival(sql));
    queryMock.mockClear();
    installQuery();
    await processWebhookEvent(checkout({}));
    expect(withArrival).toEqual(calls());
    const insert = withArrival.find(([sql]) => /insert into donations/i.test(sql));
    expect(insert?.[0]).not.toMatch(/arrival|given_on/i);
    expect(insert?.[1]).not.toContain("c12");
  });

  it("runs no statement for a session that says nothing", async () => {
    await processWebhookEvent(checkout({}));
    expect(arrivalCalls()).toEqual([]);
  });

  it("copies nothing to a monthly gift's later charges", async () => {
    const result = await processWebhookEvent(renewal());
    expect(result.action).toBe("donation.recurring");
    expect(arrivalCalls()).toEqual([]);
  });

  it("runs nothing more for a redelivery", async () => {
    await processWebhookEvent(checkout(QR));
    queryMock.mockClear();
    const again = await processWebhookEvent(checkout(QR));
    expect(again).toEqual({ processed: false, action: "duplicate" });
    expect(arrivalCalls()).toEqual([]);
  });
});

describe("when recording it goes wrong", () => {
  it("answers exactly as it would have, throws nothing, and says so once, without the donor or session", async () => {
    arrivalError = Object.assign(new Error('column "arrival_channel" does not exist sam@example.com cs_test_arrival'), { code: "42703" });
    const result = await processWebhookEvent(checkout(QR));
    expect(result).toEqual({ processed: true, action: "donation.created" });
    expect(sendDonationConfirmation).toHaveBeenCalledTimes(1);
    expect(calls().some(([sql]) => /^\s*rollback/i.test(sql))).toBe(false);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
    expect(mockClient.release.mock.calls[0][0]).toBeUndefined();
    expect(errorLog).toHaveBeenCalledTimes(1);
    const logged = errorLog.mock.calls[0].map(String).join(" ");
    expect(logged).toMatch(/what brought the giver not recorded/i);
    expect(logged).toContain("evt_test_arrival");
    expect(logged).toContain("42703");
    expect(logged).not.toContain("sam@example.com");
    expect(logged).not.toContain(SESSION_ID);
  });

  it("is swallowed when the query function throws straight away, or for an event with nothing in it", async () => {
    await expect(
      tagDonationArrival(checkout(QR), () => {
        throw new Error("no connection");
      }),
    ).resolves.toBe(false);
    const query = vi.fn();
    await expect(tagDonationArrival({ id: "evt_empty", type: "checkout.session.completed" } as unknown as Stripe.Event, query)).resolves.toBe(false);
    await expect(tagDonationArrival(null as unknown as Stripe.Event, query)).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("when recording it hangs", () => {
  const never = (): Promise<unknown> => new Promise(() => {});

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up at the same two second limit, and the connection is closed rather than reused", async () => {
    arrivalStuck = never();
    const processing = processWebhookEvent(checkout(QR));
    await vi.advanceTimersByTimeAsync(SOURCE_TAG_TIMEOUT_MS);
    await expect(processing).resolves.toEqual({ processed: true, action: "donation.created" });
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
    expect(mockClient.release.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is not tried at all on a connection the source statement was abandoned on", async () => {
    sourceStuck = never();
    const processing = processWebhookEvent(checkout({ ...QR, redBag: "true" }));
    await vi.advanceTimersByTimeAsync(SOURCE_TAG_TIMEOUT_MS);
    await expect(processing).resolves.toEqual({ processed: true, action: "donation.created" });
    expect(arrivalCalls()).toEqual([]);
    expect(mockClient.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
