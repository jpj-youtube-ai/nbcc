// TASK-161 (REQ-069): transactional write + read layer for thank_you_sent.
// Follows the repo pattern: writes take a PoolClient and run inside writeWithAudit
// so the row and its audit entry commit/rollback together; reads use the pool
// directly. Pure logic lives in src/thank-you/model.ts (unit-tested); this layer
// is exercised via BDD against a real DB (CLAUDE.md rule 5).
import type { PoolClient } from "pg";
import { pool } from "./pool";
import { writeWithAudit } from "./donations";
import {
  giftSummary,
  deriveSendState,
  recipientName,
  type ThankYouInput,
  type SendState,
} from "../thank-you/model";

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
  signed_by_role: string | null;
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
  signedByRole: string | null;
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
    signedByRole: r.signed_by_role,
    sentBy: r.sent_by,
    sentAt: r.sent_at,
  };
}

// Insert one sent-letter row, returning its id. Joins the caller's transaction.
export async function insertThankYouSent(client: PoolClient, input: ThankYouInput): Promise<number> {
  const res = await client.query<{ id: number }>(
    `INSERT INTO thank_you_sent
       (donor_id, thank_you_name, addressed_to, recipient_email, gift_type,
        gift_amount_pence, gift_in_kind, gift_aided, personal_message, signed_by_name, signed_by_role, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
      input.signedByRole ?? null,
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
            gift_amount_pence, gift_in_kind, gift_aided, personal_message, signed_by_name,
            signed_by_role, sent_by, sent_at
       FROM thank_you_sent
      ORDER BY id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  const totalRes = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM thank_you_sent`);
  return { results: res.rows.map(mapRow), total: Number(totalRes.rows[0].count) };
}

// One sent letter by id, for re-rendering the public printable-letter page (TASK-165). Returns null
// when there is no such row.
export async function getThankYouSentById(id: number): Promise<ThankYouSent | null> {
  const res = await pool.query<ThankYouSentDbRow>(
    `SELECT id, donor_id, thank_you_name, addressed_to, recipient_email, gift_type,
            gift_amount_pence, gift_in_kind, gift_aided, personal_message, signed_by_name,
            signed_by_role, sent_by, sent_at
       FROM thank_you_sent
      WHERE id = $1`,
    [id],
  );
  return res.rows.length ? mapRow(res.rows[0]) : null;
}

// ---- TASK-162: eligible-donors list for the "Donors to thank" view ----

export interface ThankYouEligibleDonor {
  donorId: number;
  name: string; // full_name, or a company's business_name
  email: string | null;
  maxGiftPence: number; // the donor's largest single PAID gift
  giftAided: boolean; // has any Gift-Aided paid gift
  anonymous: boolean;
  alreadyThanked: boolean;
  lastThankedAt: string | null;
  sendState: SendState; // ready | no_email | opted_out
}

interface EligibleDonorDbRow {
  donor_id: number;
  full_name: string;
  business_name: string | null;
  donor_type: string;
  email: string | null;
  email_consent: boolean;
  anonymous: boolean;
  max_amount: string | number; // MAX() can come back as a string from pg
  gift_aided: boolean;
  last_thanked_at: Date | null;
}

// Donors whose largest single PAID gift is >= thresholdPence, most generous first.
// Each row carries whether they can be emailed (sendState) and whether they've been
// thanked (with the last date), so the UI can show state without extra calls.
export async function listThankYouEligible(thresholdPence: number): Promise<ThankYouEligibleDonor[]> {
  const res = await pool.query<EligibleDonorDbRow>(
    `SELECT dn.id AS donor_id, dn.full_name, dn.business_name, dn.donor_type,
            dn.email, dn.email_consent, dn.anonymous,
            MAX(d.amount_pence) AS max_amount,
            BOOL_OR(d.gift_aid) AS gift_aided,
            (SELECT MAX(sent_at) FROM thank_you_sent ty WHERE ty.donor_id = dn.id) AS last_thanked_at
       FROM donors dn
       JOIN donations d ON d.donor_id = dn.id AND d.payment_status = 'paid'
      GROUP BY dn.id, dn.full_name, dn.business_name, dn.donor_type, dn.email, dn.email_consent, dn.anonymous
     HAVING MAX(d.amount_pence) >= $1
      ORDER BY MAX(d.amount_pence) DESC, dn.id ASC`,
    [thresholdPence],
  );
  return res.rows.map((r) => ({
    donorId: r.donor_id,
    name: recipientName({ donorType: r.donor_type, fullName: r.full_name, businessName: r.business_name }),
    email: r.email,
    maxGiftPence: Number(r.max_amount),
    giftAided: r.gift_aided,
    anonymous: r.anonymous,
    alreadyThanked: r.last_thanked_at !== null,
    lastThankedAt: r.last_thanked_at ? r.last_thanked_at.toISOString() : null,
    sendState: deriveSendState({ email: r.email, emailConsent: r.email_consent }),
  }));
}
