import type Stripe from "stripe";
import { markOrderExpired, markOrderPaid, noteDispute, orderIdForPaymentIntent, reconcileRefunds, type Querier } from "../db/event-tickets";
import { sendOrderFlagStaffEmail, sendTicketConfirmation, sendUnknownPaymentStaffEmail, tellAfterReconcile } from "./send";
import { flagWords } from "./model";
import { listStripeRefunds } from "./refunds";

// Event tickets on the site's one Stripe webhook (src/db/stripe-webhook.ts calls this first, on its
// transaction, before anything else looks at the event). A ticket is a purchase, never a gift, so a
// ticket checkout must NEVER reach the donations handler, which would record ticket money as a
// donation and could put it in a Gift Aid claim. A ticket checkout carries product=event_tickets in
// its metadata; a donation or a ball booking never does.
//
//   checkout.session.completed   the order is paid; its tickets are emailed once the event commits
//   checkout.session.expired     an abandoned checkout gives its places back
//                                A payment that came late and took the event over its limit, or for
//                                the wrong amount, checkout or currency, is flagged on the order and
//                                the events inbox is emailed.
//   charge.refunded / refund.created / refund.updated / refund.failed
//                                Something about a refund changed. The event only says WHICH payment:
//                                its own amounts and status are never used. Stripe is asked what it
//                                has refunded on that payment and the order is made to agree
//                                (reconcileRefunds), so events arriving late, twice or out of order
//                                change nothing. If Stripe cannot be asked, this throws: the webhook
//                                answers 500 and Stripe sends the event again.
//   charge.dispute.*             noted for staff on the order; once the bank takes the money back the
//                                order is flagged, its money stops counting, and staff are emailed
//
// Null means "not a ticket event": the caller carries on as before.

export interface TicketWebhookResult {
  action: string;
  /** Runs once the webhook's transaction has committed. Best effort: it never throws. */
  afterCommit: (() => Promise<void>) | null;
}

export function isTicketSession(metadata: Record<string, string> | null | undefined): boolean {
  return metadata?.product === "event_tickets";
}

const idOf = (v: unknown): string | null => (typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null);

export async function handleTicketEvent(client: Querier, event: Stripe.Event): Promise<TicketWebhookResult | null> {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (!isTicketSession(s.metadata)) return null;
      const reference = s.metadata?.orderReference;
      if (!reference) {
        console.error(`event tickets: checkout ${s.id} has no order reference`);
        return { action: "tickets.no_reference", afterCommit: null };
      }
      // Card only, so a completed checkout is paid. Anything else waits (and never becomes a gift).
      if (s.payment_status !== "paid") return { action: "tickets.not_paid", afterCommit: null };
      const r = await markOrderPaid(client, {
        reference,
        sessionId: s.id,
        paymentIntentId: idOf(s.payment_intent),
        amountTotal: typeof s.amount_total === "number" ? s.amount_total : null,
        currency: typeof s.currency === "string" ? s.currency : null,
        eventId: event.id,
      });
      const orderId = r.orderId;
      const fresh = orderId !== null && (r.action === "tickets.paid" || r.action === "tickets.paid_flagged");
      // Money taken for an order we do not have: nothing to confirm, but staff must know.
      const unknown = r.unknown;
      if (unknown) return { action: r.action, afterCommit: () => sendUnknownPaymentStaffEmail(unknown) };
      if (!fresh) return { action: r.action, afterCommit: null };
      const tell = flagWords(r.flags);
      return {
        action: r.action,
        afterCommit: async () => {
          await sendTicketConfirmation(orderId);
          if (tell.length) await sendOrderFlagStaffEmail(orderId, tell);
        },
      };
    }
    case "checkout.session.expired": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (!isTicketSession(s.metadata)) return null;
      return { action: await markOrderExpired(client, s.id, s.metadata?.orderReference ?? null), afterCommit: null };
    }
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed": {
      // Ticket checkouts take cards only, so these never come; if one did, it is not a gift.
      const s = event.data.object as Stripe.Checkout.Session;
      return isTicketSession(s.metadata) ? { action: "tickets.ignored", afterCommit: null } : null;
    }
    case "charge.refunded":
    case "refund.created":
    case "refund.updated":
    case "refund.failed": {
      const pi = idOf((event.data.object as { payment_intent?: unknown }).payment_intent);
      const orderId = pi ? await orderIdForPaymentIntent(client, pi) : null;
      if (orderId === null) return null;
      const r = await reconcileRefunds(client, orderId, listStripeRefunds);
      return { action: r.action, afterCommit: r.refundedNowPence > 0 || r.failedWords.length ? () => tellAfterReconcile(orderId, r) : null };
    }
    case "charge.dispute.created":
    case "charge.dispute.closed":
    case "charge.dispute.funds_withdrawn":
    case "charge.dispute.funds_reinstated": {
      const dispute = event.data.object as Stripe.Dispute;
      const pi = idOf(dispute.payment_intent);
      const orderId = pi ? await orderIdForPaymentIntent(client, pi) : null;
      if (orderId === null) return null;
      const r = await noteDispute(client, orderId, event.type, event.id, typeof dispute.status === "string" ? dispute.status : null);
      return { action: r.action, afterCommit: r.tellStaff ? () => sendOrderFlagStaffEmail(orderId, flagWords({ disputed: true })) : null };
    }
    default:
      return null;
  }
}
