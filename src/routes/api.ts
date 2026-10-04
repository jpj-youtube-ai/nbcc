import express, { Router, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type StripeNS from "stripe";
import { z } from "zod";
import { stripe, stripeConfigured } from "../clients/stripe";
import {
  selectDeclarationWording,
  declarationScopeForMode,
  scopeFromDeclarationScope,
} from "../declarations/wording";
import { declarationFieldsSchema } from "../declarations/fields";
import { partnerShareSchema, validatePartnerShares } from "../declarations/partnership";
import { companyFieldsSchema } from "../donors/company";
import { containsBlockedWord } from "../donors/display-name-filter";
import { getGiftAidDeclarationContext, completeDeclaration, GiftAidCompletionError } from "../db/donations";
import { renderGiftAidForm, renderGiftAidMessage } from "../declarations/render";
import { config } from "../config";
import { grossedUpFeePence, DEFAULT_CARD_FEE, type CardFeeRate } from "../ball/pricing";
import { storySubmissionSchema, buildStoryRecord } from "../stories/schema";
import { insertStory } from "../db/stories";
import { contactEnquirySchema } from "../contact/schema";
import { insertEnquiry } from "../db/contact";
import { createRateLimiter } from "../portal/request-limiter";
import { captchaEnabled, captchaSiteKey, verifyCaptcha } from "../clients/turnstile";
import { GIFT_MIN_PENCE, MESSAGE_MAX } from "../fundraising/model";
import { RED_BAG_PATH } from "../red-bag/switch";
import { redBagOpenTo } from "../red-bag/staff";

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

// Fill a Red Bag: the smallest gift, in pence (the page says the same: assets/js/red-bag-catalogue.js).
export const RED_BAG_MIN_PENCE = 200;

const checkoutBodySchema = z
  .object({
    mode: z.enum(["once", "monthly"]),
    plan: z.enum(PLANS).nullable(),
    amount: z.number().int().positive().nullable(),
    giftAid: z.boolean(),
    // TASK-321: the donor offering to cover Stripe's fee. A separate, voluntary amount that is
    // NOT part of the gift — it is excluded from amount_pence, from the Gift Aid claim and from
    // the GASDS £30 test. Defaulted false so the no-JS base contract is unchanged.
    coverFee: z.boolean().default(false),
    // TASK-215: which Stripe Checkout UI to open. "hosted" (the DEFAULT when absent) keeps the
    // existing behaviour byte-for-byte — Stripe returns a redirect { url } and the donor completes
    // payment on checkout.stripe.com; it is the no-JS fallback and safety net. "embedded" returns a
    // { clientSecret } the donor-page mounts inline (Stripe Embedded Checkout) so they never leave
    // nbcc.scot. Defaulting to "hosted" means any un-updated caller and the fallback path are
    // unchanged; everything else about the session (line items, amount, mode, customer_email,
    // ALL metadata) is identical across both modes — only the redirect surface differs.
    uiMode: z.enum(["hosted", "embedded"]).default("hosted"),
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
    // TASK-224: an individual monthly donor can opt into the public supporters wall from the donate
    // form. listOnSupporters is their choice; creditName is the optional public display name (the wall
    // falls back to full_name). Both optional at the type level so the no-JS base contract is unchanged;
    // the webhook maps them onto donors.list_on_supporters / credit_name. The wall only ever shows a
    // paid monthly gift >= £10 that is not anonymous/hidden, so an over-permissive stamp cannot leak.
    listOnSupporters: z.boolean().optional(),
    creditName: z.string().trim().min(1).max(200).optional(),
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
    // TASK-493: a gift made on a community fundraiser's page (/fundraise/<slug>). The webhook links
    // it to the fundraiser only if this names an APPROVED (or, TASK-502, FINISHED) one; otherwise it is
    // an ordinary donation.
    // The message and the two wall choices mean nothing without it, so they are only stamped with it
    // (buildSessionParams), which keeps every donate page session exactly as it was.
    fundraiserId: z.number().int().positive().optional(),
    supporterMessage: z.string().trim().max(MESSAGE_MAX).optional(),
    showName: z.boolean().optional(),
    showAmount: z.boolean().optional(),
    // Fill a Red Bag (/fill-a-red-bag): an optional marker on an otherwise ordinary donation. Absent
    // (every donate page gift), nothing below applies and the session is exactly what it always was.
    redBag: z.boolean().optional(),
  })
  // Fill a Red Bag: £2 at least, and never also a gift on a fundraiser's page. Only with the marker.
  .refine((b) => b.redBag !== true || (b.amount ?? 0) >= RED_BAG_MIN_PENCE, {
    message: "the smallest Fill a Red Bag gift is £2",
    path: ["amount"],
  })
  .refine((b) => b.redBag !== true || b.fundraiserId === undefined, {
    message: "a Fill a Red Bag gift is not a gift on a fundraising page",
    path: ["fundraiserId"],
  })
  // TASK-493: giving on a fundraiser's page is one off only, and £2 at least, as the design asks.
  // Monthly gifts there are not built yet (they would need the wall and meter to follow renewals).
  .refine((b) => b.fundraiserId === undefined || b.mode === "once", {
    message: "gifts on a fundraising page are one off",
    path: ["mode"],
  })
  .refine((b) => b.fundraiserId === undefined || (b.amount ?? 0) >= GIFT_MIN_PENCE, {
    message: "the smallest gift on a fundraising page is £2",
    path: ["amount"],
  })
  // Every monthly gift builds its recurring price INLINE from the amount (pence, TASK-231) — preset
  // tiers and custom amounts alike — so a monthly gift always requires an amount. (A preset tier's
  // amount rides in on its data-amount; the custom box builds it from the typed value.) The plan is
  // still carried for metadata/reporting but no longer selects a fixed Stripe Price.
  .refine((b) => b.mode !== "monthly" || b.amount !== null, {
    message: "monthly giving requires an amount",
    path: ["amount"],
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
  })
  // TASK-224: the individual supporters-wall opt-in. Require the display name when the donor asks to be
  // listed, and reject a profane one at source (mirrors the business capture, src/routes/business.ts), so
  // it never reaches the wall. Plain, dash-free messages. Only ever enforced when the fields are present.
  .superRefine((b, ctx) => {
    if (b.listOnSupporters && !b.creditName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creditName"],
        message: "Please tell us how your name should appear on our supporters page.",
      });
    }
    if (b.creditName && containsBlockedWord(b.creditName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creditName"],
        message: "Please choose a different name to show on our supporters page.",
      });
    }
    // TASK-493: the same check for a message on a fundraiser's supporter wall, which is public too.
    if (b.supporterMessage && containsBlockedWord(b.supporterMessage)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supporterMessage"],
        message: "Please choose different words for your message on the supporter wall.",
      });
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

