import type Stripe from "stripe";

// Uniform payments (TASK-604): school uniforms the charity supplies, bought through a Stripe payment
// link that carries product = uniform in its metadata (Stripe copies a payment link's metadata onto
// every checkout session it makes). A uniform is a purchase, NEVER a gift: it is kept in its own table
// (uniform_payments), so it is in no donation figure, no Gift Aid or small donations claim, no
// supporters list and no thank you email. Admin > Donations shows it under its own Uniform tile.
//
// PURE: no pool, no config, no clock. src/uniform/webhook.ts takes these to the database.

/** The Uniform tile's filter value in Admin > Donations (listDonations). Not a donations.source. */
export const UNIFORM_SOURCE = "uniform";

export function isUniformSession(metadata: Record<string, string> | null | undefined): boolean {
  return typeof metadata?.product === "string" && metadata.product.trim().toLowerCase() === "uniform";
}

/** One thing the buyer filled in on the payment link (a child's name, a size ...), as the link asked it. */
export interface UniformDetail {
  label: string;
  value: string;
}

export interface UniformPaymentWrite {
  sessionId: string;
  paymentIntentId: string | null;
  paymentLinkId: string | null;
  amountPence: number;
  currency: string;
  buyerName: string | null;
  buyerEmail: string | null;
  details: UniformDetail[];
  /** False while the money has not come in (a payment that clears later). */
  paid: boolean;
}

const idOf = (v: unknown): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null;

const words = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function detailsOf(fields: Stripe.Checkout.Session.CustomField[] | null | undefined): UniformDetail[] {
  const out: UniformDetail[] = [];
  for (const f of fields ?? []) {
    const label = words(f.label?.custom) ?? words(f.key) ?? "Detail";
    let value: string | null = null;
    if (f.type === "dropdown") {
      const chosen = f.dropdown?.value ?? null;
      value = words(f.dropdown?.options?.find((o) => o.value === chosen)?.label) ?? words(chosen);
    } else if (f.type === "numeric") {
      value = words(f.numeric?.value);
    } else {
      value = words(f.text?.value);
    }
    if (value) out.push({ label, value });
  }
  return out;
}

/** A uniform payment from its checkout session; null for a session that is not a uniform's. */
export function uniformPaymentFromSession(s: Stripe.Checkout.Session): UniformPaymentWrite | null {
  return isUniformSession(s.metadata) ? uniformPaymentFromLinkSession(s) : null;
}

/** A uniform payment from a session the uniform payment link made, whatever its own metadata says: a
 *  sale made before the link was marked product = uniform carries no mark of its own. For the one off
 *  move of earlier uniform payments (src/scripts/move-uniform-payments.ts), which finds sessions by
 *  their link. */
export function uniformPaymentFromLinkSession(s: Stripe.Checkout.Session): UniformPaymentWrite {
  return {
    sessionId: s.id,
    paymentIntentId: idOf(s.payment_intent),
    paymentLinkId: idOf(s.payment_link),
    amountPence: typeof s.amount_total === "number" ? s.amount_total : 0,
    currency: (typeof s.currency === "string" && s.currency ? s.currency : "gbp").toUpperCase(),
    buyerName: words(s.customer_details?.name),
    buyerEmail: words(s.customer_details?.email),
    details: detailsOf(s.custom_fields),
    paid: s.payment_status === "paid",
  };
}
