import { Router, type Request, type Response } from "express";
import type StripeNS from "stripe";
import { z } from "zod";
import { stripe, stripePriceByPlan, changeSubscriptionPlan, SamePlanError } from "../clients/stripe";
import { forwardEnquiry } from "../clients/contact";
import {
  selectDeclarationWording,
  declarationScopeForMode,
  scopeFromDeclarationScope,
} from "../declarations/wording";
import { declarationFieldsSchema } from "../declarations/fields";
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
const DONOR_TYPES = ["individual", "company"] as const;

const checkoutBodySchema = z
  .object({
    mode: z.enum(["once", "monthly"]),
    plan: z.enum(PLANS).nullable(),
    amount: z.number().int().positive().nullable(),
    giftAid: z.boolean(),
    // REQ-038: individuals (incl. sole traders / partners) take the Gift Aid path,
    // incorporated companies the no-Gift-Aid path. Defaulted to "individual" so the
    // no-JS base contract ({ mode, plan, amount, giftAid }) is still accepted — the
    // give widget only folds donorType/businessName in once its enhancement is live.
    // businessName is an optional donors-page display label carried through to the
    // donor record (REQ-053); it never switches the Gift Aid path.
    donorType: z.enum(DONOR_TYPES).default("individual"),
    businessName: z.string().optional(),
    // REQ-039: consent-based contact capture folded in by the give widget (TASK-058).
    // All optional so the no-JS base contract ({ mode, plan, amount, giftAid }) is
    // unchanged. email is optional and its persistence is gated on emailConsent by the
    // webhook; ageConfirmed is the 18+ attestation required for monthly giving below.
    fullName: z.string().optional(),
    email: z.string().optional(),
    emailConsent: z.boolean().optional(),
    anonymous: z.boolean().optional(),
    ageConfirmed: z.boolean().optional(),
    // REQ-043: the Gift Aid declaration folded in by the give widget (TASK-062) when
    // Gift Aid is opted in. Validated by the shared declarations module (TASK-061): a
    // present declaration must carry a valid UK postcode + house name/number (a non-UK
    // donor is exempt from the postcode), so a malformed one is rejected with 400. Only
    // an individual opts into Gift Aid, so this only ever arrives for that path.
    declaration: declarationFieldsSchema.optional(),
  })
  .refine((b) => b.mode !== "monthly" || b.plan !== null, {
    message: "monthly giving requires a plan",
    path: ["plan"],
  })
  .refine((b) => b.mode !== "once" || b.amount !== null, {
    message: "a one-off gift requires an amount",
    path: ["amount"],
  })
  // A company can never claim Gift Aid, so a company payload that also asserts
  // giftAid=true is contradictory — reject it rather than silently dropping the flag.
  .refine((b) => !(b.donorType === "company" && b.giftAid), {
    message: "a company donation cannot claim Gift Aid",
    path: ["giftAid"],
  })
  // Monthly giving is set up by adults aged 18 or over (REQ-039), so a monthly payload
  // must affirmatively confirm it — reject one that does not with a 400.
  .refine((b) => b.mode !== "monthly" || b.ageConfirmed === true, {
    message: "monthly giving requires confirming you are aged 18 or over",
    path: ["ageConfirmed"],
  });

type CheckoutBody = z.infer<typeof checkoutBodySchema>;

// Card only. Apple Pay / Google Pay are offered automatically by Stripe Checkout
// when the card method is enabled, so they need no entry here. BACS Direct Debit
// was dropped because it needs a separate Stripe account activation; re-add
// "bacs_debit" here once it is enabled in the Stripe dashboard.
const PAYMENT_METHODS: StripeNS.Checkout.SessionCreateParams["payment_method_types"] = ["card"];