// The on-site landing Stripe returns the donor to after checkout, built on config.STRIPE_SUCCESS_URL
// (the shared config base). TASK-221 makes it TYPE-AWARE: it carries the gift's `mode` (once|monthly)
// and `donor` (donorType) as query params so the thank-you page can pick which of its four variants to
// show, PLUS the session id via Stripe's {CHECKOUT_SESSION_ID} template — which Stripe substitutes, so
// the braces must NOT be URL-encoded. The page reads session_id to look up a business supporter's
// recognition record (read-only, by-session). Used for BOTH UI modes (TASK-215) so the hosted
// success_url and the embedded return_url land the SAME page with the SAME params — only the redirect
// surface differs. mode/donor are validated enum values (URL-safe), so no encoding is needed; the
// `?`/`&` separator is chosen so it composes with a base that already carries a query string.
export function thankYouReturnUrl(mode: CheckoutBody["mode"], donorType: CheckoutBody["donorType"]): string {
  const base = config.STRIPE_SUCCESS_URL;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}mode=${mode}&donor=${donorType}&session_id={CHECKOUT_SESSION_ID}`;
}

// Embedded Checkout only ENGAGES when a publishable key is actually configured (TASK-215). With no
// key set, a uiMode=embedded request is served exactly like hosted — the browser could not construct
// Stripe.js without the key anyway — so the server never mints an embedded session that cannot work,
// and the feature stays DORMANT (hosted redirect) until STRIPE_PUBLISHABLE_KEY + its infra are
// applied. Used by BOTH buildSessionParams (session shape) and postCheckoutSession (response shape)
// so the two always agree: an embedded session iff an embedded { clientSecret } response.
export function embeddedRequested(body: CheckoutBody): boolean {
  return body.uiMode === "embedded" && Boolean(config.STRIPE_PUBLISHABLE_KEY);
}

// How much this donor is offering towards Stripe's fee, in pence — 0 unless they asked.
//
// ONE-OFF ONLY, deliberately. A monthly gift is charged again every month, so a recurring fee
// cover would have to be split back out of every renewal invoice and every subsequent Gift Aid
// claim. That is a separate piece of work; offering it here and getting it wrong would corrupt
// a claim twelve times a year rather than once.
export function donationFeeCoverPence(body: CheckoutBody, cardFee: CardFeeRate): number {
  if (!body.coverFee || body.mode !== "once" || !body.amount) return 0;
  // TASK-348: grossed up, so the donation the donor chose is what actually lands.
  return grossedUpFeePence(body.amount, cardFee);
}

// Assemble the Stripe Checkout session parameters from a validated body.
//
// cardFee is passed IN rather than read here so this stays a pure, DB-free function the unit
// tests can drive (it is the single place the session's shape is decided).
export function buildSessionParams(
  body: CheckoutBody,
  cardFee: CardFeeRate = DEFAULT_CARD_FEE,
  // TASK-494: the full address of the fundraiser's own page, worked out by the SERVER from the
  // fundraiser the gift names (fundraiserReturnPage), never taken from the browser. Given, the giver
  // comes back to that page with a thank you; absent (every donate page gift, and any fundraiser
  // without a public page), the session is exactly what it always was.
  fundraiserPage: string | null = null,
): StripeNS.Checkout.SessionCreateParams {
  // Capture the Gift Aid declaration (and the gift context) on the session so the
  // 25% claim can be reconciled later. NOTE: durable storage of the declaration
  // (a Stripe webhook writing to the DB) is out of scope here — this only records
  // intent on the session metadata.
  const feeCoverPence = donationFeeCoverPence(body, cardFee);
  const metadata: Record<string, string> = {
    mode: body.mode,
    plan: body.plan ?? "",
    giftAid: String(body.giftAid),
    // TASK-321: stamped so the webhook can subtract it back out of Stripe's amount_total,
    // which is the sum of EVERY line item. Without this the fee cover would be recorded as
    // part of the gift and Gift Aid would be claimed on it.
    feeCoverPence: String(feeCoverPence),
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
    // TASK-224: carry the individual supporters-wall opt-in to the webhook, which maps it onto
    // donors.list_on_supporters / credit_name. Defaults false/"" so a donor who did not opt in (or any
    // non-monthly / sub-£10 gift, where the form never offers it) is never listed.
    listOnSupporters: String(body.listOnSupporters ?? false),
    creditName: body.creditName ?? "",
  };

  // TASK-493: only for a gift on a fundraiser's page, so a donate page session gains no keys at all.
  // Stripe allows 500 characters a value; the message is held to 200 by the schema.
  if (body.fundraiserId !== undefined) {
    metadata.fundraiserId = String(body.fundraiserId);
    metadata.supporterMessage = body.supporterMessage ?? "";
    // TASK-502: the give form no longer asks, so the name stays off the wall until the giver chooses
    // to show it on the thank you after paying. A page opened before then may still send a choice.
    metadata.showName = String(body.showName ?? false);
    metadata.showAmount = String(body.showAmount ?? true);
  }

  // Fill a Red Bag: one key, only for a gift made on that page, so a donate page session gains no
  // keys at all. The webhook records the gift as the ordinary donation it is.
  if (body.redBag === true) metadata.redBag = "true";

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
    metadata,
    // Pre-fill and lock the donor's email on the Stripe Checkout page (TASK-203) so they never
    // retype the address we already captured. Stripe still needs an email for its records, so it is
    // shown read-only rather than removed. Absent for a company (its contact email is captured
    // separately in the company object), so no pre-fill there.
    ...(body.email ? { customer_email: body.email } : {}),
    // The ONLY difference between the two UI modes is the redirect surface (TASK-215):
    // - embedded (inline), ONLY when a publishable key is configured (embeddedRequested): Stripe's
    //   SDK enum is "embedded_page"; it needs a return_url (Stripe redirects the whole page there on
    //   completion, defaulting to redirect_on_completion:always) and must NOT carry
    //   success_url/cancel_url.
    // - hosted (redirect, the default — and where embedded is requested but no key is set): no
    //   ui_mode (Stripe defaults to hosted_page) + the existing success_url/cancel_url.
    // BOTH land the SAME type-aware thank-you page (TASK-221) via thankYouReturnUrl — carrying the
    // gift's mode+donor (which of the four variants to show) and {CHECKOUT_SESSION_ID} (the business
    // supporter recognition lookup). cancel_url is unchanged (a cancel is not a thank-you).
    ...(body.redBag === true
      ? redBagReturnUrls(embeddedRequested(body))
      : fundraiserPage
      ? fundraiserReturnUrls(fundraiserPage, Boolean(body.supporterMessage), embeddedRequested(body))
      : embeddedRequested(body)
        ? { ui_mode: "embedded_page", return_url: thankYouReturnUrl(body.mode, body.donorType) }
        : { success_url: thankYouReturnUrl(body.mode, body.donorType), cancel_url: config.STRIPE_CANCEL_URL }),
  };

  if (body.mode === "monthly") {
    // EVERY monthly gift — preset tier OR custom amount — builds an INLINE monthly recurring price
    // from the entered amount (pence, GBP, interval month), the way the custom amount always did
    // (REQ-041). Stripe creates the ad-hoc recurring price on the fly, so NO fixed Stripe Prices
    // (STRIPE_PRICE_*) are needed in any environment — this is what fixes staging's REPLACE_ME 502s
    // and removes the manual per-env price setup for prod. It rolls up under the configured donation
    // product, or names an inline one, exactly like the one-off path below. The schema guarantees a
    // monthly gift carries an amount. The plan is unchanged on metadata above, so the Stripe webhook
    // and everything downstream see exactly what they saw before.
    const donationProduct = config.STRIPE_DONATION_PRODUCT;
    const monthlyItem: StripeNS.Checkout.SessionCreateParams.LineItem = {
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
  const lineItems: StripeNS.Checkout.SessionCreateParams.LineItem[] = [
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
  ];
  // Its OWN line, and deliberately NOT rolled under the donation product: the donor sees on
  // Stripe's page exactly what each part of the charge is, and NBCC's Stripe reporting keeps
  // gifts and fee contributions apart rather than inflating donation totals.
  if (feeCoverPence > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "gbp",
        unit_amount: feeCoverPence,
        product_data: {
          name: "Covering the card fee",
          description: "So your full gift reaches NBCC",
        },
      },
    });
  }
  return { ...base, mode: "payment", line_items: lineItems };
}

// TASK-494: where a gift made on a fundraiser's page comes back to. The thank you is that page with
// ?thanks=1 (and &message=1 when a page opened before TASK-502 sent a message with the gift); a
// cancel on Stripe's own page goes back to the page itself.
// TASK-502: and Stripe's {CHECKOUT_SESSION_ID} template, which Stripe fills in with the paid
// session's id (so the braces must NOT be encoded), so the thank you can offer the optional step to
// add a message to the wall, tied to that payment (POST /api/fundraisers/:slug/wall-message).
function fundraiserReturnUrls(
  page: string,
  leftMessage: boolean,
  embedded: boolean,
): Pick<StripeNS.Checkout.SessionCreateParams, "ui_mode" | "return_url" | "success_url" | "cancel_url"> {
  const thanks = `${page}?thanks=1${leftMessage ? "&message=1" : ""}&session_id={CHECKOUT_SESSION_ID}`;
  return embedded ? { ui_mode: "embedded_page", return_url: thanks } : { success_url: thanks, cancel_url: page };
}

// Fill a Red Bag: where a gift made on /fill-a-red-bag comes back to. Worked out HERE, from the
// site's own address (config.PORTAL_BASE_URL, the public address the fundraiser pages use too), and
// never taken from the browser. The thank you is the page with ?thanks=1 and Stripe's
// {CHECKOUT_SESSION_ID} template (Stripe fills it in, so the braces must NOT be encoded); a cancel on
// Stripe's own page goes back to the page itself.
export function redBagPageUrl(): string {
  return `${config.PORTAL_BASE_URL.replace(/\/+$/, "")}${RED_BAG_PATH}`;
}

function redBagReturnUrls(
  embedded: boolean,
): Pick<StripeNS.Checkout.SessionCreateParams, "ui_mode" | "return_url" | "success_url" | "cancel_url"> {
  const page = redBagPageUrl();
  const thanks = `${page}?thanks=1&session_id={CHECKOUT_SESSION_ID}`;
  return embedded ? { ui_mode: "embedded_page", return_url: thanks } : { success_url: thanks, cancel_url: page };
}

/**
 * TASK-494: the page a fundraiser gift should come back to, from the fundraiser the gift names, or
 * null for anything without a public page right now: switched off, or not public and raising money,
 * approved or (TASK-502) finished. A failed read is null too: the gift still goes ahead, and comes back the donate
 * page's way, rather than failing over where the giver lands.
 */
export async function fundraiserReturnPage(fundraiserId: number | undefined): Promise<string | null> {
  if (fundraiserId === undefined) return null;
  try {
    const [{ getFundraiser, fundraisingIsOn }, { hasPage }, { pageUrlFor }] = await Promise.all([
      import("../db/fundraisers"),
      import("../fundraising/model"),
      import("../fundraising/page-url"),
    ]);
    // Switched off, the fundraiser's page is a 404: coming back there would be a dead end.
    if (!(await fundraisingIsOn())) return null;
    const f = await getFundraiser(fundraiserId);
    // Event pages: an event's gift comes back to its own page, /event/<short name>.
    return f && hasPage(f) ? pageUrlFor(f) : null;
  } catch (err) {
    console.error("fundraiser return page lookup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// --- TASK-501: an organiser paying in what they collected ----------------------------------------

export const PAY_IN_MIN_PENCE = 100; // £1
export const PAY_IN_MAX_PENCE = 1_000_000; // £10,000
export const PAY_IN_SESSION_MINUTES = 31;

/**
 * What the private area's "Pay in what you collected" may send. Only the amount and whether to
 * cover the card fee: no Gift Aid (it is not their own gift), no name or message for the wall.
 * Anything else sent is dropped.
 */
export const payInSchema = z.object({
  amountPence: z
    .number({ invalid_type_error: "Give the amount in pounds, like 25.50." })
    .int("Give the amount in pounds and pence, like 25.50.")
    .min(PAY_IN_MIN_PENCE, "You can pay in from £1.")
    .max(PAY_IN_MAX_PENCE, "You can pay in up to £10,000 at a time. For more, please email events@nbcc.scot."),
  coverFee: z.boolean().optional(),
});

/**
 * The Stripe session for an organiser paying in (TASK-501). The SAME session a gift on a
 * fundraiser's page makes (buildSessionParams), with Gift Aid off, their name off the wall, no
 * message and no newsletter, plus one more key the webhook reads: paidInByOrganiser. It is only
 * ever stamped here, by the server, for a signed in organiser's own fundraiser; the public checkout
 * never stamps it, whatever it is sent. It comes back to the private area, never to the page.
 */
export function buildPayInSessionParams(
  input: { fundraiserId: number; amountPence: number; coverFee: boolean; name: string; email: string; manageUrl: string },
  cardFee: CardFeeRate = DEFAULT_CARD_FEE,
  now: Date = new Date(),
): StripeNS.Checkout.SessionCreateParams {
  const body: CheckoutBody = {
    mode: "once",
    plan: null,
    amount: input.amountPence,
    giftAid: false,
    coverFee: input.coverFee,
    uiMode: "hosted",
    donorType: "individual",
    fullName: input.name,
    email: input.email,
    emailConsent: false,
    anonymous: true,
    fundraiserId: input.fundraiserId,
    supporterMessage: "",
    showName: false,
    showAmount: false,
  };
  const params = buildSessionParams(body, cardFee, null);
  const manage = input.manageUrl.replace(/\/+$/, "");
  return {
    ...params,
    metadata: { ...params.metadata, paidInByOrganiser: "true" },
    success_url: `${manage}?paid=1`,
    cancel_url: manage,
    // TASK-501 review: closes after 31 minutes (Stripe's shortest is 30 from when it is made; the
    // extra minute covers the gap between our clock and theirs), so a pay in left open cannot
    // complete hours later. Donate page sessions keep Stripe's own expiry.
    expires_at: Math.floor(now.getTime() / 1000) + PAY_IN_SESSION_MINUTES * 60,
  };
}

/** The rate NBCC is charged, or the default when it cannot be read (as the donate page does). */
export async function currentCardFee(): Promise<CardFeeRate> {
  try {
    const { getCardFeeRate } = await import("../db/ball");
    return await getCardFeeRate();
  } catch (err) {
    console.error("card fee rate read failed, using default:", err instanceof Error ? err.message : err);
    return DEFAULT_CARD_FEE;
  }
}

export async function postCheckoutSession(req: Request, res: Response): Promise<Response> {
  const parsed = checkoutBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid checkout request",
      details: parsed.error.flatten(),
    });
  }

  // Fill a Red Bag: while the page is switched off (src/red-bag/switch.ts), only a signed in member
  // of staff may make a Red Bag gift. Asked ONLY for a gift carrying the marker, so every other
  // gift goes on exactly as before, with no look at who is signed in.
  if (parsed.data.redBag === true && !(await redBagOpenTo(req.headers?.authorization))) {
    return res.status(403).json({ error: "Fill a Red Bag is not open yet" });
  }

  try {
    // The rate NBCC is actually charged, from the one place it is stored (TASK-317/321).
    // A failure to read it must not take the donate page down, so fall back to the default.
    let cardFee = DEFAULT_CARD_FEE;
    try {
      const { getCardFeeRate } = await import("../db/ball");
      cardFee = await getCardFeeRate();
    } catch (err) {
      console.error("card fee rate read failed, using default:", err instanceof Error ? err.message : err);
    }
    const params = buildSessionParams(parsed.data, cardFee, await fundraiserReturnPage(parsed.data.fundraiserId));
    const session = await stripe.checkout.sessions.create(params);
    // Embedded (inline) returns a { clientSecret } the browser mounts on nbcc.scot, plus the PUBLIC
    // publishable key it needs to construct Stripe.js (TASK-215) — but ONLY when a key is configured
    // (embeddedRequested). Hosted (the default, AND the served shape when embedded is requested with
    // no key set) is UNCHANGED: it returns { url } exactly as before, so the redirect fallback and any
    // un-updated caller keep working byte-for-byte. The session metadata/line-items/mode are identical
    // either way, so the webhook + confirmation email are unaffected.
    const body: {
      url?: string | null;
      clientSecret?: string | null;
      publishableKey?: string;
      session?: { id: string; metadata: typeof params.metadata; mode: typeof params.mode };
    } =
      embeddedRequested(parsed.data)
        ? { clientSecret: session.client_secret, publishableKey: config.STRIPE_PUBLISHABLE_KEY }
        : { url: session.url };
    // Stub-mode echo (TASK-116): when there is no live Stripe (offline stub) and we are
    // not in production, hand the built session back so the BDD donation journey can
    // replay the REAL stamped metadata into the completion webhook — mirroring how Stripe
    // echoes your session object back in checkout.session.completed. Production NEVER stubs
    // (see src/clients/stripe.ts), so its response stays { url } / { clientSecret }. Applies to
    // both UI modes, since the echoed metadata/mode are identical.
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

// (TASK-238) POST /api/subscription/change-plan was removed as dead code: no front-end caller,
// no auth. Reducing a monthly donation is done by re-subscribing from the donate page.

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

  // TASK-490: Cloudflare Turnstile, when it is on. Before validation, so a bot without a valid pass
  // learns nothing about what the form expects. A refused pass stores nothing; a check that cannot
  // answer keeps the message and logs why, so a genuine enquiry is never lost to the checker.
  if (captchaEnabled()) {
    const verdict = await verifyCaptcha(req.body?.captchaToken, req.ip);
    if (verdict.outcome === "refused") {
      return res.status(400).json({ error: "captcha" });
    }
    if (verdict.outcome === "unavailable") {
      console.error("contact captcha unavailable, message kept:", verdict.reason);
    }
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

// TASK-490: the contact page asks for the Turnstile site key and shows the box only if it gets one
// (assets/js/contact-captcha.js). Public: the site key is in every visitor's browser anyway.
export function getContactCaptcha(_req: Request, res: Response): Response {
  return res.status(200).json({ siteKey: captchaSiteKey() });
}

apiRouter.get("/api/contact/captcha", getContactCaptcha);

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
        body: "Your Gift Aid declaration is complete. NBCC can now reclaim the tax on your donation at no extra cost to you.",
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
