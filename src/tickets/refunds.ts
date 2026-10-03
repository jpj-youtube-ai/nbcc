import type { RefundLister, StripeRefundLite } from "../db/event-tickets";

// Event tickets: asking Stripe what it has refunded on a payment. Stripe is the source of truth for
// refunded money (src/db/event-tickets.ts reconcileRefunds): nothing here is taken from an event's
// own amounts. If Stripe cannot be reached this throws, and the caller says so (the webhook answers
// 500 so Stripe sends the event again; the admin is asked to try again).

/** As much of a Stripe refund as the tickets need. Ours carry the intent's id in their metadata. */
export function refundLite(r: { id?: unknown; status?: unknown; amount?: unknown; metadata?: Record<string, string> | null }): StripeRefundLite {
  const raw = r.metadata?.refundIntent;
  const intentId = typeof raw === "string" && /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
  return { id: String(r.id ?? ""), status: typeof r.status === "string" ? r.status : null, amount: typeof r.amount === "number" ? r.amount : 0, intentId };
}

/** Every refund Stripe has on this payment (a ticket order never has anywhere near a hundred). */
export const listStripeRefunds: RefundLister = async (paymentIntentId) => {
  const { stripe } = await import("../clients/stripe");
  // Asked while the order is locked, so it must not hang: eight seconds, and no second try (the
  // caller says so, and Stripe's event or the admin tries again).
  const list = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 }, { timeout: 8000, maxNetworkRetries: 0 });
  return list.data.map((r) => refundLite(r));
};

/**
 * Stripe's list, with the refund Stripe has this moment answered with: so the answer is used even if
 * the list has not caught up with it. As Stripe gave it; the list's own copy wins if it is there.
 */
export function withRefund(list: RefundLister, just: StripeRefundLite): RefundLister {
  return async (paymentIntentId) => {
    const all = await list(paymentIntentId);
    return all.some((r) => r.id === just.id) ? all : [...all, just];
  };
}
