// A gift's details, for the click down in the Donations gift log (docs/superpowers/specs/2026-11-05-donations-screen-design.md,
// "The screen" 4; Task 3 of docs/superpowers/plans/2026-11-05-donations-screen.md). Read only, but
// for one thing: an older gift not yet checked with Stripe is checked the first time it is opened
// (fillPayDetails, at most PAY_FILL_LIMIT_MS, never failing the answer). Served by
// GET /api/admin/donations/:kind/:id/details (src/routes/admin-donation-details.ts), Donations: view.
//
// The answer, as JSON (dates as ISO strings). Field names are camelCase; null means "not known" or
// "none". The screen draws from this shape, so change it on purpose.
//
// kind "donation":
//   { kind: "donation", id, reference: "NBCC-000321", createdAt,
//     gift:     { amountPence, feeCoverPence, totalChargedPence, currency, mode: "once"|"monthly", plan,
//                 paymentStatus, paymentChannel: "online"|"in_person", source },
//     payment:  { method, wallet, cardBrand, cardLast4, cardCountry, checkedAt,
//                 stripe: { reference, paymentIntentId, chargeId, sessionId, invoiceId, subscriptionId,
//                           dashboardUrl, subscriptionUrl } },   (reference: Stripe's payment, else its
//                 charge, else a renewal's invoice, else the checkout session; subscriptionUrl: a monthly
//                 gift's plan in Stripe, which lists every payment of it)
//     arrival:  { channel, source, campaign, givenOn },          (all null before 6 November 2026)
//     giftAid:  { giftAid, claimStatus, declarationStatus, gasdsEligible,
//                 declaration: { id, scope, madeAt, revoked, revokedAt } | null,
//                 batch: { id, status, submittedAt } | null },
//     refunds:  { refundedPence, events: [{ at, totalRefundedPence, dispute }] },   (oldest first; each
//                 event's total is the gift's refunded total after it, as Stripe reported it)
//     donor:    { id, name, email, emailConsent, donorType, businessName, billingAddress, billingPostcode,
//                 otherGifts: { count, totalPence } | null },   (billing only for a company; other paid
//                 gifts by the same email address, refunds taken off; null with no email)
//     links:    { fundraiser: { id, title, slug, pagePath } | null, pledgeId, invoice: { id, number, url } | null,
//                 (pagePath is the page's address, /fundraise/<slug> or /event/<slug>, only while it has
//                 a public page, as the public route decides (hasPage); null otherwise)
//                 elfFamilyId: null },
//     labels:   { givenOnLabel, arrivalLabel, paidByLabel } }   (src/donations/labels.ts; arrivalLabel and
//                 paidByLabel are null when not noted)
//
// kind "elf" (an Elf Detective School payment, as Head Elf HQ counts them):
//   { kind: "elf", id, reference: "EDS-K4F9Q2", createdAt (when paid),
//     gift:     { amountPence (entry plus gift), entryPence, giftPence, feeCoverPence, totalChargedPence,
//                 currency: "GBP", mode: "once", paymentStatus: "paid", paymentChannel: "online", detectives },
//     payment:  { stripe: { sessionId } },
//     giftAid:  { giftAid, declaration: { id, scope, madeAt, revoked, revokedAt } | null },
//     family:   { id, name, email },
//     links:    { elfFamilyId },
//     labels:   { givenOnLabel: "Elf Detective School", arrivalLabel: null, paidByLabel: null } }

import { pool } from "./pool";
import { config } from "../config";
import { fillPayDetails } from "./donation-pay-details";
import { linkFor } from "./invoices";
import { qrCodeNames } from "./qr-codes";
import { fundraiserTitles } from "./fundraiser-materials";
import { invoiceNumber } from "../invoices/model";
import { donationReference } from "../donors/confirmation";
import { parseNamedCode } from "../site/qr-named";
import { labelScanCampaigns, parseScanCampaign } from "../fundraising/material-codes";
import { arrivalLabel, givenOnLabel, paidByLabel, qrArrivalName } from "../donations/labels";
import { hasPage, pagePath } from "../fundraising/model";

/** The longest the details wait for Stripe to say how an older gift was paid. */
export const PAY_FILL_LIMIT_MS = 3000;

export interface DeclarationSummary {
  id: number;
  scope: string;
  madeAt: Date | null;
  revoked: boolean;
  revokedAt: Date | null;
}

