import { describe, it, expect, vi, beforeEach } from "vitest";

// Event tickets: reconcileRefunds, the ONE place refunded money is decided. Stripe is the source of
// truth: under the order's lock it reads the payment's refunds from Stripe and makes this side agree.
// No event's own amount or status is ever trusted, so events arriving late, twice or out of order
// cannot do harm. Against a small in-memory stand-in for the tables (no database); every name is
// invented.

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { STRIPE_STILL_WORKING, reconcileRefunds, supersedeOrder, TOO_MANY_FREE, TOO_MANY_FREE_HERE, type StripeRefundLite } from "../../src/db/event-tickets";
import { pool } from "../../src/db/pool";
import { FREE_BOOKINGS_IP_MAX, FREE_BOOKINGS_MAX } from "../../src/tickets/model";

interface RefundRow {
  id: number;
  amount_pence: number;
  lines: Array<{ lineId: number; quantity: number }>;
  status: string;
  request_id: number | null;
  refunded_by: string;
  note: string | null;
  stripe_refund_id: string | null;
  old: boolean;
}

let order: { total_pence: number; refunded_pence: number; stripe_payment_intent_id: string | null; fundraiser_id: number; flags: Record<string, unknown> };
let lines: Array<{ id: number; ticket_type_id: number; quantity: number; refunded_quantity: number }>;
let refunds: RefundRow[];
let audits: string[];
let requestStatus: string;
let limit: number | null;
let takenByOthers: number;

const client = {
  query: vi.fn(async (sql: string, p: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/^SELECT total_pence, refunded_pence, stripe_payment_intent_id, fundraiser_id FROM event_ticket_orders/.test(s)) return { rows: [order], rowCount: 1 };
    if (/FROM event_ticket_refunds WHERE order_id = \$1 ORDER BY id FOR UPDATE/.test(s)) return { rows: refunds.map((r) => ({ ...r })), rowCount: refunds.length };
    if (/^UPDATE event_ticket_order_lines SET refunded_quantity = LEAST\(quantity, refunded_quantity \+ \$2\)/.test(s)) {
      const l = lines.find((x) => x.id === p[0]);
      if (l) l.refunded_quantity = Math.min(l.quantity, l.refunded_quantity + Number(p[1]));
      return { rowCount: 1, rows: [] };
    }
    if (/^UPDATE event_ticket_order_lines SET refunded_quantity = quantity/.test(s)) {
      for (const l of lines) l.refunded_quantity = l.quantity;
      return { rowCount: lines.length, rows: [] };
    }
    if (/^UPDATE event_ticket_refunds SET status = 'done'/.test(s)) {
      const r = refunds.find((x) => x.id === p[0]);
      if (r) Object.assign(r, { status: "done", stripe_refund_id: r.stripe_refund_id ?? (p[1] as string | null) });
      return { rowCount: 1, rows: [] };
    }
    if (/^UPDATE event_ticket_refunds SET status = 'failed'/.test(s)) {
      const r = refunds.find((x) => x.id === p[0]);
      if (r) r.status = "failed";
      return { rowCount: 1, rows: [] };
    }
    if (/^UPDATE event_ticket_refunds SET stripe_refund_id = COALESCE/.test(s)) {
      const r = refunds.find((x) => x.id === p[0]);
      if (r) r.stripe_refund_id = r.stripe_refund_id ?? (p[1] as string);
      return { rowCount: 1, rows: [] };
    }
    if (/^INSERT INTO event_ticket_refunds/.test(s)) {
      if (refunds.some((r) => r.stripe_refund_id === p[3])) return { rowCount: 0, rows: [] };
      const id = 100 + refunds.length;
      refunds.push({ id, amount_pence: Number(p[1]), lines: JSON.parse(String(p[4] ?? "[]")), status: "done", request_id: null, refunded_by: "stripe", note: String(p[2]), stripe_refund_id: String(p[3]), old: false });
      return { rowCount: 1, rows: [{ id }] };
    }
    if (/^UPDATE event_ticket_refund_requests SET status = 'refunded'/.test(s)) {
      requestStatus = "refunded";
      return { rowCount: 1, rows: [] };
    }
    if (/^UPDATE event_ticket_orders SET refunded_pence = \$2/.test(s)) {
      order.refunded_pence = Number(p[1]);
      return { rowCount: 1, rows: [] };
    }
    if (/^UPDATE event_ticket_orders SET flags = flags \|\| /.test(s)) {
      Object.assign(order.flags, JSON.parse(String(p[1])));
      return { rowCount: 1, rows: [] };
    }
    if (/^UPDATE event_ticket_orders SET flags = flags - 'refundFailed'/.test(s)) {
      delete order.flags.refundFailed;
      return { rowCount: 1, rows: [] };
    }
    if (/SUM\(quantity - refunded_quantity\)/.test(s) && /FROM event_ticket_order_lines WHERE order_id/.test(s)) {
      return { rows: [{ n: lines.reduce((n, l) => n + l.quantity - l.refunded_quantity, 0) }] };
    }
    if (/^SELECT id, ticket_type_id, quantity, refunded_quantity FROM event_ticket_order_lines/.test(s)) return { rows: lines.map((l) => ({ ...l })) };
    if (/FROM event_ticket_types WHERE fundraiser_id/.test(s)) return { rows: [{ id: 1, name: "Adult", price_pence: 1000, quantity: null, status: "approved", sort_order: 0 }] };
    if (/FROM event_ticket_settings WHERE fundraiser_id/.test(s)) return { rows: [{ sales_limit: limit }] };
    if (/GROUP BY l.ticket_type_id/.test(s)) return { rows: [{ ticket_type_id: 1, taken: takenByOthers + lines.reduce((n, l) => n + l.quantity - l.refunded_quantity, 0) }] };
    if (/^INSERT INTO audit_log/.test(s)) {
      audits.push(String(p[1]));
      return { rowCount: 1, rows: [] };
    }
    return { rows: [], rowCount: 0 };
  }),
};

