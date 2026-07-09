// TASK-161 (REQ-069): transactional write + read layer for thank_you_sent.
// Follows the repo pattern: writes take a PoolClient and run inside writeWithAudit
// so the row and its audit entry commit/rollback together; reads use the pool
// directly. Pure logic lives in src/thank-you/model.ts (unit-tested); this layer
// is exercised via BDD against a real DB (CLAUDE.md rule 5).
import type { PoolClient } from "pg";
import { pool } from "./pool";
import { writeWithAudit } from "./donations";
import { giftSummary, type ThankYouInput } from "../thank-you/model";

interface ThankYouSentDbRow {
  id: number;
  donor_id: number | null;
  thank_you_name: string;
  addressed_to: string;
  recipient_email: string;
  gift_type: string;
  gift_amount_pence: number | null;
  gift_in_kind: string | null;
  gift_aided: boolean;
  personal_message: string | null;
  signed_by_name: string;
  sent_by: string;
  sent_at: string;
}

export interface ThankYouSent {
  id: number;
  donorId: number | null;
  thankYouName: string;
  addressedTo: string;
  recipientEmail: string;
  giftType: "money" | "in_kind";
  giftAmountPence: number | null;
  giftInKind: string | null;
  giftAided: boolean;
  personalMessage: string | null;
  signedByName: string;
  sentBy: string;
  sentAt: string;
}

function mapRow(r: ThankYouSentDbRow): ThankYouSent {
  return {
    id: r.id,
    donorId: r.donor_id,
    thankYouName: r.thank_you_name,
    addressedTo: r.addressed_to,
    recipientEmail: r.recipient_email,
    giftType: r.gift_type as "money" | "in_kind",
    giftAmountPence: r.gift_amount_pence,
    giftInKind: r.gift_in_kind,
    giftAided: r.gift_aided,
    personalMessage: r.personal_message,
    signedByName: r.signed_by_name,
    sentBy: r.sent_by,
    sentAt: r.sent_at,
  };
}

// Insert one sent-letter row, returning its id. Joins the caller's transaction.
export async function insertThankYouSent(client: PoolClient, input: ThankYouInput): Promise<number> {
  const res = await client.query<{ id: number }>(
    `INSERT INTO thank_you_sent
       (donor_id, thank_you_name, addressed_to, recipient_email, gift_type,
        gift_amount_pence, gift_in_kind, gift_aided, personal_message, signed_by_name, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      input.donorId,
      input.thankYouName,
      input.addressedTo,
      input.recipientEmail,
      input.giftType,
      input.giftAmountPence,
      input.giftInKind,
      input.giftAided,
      input.personalMessage,
      input.signedByName,
      input.sentBy,
    ],
  );
  return res.rows[0].id;
}

// Record a sent letter and its audit-trail entry atomically.
export async function recordThankYouSent(input: ThankYouInput): Promise<number> {
  return writeWithAudit(
    (client) => insertThankYouSent(client, input),
    (id) => ({
      actor: `admin:${input.sentBy}`,
      action: "thank_you.sent",
      entity: "donor",
      entityId: input.donorId,
      data: { thankYouSentId: id, giftSummary: giftSummary(input), signedBy: input.signedByName },
    }),
  );
}

// Dedupe for the eligible-donors list: has this donor already been thanked?
export async function hasBeenThanked(donorId: number): Promise<boolean> {
  const res = await pool.query<{ thanked: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM thank_you_sent WHERE donor_id = $1) AS thanked`,
    [donorId],
  );
  return res.rows[0].thanked;
}

// Sent history, most recent first (paginated). limit/offset must be pre-clamped ints.
export async function listThankYouSent(
  limit: number,
  offset: number,
): Promise<{ results: ThankYouSent[]; total: number }> {
  const res = await pool.query<ThankYouSentDbRow>(
    `SELECT id, donor_id, thank_you_name, addressed_to, recipient_email, gift_type,
            gift_amount_pence, gift_in_kind, gift_aided, personal_message, signed_by_name, sent_by, sent_at
       FROM thank_you_sent
      ORDER BY id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  const totalRes = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM thank_you_sent`);
  return { results: res.rows.map(mapRow), total: Number(totalRes.rows[0].count) };
}
