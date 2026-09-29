import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./pool";
import type { ImportEntry } from "../reconcile/import-plan";
import { insertAudit } from "./donations";
import { ensureFulfilmentRecord } from "./fulfilment";
import { deriveClaimStatus } from "./donations-model";

// TASK-430: writing supporters the charity never knew it had.
//
// DELIBERATELY SEPARATE from src/db/donations.ts. Everything in there records money as it arrives,
// stamped with now(). This file is the only place that can write a donation dated in the past, and
// it lives apart so that backdating is a thing you have to come looking for rather than something
// the ordinary path can do by accident. A donation recorded on the wrong day is a wrong number in
// a charity's accounts.
//
// CONSENT. These five signed up through Stripe before any of this existed, so none of them passed
// through the consent flow. email_consent and thankyou_consent are therefore written FALSE, not
// defaulted: the column comment in donations.ts warns that letting them default is "the exact
// consent violation splitting the column was meant to make impossible". The thank-you and Gift Aid
// emails they receive are transactional - an acknowledgement of a gift they made, and a question
// about that gift - not marketing, which is what email_consent governs.

export type ImportOutcome = {
  donorId: number;
  donationIds: number[];
  fulfilmentId: number | null;
  skippedCharges: string[];
};

/** Charge ids already recorded, so a second run adds nothing. */
export async function alreadyImportedCharges(chargeIds: string[]): Promise<Set<string>> {
  if (chargeIds.length === 0) return new Set();
  const res = await pool.query<{ stripe_charge_id: string }>(
    `SELECT stripe_charge_id FROM donations WHERE stripe_charge_id = ANY($1::text[])`,
    [chargeIds],
  );
  return new Set(res.rows.map((r) => r.stripe_charge_id));
}

/** An existing donor with this email, if there is one. Prevents a duplicate person. */
export async function findDonorByEmail(email: string): Promise<number | null> {
  const res = await pool.query<{ id: number }>(
    `SELECT id FROM donors WHERE lower(trim(email)) = lower(trim($1)) ORDER BY id ASC LIMIT 1`,
    [email],
  );
  return res.rows[0]?.id ?? null;
}

/**
 * Create the donor, their historical donations and (for a company) their supporter record, in ONE
 * transaction. Either the whole supporter lands or none of it does: a donor with half their
 * donations is worse than a donor with none, because it looks complete.
 */
export async function importHistoricalSupporter(entry: ImportEntry): Promise<ImportOutcome> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    // Reuse an existing donor rather than create a second record for the same person.
    let donorId = await findDonorByEmail(entry.donor.email);
    if (donorId === null) {
      const res = await client.query<{ id: number }>(
        `INSERT INTO donors
           (donor_type, full_name, business_name, email, email_consent, thankyou_consent, anonymous)
         VALUES ($1, $2, $3, $4, false, false, false)
         RETURNING id`,
        [entry.donor.donorType, entry.donor.fullName, entry.donor.businessName, entry.donor.email],
      );
      donorId = res.rows[0].id;
    }

    const donationIds: number[] = [];
    const skippedCharges: string[] = [];

    for (const d of entry.donations) {
      // Idempotent per charge: Stripe's charge id is the natural key for "this exact payment".
      const dup = await client.query(
        `SELECT 1 FROM donations WHERE stripe_charge_id = $1`,
        [d.stripeChargeId],
      );
      if ((dup.rowCount ?? 0) > 0) {
        skippedCharges.push(d.stripeChargeId);
        continue;
      }

      const res = await client.query<{ id: number }>(
        // mode comes from the planner, not a literal here: the column is
        // CHECK (mode IN ('once','monthly')) and the first version of this hardcoded
        // 'subscription', so every insert was rejected.
        //
        // currency is 'GBP' upper-case because that is what every other row holds — the live path
        // calls .toUpperCase() on Stripe's lower-case 'gbp'. There is NO constraint on this column,
        // so writing 'gbp' would have been accepted and left these five donations quietly
        // inconsistent with every other donation in the table.
        `INSERT INTO donations
           (donor_id, mode, plan, amount_pence, currency, gift_aid, gasds_eligible,
            payment_channel, claim_status, stripe_subscription_id, stripe_charge_id,
            payment_status, created_at)
         VALUES ($1, $2, NULL, $3, 'GBP', false, false,
                 'online', $4, $5, $6, 'paid', $7)
         RETURNING id`,
        [
          donorId,
          d.mode,
          d.amountPence,
          // Derived by the SAME function the live money path uses, not hardcoded. My first
          // attempt invented "unclaimed", which is not one of the four values the column's CHECK
          // constraint permits, so every insert would have been rejected. Both a company and an
          // individual who has not yet declared come out as not_eligible; an individual's later
          // declaration is what makes these claimable, and it can cover past gifts.
          deriveClaimStatus({
            donorType: entry.donor.donorType,
            giftAid: false,
            hasDeclaration: false,
            paymentStatus: "paid",
          }),
          d.stripeSubscriptionId,
          d.stripeChargeId,
          d.paidAt,
        ],
      );
      donationIds.push(res.rows[0].id);
    }

    let fulfilmentId: number | null = null;
    if (entry.fulfilment) {
      // Reuse the writer the live webhook uses, rather than hand-rolling the insert. The first
      // version generated the token in SQL with gen_random_bytes(), which needs the pgcrypto
      // extension — not installed here, so it failed against production. The application has always
      // minted this token in JS with randomUUID(); doing the same means these records are
      // indistinguishable from the ones the webhook writes, and ON CONFLICT (donor_id) keeps a
      // second run from replacing a token somebody may already have been sent a link for.
      const { id } = await ensureFulfilmentRecord(client, {
        donorId,
        band: entry.fulfilment.band,
        token: randomUUID(),
      });
      fulfilmentId = id;
    }

    // An append-only record that this was a hand-run import rather than money arriving normally.
    // Anyone auditing these donations later should be able to see why they are dated in the past.
    //
    // Via insertAudit rather than hand-written SQL: the column is `data`, not `detail`, and
    // entity_id is a number rather than a string. Writing it by hand got both wrong.
    await insertAudit(client, {
      actor: "script:import-unrecorded",
      action: "donor.historical_import",
      entity: "donor",
      entityId: donorId,
      data: {
        stripeCustomerId: entry.donor.stripeCustomerId,
        donationsCreated: donationIds.length,
        chargesAlreadyPresent: skippedCharges,
        reason: "Signed up before the donation system existed; reconciled from Stripe.",
      },
    });

    await client.query("COMMIT");
    return { donorId, donationIds, fulfilmentId, skippedCharges };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
