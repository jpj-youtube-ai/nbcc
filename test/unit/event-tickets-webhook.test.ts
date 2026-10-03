import { describe, it, expect, vi, beforeEach } from "vitest";

// Event tickets on the one Stripe webhook: a ticket checkout is paid or expires, and a ticket charge
// is refunded or disputed. The database and the emails are mocked; what is checked is that ticket
// events are taken here (and never fall through to the donations handler, where ticket money would
// be recorded as a gift), and everything else is left alone. Every name here is invented.

const db = vi.hoisted(() => ({
  markOrderPaid: vi.fn(),
  markOrderExpired: vi.fn(),
  orderIdForPaymentIntent: vi.fn(),
  reconcileRefunds: vi.fn(),
  noteDispute: vi.fn(),
}));
const send = vi.hoisted(() => ({ sendTicketConfirmation: vi.fn(), tellAfterReconcile: vi.fn(), sendOrderFlagStaffEmail: vi.fn(), sendUnknownPaymentStaffEmail: vi.fn() }));
const refunds = vi.hoisted(() => ({ listStripeRefunds: vi.fn() }));
vi.mock("../../src/tickets/refunds", () => refunds);
vi.mock("../../src/db/event-tickets", () => db);
vi.mock("../../src/tickets/send", () => send);

import { handleTicketEvent, isTicketSession } from "../../src/tickets/webhook";