export interface Labels {
  givenOnLabel: string;
  arrivalLabel: string | null;
  paidByLabel: string | null;
}

export interface GiftDetails {
  kind: "donation";
  id: number;
  reference: string;
  createdAt: Date;
  gift: {
    amountPence: number;
    feeCoverPence: number;
    totalChargedPence: number;
    currency: string;
    mode: string;
    plan: string | null;
    paymentStatus: string;
    paymentChannel: string;
    source: string | null;
  };
  payment: {
    method: string | null;
    wallet: string | null;
    cardBrand: string | null;
    cardLast4: string | null;
    cardCountry: string | null;
    checkedAt: Date | null;
    stripe: {
      reference: string | null;
      paymentIntentId: string | null;
      chargeId: string | null;
      sessionId: string | null;
      invoiceId: string | null;
      subscriptionId: string | null;
      dashboardUrl: string | null;
      subscriptionUrl: string | null;
    };
  };
  arrival: { channel: string | null; source: string | null; campaign: string | null; givenOn: string | null };
  giftAid: {
    giftAid: boolean;
    claimStatus: string;
    declarationStatus: string;
    gasdsEligible: boolean;
    declaration: DeclarationSummary | null;
    batch: { id: number; status: string; submittedAt: Date | null } | null;
  };
  refunds: { refundedPence: number; events: { at: Date; totalRefundedPence: number; dispute: boolean }[] };
  donor: {
    id: number;
    name: string;
    email: string | null;
    emailConsent: boolean;
    donorType: string;
    businessName: string | null;
    billingAddress: string | null;
    billingPostcode: string | null;
    otherGifts: { count: number; totalPence: number } | null;
  };
  links: {
    fundraiser: { id: number; title: string; slug: string; pagePath: string | null } | null;
    pledgeId: number | null;
    invoice: { id: number; number: string; url: string } | null;
    elfFamilyId: null;
  };
  labels: Labels;
}

export interface ElfPaymentDetails {
  kind: "elf";
  id: number;
  reference: string;
  createdAt: Date;
  gift: {
    amountPence: number;
    entryPence: number;
    giftPence: number;
    feeCoverPence: number;
    totalChargedPence: number;
    currency: "GBP";
    mode: "once";
    paymentStatus: "paid";
    paymentChannel: "online";
    detectives: number;
  };
  payment: { stripe: { sessionId: string | null } };
  giftAid: { giftAid: boolean; declaration: DeclarationSummary | null };
  family: { id: number; name: string; email: string };
  links: { elfFamilyId: number };
  labels: Labels;
}

export type DonationDetails = GiftDetails | ElfPaymentDetails;

/** Stripe's own page for the payment: by its payment intent, else its charge; Stripe's test side with a test key. */
export function stripeDashboardUrl(ids: { paymentIntentId: string | null; chargeId: string | null }, testMode: boolean): string | null {
  const id = ids.paymentIntentId ?? ids.chargeId;
  if (!id) return null;
  return `https://dashboard.stripe.com/${testMode ? "test/" : ""}payments/${encodeURIComponent(id)}`;
}

/** A monthly gift's plan in Stripe, where every payment of it is listed; Stripe's test side with a test key. */
export function stripeSubscriptionUrl(subscriptionId: string | null, testMode: boolean): string | null {
  if (!subscriptionId) return null;
  return `https://dashboard.stripe.com/${testMode ? "test/" : ""}subscriptions/${encodeURIComponent(subscriptionId)}`;
}

const stripeTestMode = (): boolean => /^(sk|rk)_test_/.test(config.STRIPE_SECRET_KEY ?? "");

// --- SQL (read against migrations 1782923222001, 1782987698792, 1783068943728, 1783054395270,
// 1791200000000, 1791200000220, 1791200000330, 1791200000370, 1791200000400 and 1791200000310) -------

