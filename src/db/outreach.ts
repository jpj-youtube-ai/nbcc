import { pool } from "./pool";
import type { Known } from "../outreach/matching";
import type { Outcome } from "../outreach/model";

// TASK-352: storage for business outreach. The matching itself is pure and lives in
// src/outreach/matching.ts; this only fetches what it compares against and records what happened.

export interface OutreachRow {
  id: number;
  businessName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  businessType: "company" | "sole_trader";
  note: string | null;
  owner: string | null;
  sentBy: string | null;
  sentAt: string | null;
  outcome: string | null;
  outcomeAt: string | null;
  askAgainOn: string | null;
  lastEngagementAt: string | null;
  createdAt: string;
}

const ROW_COLUMNS = `id, business_name, contact_name, contact_email, contact_phone,
                     business_type, note, owner, sent_by, sent_at, outcome, outcome_at,
                     ask_again_on, last_engagement_at, created_at`;

function toRow(r: Record<string, unknown>): OutreachRow {
  return {
    id: r.id as number,
    businessName: r.business_name as string,
    contactName: (r.contact_name as string) ?? null,
    contactEmail: (r.contact_email as string) ?? null,
    contactPhone: (r.contact_phone as string) ?? null,
    businessType: r.business_type === "sole_trader" ? "sole_trader" : "company",
    note: (r.note as string) ?? null,
    owner: (r.owner as string) ?? null,
    sentBy: (r.sent_by as string) ?? null,
    sentAt: (r.sent_at as string) ?? null,
    outcome: (r.outcome as string) ?? null,
    outcomeAt: (r.outcome_at as string) ?? null,
    askAgainOn: (r.ask_again_on as string) ?? null,
    lastEngagementAt: (r.last_engagement_at as string) ?? null,
    createdAt: r.created_at as string,
  };
}

/**
 * Everything the matcher compares a new business against, in one query set.
 *
 * Three sources, because a volunteer needs to be warned about three different mistakes: emailing
 * the same firm twice, cold-pitching a business that already gives us money, and contacting one
 * that has already said no.
 *
 * The donor half is what makes attribution work without tracking links: a business that signs up
 * appears here, so "have they started giving?" is the same question as "is this a duplicate?".
 */
export async function listKnownBusinesses(): Promise<Known[]> {
  const outreach = await pool.query(
    `SELECT id, business_name, contact_email, outcome, sent_at, sent_by
       FROM business_outreach`,
  );

  const donors = await pool.query(
    `SELECT MIN(id) AS id, business_name, MIN(email) AS email, MIN(created_at) AS since
       FROM donations
      WHERE COALESCE(business_name, '') <> ''
      GROUP BY business_name`,
  );

  const known: Known[] = [];

  for (const r of outreach.rows) {
    const declined = r.outcome === "declined";
    const when = r.sent_at ? new Date(r.sent_at).toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : null;
    known.push({
      id: r.id,
      businessName: r.business_name,
      contactEmail: r.contact_email,
      source: declined ? "declined" : "outreach",
      detail: declined
        ? "told us no"
        : when
          ? `contacted ${when}${r.sent_by ? ` by ${r.sent_by}` : ""}`
          : "added but not yet contacted",
    });
  }

  for (const r of donors.rows) {
    // Negative ids keep donor matches from colliding with outreach ids in the UI, which addresses
    // them by id when a volunteer says "yes, that is the same business".
    known.push({
      id: -Number(r.id),
      businessName: r.business_name,
      contactEmail: r.email,
      source: "donor",
      detail: r.since
        ? `giving since ${new Date(r.since).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`
        : "already a donor",
    });
  }

  return known;
}

export interface OutreachCreate {
  businessName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  businessType: "company" | "sole_trader";
  note: string | null;
  owner: string | null;
}

export async function createOutreach(input: OutreachCreate): Promise<OutreachRow> {
  const res = await pool.query(
    `INSERT INTO business_outreach
       (business_name, contact_name, contact_email, contact_phone, business_type, note, owner)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${ROW_COLUMNS}`,
    [
      input.businessName,
      input.contactName,
      input.contactEmail ? input.contactEmail.toLowerCase() : null,
      input.contactPhone,
      input.businessType,
      input.note,
      input.owner,
    ],
  );
  return toRow(res.rows[0]);
}

export async function getOutreach(id: number): Promise<OutreachRow | null> {
  const res = await pool.query(`SELECT ${ROW_COLUMNS} FROM business_outreach WHERE id = $1`, [id]);
  return res.rows[0] ? toRow(res.rows[0]) : null;
}

/** Newest first. The landing view uses counts; this backs the search behind it. */
export async function listOutreach(limit = 200, offset = 0): Promise<OutreachRow[]> {
  const res = await pool.query(
    `SELECT ${ROW_COLUMNS} FROM business_outreach ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [Math.min(Math.max(limit, 1), 500), Math.max(offset, 0)],
  );
  return res.rows.map(toRow);
}

/** Stamped only after the send succeeds, so a failed send leaves the draft sendable. */
export async function markOutreachSent(id: number, sentBy: string): Promise<void> {
  await pool.query(
    `UPDATE business_outreach SET sent_at = now(), sent_by = $2 WHERE id = $1`,
    [id, sentBy],
  );
}

// Re-exported from the pure module so callers here have them without a second declaration.
export { OUTCOMES, type Outcome } from "../outreach/model";

/**
 * Anything that is not "no reply" counts as the business engaging, which is what drives the call
 * list and holds off the three-year retention purge. "No reply" deliberately does not: recording
 * silence is not contact, and treating it as engagement would keep a dead record alive forever.
 */
export async function setOutreachOutcome(
  id: number,
  outcome: Outcome,
  askAgainOn: string | null,
): Promise<void> {
  const engaged = outcome !== "no_reply";
  await pool.query(
    `UPDATE business_outreach
        SET outcome = $2,
            outcome_at = now(),
            ask_again_on = $3,
            last_engagement_at = CASE WHEN $4 THEN now() ELSE last_engagement_at END
      WHERE id = $1`,
    [id, outcome, askAgainOn, engaged],
  );
}

export interface OutreachNote {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

/** Append-only. There is no update path, by intention. */
export async function addOutreachNote(
  outreachId: number,
  author: string,
  body: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO business_outreach_notes (outreach_id, author, body) VALUES ($1, $2, $3)`,
    [outreachId, author, body],
  );
  // Writing a note is a volunteer doing something about this business, so it counts as activity
  // for retention even when the business itself has gone quiet.
  await pool.query(
    `UPDATE business_outreach SET last_engagement_at = now() WHERE id = $1`,
    [outreachId],
  );
}

export async function listOutreachNotes(outreachId: number): Promise<OutreachNote[]> {
  const res = await pool.query(
    `SELECT id, author, body, created_at FROM business_outreach_notes
      WHERE outreach_id = $1 ORDER BY created_at DESC`,
    [outreachId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    author: r.author,
    body: r.body,
    createdAt: r.created_at,
  }));
}