const client = { query: vi.fn() };
/* eslint-disable @typescript-eslint/no-explicit-any */
const ev = (type: string, object: Record<string, unknown>) => ({ id: "evt_t_1", type, data: { object } }) as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const paidSession = {
  id: "cs_test_tix_1",
  payment_status: "paid",
  payment_intent: "pi_tix_1",
  amount_total: 2552,
  currency: "gbp",
  metadata: { product: "event_tickets", orderReference: "TIX-ABCDEF", eventId: "12" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("telling a ticket checkout apart", () => {
  it("is product event_tickets, never a donation or the ball", () => {
    expect(isTicketSession({ product: "event_tickets" })).toBe(true);
    expect(isTicketSession({ product: "ball" })).toBe(false);
    expect(isTicketSession({ fundraiserId: "12" })).toBe(false);
    expect(isTicketSession(null)).toBe(false);
  });
});

describe("a ticket checkout completing", () => {
  it("marks the order paid by its reference, and sends the tickets once it commits", async () => {
    db.markOrderPaid.mockResolvedValue({ action: "tickets.paid", orderId: 7, flags: null });
    const r = await handleTicketEvent(client, ev("checkout.session.completed", paidSession));
    expect(db.markOrderPaid).toHaveBeenCalledWith(client, {
      reference: "TIX-ABCDEF",
      sessionId: "cs_test_tix_1",
      paymentIntentId: "pi_tix_1",
      amountTotal: 2552,
      currency: "gbp",
      eventId: "evt_t_1",
    });
    expect(r?.action).toBe("tickets.paid");
    expect(send.sendTicketConfirmation).not.toHaveBeenCalled();
    await r?.afterCommit?.();
    expect(send.sendTicketConfirmation).toHaveBeenCalledWith(7);
    expect(send.sendOrderFlagStaffEmail).not.toHaveBeenCalled();
  });

  it("tells staff, once it commits, when it was paid late and took the event over its limit", async () => {
    db.markOrderPaid.mockResolvedValue({ action: "tickets.paid_flagged", orderId: 7, flags: { paidLate: { was: "expired", overBy: 2 } } });
    const r = await handleTicketEvent(client, ev("checkout.session.completed", paidSession));
    await r?.afterCommit?.();
    expect(send.sendTicketConfirmation).toHaveBeenCalledWith(7);
    expect(send.sendOrderFlagStaffEmail).toHaveBeenCalledWith(7, ["Paid late: this event is now 2 over its limit"]);
  });

  it("tells staff when the amount paid does not match, but not for a late payment that fitted", async () => {
    db.markOrderPaid.mockResolvedValue({ action: "tickets.paid_flagged", orderId: 7, flags: { amountMismatch: { expected: 2552, paid: 100 } } });
    await (await handleTicketEvent(client, ev("checkout.session.completed", paidSession)))?.afterCommit?.();
    expect(send.sendOrderFlagStaffEmail).toHaveBeenCalledWith(7, ["Amount paid doesn't match: check this booking"]);
    send.sendOrderFlagStaffEmail.mockClear();
    db.markOrderPaid.mockResolvedValue({ action: "tickets.paid_flagged", orderId: 7, flags: { paidLate: { was: "pending", overBy: 0 } } });
    await (await handleTicketEvent(client, ev("checkout.session.completed", paidSession)))?.afterCommit?.();
    expect(send.sendOrderFlagStaffEmail).not.toHaveBeenCalled();
  });

  it("sends no second email when Stripe sends the event again", async () => {
    db.markOrderPaid.mockResolvedValue({ action: "tickets.already_paid", orderId: 7, flags: null });
    const r = await handleTicketEvent(client, ev("checkout.session.completed", paidSession));
    expect(r?.afterCommit).toBeNull();
  });

  it("reads an expanded payment intent too", async () => {
    db.markOrderPaid.mockResolvedValue({ action: "tickets.paid", orderId: 7, flags: null });
    await handleTicketEvent(client, ev("checkout.session.completed", { ...paidSession, payment_intent: { id: "pi_tix_2" } }));
    expect(db.markOrderPaid.mock.calls[0][1].paymentIntentId).toBe("pi_tix_2");
  });

  it("does nothing yet for a checkout not paid, but still keeps it from the donations", async () => {
    const r = await handleTicketEvent(client, ev("checkout.session.completed", { ...paidSession, payment_status: "unpaid" }));
    expect(r).toEqual({ action: "tickets.not_paid", afterCommit: null });
    expect(db.markOrderPaid).not.toHaveBeenCalled();
  });

  it("keeps a ticket checkout with no reference from the donations, and says so", async () => {
    const r = await handleTicketEvent(client, ev("checkout.session.completed", { ...paidSession, metadata: { product: "event_tickets" } }));
    expect(r?.action).toBe("tickets.no_reference");
  });

  it("leaves a donation or the ball to their own handlers", async () => {
    expect(await handleTicketEvent(client, ev("checkout.session.completed", { ...paidSession, metadata: { fundraiserId: "12" } }))).toBeNull();
    expect(await handleTicketEvent(client, ev("checkout.session.completed", { ...paidSession, metadata: { product: "ball" } }))).toBeNull();
  });
});

describe("a ticket checkout expiring", () => {
  it("gives its places back", async () => {
    db.markOrderExpired.mockResolvedValue("tickets.expired");
    const r = await handleTicketEvent(client, ev("checkout.session.expired", { id: "cs_test_tix_1", metadata: { product: "event_tickets", orderReference: "TIX-ABCDEF" } }));
    expect(db.markOrderExpired).toHaveBeenCalledWith(client, "cs_test_tix_1", "TIX-ABCDEF");
    expect(r).toEqual({ action: "tickets.expired", afterCommit: null });
  });

  it("leaves other checkouts alone", async () => {
    expect(await handleTicketEvent(client, ev("checkout.session.expired", { id: "cs_x", metadata: { product: "ball" } }))).toBeNull();
  });
});

describe("anything Stripe says about a refund (charge.refunded, refund.created, refund.updated, refund.failed)", () => {
  const unchanged = { action: "tickets.refunds_unchanged", completedPence: 0, stripePence: 0, refundedNowPence: 0, full: false, failedWords: [] };
  const events: Array<[string, Record<string, unknown>]> = [
    ["charge.refunded", { object: "charge", id: "ch_1", payment_intent: "pi_tix_1", amount_refunded: 99999, refunds: { data: [{ id: "re_x", status: "succeeded", amount: 99999, metadata: { refundIntent: "31" } }] } }],
    ["refund.created", { object: "refund", id: "re_9", status: "succeeded", amount: 99999, payment_intent: "pi_tix_1", metadata: { refundIntent: "31" } }],
    ["refund.updated", { object: "refund", id: "re_9", status: "succeeded", amount: 99999, payment_intent: { id: "pi_tix_1" }, metadata: {} }],
    ["refund.failed", { object: "refund", id: "re_9", status: "failed", amount: 99999, payment_intent: "pi_tix_1", metadata: { refundIntent: "31" } }],
  ];

  it.each(events)("%s only says which order: Stripe is asked, and nothing of the event's own is passed on", async (type, object) => {
    db.orderIdForPaymentIntent.mockResolvedValue(7);
    db.reconcileRefunds.mockResolvedValue(unchanged);
    const r = await handleTicketEvent(client, ev(type, object));
    expect(db.orderIdForPaymentIntent).toHaveBeenCalledWith(client, "pi_tix_1");
    expect(db.reconcileRefunds).toHaveBeenCalledTimes(1);
    expect(db.reconcileRefunds).toHaveBeenCalledWith(client, 7, refunds.listStripeRefunds);
    expect(JSON.stringify(db.reconcileRefunds.mock.calls[0])).not.toContain("99999");
    expect(r).toEqual({ action: "tickets.refunds_unchanged", afterCommit: null });
  });

  it("tells the buyer, once it commits, of money the reconcile has just recorded", async () => {
    db.orderIdForPaymentIntent.mockResolvedValue(7);
    const done = { ...unchanged, action: "tickets.refund_completed", completedPence: 1000, refundedNowPence: 1000 };
    db.reconcileRefunds.mockResolvedValue(done);
    const r = await handleTicketEvent(client, ev(...events[1]));
    expect(send.tellAfterReconcile).not.toHaveBeenCalled();
    await r?.afterCommit?.();
    expect(send.tellAfterReconcile).toHaveBeenCalledWith(7, done);
  });

  it("tells staff, once it commits, of a refund that failed at the bank", async () => {
    db.orderIdForPaymentIntent.mockResolvedValue(7);
    const bad = { ...unchanged, action: "tickets.refund_failed", failedWords: ["Refund failed at the bank: the buyer has not been paid back. Refund again."] };
    db.reconcileRefunds.mockResolvedValue(bad);
    const r = await handleTicketEvent(client, ev(...events[3]));
    await r?.afterCommit?.();
    expect(send.tellAfterReconcile).toHaveBeenCalledWith(7, bad);
  });

  it("fails loudly when Stripe cannot be asked, so the webhook answers 500 and Stripe sends it again", async () => {
    db.orderIdForPaymentIntent.mockResolvedValue(7);
    db.reconcileRefunds.mockRejectedValue(new Error("socket hang up"));
    await expect(handleTicketEvent(client, ev(...events[0]))).rejects.toThrow("socket hang up");
  });

  it("leaves a donation's refund to the donations", async () => {
    db.orderIdForPaymentIntent.mockResolvedValue(null);
    expect(await handleTicketEvent(client, ev("charge.refunded", { object: "charge", id: "ch_2", payment_intent: "pi_gift", amount_refunded: 500 }))).toBeNull();
    expect(await handleTicketEvent(client, ev("refund.updated", { object: "refund", id: "re_2", payment_intent: "pi_gift" }))).toBeNull();
    expect(db.reconcileRefunds).not.toHaveBeenCalled();
  });
});

describe("a ticket charge disputed", () => {
  it("is noted on the order for staff", async () => {
    db.orderIdForPaymentIntent.mockResolvedValue(7);
    db.noteDispute.mockResolvedValue({ action: "tickets.disputed", tellStaff: false });
    const r = await handleTicketEvent(client, ev("charge.dispute.created", { object: "dispute", payment_intent: "pi_tix_1", amount: 2552, status: "needs_response" }));
    expect(db.noteDispute).toHaveBeenCalledWith(client, 7, "charge.dispute.created", "evt_t_1", "needs_response");
    expect(r).toEqual({ action: "tickets.disputed", afterCommit: null });
  });

  it("tells staff when the bank takes the money back", async () => {
    db.orderIdForPaymentIntent.mockResolvedValue(7);
    db.noteDispute.mockResolvedValue({ action: "tickets.dispute_funds_withdrawn", tellStaff: true });
    const r = await handleTicketEvent(client, ev("charge.dispute.funds_withdrawn", { object: "dispute", payment_intent: "pi_tix_1", amount: 2552, status: "needs_response" }));
    await r?.afterCommit?.();
    expect(send.sendOrderFlagStaffEmail).toHaveBeenCalledWith(7, ["Disputed with the bank: this money is not counted"]);
  });
});

describe("anything else", () => {
  it("is not a ticket event", async () => {
    expect(await handleTicketEvent(client, ev("invoice.paid", {}))).toBeNull();
  });
});

describe("a payment for an order we do not have", () => {
  it("is kept from the donations, and the events inbox is told", async () => {
    db.markOrderPaid.mockResolvedValue({ action: "tickets.unknown_order", orderId: null, flags: null, unknown: { reference: "TIX-ABCDEF", sessionId: "cs_test_tix_1", amountTotal: 2552 } });
    const r = await handleTicketEvent(client, ev("checkout.session.completed", paidSession));
    expect(r?.action).toBe("tickets.unknown_order");
    await r?.afterCommit?.();
    expect(send.sendUnknownPaymentStaffEmail).toHaveBeenCalledWith({ reference: "TIX-ABCDEF", sessionId: "cs_test_tix_1", amountTotal: 2552 });
    expect(send.sendTicketConfirmation).not.toHaveBeenCalled();
  });
});
