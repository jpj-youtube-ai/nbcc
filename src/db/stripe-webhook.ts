import type { PoolClient } from "pg";
import type Stripe from "stripe";
import { pool } from "./pool";
import { buildDonationRow } from "./donations-model";
import { insertAudit, insertDonation, insertDonorAndDonation } from "./donations";
import {
  donationFromCheckoutSession,
  recurringChargeFromInvoice,
  recurringDonationInput,
  refundedPenceFromCharge,
  refundedPenceFromDispute,
  claimStatusAfterRefund,
} from "./stripe-webhook-model";

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
    const action = await dispatch(client, event);
    await client.query("COMMIT");
    return { processed: true, action };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function dispatch(client: PoolClient, event: Stripe.Event): Promise<string> {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(client, event);
    case "invoice.paid":
    case "invoice.payment_succeeded":
      return handleRecurring(client, event);
    case "charge.refunded":
      return handleRefund(client, event, refundedPenceFromCharge(event.data.object));
    case "charge.dispute.created":
    case "charge.dispute.closed":
    case "charge.dispute.funds_withdrawn":
      return handleRefund(client, event, refundedPenceFromDispute(event.data.object));
    default:
      return "ignored";
  }
}

// checkout.session.completed → persist the donation (Gift Aid recorded as a flag
// from metadata) + a donation.created audit row.
async function handleCheckoutCompleted(
  client: PoolClient,
  event: Stripe.Event & { data: { object: Stripe.Checkout.Session } },
): Promise<string> {
  const { donor, donation } = donationFromCheckoutSession(event.data.object);
  const { donorId, donationId } = await insertDonorAndDonation(client, donor, donation);
  await insertAudit(client, {
    actor: "stripe",
    action: "donation.created",
    entity: "donation",
    entityId: donationId,
    data: { eventId: event.id, donorId, giftAid: donation.giftAid },
  });
  return "donation.created";
}

interface ParentDonation {
  donor_id: number;
  gift_aid: boolean;
  declaration_id: number | null;
  plan: string | null;
  donor_type: "individual" | "company";
}

// invoice.paid / invoice.payment_succeeded → record a recurring monthly charge as
// a further donation against the SAME donor (found via the subscription id),
// inheriting Gift Aid + declaration. Skips the initial invoice and any charge
// already recorded, so it never double-counts.
async function handleRecurring(
  client: PoolClient,
  event: Stripe.Event & { data: { object: Stripe.Invoice } },
): Promise<string> {
  const rec = recurringChargeFromInvoice(event.data.object);
  if (!rec) return "ignored.invoice";

  const parent = (
    await client.query<ParentDonation>(
      `SELECT d.donor_id, d.gift_aid, d.declaration_id, d.plan, dn.donor_type
         FROM donations d JOIN donors dn ON dn.id = d.donor_id
        WHERE d.stripe_subscription_id = $1
        ORDER BY d.id ASC LIMIT 1`,
      [rec.subscriptionId],
    )
  ).rows[0];
  if (!parent) return "ignored.no_parent";

  if (rec.paymentIntentId) {
    const dup = await client.query(
      `SELECT 1 FROM donations WHERE stripe_payment_intent_id = $1`,
      [rec.paymentIntentId],
    );
    if (dup.rowCount && dup.rowCount > 0) return "ignored.duplicate_charge";
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
  return "donation.recurring";
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
