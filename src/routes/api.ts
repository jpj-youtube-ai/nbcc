import express, { Router, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type StripeNS from "stripe";
import { z } from "zod";
import { stripe, stripeConfigured, stripePriceByPlan, changeSubscriptionPlan, SamePlanError } from "../clients/stripe";
import {
  selectDeclarationWording,
  declarationScopeForMode,
  scopeFromDeclarationScope,
} from "../declarations/wording";
import { declarationFieldsSchema } from "../declarations/fields";
import { partnerShareSchema, validatePartnerShares } from "../declarations/partnership";
import { companyFieldsSchema } from "../donors/company";
import { getGiftAidDeclarationContext, completeDeclaration, GiftAidCompletionError } from "../db/donations";
import { renderGiftAidForm, renderGiftAidMessage } from "../declarations/render";
import { config } from "../config";
import { storySubmissionSchema, buildStoryRecord } from "../stories/schema";
import { insertStory } from "../db/stories";
import { contactEnquirySchema } from "../contact/schema";
import { insertEnquiry } from "../db/contact";
import { createRateLimiter } from "../portal/request-limiter";

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
const DONOR_TYPES = ["individual", "company", "partnership"] as const;

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
    // These fields are optional at the type level (the no-JS base contract is still
    // { mode, plan, amount, giftAid }), but email is REQUIRED for the individual/partnership
    // paths by the superRefine below and is ALWAYS stored by the webhook (REQ-039 revised);
    // emailConsent now governs MARKETING only, not storage. ageConfirmed is the 18+
    // attestation required for monthly giving below.
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
    // REQ-051: a business PARTNERSHIP makes one Gift Aid declaration per partner, each with
    // a share of the gift (TASK-080 folds these in as `partners`). Partners are individuals
    // in law, so the partnership keeps Gift Aid. Each entry is a full declaration + sharePence
    // (validated by the shared partnership module, TASK-079); the shares must sum EXACTLY to
    // amount, enforced below. Optional so the base contract and the individual/company paths
    // are unchanged.
    partners: z.array(partnerShareSchema).optional(),
    // REQ-038/REQ-053: an incorporated company supplies company-specific fields instead of a
    // Gift Aid declaration (validated by the shared donors module, TASK-085). Required on the
    // company path (enforced in the superRefine below); optional here so the individual /
    // partnership and no-JS base contracts are unchanged.
    company: companyFieldsSchema.optional(),
  })
  // A monthly gift needs EITHER a preset plan (its pre-configured recurring price) OR a custom
  // amount (an inline monthly recurring price, REQ-041) — but not neither.
  .refine((b) => b.mode !== "monthly" || b.plan !== null || b.amount !== null, {
    message: "monthly giving requires a plan or a custom amount",
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
  })
  // REQ-051: on the partnership Gift Aid path, the partners' shares must sum EXACTLY to the
  // donation amount — reject a payload whose shares over- or under-sum (or that carries no
  // partners) with a 400, reusing the pure validatePartnerShares (TASK-079). Only enforced
  // for a gift-aided partnership; the individual/company/no-Gift-Aid paths are untouched.
  .superRefine((b, ctx) => {
    if (b.donorType !== "partnership" || !b.giftAid) return;
    try {
      validatePartnerShares(b.partners ?? [], b.amount ?? -1);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : "invalid partner shares",
        path: ["partners"],
      });
    }
  })
  // REQ-038/REQ-053: a company donation MUST carry a valid company object — a missing or
  // invalid one (bad email, missing billing address/postcode, …) is rejected with 400. A
  // present-but-invalid `company` already fails the field-level companyFieldsSchema above; this
  // catches an absent one on the company path.
  .superRefine((b, ctx) => {
    if (b.donorType === "company" && b.company === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a company donation requires company details",
        path: ["company"],
      });
    }
    // REQ-039 (revised): email is mandatory and always stored, so we can send every
    // donor a thank-you and a portal link. Required for the individual/partnership paths;
    // a company carries its own required company.contactEmail instead, so it is exempt here.
    if (b.donorType !== "company") {
      const email = (b.email ?? "").trim();
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "a valid email is required",
          path: ["email"],
        });
      }
    }
  });