const GIFT_SQL = `SELECT d.id, d.donor_id, d.mode, d.plan, d.amount_pence, d.fee_cover_pence, d.currency, d.gift_aid,
       d.claim_status, d.payment_status, d.payment_channel, d.refunded_amount_pence, d.declaration_status,
       d.gasds_eligible, d.created_at, d.source, d.invoice_id, d.fundraiser_id, d.claim_batch_id, d.declaration_id,
       d.stripe_session_id, d.stripe_payment_intent_id, d.stripe_subscription_id, d.stripe_charge_id, d.stripe_invoice_id,
       d.arrival_channel, d.arrival_source, d.arrival_campaign, d.given_on,
       d.pay_method, d.pay_wallet, d.card_brand, d.card_last4, d.card_country, d.pay_checked_at,
       dn.full_name AS donor_name, dn.email AS donor_email, dn.email_consent, dn.donor_type, dn.business_name,
       dn.billing_address, dn.billing_postcode,
       fr.title AS fundraiser_title, fr.slug AS fundraiser_slug, fr.path AS fundraiser_path,
       fr.status AS fundraiser_status, fr.public AS fundraiser_public,
       (SELECT sp.id FROM sponsor_pledges sp WHERE sp.donation_id = d.id ORDER BY sp.id LIMIT 1) AS pledge_id,
       dc.scope AS declaration_scope, dc.revoked_at AS declaration_revoked_at, dc.created_at AS declaration_made_at,
       cb.status AS batch_status, cb.submitted_at AS batch_submitted_at
  FROM donations d JOIN donors dn ON dn.id = d.donor_id
  LEFT JOIN fundraisers fr ON fr.id = d.fundraiser_id
  LEFT JOIN declarations dc ON dc.id = d.declaration_id
  LEFT JOIN claim_batches cb ON cb.id = d.claim_batch_id
 WHERE d.id = $1`;

// After a look up: how it was paid, and the Stripe payment it found for a gift that had none (a renewal).
const PAY_SQL = `SELECT pay_method, pay_wallet, card_brand, card_last4, card_country, pay_checked_at,
       stripe_payment_intent_id, stripe_charge_id
  FROM donations WHERE id = $1`;

// Written by the webhook's refund handling (handleRefund in src/db/stripe-webhook.ts): data.refundedPence
// is the gift's refunded total after that refund or dispute, and data.eventType says which it was.
const REFUNDS_SQL = `SELECT created_at, data FROM audit_log
 WHERE entity = 'donation' AND entity_id = $1 AND action = 'donation.refunded'
 ORDER BY created_at, id`;

const OTHER_GIFTS_SQL = `SELECT count(*)::int AS gifts,
       COALESCE(SUM(GREATEST(d.amount_pence - d.refunded_amount_pence, 0)), 0) AS pence
  FROM donations d JOIN donors dn ON dn.id = d.donor_id
 WHERE lower(dn.email) = lower($1) AND d.id <> $2 AND d.payment_status = 'paid'`;

const ELF_SQL = `SELECT o.id, o.reference, o.family_id, o.entry_pence, o.donation_pence, o.fee_cover_pence, o.gift_aid,
       o.stripe_session_id, COALESCE(o.paid_at, o.created_at) AS paid_at, cardinality(o.detective_ids) AS detectives,
       f.grown_up_name, f.email, o.declaration_id,
       dc.scope AS declaration_scope, dc.revoked_at AS declaration_revoked_at, dc.created_at AS declaration_made_at
  FROM elf_orders o JOIN elf_families f ON f.id = o.family_id
  LEFT JOIN declarations dc ON dc.id = o.declaration_id
 WHERE o.id = $1 AND o.status = 'paid' AND f.active AND f.removed_at IS NULL`;

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * The fundraiser's page address, only while it has a public page (the same rule as the public page
 * route, hasPage); null otherwise. fundraisers.path is its KIND ('raising' | 'event'), not an address.
 */
function fundraiserPage(r: Record<string, unknown>): string | null {
  const f = { path: r.fundraiser_path, slug: r.fundraiser_slug, status: r.fundraiser_status, public: r.fundraiser_public === true } as Parameters<typeof hasPage>[0] & Parameters<typeof pagePath>[0];
  if (typeof f.slug !== "string" || f.slug === "" || !hasPage(f)) return null;
  return pagePath(f);
}
const date = (v: unknown): Date | null => (v instanceof Date ? v : typeof v === "string" ? new Date(v) : null);

function declarationOf(r: Row): DeclarationSummary | null {
  const id = num(r.declaration_id);
  if (id === null) return null;
  const revokedAt = date(r.declaration_revoked_at);
  return { id, scope: String(r.declaration_scope ?? ""), madeAt: date(r.declaration_made_at), revoked: revokedAt !== null, revokedAt };
}

