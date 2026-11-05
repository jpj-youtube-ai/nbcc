import type Stripe from "stripe";

// The Stripe Checkout session for paying an invoice by card: exactly the invoice's amount, card only
// (Apple Pay and Google Pay come with card), tagged product "donation_invoice" so the webhook hands it
// to src/invoices/webhook.ts before anything else can mistake it for an ordinary gift. The expiry is
// counted from the start of the minute, so a second press of Pay in the same minute asks for exactly the
// same session (src/routes/invoices.ts reuses one idempotency key a minute, and Stripe refuses a reused key
// with different details). 32 minutes, so it is still over Stripe's 30 minute minimum at the minute's end.

export const INVOICE_PRODUCT = "donation_invoice";
export const CHECKOUT_MINUTES = 32;

export function buildInvoiceSessionParams(o: {
  invoiceId: number;
  number: string;
  amountPence: number;
  description: string;
  email: string;
  baseUrl: string;
  token: string;
  now?: Date;
}): Stripe.Checkout.SessionCreateParams {
  const base = o.baseUrl.replace(/\/+$/, "");
  const metadata = { product: INVOICE_PRODUCT, invoiceId: String(o.invoiceId) };
  const page = `${base}/invoice/${o.token}`;
  return {
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: { currency: "gbp", unit_amount: o.amountPence, product_data: { name: `Invoice ${o.number}: ${o.description}` } },
      },
    ],
    customer_email: o.email,
    metadata,
    payment_intent_data: { metadata },
    success_url: `${page}?paid=1`,
    cancel_url: page,
    expires_at: Math.floor((o.now ?? new Date()).getTime() / 60_000) * 60 + CHECKOUT_MINUTES * 60,
  };
}