type CheckoutBody = z.infer<typeof checkoutBodySchema>;

// Card + BACS Direct Debit. Apple Pay / Google Pay are offered automatically by Stripe
// Checkout when the card method is enabled, so they need no entry here. BACS Direct Debit
// (REQ-029 · TASK-089) is offered for our GBP-only UK donations, which satisfy Stripe's
// BACS currency (GBP) + country (GB) requirement; it applies to both the one-off
// (mode: payment) and monthly (mode: subscription) sessions via `base` below.
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

  // Stamp the per-partner declarations + shares onto the session (REQ-051) so the webhook can
  // persist one declarations row + one donation_partner_shares row per partner — only for a
  // gift-aided partnership (its shares are already validated to sum to amount above). Carried
  // as a compact JSON array; a partnership with many partners could approach Stripe's 500-char
  // metadata value limit, which a later task can revisit if it bites.
  if (body.giftAid && body.donorType === "partnership" && body.partners) {
    metadata.partners = JSON.stringify(body.partners);
  }

  // Stamp the validated company fields onto the session (REQ-038/REQ-053) so the webhook can
  // map them onto the donor row (business_name/company_number/full_name/email + billing
  // address/postcode) — only for a company donor. A company is never Gift Aided, so there is
  // no declaration to stamp.
  if (body.donorType === "company" && body.company) {
    const c = body.company;
    metadata.companyLegalName = c.legalName;
    metadata.companyRegistrationNumber = c.registrationNumber ?? "";
    metadata.companyContactName = c.contactName;
    metadata.companyContactEmail = c.contactEmail;
    metadata.companyBillingAddress = c.billingAddress;
    metadata.companyBillingPostcode = c.billingPostcode;
    // Whether NBCC gave anything of value in return (REQ-053 · TASK-088): the webhook sends a
    // Corporation Tax receipt when false, or flags the gift for the trustees when true.
    metadata.companyConsiderationGiven = String(c.considerationGiven);
  }

  const base: StripeNS.Checkout.SessionCreateParams = {
    payment_method_types: PAYMENT_METHODS,
    success_url: config.STRIPE_SUCCESS_URL,
    cancel_url: config.STRIPE_CANCEL_URL,
    metadata,
    // Pre-fill and lock the donor's email on the Stripe Checkout page (TASK-203) so they never
    // retype the address we already captured. Stripe still needs an email for its records, so it is
    // shown read-only rather than removed. Absent for a company (its contact email is captured
    // separately in the company object), so no pre-fill there.
    ...(body.email ? { customer_email: body.email } : {}),
  };

  if (body.mode === "monthly") {
    // A preset tier uses its pre-configured recurring Price (one Price per plan, REQ-022/REQ-055).
    // A custom monthly amount (no plan, REQ-041) builds an INLINE monthly recurring price from the
    // entered amount — Stripe creates the ad-hoc price on the fly, so NO per-amount Product is
    // needed: it rolls up under the configured donation product, or names an inline one, exactly
    // like the one-off path below. The schema guarantees a plan OR an amount for a monthly gift.
    const donationProduct = config.STRIPE_DONATION_PRODUCT;
    const monthlyItem: StripeNS.Checkout.SessionCreateParams.LineItem = body.plan
      ? { price: stripePriceByPlan[body.plan], quantity: 1 }
      : {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: body.amount as number,
            recurring: { interval: "month" },
            ...(donationProduct
              ? { product: donationProduct }
              : { product_data: { name: "Monthly donation to NBCC" } }),
          },
        };
    return { ...base, mode: "subscription", line_items: [monthlyItem] };
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
    const params = buildSessionParams(parsed.data);
    const session = await stripe.checkout.sessions.create(params);
    const body: { url: string | null; session?: { id: string; metadata: typeof params.metadata; mode: typeof params.mode } } = {
      url: session.url,
    };
    // Stub-mode echo (TASK-116): when there is no live Stripe (offline stub) and we are
    // not in production, hand the built session back so the BDD donation journey can
    // replay the REAL stamped metadata into the completion webhook — mirroring how Stripe
    // echoes your session object back in checkout.session.completed. Production NEVER stubs
    // (see src/clients/stripe.ts), so its response stays { url }. The frontend reads only url.
    if (!stripeConfigured && config.NODE_ENV !== "production") {
      body.session = { id: session.id, metadata: params.metadata, mode: params.mode };
    }
    return res.status(200).json(body);
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