const stripe = (list: StripeRefundLite[]) => vi.fn(async () => list);
const re = (id: string, amount: number, status: string, intentId: number | null = null): StripeRefundLite => ({ id, amount, status, intentId });
const intent = (over: Partial<RefundRow> = {}): RefundRow => ({ id: 31, amount_pence: 1000, lines: [{ lineId: 70, quantity: 1 }], status: "pending", request_id: 5, refunded_by: "admin:a@example.com", note: null, stripe_refund_id: null, old: false, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  order = { total_pence: 2000, refunded_pence: 0, stripe_payment_intent_id: "pi_1", fundraiser_id: 12, flags: {} };
  lines = [{ id: 70, ticket_type_id: 1, quantity: 2, refunded_quantity: 0 }];
  refunds = [];
  audits = [];
  requestStatus = "open";
  limit = null;
  takenByOthers = 0;
});

describe("an admin's refund that Stripe made", () => {
  it("is finished from Stripe's list, by the refund's metadata: money, tickets, request, audit, and one email", async () => {
    refunds = [intent()];
    const r = await reconcileRefunds(client, 7, stripe([re("re_1", 1000, "succeeded", 31)]));
    expect(order.refunded_pence).toBe(1000);
    expect(lines[0].refunded_quantity).toBe(1);
    expect(refunds[0]).toMatchObject({ status: "done", stripe_refund_id: "re_1" });
    expect(requestStatus).toBe("refunded");
    expect(audits).toContain("tickets.refunded");
    expect(r).toMatchObject({ refundedNowPence: 1000, full: false, failedWords: [] });
  });

  it("changes nothing and emails nobody when run again (a replay, or an event out of order)", async () => {
    refunds = [intent()];
    const list = stripe([re("re_1", 1000, "succeeded", 31)]);
    await reconcileRefunds(client, 7, list);
    audits = [];
    const again = await reconcileRefunds(client, 7, list);
    expect(again).toMatchObject({ refundedNowPence: 0, failedWords: [] });
    expect(order.refunded_pence).toBe(1000);
    expect(lines[0].refunded_quantity).toBe(1);
    expect(audits).toEqual([]);
  });

  it("is left waiting while Stripe has not made it yet and it is young, and let go once it is old", async () => {
    refunds = [intent()];
    await reconcileRefunds(client, 7, stripe([]));
    expect(refunds[0].status).toBe("pending");
    refunds = [intent({ old: true })];
    const r = await reconcileRefunds(client, 7, stripe([]));
    expect(refunds[0].status).toBe("failed");
    expect(lines[0].refunded_quantity).toBe(0);
    expect(r.failedWords).toEqual([]);
  });

  it("is never let go, however old, when Stripe did make it", async () => {
    refunds = [intent({ old: true })];
    await reconcileRefunds(client, 7, stripe([re("re_1", 1000, "succeeded", 31)]));
    expect(refunds[0].status).toBe("done");
  });
});

