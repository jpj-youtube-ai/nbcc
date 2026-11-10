import { describe, it, expect, vi, beforeEach } from "vitest";

// Uniform payments on the site's one Stripe webhook (TASK-604). A checkout from the uniform payment
// link (product = uniform) is a purchase, never a gift: it is kept as a uniform payment and NEVER
// writes a donor, a donation or a declaration, and the site sends the buyer no email. A refund of one
// comes off the uniform payment, never a donation. The pool, the email and the config are mocked;
// every name here is invented.

const { queryMock, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, connect };
});
vi.mock("../../src/db/pool", () => ({ pool: { connect, query: queryMock } }));

const email = vi.hoisted(() => ({
  sendDonationConfirmation: vi.fn(),
  sendDeclarationEmail: vi.fn(),
  sendCompanyReceipt: vi.fn(),
  sendRefundConfirmation: vi.fn(),
  sendSubscriptionLapsedDonor: vi.fn(),
  sendSubscriptionLapsedAdmin: vi.fn(),
  sendBusinessSupporterInvite: vi.fn(),
  sendBallConfirmation: vi.fn(),
}));
vi.mock("../../src/clients/email", () => email);
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    DECLARATION_FORM_BASE_URL: "https://nbcc.test",
    ADMIN_NOTIFICATION_EMAIL: "admin@nbcc.test",
    PORTAL_BASE_URL: "https://nbcc.test",
    BALL_FROM_EMAIL: "events@nbcc.test",
  },
}));

import { processWebhookEvent } from "../../src/db/stripe-webhook";

let claimed: Set<string>;
let stored: Set<string>;
let uniformIntents: Set<string>;

beforeEach(() => {
  vi.clearAllMocks();
  claimed = new Set();
  stored = new Set();
  uniformIntents = new Set();
  queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
    const s = String(sql);
    if (/^\s*(begin|commit|rollback)/i.test(s)) return {};
    if (/insert into stripe_webhook_events/i.test(s)) {
      const id = String(params?.[0]);
      if (claimed.has(id)) return { rowCount: 0, rows: [] };
      claimed.add(id);
      return { rowCount: 1, rows: [] };
    }
    if (/insert into uniform_payments/i.test(s)) {
      const sessionId = String(params?.[0]);
      if (stored.has(sessionId)) return { rowCount: 0, rows: [] };
      stored.add(sessionId);
      if (params?.[1]) uniformIntents.add(String(params[1]));
      return { rowCount: 1, rows: [{ id: 31 }] };
    }
    if (/select id from uniform_payments where stripe_payment_intent_id/i.test(s) || /update uniform_payments/i.test(s)) {
      return uniformIntents.has(String(params?.[0])) ? { rowCount: 1, rows: [{ id: 31 }] } : { rowCount: 0, rows: [] };
    }
    return { rows: [], rowCount: 0 };
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const completed = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_uniform_1",
        object: "checkout.session",
        payment_status: "paid",
        payment_intent: "pi_uniform_1",
        payment_link: "plink_uniform",
        amount_total: 4000,
        currency: "gbp",
        customer_details: { email: "robin.uniform@example.com", name: "Robin Testperson" },
        custom_fields: [{ key: "child", label: { type: "custom", custom: "Child's name" }, type: "text", text: { value: "Sam" } }],
        metadata: { product: "uniform" },
        ...over,
      },
    },
  }) as any;
const refunded = (id: string, intent: string, amount: number) =>
  ({ id, type: "charge.refunded", data: { object: { id: "ch_u_1", object: "charge", payment_intent: intent, amount_refunded: amount } } }) as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const sqls = () => queryMock.mock.calls.map((c) => String(c[0]));
const callFor = (re: RegExp) => queryMock.mock.calls.find((c) => re.test(String(c[0])));
const anyEmail = () => Object.values(email).some((f) => f.mock.calls.length > 0);

