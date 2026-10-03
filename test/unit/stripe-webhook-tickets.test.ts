import { describe, it, expect, vi, beforeEach } from "vitest";

// Event tickets on the site's one Stripe webhook (src/db/stripe-webhook.ts). A ticket checkout is
// a purchase, never a gift: it marks its order paid and NEVER writes a donor or a donation (which
// could put ticket money in a Gift Aid claim). Its tickets email goes only after the commit. The
// pool, the email and the config are mocked; every name here is invented.

const { queryMock, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, connect };
});
vi.mock("../../src/db/pool", () => ({ pool: { connect, query: queryMock } }));

const order = vi.hoisted(() => ({ status: "pending" as string }));
const sendTickets = vi.hoisted(() => vi.fn());
const tell = vi.hoisted(() => vi.fn());
const listRefunds = vi.hoisted(() => vi.fn());
vi.mock("../../src/tickets/send", () => ({ sendTicketConfirmation: sendTickets, tellAfterReconcile: tell }));
vi.mock("../../src/tickets/refunds", () => ({ listStripeRefunds: listRefunds }));
vi.mock("../../src/clients/email", () => ({
  sendDonationConfirmation: vi.fn(),
  sendDeclarationEmail: vi.fn(),
  sendCompanyReceipt: vi.fn(),
  sendRefundConfirmation: vi.fn(),
  sendSubscriptionLapsedDonor: vi.fn(),
  sendSubscriptionLapsedAdmin: vi.fn(),
  sendBusinessSupporterInvite: vi.fn(),
  sendBallConfirmation: vi.fn(),
}));
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
const order_log: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  claimed = new Set();
  order_log.length = 0;
  order.status = "pending";
  queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
    const s = String(sql);
    if (/^\s*commit/i.test(s)) order_log.push("commit");
    if (/^\s*(begin|commit|rollback)/i.test(s)) return {};
    if (/insert into stripe_webhook_events/i.test(s)) {
      const id = String(params?.[0]);
      if (claimed.has(id)) return { rowCount: 0, rows: [] };
      claimed.add(id);
      return { rowCount: 1, rows: [] };
    }
    if (/from event_ticket_orders where reference = \$1 for update/i.test(s)) {
      return { rowCount: 1, rows: [{ id: 7, status: order.status, total_pence: 2552, fundraiser_id: 12, late: false }] };
    }
    if (/update event_ticket_orders/i.test(s)) {
      order.status = "paid";
      return { rowCount: 1, rows: [] };
    }
    return { rows: [], rowCount: 0 };
  });
  sendTickets.mockImplementation(async () => {
    order_log.push("email");
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const completed = (id: string) =>
  ({
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_tix_1",
        payment_status: "paid",
        payment_intent: "pi_tix_1",
        amount_total: 2552,
        customer_details: { email: "robin@example.com", name: "Robin Example" },
        metadata: { product: "event_tickets", orderReference: "TIX-ABCDEF", eventId: "12" },
      },
    },
  }) as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const sqls = () => queryMock.mock.calls.map((c) => String(c[0]));

describe("a ticket checkout on the webhook", () => {
  it("marks the order paid and writes no donor, donation or declaration", async () => {
    const r = await processWebhookEvent(completed("evt_tix_1"));
    expect(r).toEqual({ processed: true, action: "tickets.paid" });
    expect(sqls().some((s) => /update event_ticket_orders/i.test(s))).toBe(true);
    expect(sqls().some((s) => /insert into (donors|donations|declarations)/i.test(s))).toBe(false);
  });

  it("sends the tickets only after the commit", async () => {
    await processWebhookEvent(completed("evt_tix_2"));
    expect(sendTickets).toHaveBeenCalledWith(7);
    expect(order_log).toEqual(["commit", "email"]);
  });

  it("does nothing a second time for the same event", async () => {
    await processWebhookEvent(completed("evt_tix_3"));
    const again = await processWebhookEvent(completed("evt_tix_3"));
    expect(again).toEqual({ processed: false, action: "duplicate" });
    expect(sendTickets).toHaveBeenCalledTimes(1);
  });

  it("keeps the payment when the email cannot be sent", async () => {
    sendTickets.mockRejectedValue(new Error("mail down"));
    await expect(processWebhookEvent(completed("evt_tix_4"))).resolves.toEqual({ processed: true, action: "tickets.paid" });
  });
});

describe("a refund event for a ticket order, on the webhook", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const refundEvent = (id: string) => ({ id, type: "charge.refunded", data: { object: { id: "ch_1", object: "charge", payment_intent: "pi_tix_1", amount_refunded: 99999 } } }) as any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const withOrder = () => {
    const base = queryMock.getMockImplementation() as (sql: string, params?: unknown[]) => Promise<unknown>;
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      const s = String(sql);
      if (/rollback/i.test(s)) order_log.push("rollback");
      if (/from event_ticket_orders where stripe_payment_intent_id = \$1/i.test(s)) return { rowCount: 1, rows: [{ id: 7 }] };
      if (/select total_pence, refunded_pence, stripe_payment_intent_id, fundraiser_id from event_ticket_orders/i.test(s)) {
        return { rowCount: 1, rows: [{ total_pence: 2552, refunded_pence: 0, stripe_payment_intent_id: "pi_tix_1", fundraiser_id: 12 }] };
      }
      return base(sql, params);
    });
  };

  it("fails, rolled back, when Stripe cannot be asked: the route answers 500 and Stripe sends it again", async () => {
    withOrder();
    listRefunds.mockRejectedValue(new Error("socket hang up"));
    await expect(processWebhookEvent(refundEvent("evt_r_1"))).rejects.toThrow("socket hang up");
    expect(order_log).toEqual(["rollback"]);
    expect(tell).not.toHaveBeenCalled();
  });

  it("asks Stripe what was refunded, and never records ticket money as a donation's refund", async () => {
    withOrder();
    listRefunds.mockResolvedValue([{ id: "re_dash", amount: 500, status: "succeeded", intentId: null }]);
    const r = await processWebhookEvent(refundEvent("evt_r_2"));
    expect(listRefunds).toHaveBeenCalledWith("pi_tix_1");
    expect(r).toMatchObject({ processed: true, action: "tickets.refunded_in_stripe" });
    expect(sqls().some((q) => /donations|claim_adjust/i.test(q))).toBe(false);
    expect(JSON.stringify(queryMock.mock.calls.map((c) => c[1]))).not.toContain("99999");
    expect(tell).toHaveBeenCalledWith(7, expect.objectContaining({ refundedNowPence: 500 }));
  });
});
