import type Stripe from "stripe";
import { recordUniformPayment, setUniformRefund, type Querier } from "../db/uniform-payments";
import { isUniformSession, uniformPaymentFromSession } from "./model";

// Uniform payments on the site's one Stripe webhook (TASK-604). src/db/stripe-webhook.ts calls this
// on its transaction BEFORE the donations handler, so uniform money can never be recorded as a gift
// (which would put it in the donation totals, send a thank you email, and could put it in a Gift Aid
// or small donations claim). A uniform checkout carries product = uniform, copied from its payment link.
//
//   checkout.session.completed / checkout.session.async_payment_succeeded
//                         kept as a uniform payment once it is paid; the site sends no email (Stripe's
//                         own receipt goes if it is switched on in Stripe)
//   checkout.session.expired / checkout.session.async_payment_failed
//                         nothing to keep, and never a gift
//   charge.refunded       Stripe's total refunded so far comes off the uniform payment
//
// Null means "not a uniform event": the caller carries on as before.

export interface UniformWebhookResult {
  action: string;
}

const idOf = (v: unknown): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null;

export async function handleUniformEvent(client: Querier, event: Stripe.Event): Promise<UniformWebhookResult | null> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const w = uniformPaymentFromSession(event.data.object as Stripe.Checkout.Session);
      if (!w) return null;
      if (!w.paid) return { action: "uniform.not_paid" };
      return { action: await recordUniformPayment(client, w, event.id) };
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const s = event.data.object as Stripe.Checkout.Session;
      return isUniformSession(s.metadata) ? { action: "uniform.ignored" } : null;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const intent = idOf(charge.payment_intent);
      if (!intent) return null;
      return (await setUniformRefund(client, intent, charge.amount_refunded ?? 0)) ? { action: "uniform.refunded" } : null;
    }
    default:
      return null;
  }
}
