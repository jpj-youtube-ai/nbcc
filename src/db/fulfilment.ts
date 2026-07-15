import type { PoolClient } from "pg";
import { pool } from "./pool";
import { writeWithAudit } from "./donations";
import type { SupporterBand } from "../donors/fulfilment";

// The DB-access layer for the business_supporter_fulfilment table (TASK-205 migration 1783961442118
// + the token column, TASK-206 migration 1783964039569). Small, typed accessors over the pool: the
// band/eligibility DECISION is the pure fulfilmentBandFor in src/donors/fulfilment.ts, and the
// transactional call site is handleCheckoutCompleted in ./stripe-webhook.ts. Mirrors the
// insert-with-the-caller's-client + read-only-pool.query split used across ./donations.ts.

// One fulfilment row as stored (snake_case columns). One row per donor; band is the recognition band
// the supporter's monthly gift earned; token is the unguessable secure-thank-you-link token (nullable
// until set on insert). The captured-preferences + admin-flag columns are filled by later tasks.
export interface FulfilmentRow {
  id: number;
  donor_id: number;
  band: SupporterBand;
  token: string | null;
  credit_name: string | null;
  website: string | null;
  socials: string | null;
  list_on_supporters: boolean;
  want_social: boolean;
  want_badge: boolean;
  want_certificate: boolean;
  certificate_delivery: string | null;
  certificate_address: string | null;
  consent_featured: boolean;
  captured_at: Date | null;
  certificate_sent: boolean;
  certificate_posted: boolean;
  badge_sent: boolean;
  social_done: boolean;
  added_to_supporters: boolean;
  reminder_5_at: Date | null;
  reminder_14_at: Date | null;
  // How many of the two thank-you reminders have been sent (TASK-222): 0 = none, 1 = the 5-day
  // reminder sent, 2 = the 14-day reminder sent. NOT NULL DEFAULT 0, so every row carries a number.
  reminder_count: number;
  // When the thank-you INVITE was sent (TASK-214). NULL until an invite has gone out — stamped by the
  // going-forward webhook auto-invite and by the admin catch-up backfill, both after a successful send.
  invited_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Ensure exactly one fulfilment record exists for a business supporter (idempotent). INSERTs the
// (donor_id, band, token) row — every other column carries a DB default — and ON CONFLICT (donor_id)
// DO NOTHING, so a record that ALREADY exists is left untouched (a redelivered/reprocessed gift never
// overwrites captured preferences or admin fulfilment flags). Returns the row id AND whether it was
// actually CREATED on this call (`created: true` when the INSERT wrote a row; `false` when it hit the
// conflict and the id was re-read). The webhook uses `created` to audit `fulfilment.created` and send
// the thank-you invite ONCE, only on the newly created record, using the token it just wrote. Takes
// the caller's client so it JOINS their transaction (the webhook processor's BEGIN…COMMIT) — the
// record and its audit row then commit or roll back together.
export async function ensureFulfilmentRecord(
  client: PoolClient,
  input: { donorId: number; band: SupporterBand; token: string },
): Promise<{ id: number; created: boolean }> {
  const inserted = await client.query<{ id: number }>(
    `INSERT INTO business_supporter_fulfilment (donor_id, band, token)
     VALUES ($1, $2, $3)
     ON CONFLICT (donor_id) DO NOTHING
     RETURNING id`,
    [input.donorId, input.band, input.token],
  );
  if (inserted.rows[0]) return { id: inserted.rows[0].id, created: true };
  // Conflict: a fulfilment record already exists for this donor — read back its id (idempotent no-op).
  const existing = await client.query<{ id: number }>(
    `SELECT id FROM business_supporter_fulfilment WHERE donor_id = $1`,
    [input.donorId],
  );
  return { id: existing.rows[0].id, created: false };
}

// Read the fulfilment record addressed by a secure-thank-you-link token, or null when the token
// matches none. Read-only (pool.query, no transaction/audit — mirrors getGiftAidDeclarationContext);
// the later secure thank-you page / admin loads the business's record from their link with this.
export async function getFulfilmentByToken(token: string): Promise<FulfilmentRow | null> {
  const res = await pool.query<FulfilmentRow>(
    `SELECT * FROM business_supporter_fulfilment WHERE token = $1`,
    [token],
  );
  return res.rows[0] ?? null;
}

// --- Invite tracking + backfill (TASK-214) ------------------------------------------------------
// invited_at (migration 1783980218955) records that a fulfilment record's thank-you INVITE has been
// sent, so the one-time admin catch-up backfill never double-emails anyone. markFulfilmentInvited
// stamps it after a successful send; listUninvitedBusinessSupporters finds the records that still
// need one. Both use pool.query (no transaction — a plain stamp / a plain read, mirroring the
// declaration_status stamp and listBusinessFulfilments).

// Stamp invited_at = now() on a fulfilment record, IDEMPOTENTLY: the `AND invited_at IS NULL` guard
// means a record whose invite already went out matches zero rows and is left untouched (a no-op), so
// re-running the backfill or a webhook redelivery never overwrites the original invite timestamp.
// Called best-effort (its callers swallow failures), only AFTER a send succeeds — so a failed send
// leaves invited_at NULL and the backfill can catch it on a later run. Returns whether it newly
// stamped a row (rowCount === 1), which callers may ignore.
export async function markFulfilmentInvited(id: number): Promise<boolean> {
  const res = await pool.query(
    `UPDATE business_supporter_fulfilment
        SET invited_at = now()
      WHERE id = $1 AND invited_at IS NULL`,
    [id],
  );
  return (res.rowCount ?? 0) > 0;
}

// A defensive ceiling on the backfill list (the business-supporter population is small; this caps an
// over-broad read, mirroring the LIMIT on listBusinessFulfilments below).
const UNINVITED_SUPPORTER_LIST_LIMIT = 500;

// One un-invited business supporter the backfill must email: the fulfilment record id + its secure
// thank-you-link token + recognition band, plus the recipient email and the greeting name (the
// business_name, falling back to the donor's full_name — the same fallback the /business/thank-you
// page and the webhook invite use).
export interface UninvitedBusinessSupporter {
  fulfilmentId: number;
  token: string;
  band: SupporterBand;
  email: string;
  name: string;
}

// List every business supporter who still needs a thank-you invite, oldest record first (so the
// longest-waiting supporters are emailed first). The gate is exactly:
//   invited_at IS NULL      — no invite has been sent yet (the going-forward webhook stamps this),
//   captured_at IS NULL     — they have not already completed the thank-you page (if captured, they
//                             plainly already had the link, so there is nothing to catch up),
//   a non-empty donor email — there is somewhere to send it,
//   token IS NOT NULL       — there is a usable link to send (a token-less row would build a broken
//                             link; every webhook-created record has a token, so this is defensive).
// Read-only (pool.query, bounded by the same defensive LIMIT as listBusinessFulfilments). The
// greeting name is resolved in JS (business_name, trimmed, falling back to full_name) to match the
// webhook / thank-you-page fallback exactly.
export async function listUninvitedBusinessSupporters(): Promise<UninvitedBusinessSupporter[]> {
  const res = await pool.query<{
    id: number;
    token: string;
    band: SupporterBand;
    email: string;
    business_name: string | null;
    full_name: string;
  }>(
    `SELECT f.id, f.token, f.band, dn.email, dn.business_name, dn.full_name
       FROM business_supporter_fulfilment f
       JOIN donors dn ON dn.id = f.donor_id
      WHERE f.invited_at IS NULL
        AND f.captured_at IS NULL
        AND f.token IS NOT NULL
        AND dn.email IS NOT NULL
        AND dn.email <> ''
      ORDER BY f.id ASC
      LIMIT ${UNINVITED_SUPPORTER_LIST_LIMIT}`,
  );
  return res.rows.map((r) => ({
    fulfilmentId: r.id,
    token: r.token,
    band: r.band,
    email: r.email,
    name: (r.business_name ?? "").trim() || r.full_name,
  }));
}

// --- Certificate delivery (TASK-211) ------------------------------------------------------------
// Everything the per-business Platinum certificate page (GET /business/certificate/:token) needs, in
// ONE read addressed by the secure-thank-you-link token: the recognition band + the certificate
// opt-in (the two gates — only a PLATINUM supporter who asked for the certificate may render one), the
// donor's business_name (the hero, falling back to full_name) and the "Supporting since" date derived
// from that donor's EARLIEST donation. Read-only (pool.query — mirrors getFulfilmentByToken).
export interface CertificateContext {
  band: SupporterBand;
  wantCertificate: boolean;
  businessName: string | null;
  fullName: string;
  // Earliest donation timestamp for this donor; NULL only in the degenerate case of a fulfilment row
  // with no donations (the route falls back to "now" so the page still renders).
  supportingSince: Date | null;
}

export async function getCertificateContextByToken(token: string): Promise<CertificateContext | null> {
  const res = await pool.query<{
    band: SupporterBand;
    want_certificate: boolean;
    business_name: string | null;
    full_name: string;
    supporting_since: Date | null;
  }>(
    `SELECT f.band,
            f.want_certificate,
            dn.business_name,
            dn.full_name,
            (SELECT MIN(d.created_at) FROM donations d WHERE d.donor_id = f.donor_id) AS supporting_since
       FROM business_supporter_fulfilment f
       JOIN donors dn ON dn.id = f.donor_id
      WHERE f.token = $1`,
    [token],
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    band: r.band,
    wantCertificate: r.want_certificate,
    businessName: r.business_name,
    fullName: r.full_name,
    supportingSince: r.supporting_since,
  };
}

// --- Admin fulfilment API (TASK-207) ------------------------------------------------------------
// The read (list every business supporter + their fulfilment state) and the audited write (mark one
// fulfilment status flag done) behind the Editor+ admin endpoints in src/routes/admin.ts. The list is
// a plain read (mirrors listAdjustmentDueDonations in src/db/admin.ts); the mark is one audited
// transaction (mirrors the writers in src/db/donations.ts). WHO marked WHAT and WHEN is recorded in
// the append-only audit_log, not on the fulfilment row (which carries booleans only, per TASK-205).

// The FIVE — and only five — admin fulfilment status flags. This fixed allowlist is the security
// boundary for markFulfilmentFlag: only a member of this set can ever be written, so a caller can
// never smuggle an arbitrary column name into the UPDATE (no arbitrary-column write). Pure data, so
// isFulfilmentFlag is unit-testable DB-free.
export const FULFILMENT_FLAGS = [
  "certificate_sent",
  "certificate_posted",
  "badge_sent",
  "social_done",
  "added_to_supporters",
] as const;

export type FulfilmentFlag = (typeof FULFILMENT_FLAGS)[number];

// Type-guard narrowing an arbitrary value to one of the five allowed flags. Pure (no pool/config) —
// the allowlist gate both the route (400 on an unknown flag) and markFulfilmentFlag (defence in
// depth) consult, so an out-of-set flag is rejected before any SQL is built.
export function isFulfilmentFlag(value: unknown): value is FulfilmentFlag {
  return typeof value === "string" && (FULFILMENT_FLAGS as readonly string[]).includes(value);
}

// Why a mark cannot proceed: the flag is not one of the five (invalid_flag — a rejected
// arbitrary-column attempt), or no fulfilment row has that id (not_found). A typed error like
// BatchAssignmentError so the route can map it (400 / 404) rather than a bare 500.
export class FulfilmentFlagError extends Error {
  constructor(
    public readonly reason: "invalid_flag" | "not_found",
    public readonly detail?: string,
  ) {
    super(`fulfilment flag update failed: ${reason}${detail ? ` (${detail})` : ""}`);
    this.name = "FulfilmentFlagError";
  }
}

// A bounded cap so the admin list can never return an unbounded set (the business-supporter
// population is small; this is a defensive ceiling, mirroring the LIMITs on the admin search reads).
const BUSINESS_FULFILMENT_LIST_LIMIT = 500;

// One row of the admin business-supporter list: the fulfilment record joined to its donor (id + name
// + business_name), the recognition band, the captured preferences, and the five status booleans.
export interface BusinessFulfilmentListRow {
  id: number; // fulfilment record id
  donor_id: number;
  donor_name: string;
  business_name: string | null;
  band: SupporterBand;
  // Captured preferences (what the business submitted on the thank-you form; captured_at NULL until then).
  credit_name: string | null;
  website: string | null;
  socials: string | null;
  list_on_supporters: boolean;
  want_social: boolean;
  want_badge: boolean;
  want_certificate: boolean;
  certificate_delivery: string | null;
  certificate_address: string | null;
  consent_featured: boolean;
  captured_at: Date | null;
  // Admin fulfilment status flags.
  certificate_sent: boolean;
  certificate_posted: boolean;
  badge_sent: boolean;
  social_done: boolean;
  added_to_supporters: boolean;
  created_at: Date;
}

// List every business-supporter fulfilment record joined to its donor, most recent first, for the
// admin fulfilment view. Read-only (pool.query, no transaction/audit — mirrors
// listAdjustmentDueDonations). Bounded by a defensive LIMIT so an over-broad read stays capped.
export async function listBusinessFulfilments(): Promise<BusinessFulfilmentListRow[]> {
  const res = await pool.query<BusinessFulfilmentListRow>(
    `SELECT f.id, f.donor_id, dn.full_name AS donor_name, dn.business_name,
            f.band,
            f.credit_name, f.website, f.socials, f.list_on_supporters, f.want_social,
            f.want_badge, f.want_certificate, f.certificate_delivery, f.certificate_address,
            f.consent_featured, f.captured_at,
            f.certificate_sent, f.certificate_posted, f.badge_sent, f.social_done, f.added_to_supporters,
            f.created_at
       FROM business_supporter_fulfilment f
       JOIN donors dn ON dn.id = f.donor_id
      ORDER BY f.id DESC
      LIMIT ${BUSINESS_FULFILMENT_LIST_LIMIT}`,
  );
  return res.rows;
}

// Mark ONE fulfilment status flag true on a fulfilment row by id, in one audited transaction
// (writeWithAudit — the truth model, mirroring the writers in src/db/donations.ts): set the single
// boolean column true, bump updated_at, and append exactly one `fulfilment.<flag>` audit row (actor =
// the acting admin identity, entity business_supporter_fulfilment, entityId the row id). Any throw
// rolls BOTH the update and the audit row back.
//
// SECURITY: the flag is validated against the fixed FULFILMENT_FLAGS allowlist BEFORE any SQL is
// built (isFulfilmentFlag), so the column name interpolated into the UPDATE is provably one of the
// five literal columns — never attacker-controlled — closing off any arbitrary-column write. An
// unknown flag throws FulfilmentFlagError('invalid_flag') without opening a transaction; an unknown
// id throws FulfilmentFlagError('not_found') inside it (→ rollback).
export async function markFulfilmentFlag(
  id: number,
  flag: string,
  actor: string,
): Promise<{ id: number; flag: FulfilmentFlag; value: true; record: FulfilmentRow }> {
  if (!isFulfilmentFlag(flag)) {
    throw new FulfilmentFlagError("invalid_flag", flag);
  }
  // `flag` is now narrowed to FulfilmentFlag — one of the five literal column names — so the
  // interpolation below cannot express any other column.
  const column: FulfilmentFlag = flag;
  return writeWithAudit(
    async (client) => {
      const res = await client.query<FulfilmentRow>(
        `UPDATE business_supporter_fulfilment
            SET ${column} = true, updated_at = now()
          WHERE id = $1
        RETURNING *`,
        [id],
      );
      const record = res.rows[0];
      if (!record) throw new FulfilmentFlagError("not_found", String(id));
      return { id: record.id, flag: column, value: true as const, record };
    },
    (r) => ({
      actor,
      action: `fulfilment.${r.flag}`,
      entity: "business_supporter_fulfilment",
      entityId: r.id,
      data: { flag: r.flag, value: true },
    }),
  );
}

// --- Thank-you page capture (TASK-212) ----------------------------------------------------------
// The business thank-you page (GET /business/thank-you, served at that clean URL) is a private,
// token-gated, SUBMIT-ONCE page. The token in the private link IS the auth. Two reads/writes back it:
// getFulfilmentPageContextByToken (what the page renders) and updateFulfilmentPreferences (the one,
// once, DB-enforced write). Read-only lookups use pool.query (mirroring getCertificateContextByToken);
// the capture is an audited transaction (writeWithAudit — the truth model in ./donations.ts).

// Everything the thank-you page needs in ONE read addressed by the token: the recognition band (the
// page derives which sections to show from perksForBand(band)), the business_name to greet them by
// (falling back to full_name, like the certificate), whether they have already submitted (captured),
// and the saved preferences (so an already-captured record renders its read-only confirmation).
export interface FulfilmentPageContext {
  band: SupporterBand;
  businessName: string; // business_name, falling back to full_name — always a non-empty greeting name
  // The donor's contact email (TASK-221): the recipient for the post-capture "here is what you chose"
  // confirmation email (sent best-effort from postFulfilment). NULL when the business gave no email, in
  // which case no confirmation is sent. NEVER echoed to the browser by the GET/by-session routes.
  email: string | null;
  captured: boolean; // captured_at IS NOT NULL — the submit-once record has been filled in
  creditName: string | null;
  website: string | null;
  socials: string | null;
  listOnSupporters: boolean;
  wantSocial: boolean;
  wantBadge: boolean;
  wantCertificate: boolean;
  certificateDelivery: string | null;
  certificateAddress: string | null;
  consentFeatured: boolean;
}

export async function getFulfilmentPageContextByToken(
  token: string,
): Promise<FulfilmentPageContext | null> {
  const res = await pool.query<{
    band: SupporterBand;
    business_name: string | null;
    full_name: string;
    email: string | null;
    captured_at: Date | null;
    credit_name: string | null;
    website: string | null;
    socials: string | null;
    list_on_supporters: boolean;
    want_social: boolean;
    want_badge: boolean;
    want_certificate: boolean;
    certificate_delivery: string | null;
    certificate_address: string | null;
    consent_featured: boolean;
  }>(
    `SELECT f.band,
            dn.business_name,
            dn.full_name,
            dn.email,
            f.captured_at,
            f.credit_name, f.website, f.socials, f.list_on_supporters,
            f.want_social, f.want_badge, f.want_certificate,
            f.certificate_delivery, f.certificate_address, f.consent_featured
       FROM business_supporter_fulfilment f
       JOIN donors dn ON dn.id = f.donor_id
      WHERE f.token = $1`,
    [token],
  );
  const r = res.rows[0];
  if (!r) return null;
  const businessName = (r.business_name ?? "").trim() || r.full_name;
  return {
    band: r.band,
    businessName,
    email: r.email,
    captured: r.captured_at != null,
    creditName: r.credit_name,
    website: r.website,
    socials: r.socials,
    listOnSupporters: r.list_on_supporters,
    wantSocial: r.want_social,
    wantBadge: r.want_badge,
    wantCertificate: r.want_certificate,
    certificateDelivery: r.certificate_delivery,
    certificateAddress: r.certificate_address,
    consentFeatured: r.consent_featured,
  };
}

// --- Thank-you page state addressed by the Stripe Checkout SESSION (TASK-221) -------------------
// The type-aware post-checkout thank-you page (/donate/thank-you) has only the completed session id
// (Stripe substitutes {CHECKOUT_SESSION_ID} into the return URL), NOT the per-business token. This
// read links that session → its donor → the business_supporter_fulfilment for that donor, returning
// the SAME page state as getFulfilmentPageContextByToken PLUS the record's token (the page needs it to
// bind the form's submit-once POST and the certificate link). The link mirrors how the webhook stamps
// the donation: handleCheckoutCompleted writes donations.stripe_session_id = session.id, so the donor
// for a session is the donor of the donation carrying that session id, and the fulfilment is that
// donor's row.
//
// STRICTLY READ-ONLY (pool.query, no transaction/audit/write — mirrors getFulfilmentPageContextByToken).
// It NEVER creates a donor, donation or fulfilment record — that is the webhook's job alone. It returns
// null when no donation-with-fulfilment yet exists for the session (the webhook has not caught up, or
// this gift earns no recognition), and the route decides pending vs none from the session itself. A
// token-less fulfilment row (defensive — every webhook-created record has one) is treated as not-ready
// (null), so the page keeps polling rather than binding a broken link.
export interface FulfilmentSessionContext extends FulfilmentPageContext {
  token: string;
}

export async function getFulfilmentPageContextBySession(
  sessionId: string,
): Promise<FulfilmentSessionContext | null> {
  const res = await pool.query<{
    token: string | null;
    band: SupporterBand;
    business_name: string | null;
    full_name: string;
    email: string | null;
    captured_at: Date | null;
    credit_name: string | null;
    website: string | null;
    socials: string | null;
    list_on_supporters: boolean;
    want_social: boolean;
    want_badge: boolean;
    want_certificate: boolean;
    certificate_delivery: string | null;
    certificate_address: string | null;
    consent_featured: boolean;
  }>(
    `SELECT f.token,
            f.band,
            dn.business_name,
            dn.full_name,
            dn.email,
            f.captured_at,
            f.credit_name, f.website, f.socials, f.list_on_supporters,
            f.want_social, f.want_badge, f.want_certificate,
            f.certificate_delivery, f.certificate_address, f.consent_featured
       FROM donations d
       JOIN business_supporter_fulfilment f ON f.donor_id = d.donor_id
       JOIN donors dn ON dn.id = d.donor_id
      WHERE d.stripe_session_id = $1
      ORDER BY d.id ASC
      LIMIT 1`,
    [sessionId],
  );
  const r = res.rows[0];
  if (!r || !r.token) return null;
  const businessName = (r.business_name ?? "").trim() || r.full_name;
  return {
    token: r.token,
    band: r.band,
    businessName,
    email: r.email,
    captured: r.captured_at != null,
    creditName: r.credit_name,
    website: r.website,
    socials: r.socials,
    listOnSupporters: r.list_on_supporters,
    wantSocial: r.want_social,
    wantBadge: r.want_badge,
    wantCertificate: r.want_certificate,
    certificateDelivery: r.certificate_delivery,
    certificateAddress: r.certificate_address,
    consentFeatured: r.consent_featured,
  };
}

// The captured choices the page submits. The route (src/routes/business.ts) validates the raw body
// (zod) and resolves these server-side against the band read from the DB (a non-platinum band can
// never set the platinum extras true), so this write layer stores already-decided values.
export interface FulfilmentPreferences {
  creditName: string | null;
  website: string | null;
  socials: string | null;
  listOnSupporters: boolean;
  wantSocial: boolean;
  wantBadge: boolean;
  wantCertificate: boolean;
  certificateDelivery: "download" | "post" | null;
  certificateAddress: string | null;
  consentFeatured: boolean;
}

// Why a capture cannot proceed: no fulfilment row carries the token (not_found — surfaced as the same
// generic 404 as any unknown token, so a valid token is indistinguishable from an invalid one), or the
// record was ALREADY submitted (already_captured — the DB-enforced submit-once tripped). A typed error
// (like FulfilmentFlagError) so the route can map it to a status code rather than a bare 500.
export class FulfilmentCaptureError extends Error {
  constructor(public readonly reason: "not_found" | "already_captured") {
    super(`fulfilment capture failed: ${reason}`);
    this.name = "FulfilmentCaptureError";
  }
}

// Save the business's thank-you choices ONCE, in one audited transaction (writeWithAudit): set every
// preference column, stamp captured_at = now(), and append exactly one `fulfilment.captured` audit row
// — all committing or rolling back together.
//
// SUBMIT-ONCE is DB-enforced: the UPDATE carries `AND captured_at IS NULL`, so a record that was
// already submitted matches zero rows and is never overwritten (even under two concurrent submits —
// only the first UPDATE sees captured_at NULL). A zero-row UPDATE then distinguishes the two causes
// with a follow-up existence check: no row for the token → not_found; a row (already captured) →
// already_captured. Either throw rolls the transaction back, so nothing is half-written.
export async function updateFulfilmentPreferences(
  token: string,
  prefs: FulfilmentPreferences,
  actor: string,
): Promise<FulfilmentRow> {
  return writeWithAudit(
    async (client) => {
      const updated = await client.query<FulfilmentRow>(
        `UPDATE business_supporter_fulfilment
            SET credit_name = $2,
                website = $3,
                socials = $4,
                list_on_supporters = $5,
                want_social = $6,
                want_badge = $7,
                want_certificate = $8,
                certificate_delivery = $9,
                certificate_address = $10,
                consent_featured = $11,
                captured_at = now(),
                updated_at = now()
          WHERE token = $1 AND captured_at IS NULL
        RETURNING *`,
        [
          token,
          prefs.creditName,
          prefs.website,
          prefs.socials,
          prefs.listOnSupporters,
          prefs.wantSocial,
          prefs.wantBadge,
          prefs.wantCertificate,
          prefs.certificateDelivery,
          prefs.certificateAddress,
          prefs.consentFeatured,
        ],
      );
      const row = updated.rows[0];
      if (row) return row;
      // Zero rows updated: either the token matches nothing, or the record was already captured.
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM business_supporter_fulfilment WHERE token = $1`,
        [token],
      );
      throw new FulfilmentCaptureError(existing.rows[0] ? "already_captured" : "not_found");
    },
    (row) => ({
      actor,
      action: "fulfilment.captured",
      entity: "business_supporter_fulfilment",
      entityId: row.id,
      data: {
        band: row.band,
        listOnSupporters: row.list_on_supporters,
        wantSocial: row.want_social,
        wantBadge: row.want_badge,
        wantCertificate: row.want_certificate,
        certificateDelivery: row.certificate_delivery,
      },
    }),
  );
}

// --- Reminder scheduling (TASK-222) -------------------------------------------------------------
// The daily runner (npm run reminders) nudges business supporters who have not yet chosen how they
// would like to be thanked: a warm 5-day reminder, then a gentle 14-day last note. reminder_count
// (migration 1784050000000) tracks how many have been sent (0/1/2). listSupportersDueForReminder
// finds who is due the next stage; markReminderSent advances the count after a successful send. Both
// use pool.query (a plain read / a plain idempotent stamp — mirroring listUninvitedBusinessSupporters
// and markFulfilmentInvited).

// A defensive ceiling on the due-reminder list (the business-supporter population is small; this caps
// an over-broad read, mirroring the LIMITs on the other business-supporter reads).
const REMINDER_DUE_LIST_LIMIT = 500;

// One business supporter due a thank-you reminder: the fulfilment record id + its secure
// thank-you-link token + recognition band, the recipient email and the greeting name (business_name
// falling back to full_name — the same fallback the invite / thank-you page use), and which stage is
// due (1 = the 5-day reminder, 2 = the 14-day reminder).
export interface SupporterDueForReminder {
  fulfilmentId: number;
  token: string;
  band: SupporterBand;
  email: string;
  name: string;
  stage: 1 | 2;
}

// List every business supporter due a reminder AT `now`, oldest record first. A record is due when it
// has NOT been captured (they have not chosen yet), HAS been invited (there is a link to remind them
// about), has a non-empty email and a token, AND either:
//   - reminder_count = 0 AND it was invited at least 5 days ago  → the 5-day reminder (stage 1), or
//   - reminder_count = 1 AND it was invited at least 14 days ago → the 14-day reminder (stage 2).
// A record already at reminder_count = 2 (fully reminded), or captured, or too recently invited, is
// excluded — so the WHERE clause guarantees reminder_count is 0 or 1 and the stage CASE is exact. The
// clock is passed in (not now()), so the pass is deterministic and unit-testable. Read-only
// (pool.query, bounded by a defensive LIMIT). The greeting name is resolved in JS (business_name,
// trimmed, falling back to full_name) to match the invite / thank-you-page fallback exactly.
export async function listSupportersDueForReminder(now: Date): Promise<SupporterDueForReminder[]> {
  const res = await pool.query<{
    id: number;
    token: string;
    band: SupporterBand;
    email: string;
    business_name: string | null;
    full_name: string;
    stage: number;
  }>(
    `SELECT f.id, f.token, f.band, dn.email, dn.business_name, dn.full_name,
            CASE WHEN f.reminder_count = 0 THEN 1 ELSE 2 END AS stage
       FROM business_supporter_fulfilment f
       JOIN donors dn ON dn.id = f.donor_id
      WHERE f.captured_at IS NULL
        AND f.invited_at IS NOT NULL
        AND f.token IS NOT NULL
        AND dn.email IS NOT NULL
        AND dn.email <> ''
        AND (
              (f.reminder_count = 0 AND f.invited_at <= $1::timestamptz - interval '5 days')
           OR (f.reminder_count = 1 AND f.invited_at <= $1::timestamptz - interval '14 days')
        )
      ORDER BY f.id ASC
      LIMIT ${REMINDER_DUE_LIST_LIMIT}`,
    [now],
  );
  return res.rows.map((r) => ({
    fulfilmentId: r.id,
    token: r.token,
    band: r.band,
    email: r.email,
    name: (r.business_name ?? "").trim() || r.full_name,
    stage: r.stage === 1 ? 1 : 2,
  }));
}

// Advance a fulfilment record's reminder_count to `stage` (1 or 2) after that stage's reminder was
// sent, IDEMPOTENTLY: the `AND reminder_count = stage - 1` guard means the update only fires when the
// record is at exactly the previous stage, so re-running the same stage (or a racing double-run) sets
// the count once and never double-sends. Called best-effort (its caller swallows failures), only AFTER
// a send succeeds — so a failed send leaves the count unchanged and the record is retried next run.
// Returns whether it newly stamped a row (rowCount === 1), which callers may ignore. Mirrors
// markFulfilmentInvited (a plain idempotent stamp on pool.query).
export async function markReminderSent(id: number, stage: number): Promise<boolean> {
  const res = await pool.query(
    `UPDATE business_supporter_fulfilment
        SET reminder_count = $2
      WHERE id = $1 AND reminder_count = $2 - 1`,
    [id, stage],
  );
  return (res.rowCount ?? 0) > 0;
}