// Contact enquiry (2026-07-10 contact-inbox spec, Task 5). Validates a website enquiry and
// STORES it in the isolated contact DB (contactPool, via insertEnquiry) — no external forward.
// A honeypot (`company`) filled by a bot is silently accepted (200) but never stored, matching
// the my-story honeypot pattern. A per-IP rate limit guards the public, unauthenticated endpoint.
const contactLimiter = createRateLimiter({ max: 5, windowMs: 60_000 });

export async function postContact(req: Request, res: Response): Promise<Response> {
  // Honeypot: a real browser never fills the hidden `company` field. Pretend success, store nothing.
  if (typeof req.body?.company === "string" && req.body.company.trim() !== "") {
    return res.status(200).json({ status: "sent" });
  }

  const key = req.ip ?? "unknown";
  if (!contactLimiter.allow(key, Date.now())) {
    return res.status(429).json({ error: "Too many messages. Please try again shortly." });
  }

  const parsed = contactEnquirySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid contact request",
      details: parsed.error.flatten(),
    });
  }

  try {
    await insertEnquiry(parsed.data);
    return res.status(200).json({ status: "sent" });
  } catch (err) {
    console.error("contact store failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Could not send your message right now" });
  }
}

apiRouter.post(
  "/api/contact",
  express.urlencoded({ extended: false, limit: "16kb" }),
  postContact,
);

// Token-scoped Gift Aid declaration completion (REQ-048/TASK-076). The in-person
// confirmation email/QR (TASK-075) links a walk-in donor here with their donation's unique
// declaration_token. GET renders the declaration form with the VERBATIM HMRC wording and
// does NOT mutate (a mere view never advances declaration_status). POST persists the
// immutable declaration + links it + sets declaration_status='completed' in ONE audited
// transaction (completeDeclaration → writeWithAudit). The gift-aid.html file is the template
// rendered server side, so the form works without JS.
const GIFT_AID_TEMPLATE = resolve(__dirname, "../..", "gift-aid.html");

export async function getGiftAid(req: Request, res: Response): Promise<Response> {
  const template = readFileSync(GIFT_AID_TEMPLATE, "utf8");
  try {
    const ctx = await getGiftAidDeclarationContext(req.params.token);
    if (ctx.alreadyCompleted) {
      return res.status(200).type("html").send(
        renderGiftAidMessage(template, {
          heading: "Gift Aid already added",
          body: "Thank you. This donation's Gift Aid declaration is already complete, so there is nothing more for you to do.",
        }),
      );
    }
    return res.status(200).type("html").send(
      renderGiftAidForm(template, { token: req.params.token, wordingSnapshot: ctx.wordingSnapshot }),
    );
  } catch (err) {
    if (err instanceof GiftAidCompletionError && err.reason === "not_found") {
      return res.status(404).type("html").send(
        renderGiftAidMessage(template, {
          heading: "This link is not valid",
          body: "We could not find a donation for this Gift Aid link. Please use the link from your confirmation email.",
        }),
      );
    }
    console.error("gift-aid GET failed:", err instanceof Error ? err.message : err);
    return res.status(500).type("html").send(
      renderGiftAidMessage(template, {
        heading: "Something went wrong",
        body: "We could not load your Gift Aid form right now. Please try again later.",
      }),
    );
  }
}