describe("a uniform payment link checkout on the webhook", () => {
  it("is kept as a uniform payment, and writes no donor, donation or declaration", async () => {
    const r = await processWebhookEvent(completed("evt_u_1"));
    expect(r).toEqual({ processed: true, action: "uniform.paid" });
    expect(sqls().some((s) => /insert into (donors|donations|declarations)/i.test(s))).toBe(false);
  });

  it("keeps its session, payment, link, amount, buyer and what they filled in", async () => {
    await processWebhookEvent(completed("evt_u_2"));
    const [, params] = callFor(/insert into uniform_payments/i) ?? [];
    expect(params).toEqual([
      "cs_test_uniform_1",
      "pi_uniform_1",
      "plink_uniform",
      4000,
      "GBP",
      "Robin Testperson",
      "robin.uniform@example.com",
      JSON.stringify([{ label: "Child's name", value: "Sam" }]),
    ]);
  });

  it("writes an audit line beside it", async () => {
    await processWebhookEvent(completed("evt_u_3"));
    const [sql, params] = callFor(/insert into audit_log/i) ?? [];
    expect(String(sql)).toMatch(/insert into audit_log/i);
    expect(params).toEqual(expect.arrayContaining(["stripe", "uniform.paid", "uniform_payment", 31]));
  });

  it("sends the buyer no email from the site", async () => {
    await processWebhookEvent(completed("evt_u_4"));
    expect(anyEmail()).toBe(false);
  });

  it("is kept once when Stripe sends the same checkout under another event", async () => {
    await processWebhookEvent(completed("evt_u_5"));
    const again = await processWebhookEvent(completed("evt_u_6"));
    expect(again).toEqual({ processed: true, action: "uniform.already_paid" });
    expect(sqls().filter((s) => /insert into audit_log/i.test(s))).toHaveLength(1);
  });

  it("waits, as no gift either, while the money has not come in", async () => {
    const r = await processWebhookEvent(completed("evt_u_7", { payment_status: "unpaid" }));
    expect(r).toEqual({ processed: true, action: "uniform.not_paid" });
    expect(sqls().some((s) => /insert into (uniform_payments|donors|donations)/i.test(s))).toBe(false);
  });

  it("is kept when the money comes in later", async () => {
    const later = { ...completed("evt_u_8"), type: "checkout.session.async_payment_succeeded" };
    const r = await processWebhookEvent(later);
    expect(r).toEqual({ processed: true, action: "uniform.paid" });
    expect(sqls().some((s) => /insert into (donors|donations)/i.test(s))).toBe(false);
  });

  it("leaves every other checkout to the handlers it always went to", async () => {
    await processWebhookEvent(completed("evt_u_9", { metadata: { product: "event_tickets" } }));
    expect(sqls().some((s) => /uniform_payments/i.test(s))).toBe(false);
  });
});

describe("a refund of a uniform payment, on the webhook", () => {
  it("comes off the uniform payment, with Stripe's total refunded, and never touches donations", async () => {
    await processWebhookEvent(completed("evt_u_10"));
    queryMock.mockClear();
    const r = await processWebhookEvent(refunded("evt_u_11", "pi_uniform_1", 1500));
    expect(r).toEqual({ processed: true, action: "uniform.refunded" });
    const [, params] = callFor(/update uniform_payments/i) ?? [];
    expect(params).toEqual(["pi_uniform_1", 1500]);
    expect(sqls().some((s) => /donations|claim_adjust/i.test(s))).toBe(false);
    expect(anyEmail()).toBe(false);
  });

  it("is left to the donations' refund when the payment is not a uniform's, its amount never handed to uniforms", async () => {
    const r = await processWebhookEvent(refunded("evt_u_12", "pi_some_gift", 1500));
    expect(r.action).not.toBe("uniform.refunded");
    expect(sqls().some((s) => /update uniform_payments/i.test(s))).toBe(false);
  });
});
