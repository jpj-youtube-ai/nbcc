import type Stripe from "stripe";
import {
  donationInputSchema,
  deriveClaimStatus,
  type DonationInput,
  type DonorInput,
  type DonorType,
  type ClaimStatus,
} from "./donations-model";
import type { DeclarationFields } from "../declarations/fields";
import { buildCompanyDonorRow, type CompanyFields } from "../donors/company";
import { scopeFromDeclarationScope, type Scope, type DeclarationWording } from "../declarations/wording";
import { isGasdsEligibleAmount } from "../gasds/caps";

// PURE event→record mapping for the single Stripe webhook handler (REQ-036). No
// pool/config/network/clock — imports only the pure donation model, so it is
// unit-tested DB-free. The transactional persistence + event-id idempotency lives
// in ./stripe-webhook.ts. Stripe types are type-only imports (erased at runtime).

export interface DonationWrite {
  donor: DonorInput;
  donation: DonationInput;
}

// The REQ-029 checkout endpoint stamps metadata.giftAid as the string "true"/"false".
export function giftAidFromMetadata(metadata: Stripe.Metadata | null | undefined): boolean {
  return metadata?.giftAid === "true";
}

const asString = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" ? v.id : null;

// checkout.session.completed → the donation record. Gift Aid is carried as a FLAG
// (gift_aid boolean from metadata); the declaration relationship is captured later
// (REQ-040/043), so declaration_id is null and buildDonationRow derives the
// claim_status accordingly (a flagged-but-undeclared gift is not yet claimable).
export function donationFromCheckoutSession(session: Stripe.Checkout.Session): DonationWrite {
  const md = session.metadata ?? {};
  const mode = md.mode === "monthly" ? "monthly" : "once";
  // donor_type + business name are stamped on the session metadata by the REQ-029
  // checkout endpoint (REQ-038): donorType defaults to "individual" (the no-JS base
  // contract), businessName is the optional donors-page display label. donor_type is
  // the SINGLE field that routes claims — buildDonationRow forces Gift Aid off and
  // derives claim_status='not_eligible' for a company (REQ-036/REQ-053), so even a
  // stray giftAid flag on a company session never survives into the row.
  const donorType = md.donorType === "company" ? "company" : "individual";
  const businessName = md.businessName ? md.businessName : null;
  const donation = donationInputSchema.parse({
    donorType,
    mode,
    plan: md.plan ? md.plan : null,
    amountPence: session.amount_total ?? 0,
    currency: (session.currency ?? "gbp").toUpperCase(),
    giftAid: giftAidFromMetadata(session.metadata),
    declarationId: null,
    paymentChannel: "online",
    stripeSessionId: session.id,
    stripePaymentIntentId: asString(session.payment_intent),
    stripeSubscriptionId: asString(session.subscription),
    stripeChargeId: null,
  });
  // REQ-039: the donor's contact details come from OUR consent-based capture, stamped
  // on metadata by the checkout endpoint. Full name falls back to the Stripe cardholder
  // name (then a placeholder) when the capture form was bypassed. Email is consent-based:
  // store the captured email + mark consent ONLY when the donor opted in, otherwise
  // persist no email so the platform sends nothing (Stripe's receipt email is separate).
  const cardholderName = session.customer_details?.name ?? null;
  const consented = md.emailConsent === "true";

  // A company donation (REQ-038/REQ-053) carries its own captured company fields, stamped on
  // metadata by the checkout endpoint and validated there. Map them onto the donor row
  // (business_name/company_number/full_name/email + the new billing columns) via
  // buildCompanyDonorRow. The contact email is an operational billing contact, so it is stored
  // regardless of marketing consent (emailConsent stays false, so no marketing email is sent).
  const companyRow = companyDonorFromCheckoutSession(session);
  if (companyRow) {
    return {
      donor: {
        fullName: companyRow.full_name,
        businessName: companyRow.business_name,
        companyNumber: companyRow.company_number,
        email: companyRow.email,
        emailConsent: false,
        anonymous: md.anonymous === "true",
        billingAddress: companyRow.billing_address,
        billingPostcode: companyRow.billing_postcode,
      },
      donation,
    };
  }

  return {
    donor: {
      fullName: md.fullName ? md.fullName : (cardholderName ?? "Anonymous donor"),
      businessName,
      email: consented && md.email ? md.email : null,
      emailConsent: consented,
      anonymous: md.anonymous === "true",
    },
    donation,
  };
}

