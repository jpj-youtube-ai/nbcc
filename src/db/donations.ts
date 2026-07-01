import type { PoolClient } from "pg";
import { pool } from "./pool";
import { buildDonationRow, type DonationInput, type DonorType } from "./donations-model";

// The unified donation model's write layer (REQ-036/REQ-037). Every state write and
// its matching audit_log row commit or roll back TOGETHER, inside one BEGIN…COMMIT
// (the truth model in CLAUDE.md). Pure field mapping / claim derivation lives in
// ./donations-model (unit-tested DB-free); this module owns only the transaction.

export interface AuditInput {
  actor: string; // who/what performed the action (e.g. "system", a webhook, an admin)
  action: string; // e.g. "donation.created"
  entity: string; // "donation" | "donor" | "declaration" | ...
  entityId: number | null; // the affected row's id
  data?: Record<string, unknown>; // arbitrary snapshot/context, stored as jsonb
}

// The atomic helper. `write` performs the state change (insert/update on
// donors/declarations/donations) using the supplied client; `toAudit` maps its
// result to the audit row. Both the write and the audit INSERT run in one
// transaction — ANY throw (from either) rolls back BOTH, so an audited change is
// never half-persisted and the audit trail never drifts from the data.
export async function writeWithAudit<T>(
  write: (client: PoolClient) => Promise<T>,
  toAudit: (result: T) => AuditInput,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await write(client);
    const audit = toAudit(result);
    await client.query(
      `INSERT INTO audit_log (actor, action, entity, entity_id, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [audit.actor, audit.action, audit.entity, audit.entityId, audit.data ?? {}],
    );
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// The donor identity fields (donor_type comes from the donation, one source of truth).
export interface DonorInput {
  fullName: string; // person name, or a company's contact name
  businessName?: string | null;
  companyNumber?: string | null;
  email?: string | null;
  emailConsent?: boolean;
  anonymous?: boolean;
}

export interface RecordDonationInput {
  donor: DonorInput;
  donation: DonationInput; // carries donorType, mode, amount, giftAid, stripe/declaration refs
}

// Concrete use of writeWithAudit: insert the donor and the donation row (mapped +
// claim-derived by buildDonationRow) and append the "donation.created" audit row,
// all atomically. Returns the new ids.
export async function recordDonation(
  input: RecordDonationInput,
): Promise<{ donorId: number; donationId: number }> {
  const donorType: DonorType = input.donation.donorType;
  return writeWithAudit(
    async (client) => {
      const d = input.donor;
      const donor = await client.query<{ id: number }>(
        `INSERT INTO donors
           (donor_type, full_name, business_name, company_number, email, email_consent, anonymous)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          donorType,
          d.fullName,
          d.businessName ?? null,
          d.companyNumber ?? null,
          d.email ?? null,
          d.emailConsent ?? false,
          d.anonymous ?? false,
        ],
      );
      const donorId = donor.rows[0].id;

      const row = buildDonationRow(input.donation, donorId);
      const donation = await client.query<{ id: number }>(
        `INSERT INTO donations
           (donor_id, declaration_id, mode, plan, amount_pence, currency, gift_aid,
            payment_channel, claim_status, stripe_session_id, stripe_payment_intent_id,
            stripe_subscription_id, stripe_charge_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [
          row.donor_id,
          row.declaration_id,
          row.mode,
          row.plan,
          row.amount_pence,
          row.currency,
          row.gift_aid,
          row.payment_channel,
          row.claim_status,
          row.stripe_session_id,
          row.stripe_payment_intent_id,
          row.stripe_subscription_id,
          row.stripe_charge_id,
        ],
      );
      return { donorId, donationId: donation.rows[0].id };
    },
    (r) => ({
      actor: "system",
      action: "donation.created",
      entity: "donation",
      entityId: r.donationId,
      data: { donorId: r.donorId, donorType },
    }),
  );
}