describe("a refund that failed at the bank after it was applied here", () => {
  beforeEach(() => {
    refunds = [intent({ status: "done", stripe_refund_id: "re_1" })];
    order.refunded_pence = 1000;
    lines[0].refunded_quantity = 1;
  });

  it("puts the money back to what Stripe says, never the tickets, flags the booking and tells staff, not the buyer", async () => {
    const r = await reconcileRefunds(client, 7, stripe([re("re_1", 1000, "failed", 31)]));
    expect(order.refunded_pence).toBe(0);
    expect(lines[0].refunded_quantity).toBe(1);
    expect(refunds[0].status).toBe("failed");
    expect(r.refundedNowPence).toBe(0);
    expect(r.failedWords).toEqual(["Refund failed at the bank: the buyer has not been paid back. Their tickets were released: contact them and refund them in Stripe."]);
    expect(order.flags.refundFailed).toEqual({ released: true, overBy: 0 });
  });

  it("says how far over its limit the event would be if they still come", async () => {
    limit = 10;
    takenByOthers = 10; // their released place has since been sold to someone else
    const r = await reconcileRefunds(client, 7, stripe([re("re_1", 1000, "failed", 31)]));
    expect(r.failedWords[0]).toBe(
      "Refund failed at the bank: the buyer has not been paid back. Their tickets were released: contact them and refund them in Stripe. Counting their tickets, this event is now 2 over its limit.",
    );
  });

  it("is not applied again by a late 'succeeded' event: only Stripe's list now counts", async () => {
    await reconcileRefunds(client, 7, stripe([re("re_1", 1000, "failed", 31)]));
    // The stale event arrives; reconcile reads Stripe again, which still says failed.
    const late = await reconcileRefunds(client, 7, stripe([re("re_1", 1000, "failed", 31)]));
    expect(order.refunded_pence).toBe(0);
    expect(refunds[0].status).toBe("failed");
    expect(late.failedWords).toEqual([]);
  });
});

describe("the failed refund flag", () => {
  it("is never cleared by itself, even when a later refund goes through: an admin marks it sorted", async () => {
    refunds = [intent({ status: "done", stripe_refund_id: "re_1" })];
    order.refunded_pence = 1000;
    lines[0].refunded_quantity = 1;
    await reconcileRefunds(client, 7, stripe([re("re_1", 1000, "failed", 31)]));
    expect(order.flags.refundFailed).toBeTruthy();
    // Staff refund them in Stripe: recorded, the buyer told, and the flag still there.
    const r = await reconcileRefunds(client, 7, stripe([re("re_1", 1000, "failed", 31), re("re_again", 1000, "succeeded")]));
    expect(r.refundedNowPence).toBe(1000);
    expect(order.refunded_pence).toBe(1000);
    expect(order.flags.refundFailed).toBeTruthy();
    expect(client.query.mock.calls.some((c) => /flags - 'refundFailed'/.test(String(c[0])))).toBe(false);
  });
});