// Assemble the Stripe Checkout session parameters from a validated body.
export function buildSessionParams(
  body: CheckoutBody,
): StripeNS.Checkout.SessionCreateParams {
  // Capture the Gift Aid declaration (and the gift context) on the session so the
  // 25% claim can be reconciled later. NOTE: durable storage of the declaration
  // (a Stripe webhook writing to the DB) is out of scope here — this only records
  // intent on the session metadata.
  const metadata: Record<string, string> = {
    mode: body.mode,
    plan: body.plan ?? "",
    giftAid: String(body.giftAid),
    // Stamp the donor type + optional business name alongside giftAid (REQ-038), so
    // the single Stripe webhook can persist them onto the donor record (REQ-036).
    donorType: body.donorType,
    businessName: body.businessName ?? "",
    // REQ-039: carry the consent-based contact capture to the webhook, which maps
    // full_name / email / email_consent / anonymous onto the donor row (email is
    // persisted only with consent). ageConfirmed records the 18+ attestation.
    fullName: body.fullName ?? "",
    email: body.email ?? "",
    emailConsent: String(body.emailConsent ?? false),
    anonymous: String(body.anonymous ?? false),
    ageConfirmed: String(body.ageConfirmed ?? false),
  };

  // The declaration scope defaults from the gift's frequency (REQ-041): monthly is
  // enduring — one declaration covers all the donor's gifts — while a one-off covers just
  // this donation. When the donor makes an explicit choice (REQ-044, TASK-065), that value
  // OVERRIDES the mode default so a one-off donor can opt into an enduring, all-donations
  // declaration; absent it, requests without JS/scope choice keep the mode-derived default.
  // Stamped on EVERY session and reused below (via scopeFromDeclarationScope) to pick the
  // matching verbatim wording, so scope selection is never duplicated.
  const declarationScope = body.declaration?.scope ?? declarationScopeForMode(body.mode);
  metadata.declarationScope = declarationScope;

  // When Gift Aid is affirmatively opted in, bind the consent to the EXACT verbatim
  // HMRC statement the donor saw (REQ-042): stamp the selected wording version +
  // snapshot so the REQ-036 webhook can persist them onto the immutable declaration
  // (REQ-043/REQ-046) — no declarations row is written here. The enduring declaration
  // scope maps to the all-donations template, this_donation to the single-donation one.
  if (body.giftAid) {
    const wording = selectDeclarationWording({
      mode: body.mode,
      scope: scopeFromDeclarationScope(declarationScope),
    });
    metadata.giftAidWordingVersion = wording.wording_version;
    metadata.giftAidWording = wording.wording_snapshot;
  }

  // Stamp the captured HMRC declaration onto the session (REQ-043) so the webhook can
  // persist a declarations row — only for a gift-aided individual, the only path that
  // makes a declaration. A non-UK donor omits the postcode.
  if (body.giftAid && body.donorType === "individual" && body.declaration) {
    const d = body.declaration;
    metadata.declTitle = d.title ?? "";
    metadata.declFirstName = d.firstName;
    metadata.declLastName = d.lastName;
    metadata.declHouseNameNumber = d.houseNameNumber ?? "";
    metadata.declAddress = d.address;
    metadata.declPostcode = d.nonUk ? "" : (d.postcode ?? "");
    metadata.declNonUk = String(d.nonUk);
  }

  const base: StripeNS.Checkout.SessionCreateParams = {
    payment_method_types: PAYMENT_METHODS,
    success_url: config.STRIPE_SUCCESS_URL,
    cancel_url: config.STRIPE_CANCEL_URL,
    metadata,
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
  } catch (err) {
    // Upstream Stripe failure: log the real reason (e.g. a payment method not
    // activated, or a key-permission error) so it is visible in CloudWatch, then
    // return 502 — the front-end (startCheckout) degrades to its preview when it
    // cannot get a { url }. The message is safe to log; no secret is included.
    console.error("checkout-session create failed:", err instanceof Error ? err.message : err);
    return res.status(502).json({ error: "Checkout is temporarily unavailable" });
  }
}

apiRouter.post("/api/checkout-session", postCheckoutSession);

// POST /api/subscription/change-plan (REQ-055): move a monthly subscription up or
// down a tier. Validated zod-first (same style as checkout above): a non-empty
// subscriptionId and a known plan. The plan→price mapping and the single-item swap
// (with proration_behavior 'create_prorations' — one Price per tier, so proration
// is Stripe's job) live in src/clients/stripe (changeSubscriptionPlan). This is the
// backend capability ONLY — the donor-facing triggers are out of scope here: the
// self-serve donor portal (REQ-061) and role-based admin-on-behalf (REQ-062).
const changePlanBodySchema = z.object({
  subscriptionId: z.string().min(1),
  plan: z.enum(PLANS),
});

export async function postChangePlan(req: Request, res: Response): Promise<Response> {
  const parsed = changePlanBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid plan change request",
      details: parsed.error.flatten(),
    });
  }

  try {
    const subscription = await changeSubscriptionPlan(
      parsed.data.subscriptionId,
      parsed.data.plan,
    );
    return res.status(200).json(subscription);
  } catch (err) {
    // A no-op change (already on this tier) is a client error → 400. Any other
    // failure is an upstream Stripe problem → 502, mirroring the checkout endpoint's
    // shape. The message is safe to log; no secret is included.
    if (err instanceof SamePlanError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("change-plan update failed:", err instanceof Error ? err.message : err);
    return res.status(502).json({ error: "Plan change is temporarily unavailable" });
  }
}

apiRouter.post("/api/subscription/change-plan", postChangePlan);

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
