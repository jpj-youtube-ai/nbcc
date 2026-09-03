import { pool } from "./pool";
import type { Known } from "../outreach/matching";
import type { Outcome } from "../outreach/model";
import { isEngagement } from "../outreach/outcomes";

// TASK-354: storage for business outreach. The matching itself is pure and lives in
// src/outreach/matching.ts; this only fetches what it compares against and records what happened.

export interface OutreachRow {
  id: number;
  businessName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  businessType: "company" | "sole_trader";
  note: string | null;
  /** Who we know that knows them. The field most likely to walk out in somebody's head. */
  warmIntro: string | null;
  /** Where the volunteer got the details. The email says this back to the business. */
  detailsSource: string;
  /** Why we may email an individual subscriber. Null for a company, which needs none. */
  consentBasis: string | null;
  consentBasisRecordedBy: string | null;
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
                     ask_again_on, last_engagement_at, created_at, warm_intro, details_source,
                     consent_basis,
                     consent_basis_recorded_by, consent_basis_recorded_at`;

function toRow(r: Record<string, unknown>): OutreachRow {
  return {
    id: r.id as number,
    businessName: r.business_name as string,
    contactName: (r.contact_name as string) ?? null,
    contactEmail: (r.contact_email as string) ?? null,
    contactPhone: (r.contact_phone as string) ?? null,
    businessType: r.business_type === "sole_trader" ? "sole_trader" : "company",
    note: (r.note as string) ?? null,
    warmIntro: (r.warm_intro as string) ?? null,
    detailsSource: (r.details_source as string) ?? "website_or_listing",
    consentBasis: (r.consent_basis as string) ?? null,
    consentBasisRecordedBy: (r.consent_basis_recorded_by as string) ?? null,
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

  // business_name and email live on DONORS, not on donations - a donation carries the money and
  // the donor carries who gave it. Joining to a paid donation is the point of the query rather
  // than a nicety: a company that started a checkout and never finished it has not given us
  // anything, and warning a volunteer off it would cost us the very approach worth making.
  const donors = await pool.query(
    `SELECT MIN(dn.id) AS id,
            dn.business_name,
            MIN(dn.email) AS email,
            MIN(d.created_at) AS since
       FROM donors dn
       JOIN donations d ON d.donor_id = dn.id AND d.payment_status = 'paid'
      WHERE COALESCE(dn.business_name, '') <> ''
      GROUP BY dn.business_name`,
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
  warmIntro: string | null;
  detailsSource: string;
  consentBasis: string | null;
  /** Who recorded the basis. Stamped only when there is a basis to attribute. */
  recordedBy: string | null;
  owner: string | null;
}

export async function createOutreach(input: OutreachCreate): Promise<OutreachRow> {
  const res = await pool.query(
    `INSERT INTO business_outreach
       (business_name, contact_name, contact_email, contact_phone, business_type, note, owner,
        warm_intro, details_source, consent_basis, consent_basis_recorded_by,
        consent_basis_recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${ROW_COLUMNS}`,
    [
      input.businessName,
      input.contactName,
      input.contactEmail ? input.contactEmail.toLowerCase() : null,
      input.contactPhone,
      input.businessType,
      input.note,
      input.owner,
      input.warmIntro,
      input.detailsSource,
      input.consentBasis,
      // Stamped together, or not at all: a basis with nobody's name against it cannot be asked
      // about later, and a name with no basis says nothing.
      input.consentBasis ? input.recordedBy : null,
      input.consentBasis ? new Date() : null,
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
 * Whether this counts as the business engaging comes from src/outreach/outcomes.ts, so the rule
 * that drives the call list, the retention purge and the screen is written once.
 */
export async function setOutreachOutcome(
  id: number,
  outcome: Outcome,
  askAgainOn: string | null,
): Promise<void> {
  const engaged = isEngagement(outcome);
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
