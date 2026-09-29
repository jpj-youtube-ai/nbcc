import { randomUUID } from "node:crypto";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import type { CatchupDonor } from "../outreach/catchup-plan";

// TASK-438: the reads and the one write behind the catch-up for the three individuals TASK-430
// imported. Deliberately small - the sending itself reuses the paths that already exist
// (recordThankYouSent, sendDeclarationConfirmation), because those are the tested ones.

/** The three donors, their paid donations, and whether they have ever been thanked. */
export async function listCatchupDonors(emails: string[]): Promise<CatchupDonor[]> {
  if (emails.length === 0) return [];
  const res = await pool.query<{
    donor_id: number;
    full_name: string;
    email: string | null;
    already_thanked: boolean;
    donation_id: number;
    amount_pence: number;
    paid_at: Date;
    declaration_status: string;
  }>(
    `SELECT dn.id AS donor_id, dn.full_name, dn.email,
            EXISTS(SELECT 1 FROM thank_you_sent ty WHERE ty.donor_id = dn.id) AS already_thanked,
            d.id AS donation_id, d.amount_pence, d.created_at AS paid_at, d.declaration_status
       FROM donors dn
       JOIN donations d ON d.donor_id = dn.id AND d.payment_status = 'paid'
      WHERE lower(trim(dn.email)) = ANY($1::text[])
      ORDER BY dn.id ASC, d.created_at ASC`,
    [emails.map((e) => e.trim().toLowerCase())],
  );

  const byDonor = new Map<number, CatchupDonor>();
  for (const r of res.rows) {
    let donor = byDonor.get(r.donor_id);
    if (!donor) {
      donor = {
        donorId: r.donor_id,
        fullName: r.full_name,
        email: r.email,
        alreadyThanked: r.already_thanked,
        donations: [],
      };
      byDonor.set(r.donor_id, donor);
    }
    donor.donations.push({
      id: r.donation_id,
      amountPence: r.amount_pence,
      paidAt: new Date(r.paid_at),
      declarationStatus: r.declaration_status,
    });
  }
  return [...byDonor.values()];
}

/**
 * Put a donation into the declaration flow so a Gift Aid link can be sent for it: a unique token
 * plus declaration_status='pending'.
 *
 * 'pending', not 'sent', and that matters. The legal lifecycle is
 * not_required -> pending -> sent -> completed, and ONLY a donation at 'sent' (or 'undelivered')
 * can be confirmed by the donor. sendDeclarationConfirmation stamps 'sent' after the email
 * actually leaves, or 'undelivered' when it does not - so a link that never arrived cannot be
 * mistaken for one that did. Minting the token and jumping straight to 'sent' would claim a
 * delivery that had not happened yet.
 *
 * Returns null when the donation has already left not_required: it has a live link of its own, and
 * a second would be two routes to the same declaration.
 */
export async function mintDeclarationInvite(
  donationId: number,
  actor: string,
): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const token = randomUUID();
    const res = await client.query<{ id: number }>(
      `UPDATE donations
          SET declaration_status = 'pending', declaration_token = $1
        WHERE id = $2 AND declaration_status = 'not_required'
        RETURNING id`,
      [token, donationId],
    );
    if (res.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    await insertAudit(client, {
      actor,
      action: "declaration.invited",
      entity: "donation",
      entityId: donationId,
      data: { reason: "Catch-up Gift Aid request for a supporter imported from Stripe (TASK-438)." },
    });
    await client.query("COMMIT");
    return token;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