// Wait for the look up, but never longer than the limit, and never fail for it.
async function withinLimit(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  try {
    await Promise.race([work.then(() => undefined, () => undefined), limit]);
  } finally {
    clearTimeout(timer);
  }
}

// A QR code's tag by name: a named code from Admin > QR codes, a fundraiser's printed piece, or a
// page's own code. Null when it cannot be named (or its look up fails): the screen says "QR code".
async function qrNameFor(campaign: string | null): Promise<{ name: string; page: boolean } | null> {
  if (!campaign) return null;
  const named = new Map<string, string>();
  try {
    const codeId = parseNamedCode(campaign);
    if (codeId !== null) {
      const name = (await qrCodeNames([codeId])).get(codeId);
      if (!name) return null;
      named.set(campaign, name);
    }
    const piece = parseScanCampaign(campaign);
    if (piece) {
      for (const [k, v] of labelScanCampaigns([campaign], await fundraiserTitles([piece.id]))) named.set(k, v);
    }
  } catch (err) {
    console.error("gift details: QR code name not found:", err instanceof Error ? err.message : err);
    return null;
  }
  return qrArrivalName(campaign, named);
}

async function giftDetails(id: number, payFillLimitMs: number): Promise<GiftDetails | null> {
  const r = (await pool.query(GIFT_SQL, [id])).rows[0] as Row | undefined;
  if (!r) return null;

  // An older gift never checked with Stripe: ask now, then read what was kept.
  let pay: Row = r;
  if (r.pay_method === null && r.pay_checked_at === null) {
    await withinLimit(Promise.resolve().then(() => fillPayDetails(id)), payFillLimitMs);
    pay = { ...r, ...((await pool.query(PAY_SQL, [id])).rows[0] as Row | undefined) };
  }

  const refundRows = (await pool.query(REFUNDS_SQL, [id])).rows as Row[];
  const email = str(r.donor_email);
  const others = email ? ((await pool.query(OTHER_GIFTS_SQL, [email, id])).rows[0] as Row | undefined) : undefined;
  const channel = str(r.arrival_channel);
  const campaign = str(r.arrival_campaign);
  const qr = channel === "qr" ? await qrNameFor(campaign) : null;

  const amountPence = Number(r.amount_pence);
  const feeCoverPence = Number(r.fee_cover_pence ?? 0);
  const paymentIntentId = str(pay.stripe_payment_intent_id);
  const chargeId = str(pay.stripe_charge_id);
  const sessionId = str(r.stripe_session_id);
  const stripeInvoiceId = str(r.stripe_invoice_id);
  const subscriptionId = str(r.stripe_subscription_id);
  const company = r.donor_type === "company";
  const invoiceId = num(r.invoice_id);
  const fundraiserId = num(r.fundraiser_id);
  const batchId = num(r.claim_batch_id);
  const pledgeId = num(r.pledge_id);
  const fundraiserTitle = str(r.fundraiser_title);

  return {
    kind: "donation",
    id: Number(r.id),
    reference: donationReference(Number(r.id)),
    createdAt: date(r.created_at) as Date,
    gift: {
      amountPence,
      feeCoverPence,
      totalChargedPence: amountPence + feeCoverPence,
      currency: String(r.currency),
      mode: String(r.mode),
      plan: str(r.plan),
      paymentStatus: String(r.payment_status),
      paymentChannel: String(r.payment_channel),
      source: str(r.source),
    },
    payment: {
      method: str(pay.pay_method),
      wallet: str(pay.pay_wallet),
      cardBrand: str(pay.card_brand),
      cardLast4: str(pay.card_last4),
      cardCountry: str(pay.card_country),
      checkedAt: date(pay.pay_checked_at),
      stripe: {
        reference: paymentIntentId ?? chargeId ?? stripeInvoiceId ?? sessionId,
        paymentIntentId,
        chargeId,
        sessionId,
        invoiceId: stripeInvoiceId,
        subscriptionId,
        dashboardUrl: stripeDashboardUrl({ paymentIntentId, chargeId }, stripeTestMode()),
        subscriptionUrl: stripeSubscriptionUrl(subscriptionId, stripeTestMode()),
      },
    },
    arrival: { channel, source: str(r.arrival_source), campaign, givenOn: str(r.given_on) },
    giftAid: {
      giftAid: r.gift_aid === true,
      claimStatus: String(r.claim_status),
      declarationStatus: String(r.declaration_status),
      gasdsEligible: r.gasds_eligible === true,
      declaration: declarationOf(r),
      batch: batchId === null ? null : { id: batchId, status: String(r.batch_status ?? ""), submittedAt: date(r.batch_submitted_at) },
    },
    refunds: {
      refundedPence: Number(r.refunded_amount_pence ?? 0),
      events: refundRows.map((e) => {
        const data = (e.data ?? {}) as { refundedPence?: unknown; eventType?: unknown };
        return {
          at: date(e.created_at) as Date,
          totalRefundedPence: Number(data.refundedPence ?? 0),
          dispute: typeof data.eventType === "string" && data.eventType.startsWith("charge.dispute"),
        };
      }),
    },
    donor: {
      id: Number(r.donor_id),
      name: String(r.donor_name ?? ""),
      email,
      emailConsent: r.email_consent === true,
      donorType: String(r.donor_type),
      businessName: str(r.business_name),
      billingAddress: company ? str(r.billing_address) : null,
      billingPostcode: company ? str(r.billing_postcode) : null,
      otherGifts: others ? { count: Number(others.gifts ?? 0), totalPence: Number(others.pence ?? 0) } : null,
    },
    links: {
      fundraiser:
        fundraiserId === null || fundraiserTitle === null
          ? null
          : { id: fundraiserId, title: fundraiserTitle, slug: String(r.fundraiser_slug ?? ""), pagePath: fundraiserPage(r) },
      pledgeId,
      invoice: invoiceId === null ? null : { id: invoiceId, number: invoiceNumber(invoiceId), url: linkFor(invoiceId) },
      elfFamilyId: null,
    },
    labels: {
      givenOnLabel: givenOnLabel({ kind: "donation", source: str(r.source), paymentChannel: String(r.payment_channel), invoiceId, fundraiserTitle, pledgeId }),
      arrivalLabel: arrivalLabel({ channel, source: str(r.arrival_source), campaign, qr }),
      paidByLabel: paidByLabel({
        kind: "donation",
        paymentChannel: String(r.payment_channel),
        payMethod: str(pay.pay_method),
        payWallet: str(pay.pay_wallet),
        cardBrand: str(pay.card_brand),
        cardLast4: str(pay.card_last4),
      }),
    },
  };
}