// checkout.session.completed → the company donor columns, or null when this is not a company
// donation with company metadata. The checkout endpoint stamps + validates the company object
// (REQ-038) as metadata.company* keys; this reconstructs the fields and maps them via
// buildCompanyDonorRow (no re-validation — the metadata is trusted, mirroring
// declarationFromCheckoutSession). No declaration row and no claim_status change:
// buildDonationRow/deriveClaimStatus already force not_eligible for a company.
export function companyDonorFromCheckoutSession(
  session: Stripe.Checkout.Session,
): ReturnType<typeof buildCompanyDonorRow> | null {
  const md = session.metadata ?? {};
  if (md.donorType !== "company") return null;
  if (!md.companyLegalName) return null; // no company object was captured/stamped
  const fields: CompanyFields = {
    legalName: md.companyLegalName,
    registrationNumber: md.companyRegistrationNumber ? md.companyRegistrationNumber : undefined,
    contactName: md.companyContactName ?? "",
    contactEmail: md.companyContactEmail ?? "",
    billingAddress: md.companyBillingAddress ?? "",
    billingPostcode: md.companyBillingPostcode ?? "",
    considerationGiven: md.companyConsiderationGiven === "true",
  };
  return buildCompanyDonorRow(fields);
}

// The Gift Aid declaration to persist alongside a checkout donation (REQ-043). Carries
// the validated capture fields, the REQ-044 scope column value, and the REQ-040 wording
// snapshot the donor agreed to — everything except the donor FK, which the transactional
// writer fills in after inserting the donor.
export interface DeclarationWrite {
  fields: DeclarationFields;
  scope: Scope;
  wording: DeclarationWording;
  confirmedTaxpayer: boolean;
}

// checkout.session.completed → the Gift Aid declaration, or null when there is none. A
// declaration exists only for a gift-aided individual, and only when the REQ-063 checkout
// stamped the decl* fields (declFirstName is always present then). The declaration scope
// column takes 'this_donation' | 'all_donations' (REQ-044): the enduring monthly default
// (metadata.declarationScope='enduring', REQ-041) maps to 'all_donations', and a donor's
// explicit override (REQ-044, TASK-065) is carried through verbatim — scopeFromDeclarationScope
// collapses both the same way the checkout did. Opting into Gift Aid is the taxpayer
// confirmation, so confirmed_taxpayer is true.
export function declarationFromCheckoutSession(
  session: Stripe.Checkout.Session,
): DeclarationWrite | null {
  const md = session.metadata ?? {};
  if (!giftAidFromMetadata(md)) return null;
  if (md.donorType === "company") return null;
  if (!md.declFirstName) return null; // no declaration was captured
  const fields: DeclarationFields = {
    title: md.declTitle ? md.declTitle : undefined,
    firstName: md.declFirstName,
    lastName: md.declLastName ?? "",
    houseNameNumber: md.declHouseNameNumber ? md.declHouseNameNumber : undefined,
    address: md.declAddress ?? "",
    postcode: md.declPostcode ? md.declPostcode : undefined,
    nonUk: md.declNonUk === "true",
  };
  const scope: Scope = scopeFromDeclarationScope(md.declarationScope);
  return {
    fields,
    scope,
    wording: {
      wording_version: md.giftAidWordingVersion ?? "",
      wording_snapshot: md.giftAidWording ?? "",
    },
    confirmedTaxpayer: true,
  };
}

// One partner's Gift Aid declaration + share of a partnership donation to persist (REQ-051).
// Mirrors DeclarationWrite (the declaration fields, scope column value and wording snapshot,
// with the donor FK filled in by the transactional writer) plus the partner's share in pence.
export interface PartnerShareWrite extends DeclarationWrite {
  sharePence: number;
}