// Coerce a native (url-encoded) form submission onto the declaration fields shape: empty
// optional inputs become undefined, and the non-UK checkbox (present only when ticked)
// becomes a boolean. declarationFieldsSchema.strict() then validates the rest.
function coerceDeclarationFields(body: Record<string, unknown>): Record<string, unknown> {
  const str = (v: unknown): string | undefined => {
    const s = typeof v === "string" ? v.trim() : "";
    return s.length > 0 ? s : undefined;
  };
  return {
    title: str(body.title),
    firstName: str(body.firstName),
    lastName: str(body.lastName),
    houseNameNumber: str(body.houseNameNumber),
    address: str(body.address),
    postcode: str(body.postcode),
    nonUk: body.nonUk === "true" || body.nonUk === "on" || body.nonUk === true,
  };
}

export async function postGiftAid(req: Request, res: Response): Promise<Response> {
  const template = readFileSync(GIFT_AID_TEMPLATE, "utf8");
  const parsed = declarationFieldsSchema.safeParse(
    coerceDeclarationFields((req.body ?? {}) as Record<string, unknown>),
  );
  if (!parsed.success) {
    return res.status(400).type("html").send(
      renderGiftAidMessage(template, {
        heading: "Please check your details",
        body: "Some required details were missing or invalid. Please go back and complete every required field, including a valid UK postcode unless you live outside the UK.",
      }),
    );
  }

  try {
    await completeDeclaration(req.params.token, parsed.data);
    return res.status(200).type("html").send(
      renderGiftAidMessage(template, {
        heading: "Gift Aid added, thank you",
        body: "Your Gift Aid declaration is complete. NBCC can now reclaim the tax on your gift at no extra cost to you.",
      }),
    );
  } catch (err) {
    if (err instanceof GiftAidCompletionError) {
      const notFound = err.reason === "not_found";
      return res.status(notFound ? 404 : 409).type("html").send(
        renderGiftAidMessage(template, {
          heading: notFound ? "This link is not valid" : "Nothing to complete",
          body: notFound
            ? "We could not find a donation for this Gift Aid link. Please use the link from your confirmation email."
            : "This Gift Aid declaration has already been completed, or is not awaiting confirmation.",
        }),
      );
    }
    console.error("gift-aid POST failed:", err instanceof Error ? err.message : err);
    return res.status(500).type("html").send(
      renderGiftAidMessage(template, {
        heading: "Something went wrong",
        body: "We could not save your Gift Aid declaration right now. Please try again later.",
      }),
    );
  }
}

apiRouter.get("/api/gift-aid/:token", getGiftAid);
// The form posts url-encoded (native, no-JS), so parse it here — the global express.json
// (src/app.ts) only handles application/json.
apiRouter.post("/api/gift-aid/:token", express.urlencoded({ extended: false }), postGiftAid);

// POST /api/my-story (Task B1 · REQ intent: "Persist My Story submissions to a dedicated
// stories database with consent & retention metadata."). Accepts BOTH application/json
// (Task A's JS-enhanced stepper) AND application/x-www-form-urlencoded (the native, no-JS
// form fallback — my-story.html's <form action="/api/my-story" method="post">). One Zod
// schema (src/stories/schema.ts) validates both transports; storySubmissionSchema's
// checkbox coercion already handles form-encoded "on"/"true" strings. Persists via
// insertStory, which uses ONLY the separate storiesPool (never src/db/pool.ts / the
// charity DB). Never logs story PII (only counts/booleans, never story_text or contact
// fields) — mirrors the security checklist in the spec.
const myStoryLimiter = createRateLimiter({ max: 5, windowMs: 15 * 60 * 1000 });

