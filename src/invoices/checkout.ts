import type Stripe from "stripe";

// The Stripe Checkout session for paying an invoice by card: exactly the invoice's amount, card only
// (Apple Pay and Google Pay come with card), tagged product "donation_invoice" so the webhook hands it
// to src/invoices/webhook.ts before anything else can mistake it for an ordinary gift. 31 minutes,
// because Stripe refuses an expiry under 30 from when it receives the request.

export const INVOICE_PRODUCT = "donation_invoice";
export const CHECKOUT_MINUTES = 31;

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
    expires_at: Math.floor((o.now ?? new Date()).getTime() / 1000) + CHECKOUT_MINUTES * 60,
  };
}
