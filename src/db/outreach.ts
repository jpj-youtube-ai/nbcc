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
  /** What "my businesses" matches on. `owner` stays the label shown on screen. */
  ownerEmail: string | null;
  /** Which donor this business became. Linked by a volunteer, never guessed from a name. */
  donorId: number | null;
  /** Lower-cased, de-duplicated. What the list filters on. */
  tags: string[];
  /** When the single follow-up went. Once set, this business is never chased again. */
  nudgeSentAt: string | null;
  nudgeSentBy: string | null;
  /** Whether the volunteer wrote a line of their own. The message itself is not kept. */
  sentWithPersonalMessage: boolean | null;
  /** When a volunteer confirmed they had checked this number against the TPS register. */
  ctpsCheckedAt: string | null;
  ctpsCheckedBy: string | null;
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
                     ask_again_on, last_engagement_at, created_at, owner_email, warm_intro,
                     ctps_checked_at, ctps_checked_by, donor_id, sent_with_personal_message,
                     nudge_sent_at, nudge_sent_by, tags,
                     details_source,
                     consent_basis,
                     consent_basis_recorded_by, consent_basis_recorded_at`;

/**
 * A `date` column as YYYY-MM-DD (TASK-644). pg hands one back as a Date at local midnight, not as
 * text, and the to do rule reads it as text: a Date there broke the to do list and the business's
 * page for every business with an ask again date. Read with the local getters, as pg built it.
 */
function dateOnly(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}

function toRow(r: Record<string, unknown>): OutreachRow {
  return {
    id: r.id as number,
    businessName: r.business_name as string,
    contactName: (r.contact_name as string) ?? null,
    contactEmail: (r.contact_email as string) ?? null,
    contactPhone: (r.contact_phone as string) ?? null,
    businessType: r.business_type === "sole_trader" ? "sole_trader" : "company",
    note: (r.note as string) ?? null,
    ownerEmail: (r.owner_email as string) ?? null,
    donorId: (r.donor_id as number) ?? null,
    tags: (r.tags as string[]) ?? [],
    nudgeSentAt: (r.nudge_sent_at as string) ?? null,
    nudgeSentBy: (r.nudge_sent_by as string) ?? null,
    sentWithPersonalMessage:
      r.sent_with_personal_message === null || r.sent_with_personal_message === undefined
        ? null
        : Boolean(r.sent_with_personal_message),
    ctpsCheckedAt: (r.ctps_checked_at as string) ?? null,
    ctpsCheckedBy: (r.ctps_checked_by as string) ?? null,
    warmIntro: (r.warm_intro as string) ?? null,
    detailsSource: (r.details_source as string) ?? "website_or_listing",
    consentBasis: (r.consent_basis as string) ?? null,
    consentBasisRecordedBy: (r.consent_basis_recorded_by as string) ?? null,
    owner: (r.owner as string) ?? null,
    sentBy: (r.sent_by as string) ?? null,
    sentAt: (r.sent_at as string) ?? null,
    outcome: (r.outcome as string) ?? null,
    outcomeAt: (r.outcome_at as string) ?? null,
    askAgainOn: dateOnly(r.ask_again_on),
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
       JOIN donations d ON d.donor_id = dn.id AND d.payment_status = 'paid' AND NOT d.paid_in_by_organiser
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
  tags: string[];
  detailsSource: string;
  consentBasis: string | null;
  /** Who recorded the basis. Stamped only when there is a basis to attribute. */
  recordedBy: string | null;
  owner: string | null;
  ownerEmail: string | null;
}

export async function createOutreach(input: OutreachCreate): Promise<OutreachRow> {
  const res = await pool.query(
    `INSERT INTO business_outreach
       (business_name, contact_name, contact_email, contact_phone, business_type, note, owner,
        owner_email, warm_intro, tags, details_source, consent_basis, consent_basis_recorded_by,
        consent_basis_recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING ${ROW_COLUMNS}`,
    [
      input.businessName,
      input.contactName,
      input.contactEmail ? input.contactEmail.toLowerCase() : null,
      input.contactPhone,
      input.businessType,
      input.note,
      input.owner,
      input.ownerEmail,
      input.warmIntro,
      input.tags,
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

/**
 * Three columns of every business, for the counts on the screen (admin refresh, 2026-11-14). The
 * list is sent a page at a time, so counting what was sent went wrong past the first page; the
 * counting itself is the pure rule in src/outreach/list-counts.ts.
 */
export async function listOutreachForCounts(): Promise<
  { outcome: string | null; sentAt: string | null; ownerEmail: string | null }[]
> {
  const res = await pool.query(`SELECT outcome, sent_at, owner_email FROM business_outreach`);
  return res.rows.map((r) => ({
    outcome: (r.outcome as string) ?? null,
    sentAt: (r.sent_at as string) ?? null,
    ownerEmail: (r.owner_email as string) ?? null,
  }));
}

/** The newest note on each of these businesses, keyed by the business. One query for the page. */
export async function latestOutreachNotes(
  ids: number[],
): Promise<Map<number, { body: string; author: string; createdAt: string }>> {
  const latest = new Map<number, { body: string; author: string; createdAt: string }>();
  if (ids.length === 0) return latest;
  const res = await pool.query(
    `SELECT DISTINCT ON (outreach_id) outreach_id, author, body, created_at
       FROM business_outreach_notes
      WHERE outreach_id = ANY($1::int[])
      ORDER BY outreach_id, created_at DESC`,
    [ids],
  );
  for (const r of res.rows) {
    latest.set(Number(r.outreach_id), { body: r.body, author: r.author, createdAt: r.created_at });
  }
  return latest;
}

/** The donor a business became, by the name a volunteer would know it by. Null when it has gone. */
export async function getOutreachSupporter(donorId: number): Promise<{ id: number; name: string } | null> {
  const res = await pool.query(
    `SELECT id, COALESCE(NULLIF(business_name, ''), full_name) AS name FROM donors WHERE id = $1`,
    [donorId],
  );
  return res.rows[0] ? { id: Number(res.rows[0].id), name: String(res.rows[0].name ?? "") } : null;
}

/** What a volunteer may put right about a business once it is on the list. */
export interface OutreachDetails {
  businessName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  warmIntro: string | null;
  owner: string | null;
  ownerEmail: string | null;
  tags: string[];
}

/**
 * Change a business's details (admin refresh, 2026-11-14).
 *
 * `clearTpsCheck` is set when the phone number changed. The checked mark says "somebody checked
 * THIS number against the Telephone Preference Service register", so it cannot outlive the
 * number: it is cleared in the same statement, and the new number is hidden until it is checked.
 *
 * Deliberately not here: the kind of business, where the details came from and how a sole trader
 * agreed to hear from us. Who may be emailed turns on those, and they are not details to tidy.
 */
export async function updateOutreachDetails(
  id: number,
  d: OutreachDetails,
  clearTpsCheck: boolean,
): Promise<OutreachRow | null> {
  const res = await pool.query(
    `UPDATE business_outreach
        SET business_name = $2, contact_name = $3, contact_email = $4, contact_phone = $5,
            warm_intro = $6, owner = $7, owner_email = $8, tags = $9,
            ctps_checked_at = CASE WHEN $10::boolean THEN NULL ELSE ctps_checked_at END,
            ctps_checked_by = CASE WHEN $10::boolean THEN NULL ELSE ctps_checked_by END
      WHERE id = $1
      RETURNING ${ROW_COLUMNS}`,
    [
      id,
      d.businessName,
      d.contactName,
      d.contactEmail ? d.contactEmail.toLowerCase() : null,
      d.contactPhone,
      d.warmIntro,
      d.owner,
      d.ownerEmail,
      d.tags,
      clearTpsCheck,
    ],
  );
  return res.rows[0] ? toRow(res.rows[0]) : null;
}

/**
 * Record that somebody checked this number against the TPS register (TASK-412).
 *
 * Once only: a second confirmation would overwrite the name and date of the person who actually
 * did the checking, and that record is the whole point.
 */
export async function markCtpsChecked(id: number, by: string): Promise<void> {
  await pool.query(
    `UPDATE business_outreach
        SET ctps_checked_at = now(), ctps_checked_by = $2
      WHERE id = $1 AND ctps_checked_at IS NULL`,
    [id, by],
  );
}

/** Stamped only after the send succeeds, so a failed send leaves the draft sendable. */
export async function markOutreachSent(
  id: number,
  sentBy: string,
  withPersonalMessage: boolean,
): Promise<void> {
  await pool.query(
    `UPDATE business_outreach
        SET sent_at = now(), sent_by = $2, sent_with_personal_message = $3
      WHERE id = $1`,
    [id, sentBy, withPersonalMessage],
  );
}

/**
 * Stamp the follow-up. Guarded in SQL as well as in the rule: two volunteers pressing the button
 * within the same second would otherwise both pass the read-then-write check, and the second
 * business would get two "one last note" emails, which is the one thing that email promises not to
 * do. The UPDATE only matches while nudge_sent_at IS NULL, so exactly one of them wins.
 */
export async function markOutreachNudged(id: number, by: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE business_outreach
        SET nudge_sent_at = now(), nudge_sent_by = $2
      WHERE id = $1 AND nudge_sent_at IS NULL`,
    [id, by],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Link a business to the donor it became. Set when a volunteer records the sign-up. */
export async function linkOutreachDonor(id: number, donorId: number | null): Promise<void> {
  await pool.query(`UPDATE business_outreach SET donor_id = $2 WHERE id = $1`, [id, donorId]);
}

/**
 * Everything the reports read, in one query. The figures themselves are worked out in
 * src/outreach/reports.ts, where they can be argued with in a unit test.
 *
 * raised_pence sums the PAID donations of the donor a volunteer linked. A business marked signed
 * up but never linked contributes nothing rather than a guess.
 */
export async function listOutreachForReports(): Promise<
  { outcome: string | null; sentAt: string | null; owner: string | null; sentWithPersonalMessage: boolean | null; raisedPence: number }[]
> {
  const res = await pool.query(
    `SELECT b.outcome, b.sent_at, b.owner, b.sent_with_personal_message,
            COALESCE((
              SELECT SUM(d.amount_pence - d.refunded_amount_pence)
                FROM donations d
               WHERE d.donor_id = b.donor_id AND d.payment_status = 'paid' AND NOT d.paid_in_by_organiser
            ), 0) AS raised_pence
       FROM business_outreach b`,
  );
  return res.rows.map((r) => ({
    outcome: (r.outcome as string) ?? null,
    sentAt: (r.sent_at as string) ?? null,
    owner: (r.owner as string) ?? null,
    sentWithPersonalMessage:
      r.sent_with_personal_message === null ? null : Boolean(r.sent_with_personal_message),
    raisedPence: Number(r.raised_pence) || 0,
  }));
}

/**
 * Every business donor who has actually paid, for a volunteer to pick from when recording a
 * sign-up.
 *
 * Deliberately unranked and unfiltered: the ORDERING is the matcher's job, and the matcher is pure
 * TypeScript in src/outreach/matching.ts. Ranking here would mean a second, different notion of
 * "these look like the same firm" living in SQL, which is exactly the drift the pure module exists
 * to prevent.
 */
export async function listBusinessDonors(): Promise<
  { id: number; name: string; email: string | null; totalPence: number }[]
> {
  const res = await pool.query(
    `SELECT dn.id, COALESCE(NULLIF(dn.business_name, ''), dn.full_name) AS name, dn.email,
            COALESCE(SUM(d.amount_pence - d.refunded_amount_pence), 0) AS total_pence
       FROM donors dn
       JOIN donations d ON d.donor_id = dn.id AND d.payment_status = 'paid' AND NOT d.paid_in_by_organiser
      WHERE COALESCE(dn.business_name, '') <> ''
      GROUP BY dn.id, dn.business_name, dn.full_name, dn.email
      ORDER BY name ASC`,
  );
  return res.rows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    email: (r.email as string) ?? null,
    totalPence: Number(r.total_pence) || 0,
  }));
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

/**
 * Every business that could possibly need something. Deliberately NOT filtered here: what needs
 * doing is a rule, not a query, and putting it in SQL would mean two places to change it and one
 * of them untestable without a database.
 *
 * Declines and sign-ups are the exception, because those two are settled for good and there is no
 * point carrying them across the wire every time somebody opens the screen.
 */
export async function listOutreachForTodo(): Promise<OutreachRow[]> {
  const res = await pool.query(
    `SELECT ${ROW_COLUMNS} FROM business_outreach
      WHERE outcome IS NULL OR outcome NOT IN ('declined', 'signed_up')`,
  );
  return res.rows.map(toRow);
}

/** The volunteers a business can be assigned to: everyone who can sign in and is not disabled. */
export async function listVolunteers(): Promise<{ name: string; email: string }[]> {
  const res = await pool.query(
    // 'invited' counts: somebody who has been asked to join can be handed a business ready for
    // when they accept. 'disabled' does not.
    `SELECT full_name, email FROM users WHERE status <> 'disabled' ORDER BY full_name`,
  );
  return res.rows.map((r) => ({ name: r.full_name as string, email: r.email as string }));
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