// checkout.session.completed → the partnership's per-partner declarations + shares, or [] when
// there is none. A partnership stamps a `partners` JSON array on the session (REQ-051 checkout,
// TASK-081) only for the gift-aided partnership path; each entry is a declaration + sharePence
// (already validated at checkout to sum to the amount). The scope column value and the verbatim
// wording are shared across the partners (same gift), mirroring declarationFromCheckoutSession.
export function partnerSharesFromCheckoutSession(
  session: Stripe.Checkout.Session,
): PartnerShareWrite[] {
  const md = session.metadata ?? {};
  if (!giftAidFromMetadata(md)) return [];
  if (!md.partners) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(md.partners);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const scope: Scope = scopeFromDeclarationScope(md.declarationScope);
  const wording: DeclarationWording = {
    wording_version: md.giftAidWordingVersion ?? "",
    wording_snapshot: md.giftAidWording ?? "",
  };
  return raw.map((p: Record<string, unknown>): PartnerShareWrite => {
    const str = (v: unknown): string | undefined =>
      typeof v === "string" && v.length > 0 ? v : undefined;
    const fields: DeclarationFields = {
      title: str(p.title),
      firstName: (p.firstName as string) ?? "",
      lastName: (p.lastName as string) ?? "",
      houseNameNumber: str(p.houseNameNumber),
      address: (p.address as string) ?? "",
      postcode: str(p.postcode),
      nonUk: p.nonUk === true,
    };
    return {
      fields,
      scope,
      wording,
      confirmedTaxpayer: true,
      sharePence: typeof p.sharePence === "number" ? p.sharePence : 0,
    };
  });
}

// The single donation-confirmation email payload (TASK-070). Pure data shape — the
// network send lives in src/clients/email.ts. NOT the full REQ-060 templated system
// (Gift Aid confirmation, manage/cancel, receipts); just enough to thank a donor.
export interface DonationConfirmationEmail {
  email: string;
  fullName: string;
  amountPence: number;
  currency: string;
}

// Decide whether — and with what payload — to send a donation-confirmation email.
// Returns null (send nothing) unless the donor gave us an email AND opted into
// contact (email_consent). This is the consent gate: donationFromCheckoutSession
// already suppresses the email when consent was withheld, and this predicate is the
// belt-and-braces the send path checks. Pure: no pool/config/network/clock.
export function confirmationEmailFor(
  donor: { email?: string | null; emailConsent?: boolean; fullName: string },
  amount: { amountPence: number; currency: string },
): DonationConfirmationEmail | null {
  if (!donor.email || donor.emailConsent !== true) return null;
  return {
    email: donor.email,
    fullName: donor.fullName,
    amountPence: amount.amountPence,
    currency: amount.currency,
  };
}

// checkout.session.completed → the confirmation-email payload, or null when the
// donor withheld their email / did not consent. The event→payload mapping the
// webhook processor triggers a send from, kept pure so the trigger is unit-tested
// DB-free (the send itself is a mocked client).
export function confirmationEmailFromCheckoutSession(
  session: Stripe.Checkout.Session,
): DonationConfirmationEmail | null {
  const { donor, donation } = donationFromCheckoutSession(session);
  return confirmationEmailFor(donor, donation);
}

export interface RecurringCharge {
  subscriptionId: string;
  amountPence: number;
  currency: string;
  paymentIntentId: string | null;
  chargeId: string | null;
}