async function elfDetails(id: number): Promise<ElfPaymentDetails | null> {
  const r = (await pool.query(ELF_SQL, [id])).rows[0] as Row | undefined;
  if (!r) return null;
  const entryPence = Number(r.entry_pence);
  const giftPence = Number(r.donation_pence);
  const feeCoverPence = Number(r.fee_cover_pence ?? 0);
  const familyId = Number(r.family_id);
  return {
    kind: "elf",
    id: Number(r.id),
    reference: String(r.reference),
    createdAt: date(r.paid_at) as Date,
    gift: {
      amountPence: entryPence + giftPence,
      entryPence,
      giftPence,
      feeCoverPence,
      totalChargedPence: entryPence + giftPence + feeCoverPence,
      currency: "GBP",
      mode: "once",
      paymentStatus: "paid",
      paymentChannel: "online",
      detectives: Number(r.detectives ?? 0),
    },
    payment: { stripe: { sessionId: str(r.stripe_session_id) } },
    // Gift Aid is the gift's alone; an entry never carries it (as the list says).
    giftAid: { giftAid: r.gift_aid === true && giftPence > 0, declaration: declarationOf(r) },
    family: { id: familyId, name: String(r.grown_up_name ?? ""), email: String(r.email ?? "") },
    links: { elfFamilyId: familyId },
    labels: { givenOnLabel: "Elf Detective School", arrivalLabel: null, paidByLabel: null },
  };
}

/** A gift's or an elf payment's details; null when there is no such one (or the kind is unknown). */
export async function getDonationDetails(
  kind: string,
  id: number,
  opts: { payFillLimitMs?: number } = {},
): Promise<DonationDetails | null> {
  if (kind === "donation") return giftDetails(id, opts.payFillLimitMs ?? PAY_FILL_LIMIT_MS);
  if (kind === "elf") return elfDetails(id);
  return null;
}
