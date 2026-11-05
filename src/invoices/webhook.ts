import type Stripe from "stripe";
import type { PoolClient } from "pg";
import { settleInvoice, sendInvoicesPaidTwiceAlert } from "../db/invoices";
import { ukDay } from "../analytics/visitor";
import { INVOICE_PRODUCT } from "./checkout";

// The Stripe webhook's invoice step (src/db/stripe-webhook.ts runs it first): a Checkout session tagged
// product "donation_invoice" (src/invoices/checkout.ts) is an invoice paid by card. It is settled here,
// in the webhook's transaction, and never reaches the ordinary gift path, so it cannot be recorded twice
// or without its invoice. The receipt, and a note to the giving inbox if it was paid twice, go after the
// commit, like every other send in the webhook.

export interface InvoiceWebhookResult {
  action: string;
  afterCommit: (() => Promise<void>) | null;
}

export async function handleInvoiceEvent(client: PoolClient, event: Stripe.Event): Promise<InvoiceWebhookResult | null> {
  if (event.type !== "checkout.session.completed") return null;
  const s = event.data.object as Stripe.Checkout.Session;
  if (s.metadata?.product !== INVOICE_PRODUCT) return null;
  if (s.payment_status !== "paid") return { action: "invoice.not_paid", afterCommit: null };

  const raw = s.metadata?.invoiceId ?? "";
  const id = /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
  const intent = typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null);
  const when = new Date((event.created ?? Math.floor(Date.now() / 1000)) * 1000);
  const out =
    id === null ? null : await settleInvoice(client, id, { by: "card", paidOn: ukDay(when), sessionId: s.id, paymentIntentId: intent, actor: "stripe" });
  if (!out) {
    // Money was taken against an invoice we cannot find. Stripe still holds the payment; say so loudly.
    console.error(`invoice payment for unknown invoice ${raw || "(none)"}: session ${s.id}`);
    return { action: "invoice.unknown", afterCommit: null };
  }
  if (out.outcome === "already-recorded") return { action: "invoice.already_recorded", afterCommit: null };
  const twice = out.outcome === "paid-twice";
  return {
    action: twice ? "invoice.paid_twice" : "invoice.paid",
    afterCommit: async () => {
      await out.receipt();
      if (twice) await sendInvoicesPaidTwiceAlert();
    },
  };
}