function myStoryThankYouHtml(): string {
  // Self-contained, minimal thank-you page for the no-JS path (no new static file):
  // links the real site stylesheet so it matches the brand, warm closing line per spec.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Thank you | Night Before Christmas Campaign</title>
<link rel="stylesheet" href="/assets/css/styles.css" />
</head>
<body>
<main class="my-story-thanks" style="max-width: 40rem; margin: 4rem auto; padding: 0 1.5rem; text-align: center;">
<h1>Thank you</h1>
<p>Your story becomes part of ours.</p>
<p><a href="/">Back to the home page</a></p>
</main>
</body>
</html>`;
}

export async function postMyStory(req: Request, res: Response): Promise<Response | void> {
  const isJson = Boolean(req.is("application/json"));
  const parsed = storySubmissionSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    if (isJson) {
      return res.status(400).json({ error: "Please check your story details and try again" });
    }
    return res.status(400).type("html").send(
      "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\" /><title>Please check your details</title></head>" +
        "<body><main><h1>Please check your details</h1><p>Some required details were missing or invalid. Please go back and try again.</p></main></body></html>",
    );
  }

  // Honeypot: a real visitor never fills this hidden field. Respond exactly as a
  // successful submission would, but silently drop it — no insert, no error surfaced.
  if (parsed.data.website && parsed.data.website.trim().length > 0) {
    return isJson
      ? res.status(200).json({ ok: true })
      : res.status(200).type("html").send(myStoryThankYouHtml());
  }

  // Per-IP rate limit (spam/abuse guard, mirrors src/portal/request-limiter usage in
  // postRequestAccess). Over-limit responds exactly like an honeypot drop: no insert.
  if (!myStoryLimiter.allow(req.ip ?? "unknown", Date.now())) {
    return isJson
      ? res.status(429).json({ error: "Too many submissions, please try again later" })
      : res.status(429).type("html").send(
          "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\" /><title>Please try again later</title></head>" +
            "<body><main><h1>Please try again later</h1><p>Too many submissions from this connection. Please try again later.</p></main></body></html>",
        );
  }

  try {
    await insertStory(buildStoryRecord(parsed.data));
  } catch (err) {
    // Never log story PII: log only that the insert failed, never the payload.
    console.error("my-story insert failed:", err instanceof Error ? err.message : "unknown error");
    if (isJson) {
      return res.status(500).json({ error: "We could not save your story right now" });
    }
    return res.status(500).type("html").send(
      "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\" /><title>Something went wrong</title></head>" +
        "<body><main><h1>Something went wrong</h1><p>We could not save your story right now. Please try again later.</p></main></body></html>",
    );
  }

  if (isJson) {
    return res.status(200).json({ ok: true });
  }
  return res.status(200).type("html").send(myStoryThankYouHtml());
}

// Body-size guard for the public, unauthenticated JSON path of this route. It reads
// only the Content-Length header (never the body), so it is mounted in src/app.ts
// scoped to "/api/my-story" BEFORE the global express.json() — giving a REAL 32kb cap
// (mounted after the parser it would be a no-op, since body-parser skips a body already
// parsed at its 100kb default). 32kb is comfortably above the largest legitimate JSON
// payload (storyText caps at 5000 chars, see src/stories/schema.ts) while shutting a
// deliberately oversized POST down early. Exported for that mount and for unit tests.
const MY_STORY_JSON_LIMIT_BYTES = 32 * 1024;

export function rejectOversizedMyStoryJson(req: Request, res: Response, next: () => void): void {
  if (req.is("application/json")) {
    const len = Number(req.headers["content-length"]);
    if (Number.isFinite(len) && len > MY_STORY_JSON_LIMIT_BYTES) {
      res.status(413).json({ error: "Your story submission is too large" });
      return;
    }
  }
  next();
}

// The form-encoded path (no-JS fallback) has NO global parser (only the global
// express.json() exists in src/app.ts), so a real, enforced per-route limit of 16kb
// is added here — comfortably above the largest legitimate form payload. The JSON-path
// size cap (rejectOversizedMyStoryJson) is mounted pre-parse in src/app.ts.
apiRouter.post(
  "/api/my-story",
  express.urlencoded({ extended: false, limit: "16kb" }),
  postMyStory,
);
