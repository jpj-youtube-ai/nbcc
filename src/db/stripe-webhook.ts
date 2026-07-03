import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type Stripe from "stripe";
import { pool } from "./pool";
import { config } from "../config";
import { buildDonationRow, deriveClaimStatus, type DonorInput, type PaymentStatus } from "./donations-model";
import { insertAudit, insertDonation, insertDonorAndDonation } from "./donations";
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
  claimStatusAfterRefund,
  confirmationEmailFor,
  type DonationConfirmationEmail,
} from "./stripe-webhook-model";
import {
  sendDonationConfirmation,
  sendDeclarationEmail,
  sendCompanyReceipt,
  sendSubscriptionLapsedDonor,
  sendSubscriptionLapsedAdmin,
} from "../clients/email";
import { applyDeclarationEvent } from "../declarations/status";
import { buildCorporationTaxReceipt, classifyCompanyGift } from "../donors/receipt";
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
    const { action, email, declaration, receipt, lapse } = await dispatch(client, event);
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
    await sendDonationConfirmation(email);
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
      return {
        action: await handleRefund(client, event, refundedPenceFromCharge(event.data.object)),
        email: null,
      };
    case "charge.dispute.created":
    case "charge.dispute.closed":
    case "charge.dispute.funds_withdrawn":
      return {
        action: await handleRefund(client, event, refundedPenceFromDispute(event.data.object)),
        email: null,
      };
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

  // Confirm the gift by email only when the donor gave us their email AND consent
  // (confirmationEmailFor gates this; donationFromCheckoutSession already suppresses
  // the email otherwise). A company's contact email is not marketing consent, so this is
  // null for a company — the Corporation Tax receipt above is its email. Sent after COMMIT.
  return { action: "donation.created", email: confirmationEmailFor(donor, donation), receipt };
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
  // the donor row found via the subscription). Sent after COMMIT by the caller.
  return {
    action: "donation.recurring",
    email: confirmationEmailFor(
      { email: parent.email, emailConsent: parent.email_consent, fullName: parent.full_name },
      { amountPence: rec.amountPence, currency: rec.currency },
    ),
  };
}

interface RefundTarget {
  id: number;
  gift_aid: boolean;
  declaration_id: number | null;
  amount_pence: number;
  donor_type: "individual" | "company";
}

// charge.refunded / charge.dispute.* → update the SAME donation record's
// refunded_amount_pence (absolute, so replay-safe) and recompute claim_status.
// Never inserts a new row.
async function handleRefund(
  client: PoolClient,
  event: Stripe.Event,
  refundedPence: number,
): Promise<string> {
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
      `SELECT d.id, d.gift_aid, d.declaration_id, d.amount_pence, dn.donor_type
         FROM donations d JOIN donors dn ON dn.id = d.donor_id
        WHERE d.stripe_payment_intent_id = $1 OR d.stripe_charge_id = $2
        ORDER BY d.id ASC LIMIT 1`,
      [paymentIntentId, chargeId],
    )
  ).rows[0];
  if (!target) return "ignored.no_donation";

  const claimStatus = claimStatusAfterRefund(
    {
      donorType: target.donor_type,
      giftAid: target.gift_aid,
      hasDeclaration: target.declaration_id != null,
      amountPence: target.amount_pence,
    },
    refundedPence,
  );
  await client.query(
    `UPDATE donations SET refunded_amount_pence = $1, claim_status = $2 WHERE id = $3`,
    [refundedPence, claimStatus, target.id],
  );
  await insertAudit(client, {
    actor: "stripe",
    action: "donation.refunded",
    entity: "donation",
    entityId: target.id,
    data: { eventId: event.id, refundedPence, claimStatus, eventType: event.type },
  });
  return "donation.refunded";
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