describe("a refund made in Stripe itself", () => {
  it("is recorded as money only: no tickets are released until an admin says which", async () => {
    const r = await reconcileRefunds(client, 7, stripe([re("re_dash", 500, "succeeded")]));
    expect(order.refunded_pence).toBe(500);
    expect(lines[0].refunded_quantity).toBe(0);
    expect(refunds[0]).toMatchObject({ refunded_by: "stripe", status: "done", stripe_refund_id: "re_dash", amount_pence: 500 });
    expect(r).toMatchObject({ refundedNowPence: 500, full: false });
  });

  it("in full releases every ticket", async () => {
    const r = await reconcileRefunds(client, 7, stripe([re("re_dash", 2000, "succeeded")]));
    expect(lines[0].refunded_quantity).toBe(2);
    expect(r.full).toBe(true);
  });

  it("is never swallowed by one of ours still waiting that Stripe never made", async () => {
    refunds = [intent()];
    const r = await reconcileRefunds(client, 7, stripe([re("re_dash", 1000, "succeeded")]));
    expect(order.refunded_pence).toBe(1000);
    expect(refunds[0].status).toBe("pending");
    expect(lines[0].refunded_quantity).toBe(0);
    expect(refunds[1]).toMatchObject({ refunded_by: "stripe", stripe_refund_id: "re_dash" });
    expect(r.refundedNowPence).toBe(1000);
  });

  it("that later fails takes the money back off, and flags the booking", async () => {
    await reconcileRefunds(client, 7, stripe([re("re_dash", 500, "succeeded")]));
    const r = await reconcileRefunds(client, 7, stripe([re("re_dash", 500, "failed")]));
    expect(order.refunded_pence).toBe(0);
    expect(refunds[0].status).toBe("failed");
    expect(r.failedWords).toEqual(["Refund failed at the bank: the buyer has not been paid back. Refund again."]);
  });
});

describe("the total", () => {
  it("is always the sum of Stripe's succeeded refunds, never more than was paid", async () => {
    refunds = [intent()];
    await reconcileRefunds(client, 7, stripe([re("re_1", 1000, "succeeded", 31), re("re_2", 700, "succeeded"), re("re_3", 900, "pending"), re("re_4", 5000, "failed")]));
    expect(order.refunded_pence).toBe(1700);
  });

  it("asks Stripe nothing for an order with no card payment", async () => {
    order.stripe_payment_intent_id = null;
    const list = stripe([]);
    expect(await reconcileRefunds(client, 7, list)).toMatchObject({ refundedNowPence: 0 });
    expect(list).not.toHaveBeenCalled();
  });

  it("lets Stripe being out of reach be heard, so the caller can try again", async () => {
    await expect(reconcileRefunds(client, 7, vi.fn(async () => Promise.reject(new Error("socket hang up"))))).rejects.toThrow("socket hang up");
  });
});

describe("an older checkout of the same buyer", () => {
  it("is cancelled only if its Stripe checkout is still the one that was read and closed", async () => {
    const query = vi.mocked(pool.query as unknown as (sql: string, p: unknown[]) => Promise<{ rowCount: number }>);
    query.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 });
    expect(await supersedeOrder(60, "cs_old")).toBe(true);
    expect(await supersedeOrder(61, null)).toBe(false); // a checkout was opened for it since: left alone
    expect(query.mock.calls[0][0]).toMatch(/status = 'pending' AND stripe_session_id IS NOT DISTINCT FROM \$2/);
    expect(query.mock.calls.map((c) => c[1])).toEqual([
      [60, "cs_old"],
      [61, null],
    ]);
  });
});

describe("the caps on free bookings", () => {
  it("are two by email and six by address, each with its own words", () => {
    expect([FREE_BOOKINGS_MAX, FREE_BOOKINGS_IP_MAX]).toEqual([2, 6]);
    expect(TOO_MANY_FREE).toBe("You already have 2 free bookings for this event. Need more? Email events@nbcc.scot.");
    expect(TOO_MANY_FREE_HERE).toBe("We've had several free bookings from this connection. If that isn't you, email events@nbcc.scot and we'll book you in.");
  });
});

describe("an old refund Stripe has not finished with", () => {
  it("is said plainly to the admin who tries another", () => {
    expect(STRIPE_STILL_WORKING).toBe("Stripe is still working on the last refund for this booking. Check again later today.");
  });
});
