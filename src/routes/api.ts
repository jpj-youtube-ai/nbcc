import { Router, type Request, type Response } from "express";
import type StripeNS from "stripe";
import { z } from "zod";
import { stripe, stripePriceByPlan } from "../clients/stripe";
import { forwardEnquiry } from "../clients/contact";
import { config } from "../config";

// Marketing-site API endpoints, both implemented.
// - POST /api/checkout-session (REQ-029): turns the REQ-028 front-end payload into
//   a Stripe Checkout session and returns its { url }.
// - POST /api/contact (REQ-030): validates a website enquiry and forwards it to
//   the configured form service, returning success.
export const apiRouter = Router();

const PLANS = ["bronze", "silver", "gold", "platinum"] as const;

// The request body mirrors the payload assembled by startCheckout in main.js
// (REQ-028): { mode, plan, amount, giftAid }. Validated zod-first, the same style
// as src/config/schema.ts. The refinements reject the impossible combinations:
// a monthly gift needs a plan (to pick its recurring price), a one-off needs an
// amount (to build the inline price).
const checkoutBodySchema = z
  .object({
    mode: z.enum(["once", "monthly"]),
    plan: z.enum(PLANS).nullable(),
    amount: z.number().int().positive().nullable(),
    giftAid: z.boolean(),
  })
  .refine((b) => b.mode !== "monthly" || b.plan !== null, {
    message: "monthly giving requires a plan",
    path: ["plan"],
  })
  .refine((b) => b.mode !== "once" || b.amount !== null, {
    message: "a one-off gift requires an amount",
    path: ["amount"],
  });

type CheckoutBody = z.infer<typeof checkoutBodySchema>;

// Card plus BACS Direct Debit; Apple Pay / Google Pay are offered automatically
// by Stripe Checkout when the card method is enabled, so they need no entry here.
const PAYMENT_METHODS: StripeNS.Checkout.SessionCreateParams["payment_method_types"] = [
  "card",
  "bacs_debit",
];

// Assemble the Stripe Checkout session parameters from a validated body.
export function buildSessionParams(
  body: CheckoutBody,
): StripeNS.Checkout.SessionCreateParams {
  // Capture the Gift Aid declaration (and the gift context) on the session so the
  // 25% claim can be reconciled later. NOTE: durable storage of the declaration
  // (a Stripe webhook writing to the DB) is out of scope here — this only records
  // intent on the session metadata.
  const base: StripeNS.Checkout.SessionCreateParams = {
    payment_method_types: PAYMENT_METHODS,
    success_url: config.STRIPE_SUCCESS_URL,
    cancel_url: config.STRIPE_CANCEL_URL,
    metadata: {
      mode: body.mode,
      plan: body.plan ?? "",
      giftAid: String(body.giftAid),
    },
  };

  if (body.mode === "monthly") {
    // plan is guaranteed non-null by the schema refinement above.
    return {
      ...base,
      mode: "subscription",
      line_items: [{ price: stripePriceByPlan[body.plan as (typeof PLANS)[number]], quantity: 1 }],
    };
  }

  // One-off: an inline GBP price built from the amount in pence (schema-guaranteed
  // non-null for mode=once). When a donation product is configured, attach it so
  // all one-off gifts roll up under that product in Stripe; otherwise name an
  // inline product. Either way the amount stays the donor's entered value.
  const donationProduct = config.STRIPE_DONATION_PRODUCT;
  return {
    ...base,
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: body.amount as number,
          ...(donationProduct
            ? { product: donationProduct }
            : { product_data: { name: "Donation to NBCC" } }),
        },
      },
    ],
  };
}

export async function postCheckoutSession(req: Request, res: Response): Promise<Response> {
  const parsed = checkoutBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid checkout request",
      details: parsed.error.flatten(),
    });
  }

  try {
    const session = await stripe.checkout.sessions.create(buildSessionParams(parsed.data));
    return res.status(200).json({ url: session.url });
  } catch {
    // Upstream Stripe failure: the front-end (startCheckout) degrades to its
    // preview when it cannot get a { url }.
    return res.status(502).json({ error: "Checkout is temporarily unavailable" });
  }
}

apiRouter.post("/api/checkout-session", postCheckoutSession);

// Contact enquiry (REQ-030). Mirrors the checkout handler: zod-first validation,
// then forward via the contact client. The body matches the payload initContactForm
// posts (REQ-027): firstName/email/message required, lastName optional.
const contactBodySchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional().default(""),
  email: z.string().email(),
  message: z.string().min(1),
});

export async function postContact(req: Request, res: Response): Promise<Response> {
  const parsed = contactBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid contact request",
      details: parsed.error.flatten(),
    });
  }

  try {
    await forwardEnquiry(parsed.data);
    return res.status(200).json({ status: "sent" });
  } catch {
    // Upstream forwarding failure: the front-end (initContactForm) degrades to its
    // mailto fallback when it cannot reach the endpoint (REQ-027).
    return res.status(502).json({ error: "Could not send your message right now" });
  }
}

apiRouter.post("/api/contact", postContact);
