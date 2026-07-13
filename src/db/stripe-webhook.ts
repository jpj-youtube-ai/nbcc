import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type Stripe from "stripe";
import { pool } from "./pool";
import { config } from "../config";
import {
  buildDonationRow,
  deriveClaimStatus,
  type DonorInput,
  type PaymentStatus,
  type ClaimStatus,
} from "./donations-model";
import { insertAudit, insertDonation, insertDonorAndDonation, insertClaimAdjustment } from "./donations";
import { ensureFulfilmentRecord } from "./fulfilment";
import { fulfilmentBandFor, type SupporterBand } from "../donors/fulfilment";
import { buildBusinessSupporterInviteEmail } from "../business/invite-email";
import {
  donationFromCheckoutSession,
  declarationFromCheckoutSession,
  partnerSharesFromCheckoutSession,
  companyDonorFromCheckoutSession,
  dunningFromStripeEvent,
  recurringChargeFromInvoice,
  recurringDonationInput,
  cardPresentDonationInput,
  declarationLinks,
  refundedPenceFromCharge,
  refundedPenceFromDispute,
  confirmationEmailFor,
  type DonationConfirmationEmail,
} from "./stripe-webhook-model";
import { recalculateClaimOnRefund } from "../claims/refund";
import {
  sendDonationConfirmation,
  sendDeclarationEmail,
  sendCompanyReceipt,
  sendRefundConfirmation,
  sendSubscriptionLapsedDonor,
  sendSubscriptionLapsedAdmin,
  sendBusinessSupporterInvite,
} from "../clients/email";
import { applyDeclarationEvent } from "../declarations/status";
import {
  buildCorporationTaxReceipt,
  classifyCompanyGift,
  buildCompanyRefundNotice,
  type CompanyRefundAction,
} from "../donors/receipt";
import { buildDonationConfirmation, buildRefundConfirmation, donationReference } from "../donors/confirmation";
import {
  applyDunningEvent,
  canApplyDunningEvent,
  nextFailedAttempts,
  type DunningStatus,
} from "../subscriptions/dunning";

// The SINGLE Stripe webhook processor for the unified platform (REQ-036) — no
// other module handles donor/donation events. Every event is processed in ONE
// transaction that (a) records the event id for idempotency and (b) performs the
// state write + its audit_log row via the REQ-037 helpers. Any throw rolls the
// whole thing back; a redelivered event id is a no-op.

export interface WebhookResult {
  processed: boolean; // false = duplicate event id, already handled
  action: string; // what was done (e.g. donation.created, donation.refunded, ignored)
}