// invoice.paid / invoice.payment_succeeded → a recurring monthly charge to record
// as a further donation against the SAME subscription/donor. The first invoice
// (billing_reason 'subscription_create') is skipped — it is already captured by
// checkout.session.completed, so recording it again would double-count.
export function recurringChargeFromInvoice(invoice: Stripe.Invoice): RecurringCharge | null {
  if (invoice.billing_reason === "subscription_create") return null;
  // Read the subscription/charge refs defensively: older Stripe API versions put
  // them as flat fields on the invoice, newer ones nest the subscription under
  // parent.subscription_details. A webhook delivers whichever the account is on.
  const inv = invoice as unknown as {
    subscription?: string | { id: string } | null;
    payment_intent?: string | { id: string } | null;
    charge?: string | { id: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  };
  const subscriptionId =
    asString(inv.subscription) ?? asString(inv.parent?.subscription_details?.subscription);
  if (!subscriptionId) return null;
  return {
    subscriptionId,
    amountPence: invoice.amount_paid ?? 0,
    currency: (invoice.currency ?? "gbp").toUpperCase(),
    paymentIntentId: asString(inv.payment_intent),
    chargeId: asString(inv.charge),
  };
}

// The Gift Aid / declaration context carried from the ORIGINAL donation on the
// subscription (found via the subscription id in the processor). A monthly gift's
// declaration governs every later charge on that subscription — including prorated
// up/downgrades — so it is inherited, never re-derived here (REQ-055/REQ-059).
export interface RecurringDonationParent {
  donorType: DonorType;
  plan: string | null;
  giftAid: boolean;
  declarationId: number | null;
}

// Assemble the donation input for a recurring OR prorated charge. The amount is the
// invoice's ACTUALLY-charged amount (rec.amountPence = invoice.amount_paid), NOT the
// plan's preset tier value — a mid-subscription up/downgrade bills a prorated amount,
// and Gift Aid is claimed on the true amount charged, needing no special handling
// (REQ-055). Gift Aid + declaration + plan come from the original declaration on the
// subscription; each charge becomes its own donation row against the same donor.
export function recurringDonationInput(
  rec: RecurringCharge,
  parent: RecurringDonationParent,
): DonationInput {
  return donationInputSchema.parse({
    donorType: parent.donorType,
    mode: "monthly",
    plan: parent.plan,
    amountPence: rec.amountPence,
    currency: rec.currency,
    giftAid: parent.giftAid,
    declarationId: parent.declarationId,
    paymentChannel: "online",
    stripeSubscriptionId: rec.subscriptionId,
    stripePaymentIntentId: rec.paymentIntentId,
    stripeChargeId: rec.chargeId,
  });
}

// charge.succeeded → an IN-PERSON donation input (REQ-054). A Stripe Terminal /
// card-present charge (payment_method_details.type === 'card_present') is a gift taken
// at an event, NOT an online checkout — it has no checkout.session, so it is captured
// straight off the charge. Mirrors recurringDonationInput: pure, no pool/clock; parses
// through donationInputSchema so the row is validated the same way. Marked
// payment_channel='in_person' (the REQ-036 column), a one-off with NO Gift Aid and NO
// declaration (an in-person tap captures no Gift Aid declaration — declaration_id null,
// so buildDonationRow derives claim_status='not_eligible').
//
// Returns null for ANY other charge shape — crucially an online 'card' charge, which is
// already captured via checkout.session.completed; returning null there stops the same
// gift being mapped twice (the double-count guard the acceptance requires).
export function cardPresentDonationInput(charge: Stripe.Charge): DonationInput | null {
  if (charge.payment_method_details?.type !== "card_present") return null;
  const amountPence = charge.amount ?? 0;
  return donationInputSchema.parse({
    donorType: "individual",
    mode: "once",
    plan: null,
    amountPence,
    currency: (charge.currency ?? "gbp").toUpperCase(),
    giftAid: false,
    declarationId: null,
    // GASDS (REQ-058/TASK-078): a small (≤ £30), un-declared, non-Gift-Aided in-person tap is
    // claimable under the Small Donations Scheme instead of Gift Aid. This gift carries no
    // declaration and no Gift Aid, so eligibility rests only on the amount.
    gasdsEligible: isGasdsEligibleAmount(amountPence, { hasDeclaration: false, giftAid: false }),
    paymentChannel: "in_person",
    stripePaymentIntentId: asString(charge.payment_intent),
    stripeChargeId: charge.id,
  });
}

// The declaration-confirmation links for an in-person donation (TASK-075/REQ-048). Built
// from the site base URL + the donation's UNIQUE declaration_token, so each addresses
// exactly one gift: `link` is the full Gift Aid declaration form URL (emailed as a click
// target); `shortLink` is a compact, QR-encodable variant of the same token (printed on a
// receipt / shown as a QR). Pure — the base URL is passed in (read from config by the
// caller), no pool/config/clock. Trailing slashes on the base are trimmed so the paths
// never double up.
export interface DeclarationLinks {
  link: string;
  shortLink: string;
}

export function declarationLinks(baseUrl: string, token: string): DeclarationLinks {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    link: `${base}/gift-aid/declare?token=${encodeURIComponent(token)}`,
    shortLink: `${base}/g/${encodeURIComponent(token)}`,
  };
}

// charge.refunded carries the ABSOLUTE total refunded so far, so replaying the
// event is idempotent (we set, never increment).
export function refundedPenceFromCharge(charge: Stripe.Charge): number {
  return charge.amount_refunded ?? 0;
}

export function refundedPenceFromDispute(dispute: Stripe.Dispute): number {
  return dispute.amount ?? 0;
}

// Recompute claim_status when a donation is refunded/disputed: a fully-refunded
// gift is never claimable; otherwise eligibility is unchanged (still governed by
// donor type + Gift Aid + an active declaration — REQ-037).
export function claimStatusAfterRefund(
  existing: { donorType: DonorType; giftAid: boolean; hasDeclaration: boolean; amountPence: number },
  refundedPence: number,
): ClaimStatus {
  return deriveClaimStatus({
    donorType: existing.donorType,
    giftAid: existing.giftAid,
    hasDeclaration: existing.hasDeclaration,
    fullyRefunded: refundedPence >= existing.amountPence,
  });
}