export async function processWebhookEvent(event: Stripe.Event): Promise<WebhookResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Idempotency: claim this event id. A conflict means Stripe redelivered an
    // event we already committed — skip re-processing (the prior write stands).
    const claim = await client.query(
      `INSERT INTO stripe_webhook_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [event.id, event.type],
    );
    if (claim.rowCount === 0) {
      await client.query("COMMIT");
      return { processed: false, action: "duplicate" };
    }
    const { action, email, declaration, receipt, lapse, refundNotice, refundConfirmation, businessInvite } =
      await dispatch(client, event);
    await client.query("COMMIT");
    // Send the single donation-confirmation email (TASK-070) only AFTER the donor +
    // donation row has committed, and OUTSIDE the transaction: a slow or failing
    // provider must never roll back a recorded gift. Best-effort — the send is
    // swallowed on failure (the donation is already durably recorded).
    await sendConfirmation(email);
    // In-person Gift Aid declaration email (TASK-075): also post-commit, best-effort. Its
    // outcome flips declaration_status to 'sent' or 'undelivered' via a SEPARATE write, so
    // neither the send nor its status stamp can roll back the committed donation.
    await sendDeclarationConfirmation(declaration ?? null);
    // Company Corporation Tax receipt (TASK-088): post-commit, best-effort. Only present for a
    // company donation with NO consideration given; a gift WITH consideration was flagged for
    // the trustees inside the transaction instead (no receipt).
    await sendCompanyReceiptEmail(receipt ?? null);
    // Lapsed-subscription notices (TASK-092): post-commit, best-effort. Present only when this
    // event lapsed a subscription (donor notice gated on email + consent, admin notice always).
    await sendLapseNotifications(lapse ?? null);
    // Company refund void/correction receipt notice (TASK-095): post-commit, best-effort.
    await sendRefundNotice(refundNotice ?? null);
    // Individual-donor refund confirmation (TASK-099): post-commit, best-effort.
    await sendRefundConfirmationEmail(refundConfirmation ?? null);
    // Business-supporter thank-you invite (TASK-213): post-commit, best-effort. Present ONLY when a
    // NEW fulfilment record was just created for a qualifying business monthly gift AND the business
    // gave us an email — so it sends once per new supporter. A failed/late send must never fail the
    // webhook (the record + its token are already durably committed).
    await sendBusinessInvite(businessInvite ?? null);
    return { processed: true, action };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// A dispatched event's outcome: the action label (as before) plus the optional
// confirmation-email payload to send once the transaction commits (null = send
// nothing — e.g. a refund, or a donor who withheld their email / consent).
interface DispatchResult {
  action: string;
  email: DonationConfirmationEmail | null;
  // The in-person declaration email to send + stamp post-commit (TASK-075), or null when
  // there is nothing to confirm (non-card-present, or no receipt_email to send to).
  declaration?: DeclarationSend | null;
  // The Corporation Tax receipt to send post-commit (TASK-088), or null when there is none
  // (not a company gift, or one flagged for the trustees because consideration was given).
  receipt?: CompanyReceiptSend | null;
  // The lapsed-subscription notifications to send post-commit (TASK-092), or null when the event
  // did not lapse a subscription.
  lapse?: LapseNotify | null;
  // The company refund void/correction receipt notice to send post-commit (TASK-095), or null.
  refundNotice?: RefundNotice | null;
  // The individual-donor refund confirmation email to send post-commit (TASK-099), or null (a
  // company refund, or no consented donor email).
  refundConfirmation?: RefundConfirmationSend | null;
  // The business-supporter thank-you invite to send post-commit (TASK-213), or null when this gift
  // did not create a NEW fulfilment record or the business gave us no email.
  businessInvite?: BusinessInviteSend | null;
}

// A committed individual-donor refund whose confirmation email must be sent AFTER commit (TASK-099).
interface RefundConfirmationSend {
  email: string;
  fullName: string;
  refundedPence: number;
  currency: string;
  refundDate: Date;
  full: boolean;
}

// Post-commit, best-effort individual-donor refund confirmation (TASK-099/REQ-063). Builds the
// content (src/donors/confirmation.ts) and sends it; a null send (a company refund, or no consented
// donor email) or a provider failure is a no-op, so a failed/late send never rolls back the
// committed refund. Exported so the trigger is unit-testable.
export async function sendRefundConfirmationEmail(send: RefundConfirmationSend | null): Promise<void> {
  if (!send) return;
  try {
    const content = buildRefundConfirmation({
      fullName: send.fullName,
      refundedPence: send.refundedPence,
      currency: send.currency,
      refundDate: send.refundDate,
      full: send.full,
    });
    await sendRefundConfirmation({
      email: send.email,
      fullName: send.fullName,
      refundedPence: send.refundedPence,
      currency: send.currency,
      text: content.text,
      html: content.html,
    });
  } catch {
    // best-effort: the refund is durably recorded; a failed confirmation must not fail the webhook.
  }
}

// A committed company refund whose void/correction Corporation Tax receipt notice must be sent
// AFTER commit (TASK-095/REQ-063). Carries the billing-contact email + the values the pure notice
// builder needs.
interface RefundNotice {
  email: string;
  legalName: string;
  action: CompanyRefundAction;
  originalAmountPence: number;
  refundedPence: number;
  currency: string;
  donationDate: Date;
}

// Post-commit, best-effort company refund notice (TASK-095/REQ-063). Builds the void/correction
// content (src/donors/receipt.ts) and sends it via the same company-receipt channel; a null notice
// (not a company refund, or no contact email) or a provider failure is a no-op, so a failed/late
// send never rolls back the committed refund. Exported so the trigger is unit-testable.
export async function sendRefundNotice(notice: RefundNotice | null): Promise<void> {
  if (!notice) return;
  try {
    const content = buildCompanyRefundNotice({
      legalName: notice.legalName,
      action: notice.action,
      originalAmountPence: notice.originalAmountPence,
      refundedPence: notice.refundedPence,
      currency: notice.currency,
      donationDate: notice.donationDate,
    });
    await sendCompanyReceipt({
      email: notice.email,
      legalName: notice.legalName,
      amountPence: notice.originalAmountPence,
      currency: notice.currency,
      text: content.text,
      html: content.html,
    });
  } catch {
    // best-effort: the refund is durably recorded; a failed notice must not fail the webhook.
  }
}

// A committed subscription lapse whose notices must be sent AFTER commit (TASK-092/REQ-065): a
// donor notice (only when they gave an email + consent) and an admin notice (always). Carries the
// donor contact + the subscription id for the email bodies.
interface LapseNotify {
  donorEmail: string | null;
  donorEmailConsent: boolean;
  donorName: string;
  subscriptionId: string;
}

// Post-commit, best-effort lapsed-subscription notifications (TASK-092/REQ-065). Always emails the
// fixed admin inbox (config.ADMIN_NOTIFICATION_EMAIL); emails the donor ONLY when they gave us an
// email and consent (mirroring the confirmation-email gate). Each send is best-effort — the lapse
// is already durably recorded, so a failed/late send must not fail the webhook. Exported so the
// trigger is unit-testable with a mocked email client.
export async function sendLapseNotifications(lapse: LapseNotify | null): Promise<void> {
  if (!lapse) return;
  try {
    await sendSubscriptionLapsedAdmin({
      email: config.ADMIN_NOTIFICATION_EMAIL,
      donorName: lapse.donorName,
      subscriptionId: lapse.subscriptionId,
    });
  } catch {
    // best-effort: the lapse is committed; a failed admin notice must not fail the webhook.
  }
  if (lapse.donorEmail && lapse.donorEmailConsent) {
    try {
      await sendSubscriptionLapsedDonor({
        email: lapse.donorEmail,
        fullName: lapse.donorName,
        subscriptionId: lapse.subscriptionId,
      });
    } catch {
      // best-effort: the donor notice is a courtesy; a failed send must not fail the webhook.
    }
  }
}

// A newly-created business supporter whose thank-you invite must be sent AFTER commit (TASK-213).
// Present ONLY when handleCheckoutCompleted actually CREATED the fulfilment record (not on a conflict)
// AND the business gave us an email. Carries the recipient + the greeting names (businessName falls
// back to fullName) + the record's band and the token that was just written (the invite links to
// /business/thank-you?token=<token>).
interface BusinessInviteSend {
  email: string;
  businessName: string | null;
  fullName: string;
  band: SupporterBand;
  token: string;
}

// Post-commit, best-effort business-supporter thank-you invite (TASK-213). Builds the branded invite
// (src/business/invite-email.ts) on the env-correct public base (config.PORTAL_BASE_URL — the same base
// the donor portal magic link uses, so a staging email links to staging and a prod email to prod) and
// sends it From/Reply-To config.GIVING_FROM_EMAIL via the relay's thank-you passthrough. A null send
// (no new record, or no email) or a provider failure is a no-op, so a failed/late send never rolls
// back the committed fulfilment record. Mirrors sendLapseNotifications exactly (structure, placement,
// error swallowing). Exported so the trigger is unit-testable with a mocked email client.
export async function sendBusinessInvite(send: BusinessInviteSend | null): Promise<void> {
  if (!send) return;
  try {
    // Greeting name: the business_name, falling back to the donor's full_name (the same fallback the
    // /business/thank-you page uses) — always a non-empty name to greet them by.
    const businessName = (send.businessName ?? "").trim() || send.fullName;
    const invite = buildBusinessSupporterInviteEmail({
      businessName,
      baseUrl: config.PORTAL_BASE_URL,
      token: send.token,
    });
    await sendBusinessSupporterInvite({
      email: send.email,
      from: config.GIVING_FROM_EMAIL,
      replyTo: config.GIVING_FROM_EMAIL,
      subject: invite.subject,
      html: invite.html,
      text: invite.text,
    });
  } catch {
    // best-effort: the fulfilment record + token are durably committed; a failed invite must not fail
    // the webhook (which would make Stripe redeliver and re-run the whole handler).
  }
}

// A committed company donation whose Corporation Tax receipt must be sent AFTER commit. Carries
// the billing-contact email and the values the pure receipt builder needs. donationDate is the
// gift's timestamp (from the Stripe session), so the builder needs no clock.
interface CompanyReceiptSend {
  email: string;
  legalName: string;
  amountPence: number;
  currency: string;
  donationDate: Date;
}

// Post-commit, best-effort Corporation Tax receipt email (TASK-088/REQ-053). Builds the verbatim
// receipt content (src/donors/receipt.ts) and sends it to the company's billing contact; a null
// send (a non-company gift, or one flagged for the trustees) or a provider failure is a no-op, so
// a failed/late send never rolls back the committed donation. Exported so the trigger is
// unit-testable with a mocked email client.
export async function sendCompanyReceiptEmail(send: CompanyReceiptSend | null): Promise<void> {
  if (!send) return;
  try {
    const receipt = buildCorporationTaxReceipt({
      legalName: send.legalName,
      amountPence: send.amountPence,
      currency: send.currency,
      donationDate: send.donationDate,
    });
    await sendCompanyReceipt({
      email: send.email,
      legalName: send.legalName,
      amountPence: send.amountPence,
      currency: send.currency,
      text: receipt.text,
      html: receipt.html,
    });
  } catch {
    // best-effort: the donation is durably recorded; a failed receipt must not fail the webhook.
  }
}

// A pending in-person declaration whose confirmation email must be sent AFTER commit; its
// send outcome flips declaration_status. Carries the committed donation id, the recipient
// (the charge's receipt_email), the unique token addressing the declaration, and the
// amount for the email body.
interface DeclarationSend {
  donationId: number;
  receiptEmail: string;
  token: string;
  amountPence: number;
  currency: string;
}

// Post-commit, best-effort in-person declaration email (TASK-075/REQ-048). Sends the
// unique declaration link + QR short link to the charge's receipt_email, then stamps
// declaration_status: 'sent' on success, 'undelivered' when the send throws — via a
// SEPARATE write, so a failed send/stamp never rolls back the committed donation. The
// legal pending→sent / pending→undelivered transition is enforced by applyDeclarationEvent.
// Exported so the trigger is unit-testable with a mocked email client.
export async function sendDeclarationConfirmation(decl: DeclarationSend | null): Promise<void> {
  if (!decl) return;
  const links = declarationLinks(config.DECLARATION_FORM_BASE_URL, decl.token);
  let event: "send" | "mark_undelivered" = "send";
  try {
    await sendDeclarationEmail({
      email: decl.receiptEmail,
      declarationLink: links.link,
      shortLink: links.shortLink,
      amountPence: decl.amountPence,
      currency: decl.currency,
    });
  } catch {
    // The provider failed: the confirmation was not delivered.
    event = "mark_undelivered";
  }
  const status = applyDeclarationEvent("pending", event); // 'sent' | 'undelivered'
  try {
    await pool.query(`UPDATE donations SET declaration_status = $1 WHERE id = $2`, [
      status,
      decl.donationId,
    ]);
  } catch {
    // Best-effort status stamp: the donation + token are already durably committed, so a
    // failure here must not fail the webhook (which would make Stripe redeliver).
  }
}

// Post-commit, best-effort send of the donation-confirmation email. Isolated so the
// trigger is unit-testable with a mocked email client (DB-free). A null payload
// sends nothing; any send failure is swallowed (the donation already committed).
export async function sendConfirmation(email: DonationConfirmationEmail | null): Promise<void> {
  if (!email) return;
  try {
    // Build the enriched content (Gift Aid line + manage/cancel copy where they apply) from the
    // pure builder, then send. The consent gate stays in confirmationEmailFor: a null email (no
    // consented address) already short-circuited above, so no email is sent without consent.
    const content = buildDonationConfirmation({
      fullName: email.fullName,
      amountPence: email.amountPence,
      currency: email.currency,
      giftAid: email.giftAid,
      mode: email.mode,
      reference: email.reference,
      donationDate: email.donationDate,
    });
    await sendDonationConfirmation({
      email: email.email,
      fullName: email.fullName,
      amountPence: email.amountPence,
      currency: email.currency,
      text: content.text,
      html: content.html,
    });
  } catch {
    // best-effort: the donation is durably recorded; a failed email must not fail
    // the webhook (which would make Stripe redeliver and re-run the whole handler).
  }
}

async function dispatch(client: PoolClient, event: Stripe.Event): Promise<DispatchResult> {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(client, event);
    case "invoice.paid":
    case "invoice.payment_succeeded": {
      // A successful invoice both records the recurring donation AND recovers any dunning on the
      // subscription (payment_succeeded → active). Both writes join THIS transaction.
      const recurring = await handleRecurring(client, event);
      await handleDunning(client, event);
      return recurring;
    }
    case "charge.succeeded":
      return handleChargeSucceeded(client, event);
    // Subscription dunning (REQ-065/TASK-092): a failed renewal advances the dunning lifecycle,
    // and a terminal subscription state lapses it. All go through handleDunning + the same
    // writeWithAudit-style transaction, and are idempotent via the event-id claim above.
    case "invoice.payment_failed":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return handleDunning(client, event);
    // BACS settlement (REQ-065/TASK-090): a pending BACS gift's mandate confirms or fails
    // asynchronously. Flip payment_status + re-derive claim_status on the SAME donation
    // (found by session id) — never a new row. Idempotent via the event-id claim above.
    case "checkout.session.async_payment_succeeded":
      return { action: await handleAsyncPayment(client, event, "paid"), email: null };
    case "checkout.session.async_payment_failed":
      return { action: await handleAsyncPayment(client, event, "failed"), email: null };
    case "charge.refunded":
      return handleRefund(client, event, refundedPenceFromCharge(event.data.object));
    case "charge.dispute.created":
    case "charge.dispute.closed":
    case "charge.dispute.funds_withdrawn":
      return handleRefund(client, event, refundedPenceFromDispute(event.data.object));
    default:
      return { action: "ignored", email: null };
  }
}

// checkout.session.completed → persist the donation (Gift Aid recorded as a flag
// from metadata) + a donation.created audit row.
async function handleCheckoutCompleted(
  client: PoolClient,
  event: Stripe.Event & { data: { object: Stripe.Checkout.Session } },
): Promise<DispatchResult> {
  const { donor, donation } = donationFromCheckoutSession(event.data.object);
  // A gift-aided individual also captures a Gift Aid declaration (REQ-043); it is
  // inserted and linked to the donation in the SAME transaction (declaration_id FK).
  const declaration = declarationFromCheckoutSession(event.data.object);
  // A gift-aided PARTNERSHIP instead captures one declaration + share per partner (REQ-051),
  // inserted alongside the donation in the SAME transaction (donation_partner_shares rows).
  const partners = partnerSharesFromCheckoutSession(event.data.object);
  const { donorId, donationId, declarationId, partnerShareIds } = await insertDonorAndDonation(
    client,
    donor,
    donation,
    declaration ?? undefined,
    partners.length ? partners : undefined,
  );
  if (declarationId != null) {
    await insertAudit(client, {
      actor: "stripe",
      action: "declaration.created",
      entity: "declaration",
      entityId: declarationId,
      data: { eventId: event.id, donorId, donationId },
    });
  }
  if (partnerShareIds.length) {
    await insertAudit(client, {
      actor: "stripe",
      action: "partnership.shares_created",
      entity: "donation",
      entityId: donationId,
      data: { eventId: event.id, donorId, partnerShareIds, partnerCount: partnerShareIds.length },
    });
  }
  await insertAudit(client, {
    actor: "stripe",
    action: "donation.created",
    entity: "donation",
    entityId: donationId,
    data: { eventId: event.id, donorId, giftAid: donation.giftAid, declarationId },
  });

  // Business-supporter fulfilment (TASK-206): a BUSINESS MONTHLY gift at/above the £10/month minimum
  // — an incorporated company, or a partnership/sole trader donating under a business name — earns a
  // recognition record. fulfilmentBandFor gates it (null for a one-off, an individual with no
  // business name, or a sub-£10 gift). When it bands, create the record in the SAME transaction (so
  // it commits with the donation) with a fresh per-business token for the secure thank-you link, and
  // audit it. Idempotent: ensureFulfilmentRecord's ON CONFLICT (donor_id) DO NOTHING + the event-id
  // guard above mean a redelivered event never double-creates. Does not touch the confirmation-email
  // or company-receipt behaviour below — those payloads are unchanged.
  const fulfilmentBand = fulfilmentBandFor({
    mode: donation.mode,
    donorType: donation.donorType,
    businessName: donor.businessName,
    amountPence: donation.amountPence,
  });
  let businessInvite: BusinessInviteSend | null = null;
  if (fulfilmentBand) {
    // Mint the secure-thank-you-link token here. It becomes the record's token IFF this call CREATES
    // the row; on a conflict ensureFulfilmentRecord ignores it and keeps the existing token. We only
    // audit/send on `created`, so the token we audit-with and thread out is always the one written.
    const token = randomUUID();
    const { id: fulfilmentId, created } = await ensureFulfilmentRecord(client, {
      donorId,
      band: fulfilmentBand,
      token,
    });
    // Audit `fulfilment.created` and send the invite ONLY on the newly created record — not on a
    // redelivered/reprocessed conflict — so each happens exactly ONCE per business supporter.
    if (created) {
      await insertAudit(client, {
        actor: "stripe",
        action: "fulfilment.created",
        entity: "business_supporter_fulfilment",
        entityId: fulfilmentId,
        data: { eventId: event.id, donorId, band: fulfilmentBand },
      });
      // Thread the thank-you invite OUT of the transaction to send post-commit (TASK-213), but only
      // when the business gave us an email. The invite is a transactional service message (it is how
      // they reach their thank-you page), so it follows the same email-present gate as the donation
      // confirmation / company receipt — not the marketing-consent gate.
      if (donor.email) {
        businessInvite = {
          email: donor.email,
          businessName: donor.businessName ?? null,
          fullName: donor.fullName,
          band: fulfilmentBand,
          token,
        };
      }
    }
  }

  // Company donation (REQ-053, TASK-088): decide receipt vs trustee-flag from whether NBCC gave
  // anything of value in return. A CLEAN gift (no consideration) gets a Corporation Tax receipt
  // emailed to the billing contact AFTER commit; a gift WITH consideration is NOT a plain
  // donation, so it is flagged for the trustees via an audit row inside THIS transaction (no
  // receipt). The donation itself already persisted non-claimable (donor_type='company').
  let receipt: CompanyReceiptSend | null = null;
  const companyRow = companyDonorFromCheckoutSession(event.data.object);
  if (companyRow) {
    const considerationGiven = event.data.object.metadata?.companyConsiderationGiven === "true";
    if (classifyCompanyGift({ considerationGiven }) === "flag_for_trustees") {
      await insertAudit(client, {
        actor: "stripe",
        action: "donation.flagged_for_trustees",
        entity: "donation",
        entityId: donationId,
        data: { eventId: event.id, donorId, reason: "consideration_given", legalName: companyRow.business_name },
      });
    } else {
      receipt = {
        email: companyRow.email,
        legalName: companyRow.business_name,
        amountPence: donation.amountPence,
        currency: donation.currency,
        donationDate: new Date((event.data.object.created ?? 0) * 1000),
      };
    }
  }

  // A company donation's email is its Corporation Tax receipt (above), NOT the individual donor
  // confirmation — so suppress the donor thank-you for companies (an individual/partnership donor
  // gets it whenever we have an email, consent-independent). Sent after COMMIT. The individual
  // confirmation carries the receipt reference (NBCC-<id>) + the gift date (TASK-203), so it stands
  // in for the Stripe receipt now that Stripe's own receipt email is off.
  const donationDate = new Date((event.data.object.created ?? 0) * 1000);
  return {
    action: "donation.created",
    email: companyRow
      ? null
      : confirmationEmailFor(donor, donation, { reference: donationReference(donationId), donationDate }),
    receipt,
    businessInvite,
  };
}

// charge.succeeded → record an IN-PERSON (Stripe Terminal / card_present) donation
// (REQ-054). ONLY card_present charges are handled: an online 'card' charge is already
// captured by checkout.session.completed, so mapping it here too would double-count —
// cardPresentDonationInput returns null for it and we ignore the event. A card-present
// tap captures no donor identity, so it books a walk-in donor (anonymous, no email/
// consent) + the donation + a donation.created audit row in the SAME transaction.
async function handleChargeSucceeded(
  client: PoolClient,
  event: Stripe.Event & { data: { object: Stripe.Charge } },
): Promise<DispatchResult> {
  const donation = cardPresentDonationInput(event.data.object);
  if (!donation) return { action: "ignored.not_card_present", email: null };

  // A walk-in gift has no captured identity: an anonymous donor with no email/consent
  // (never shown on the public supporters wall, never emailed).
  const donor: DonorInput = {
    fullName: "In-person donor",
    anonymous: true,
    emailConsent: false,
  };
  const { donorId, donationId } = await insertDonorAndDonation(client, donor, donation);

  // An in-person gift has no Gift Aid declaration yet, but the walk-in donor may add one:
  // stamp the donation with a UNIQUE token and declaration_status='pending' (a confirmation
  // is owed), in the SAME transaction as the donation. The token addresses the declaration
  // link/QR in the post-commit email (TASK-075). Kept off buildDonationRow (which is shared
  // with online channels that never carry a token) — a targeted UPDATE on the new row.
  const token = randomUUID();
  await client.query(
    `UPDATE donations SET declaration_status = 'pending', declaration_token = $1 WHERE id = $2`,
    [token, donationId],
  );

  await insertAudit(client, {
    actor: "stripe",
    action: "donation.created",
    entity: "donation",
    entityId: donationId,
    data: { eventId: event.id, donorId, paymentChannel: donation.paymentChannel },
  });

  // Email the declaration link only when the terminal captured a receipt email; otherwise
  // the confirmation stays 'pending' (a printed-QR follow-up, out of scope here).
  const receiptEmail = event.data.object.receipt_email;
  const declaration: DeclarationSend | null = receiptEmail
    ? {
        donationId,
        receiptEmail,
        token,
        amountPence: donation.amountPence,
        currency: donation.currency,
      }
    : null;
  return { action: "donation.created", email: null, declaration };
}

interface ParentDonation {
  donor_id: number;
  gift_aid: boolean;
  declaration_id: number | null;
  plan: string | null;
  donor_type: "individual" | "company";
  full_name: string;
  email: string | null;
  email_consent: boolean;
}

// invoice.paid / invoice.payment_succeeded → record a recurring monthly charge as
// a further donation against the SAME donor (found via the subscription id),
// inheriting Gift Aid + declaration. Skips the initial invoice and any charge
// already recorded, so it never double-counts.
async function handleRecurring(
  client: PoolClient,
  event: Stripe.Event & { data: { object: Stripe.Invoice } },
): Promise<DispatchResult> {
  const rec = recurringChargeFromInvoice(event.data.object);
  if (!rec) return { action: "ignored.invoice", email: null };

  const parent = (
    await client.query<ParentDonation>(
      `SELECT d.donor_id, d.gift_aid, d.declaration_id, d.plan, dn.donor_type,
              dn.full_name, dn.email, dn.email_consent
         FROM donations d JOIN donors dn ON dn.id = d.donor_id
        WHERE d.stripe_subscription_id = $1
        ORDER BY d.id ASC LIMIT 1`,
      [rec.subscriptionId],
    )
  ).rows[0];
  if (!parent) return { action: "ignored.no_parent", email: null };

  if (rec.paymentIntentId) {
    const dup = await client.query(
      `SELECT 1 FROM donations WHERE stripe_payment_intent_id = $1`,
      [rec.paymentIntentId],
    );
    if (dup.rowCount && dup.rowCount > 0) return { action: "ignored.duplicate_charge", email: null };
  }

  // The amount is the invoice's actually-charged amount (rec.amountPence =
  // amount_paid), so a prorated up/downgrade claims the true amount; Gift Aid +
  // declaration are carried from the original declaration on the subscription (REQ-055).
  const donation = recurringDonationInput(rec, {
    donorType: parent.donor_type,
    plan: parent.plan,
    giftAid: parent.gift_aid,
    declarationId: parent.declaration_id,
  });
  const donationId = await insertDonation(client, buildDonationRow(donation, parent.donor_id));
  await insertAudit(client, {
    actor: "stripe",
    action: "donation.recurring",
    entity: "donation",
    entityId: donationId,
    data: { eventId: event.id, donorId: parent.donor_id, subscriptionId: rec.subscriptionId },
  });
  // Confirm each recurring charge to a consenting donor (email + consent carried on
  // the donor row found via the subscription). Sent after COMMIT by the caller. Carries this
  // charge's own receipt reference (NBCC-<id>) + payment date (TASK-203).
  return {
    action: "donation.recurring",
    email: confirmationEmailFor(
      { email: parent.email, emailConsent: parent.email_consent, fullName: parent.full_name },
      // A recurring charge is a monthly gift; Gift Aid is carried from the parent donation.
      { amountPence: rec.amountPence, currency: rec.currency, giftAid: parent.gift_aid, mode: "monthly" },
      { reference: donationReference(donationId), donationDate: new Date((event.created ?? 0) * 1000) },
    ),
  };
}

interface RefundTarget {
  id: number;
  gift_aid: boolean;
  declaration_id: number | null;
  amount_pence: number;
  currency: string;
  created_at: Date;
  claim_status: ClaimStatus;
  claim_batch_id: number | null;
  donor_type: "individual" | "company";
  business_name: string | null;
  full_name: string;
  email: string | null;
  email_consent: boolean;
}

// charge.refunded / charge.dispute.* → update the SAME donation record's refunded_amount_pence
// (absolute, so replay-safe) and recompute the claim state via the pure recalculateClaimOnRefund
// (REQ-063/TASK-093). Never inserts a NEW donation. On an ALREADY-CLAIMED gift it flags
// claim_status='adjustment_due' and inserts a claim_adjustments row (tied to its claim batch) in
// THIS transaction; on a COMPANY gift it leaves claim_status untouched and returns a
// void/correction receipt notice to send post-commit. Idempotent via the event-id claim above.
async function handleRefund(
  client: PoolClient,
  event: Stripe.Event,
  refundedPence: number,
): Promise<DispatchResult> {
  const obj = event.data.object as Stripe.Charge | Stripe.Dispute;
  const paymentIntentId = typeof obj.payment_intent === "string" ? obj.payment_intent : null;
  const chargeId =
    obj.object === "charge"
      ? obj.id
      : typeof (obj as Stripe.Dispute).charge === "string"
        ? ((obj as Stripe.Dispute).charge as string)
        : null;

  const target = (
    await client.query<RefundTarget>(
      `SELECT d.id, d.gift_aid, d.declaration_id, d.amount_pence, d.currency, d.created_at,
              d.claim_status, d.claim_batch_id, dn.donor_type, dn.business_name,
              dn.full_name, dn.email, dn.email_consent
         FROM donations d JOIN donors dn ON dn.id = d.donor_id
        WHERE d.stripe_payment_intent_id = $1 OR d.stripe_charge_id = $2
        ORDER BY d.id ASC LIMIT 1`,
      [paymentIntentId, chargeId],
    )
  ).rows[0];
  if (!target) return { action: "ignored.no_donation", email: null };

  // Cap the reported refund at the donation amount (Stripe reports the cumulative absolute
  // refunded total, which for a dispute can equal the amount).
  const cappedRefund = Math.min(refundedPence, target.amount_pence);
  const recalc = recalculateClaimOnRefund({
    donorType: target.donor_type,
    giftAid: target.gift_aid,
    hasDeclaration: target.declaration_id != null,
    amountPence: target.amount_pence,
    refundedPence: cappedRefund,
    claimStatus: target.claim_status,
  });

  // The donations.claim_status column now accepts 'adjustment_due' (migration 1783067859348).
  await client.query(
    `UPDATE donations SET refunded_amount_pence = $1, claim_status = $2 WHERE id = $3`,
    [refundedPence, recalc.claimStatus, target.id],
  );
  await insertAudit(client, {
    actor: "stripe",
    action: "donation.refunded",
    entity: "donation",
    entityId: target.id,
    data: { eventId: event.id, refundedPence, claimStatus: recalc.claimStatus, eventType: event.type },
  });

  // Already-claimed gift → record the owed HMRC adjustment against its claim batch, same tx.
  if (recalc.claimStatus === "adjustment_due" && target.claim_batch_id != null) {
    const adjustmentId = await insertClaimAdjustment(
      client,
      target.id,
      target.claim_batch_id,
      recalc.adjustmentPence,
      `refund via ${event.type}`,
    );
    await insertAudit(client, {
      actor: "stripe",
      action: "claim.adjustment_recorded",
      entity: "donation",
      entityId: target.id,
      data: {
        eventId: event.id,
        adjustmentId,
        claimBatchId: target.claim_batch_id,
        adjustmentPence: recalc.adjustmentPence,
      },
    });
  }

  // Company gift → a void/correction Corporation Tax receipt notice, sent post-commit.
  const refundNotice: RefundNotice | null =
    target.donor_type === "company" && recalc.receiptAction && target.email
      ? {
          email: target.email,
          legalName: target.business_name ?? "",
          action: recalc.receiptAction,
          originalAmountPence: target.amount_pence,
          refundedPence: cappedRefund,
          currency: target.currency,
          donationDate: new Date(target.created_at),
        }
      : null;

  // Individual donor → a refund confirmation email, sent post-commit, ONLY when a consented email is
  // on file (the same gate as the donation-confirmation send). A company never gets this (it gets the
  // receipt notice above); recalc.donorRefund is null for a company.
  const refundConfirmation: RefundConfirmationSend | null =
    recalc.donorRefund && target.email && target.email_consent
      ? {
          email: target.email,
          fullName: target.full_name,
          refundedPence: cappedRefund,
          currency: target.currency,
          refundDate: new Date((event.created ?? 0) * 1000),
          full: recalc.donorRefund === "full",
        }
      : null;

  return { action: "donation.refunded", email: null, refundNotice, refundConfirmation };
}

interface PaymentTarget {
  id: number;
  gift_aid: boolean;
  declaration_id: number | null;
  amount_pence: number;
  refunded_amount_pence: number;
  donor_type: "individual" | "company";
}

// checkout.session.async_payment_succeeded / async_payment_failed → settle a pending BACS gift
// (REQ-065/TASK-090). Finds the SAME donation by its session id, flips payment_status, and
// re-derives claim_status through the existing rule (deriveClaimStatus): a succeeded gift becomes
// claimable only if it is an individual, gift-aided, declared and not refunded; a failed gift is
// permanently not_eligible (paymentStatus='failed'). Never inserts a new row. Idempotent via the
// event-id claim in processWebhookEvent, so a resent event is a no-op.
async function handleAsyncPayment(
  client: PoolClient,
  event: Stripe.Event & { data: { object: Stripe.Checkout.Session } },
  newStatus: PaymentStatus,
): Promise<string> {
  const sessionId = event.data.object.id;
  const target = (
    await client.query<PaymentTarget>(
      `SELECT d.id, d.gift_aid, d.declaration_id, d.amount_pence, d.refunded_amount_pence, dn.donor_type
         FROM donations d JOIN donors dn ON dn.id = d.donor_id
        WHERE d.stripe_session_id = $1
        ORDER BY d.id ASC LIMIT 1`,
      [sessionId],
    )
  ).rows[0];
  if (!target) return "ignored.no_donation";

  const claimStatus = deriveClaimStatus({
    donorType: target.donor_type,
    giftAid: target.gift_aid,
    hasDeclaration: target.declaration_id != null,
    fullyRefunded: target.refunded_amount_pence >= target.amount_pence,
    paymentStatus: newStatus,
  });
  await client.query(
    `UPDATE donations SET payment_status = $1, claim_status = $2 WHERE id = $3`,
    [newStatus, claimStatus, target.id],
  );
  const action = newStatus === "paid" ? "donation.payment_succeeded" : "donation.payment_failed";
  await insertAudit(client, {
    actor: "stripe",
    action,
    entity: "donation",
    entityId: target.id,
    data: { eventId: event.id, sessionId, paymentStatus: newStatus, claimStatus },
  });
  return action;
}

interface DunningTarget {
  dunning_id: number | null;
  status: DunningStatus | null;
  failed_attempts: number | null;
  donor_id: number;
  full_name: string;
  email: string | null;
  email_consent: boolean;
}

// invoice.payment_failed / invoice.payment_succeeded / customer.subscription.updated|deleted →
// advance the subscription_dunning lifecycle (REQ-065/TASK-092). Maps the Stripe event to a
// dunning event (dunningFromStripeEvent), then applies it via the pure state machine and
// UPSERTs the dunning row + a matching audit row in THIS transaction. Idempotent via the
// event-id claim in processWebhookEvent. On a lapse, returns the donor contact so the post-commit
// caller can send the donor + admin notices. Never throws for a legal-but-no-op event (e.g. a
// success with no open dunning, or a cancel while already active) — it simply ignores it.
async function handleDunning(client: PoolClient, event: Stripe.Event): Promise<DispatchResult> {
  const mapping = dunningFromStripeEvent(event);
  if (!mapping) return { action: "ignored.not_dunning", email: null };
  const { subscriptionId, dunningEvent } = mapping;

  // Find the donor for this subscription (from its recurring donation) + any existing dunning row.
  const target = (
    await client.query<DunningTarget>(
      `SELECT sd.id AS dunning_id, sd.status, sd.failed_attempts,
              dn.id AS donor_id, dn.full_name, dn.email, dn.email_consent
         FROM donations d
         JOIN donors dn ON dn.id = d.donor_id
         LEFT JOIN subscription_dunning sd ON sd.stripe_subscription_id = $1
        WHERE d.stripe_subscription_id = $1
        ORDER BY d.id ASC LIMIT 1`,
      [subscriptionId],
    )
  ).rows[0];
  if (!target) return { action: "ignored.no_subscription", email: null };

  const current: DunningStatus = target.status ?? "active";
  const attempts = target.failed_attempts ?? 0;

  // Nothing to reset when a success arrives with no open dunning; and ignore any illegal
  // transition (e.g. retries_exhausted on a healthy active subscription = a voluntary cancel, or
  // any event on an already-lapsed row) rather than throwing.
  if (dunningEvent === "payment_succeeded" && target.dunning_id === null) {
    return { action: "ignored.dunning_noop", email: null };
  }
  if (!canApplyDunningEvent(current, dunningEvent)) {
    return { action: "ignored.dunning_noop", email: null };
  }

  const nextStatus = applyDunningEvent(current, dunningEvent);
  const nextAttempts = nextFailedAttempts(dunningEvent, attempts);
  const lapsed = nextStatus === "lapsed";

  if (target.dunning_id === null) {
    await client.query(
      `INSERT INTO subscription_dunning
         (donor_id, stripe_subscription_id, status, failed_attempts, lapsed_at, updated_at)
       VALUES ($1, $2, $3, $4, ${lapsed ? "now()" : "NULL"}, now())`,
      [target.donor_id, subscriptionId, nextStatus, nextAttempts],
    );
  } else {
    await client.query(
      `UPDATE subscription_dunning
          SET status = $1, failed_attempts = $2,
              lapsed_at = ${lapsed ? "now()" : "lapsed_at"}, updated_at = now()
        WHERE id = $3`,
      [nextStatus, nextAttempts, target.dunning_id],
    );
  }

  const action = lapsed
    ? "subscription.lapsed"
    : dunningEvent === "payment_failed"
      ? "subscription.payment_failed"
      : "subscription.payment_recovered";
  await insertAudit(client, {
    actor: "stripe",
    action,
    entity: "subscription",
    entityId: target.donor_id,
    data: { eventId: event.id, subscriptionId, status: nextStatus, failedAttempts: nextAttempts },
  });

  const lapse: LapseNotify | null = lapsed
    ? {
        donorEmail: target.email,
        donorEmailConsent: target.email_consent,
        donorName: target.full_name,
        subscriptionId,
      }
    : null;
  return { action, email: null, lapse };
}
