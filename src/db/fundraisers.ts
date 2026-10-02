import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import {
  meter,
  slugify,
  RESERVED_SLUGS,
  type AdminPatch,
  type FundraiserEdit,
  type FundraiserRecord,
  type Meter,
  type SignUp,
  type WallSourceRow,
} from "../fundraising/model";

// TASK-493: the SQL behind community fundraising. The rules live in src/fundraising/model.ts; this
// file only moves rows. Every write a person makes (staff, an organiser, the public form, Stripe)
// writes its audit_log row in the SAME transaction, against entity "fundraiser" and the
// fundraiser's id, so the admin's History for a fundraiser is one query.

export type FundraiserErrorReason = "not_found" | "bad_status" | "slug_taken" | "not_waiting";

export class FundraiserError extends Error {
  constructor(public readonly reason: FundraiserErrorReason) {
    super(`fundraiser: ${reason}`);
    this.name = "FundraiserError";
  }
}

export interface FundraisingSettings {
  pageOn: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

// Field -> column, written out so a field reaches SQL only by being named here.
const COLUMNS = {
  path: "path",
  kind: "kind",
  title: "title",
  description: "description",
  eventDate: "event_date",
  startTime: "start_time",
  venue: "venue",
  town: "town",
  targetPence: "target_pence",
  public: "public",
  name: "organiser_name",
  email: "organiser_email",
  phone: "organiser_phone",
  socialLink: "social_link",
  socialOk: "social_ok",
  wants: "wants",
  postAddress: "post_address",
  newsletterOk: "newsletter_ok",
  imageSrc: "image_src",
  slug: "slug",
} as const;
type PatchField = keyof typeof COLUMNS;

const SELECT = `
  SELECT f.id, f.slug, f.path, f.kind, f.title, f.description,
         to_char(f.event_date, 'YYYY-MM-DD') AS event_date,
         to_char(f.start_time, 'HH24:MI') AS start_time,
         f.venue, f.town, f.target_pence, f.public, f.status,
         f.organiser_name, f.organiser_email, f.organiser_phone, f.social_link, f.social_ok,
         f.wants, f.post_address, f.newsletter_ok, f.image_src, f.declined_reason,
         f.created_at, f.approved_at, f.approved_by, f.updated_at, f.updated_by
    FROM fundraisers f`;

// Online: paid gifts less refunds. Cash: what staff recorded as paid in. Summed per fundraiser.
const ONLINE_SQL = `(SELECT COALESCE(SUM(GREATEST(d.amount_pence - d.refunded_amount_pence, 0))
                       FILTER (WHERE d.payment_status = 'paid'), 0)
                       FROM donations d WHERE d.fundraiser_id = f.id)`;
const CASH_SQL = `(SELECT COALESCE(SUM(c.amount_pence), 0) FROM fundraiser_cash c WHERE c.fundraiser_id = f.id)`;
const WAITING_SQL = `EXISTS (SELECT 1 FROM fundraiser_edits e WHERE e.fundraiser_id = f.id AND e.status = 'waiting')`;

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

export function toRecord(r: Row): FundraiserRecord {
  const wants = (r.wants ?? {}) as Record<string, unknown>;
  return {
    id: Number(r.id),
    slug: String(r.slug),
    path: r.path as FundraiserRecord["path"],
    kind: r.kind as FundraiserRecord["kind"],
    title: String(r.title),
    description: String(r.description ?? ""),
    eventDate: (r.event_date as string | null) ?? null,
    startTime: (r.start_time as string | null) ?? null,
    venue: String(r.venue ?? ""),
    town: String(r.town ?? ""),
    targetPence: r.target_pence == null ? null : Number(r.target_pence),
    public: Boolean(r.public),
    status: r.status as FundraiserRecord["status"],
    name: String(r.organiser_name),
    email: String(r.organiser_email),
    phone: String(r.organiser_phone),
    socialLink: (r.social_link as string | null) ?? null,
    socialOk: Boolean(r.social_ok),
    wants: {
      leaflets: Number(wants.leaflets ?? 0),
      buckets: Number(wants.buckets ?? 0),
      shoutOut: Boolean(wants.shoutOut),
      attend: Boolean(wants.attend),
    },
    postAddress: (r.post_address as string | null) ?? null,
    newsletterOk: Boolean(r.newsletter_ok),
    imageSrc: (r.image_src as string | null) ?? null,
    declinedReason: (r.declined_reason as string | null) ?? null,
    createdAt: iso(r.created_at) as string,
    approvedAt: iso(r.approved_at),
    approvedBy: (r.approved_by as string | null) ?? null,
    updatedAt: iso(r.updated_at) as string,
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}

const meterOf = (r: Row): Meter =>
  meter({ onlinePence: Number(r.online_pence ?? 0), cashPence: Number(r.cash_pence ?? 0), targetPence: r.target_pence == null ? null : Number(r.target_pence) });

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The SET list and values for a partial change. Pure apart from its types: a field reaches SQL only
 * through COLUMNS, and wants goes in as JSON. Placeholders start at $start.
 */
export function patchAssignments(patch: Partial<Record<PatchField, unknown>>, start = 1): { sets: string[]; values: unknown[]; fields: PatchField[] } {
  const fields = (Object.keys(patch) as PatchField[]).filter((f) => f in COLUMNS && patch[f] !== undefined);
  const sets = fields.map((f, i) => `${COLUMNS[f]} = $${start + i}`);
  const values = fields.map((f) => (f === "wants" ? JSON.stringify(patch[f]) : patch[f]));
  return { sets, values, fields };
}

async function lockFundraiser(client: PoolClient, id: number): Promise<FundraiserRecord> {
  const found = await client.query(`${SELECT} WHERE f.id = $1 FOR UPDATE`, [id]);
  if (!found.rows[0]) throw new FundraiserError("not_found");
  return toRecord(found.rows[0]);
}

async function reread(client: PoolClient, id: number): Promise<FundraiserRecord> {
  return toRecord((await client.query(`${SELECT} WHERE f.id = $1`, [id])).rows[0]);
}

async function applyPatch(
  client: PoolClient,
  id: number,
  patch: Partial<Record<PatchField, unknown>>,
  actor: string,
): Promise<PatchField[]> {
  if (typeof patch.slug === "string") {
    const taken = await client.query("SELECT 1 FROM fundraisers WHERE slug = $1 AND id <> $2", [patch.slug, id]);
    if (taken.rows.length > 0) throw new FundraiserError("slug_taken");
  }
  const { sets, values, fields } = patchAssignments(patch, 1);
  if (fields.length === 0) return [];
  await client.query(
    `UPDATE fundraisers SET ${sets.join(", ")}, updated_at = now(), updated_by = $${fields.length + 1} WHERE id = $${fields.length + 2}`,
    [...values, actor, id],
  );
  return fields;
}

// --- the switch ----------------------------------------------------------------------------------

export async function getFundraisingSettings(): Promise<FundraisingSettings> {
  const r = await pool.query<{ page_on: boolean; updated_at: string; updated_by: string | null }>(
    "SELECT page_on, updated_at, updated_by FROM fundraising_settings WHERE id = 1",
  );
  const row = r.rows[0];
  if (!row) return { pageOn: false, updatedAt: null, updatedBy: null };
  return { pageOn: row.page_on, updatedAt: iso(row.updated_at), updatedBy: row.updated_by };
}

/** Is fundraising switched on? Any failure reads as OFF, so nothing shows that should not. */
export async function fundraisingIsOn(): Promise<boolean> {
  try {
    return (await getFundraisingSettings()).pageOn;
  } catch {
    return false;
  }
}

export async function setFundraisingOn(pageOn: boolean, actor: string): Promise<FundraisingSettings> {
  return inTransaction(async (client) => {
    const before = await client.query<{ page_on: boolean }>("SELECT page_on FROM fundraising_settings WHERE id = 1 FOR UPDATE");
    await client.query(
      `INSERT INTO fundraising_settings (id, page_on, updated_at, updated_by) VALUES (1, $1, now(), $2)
       ON CONFLICT (id) DO UPDATE SET page_on = $1, updated_at = now(), updated_by = $2`,
      [pageOn, actor],
    );
    await insertAudit(client, {
      actor,
      action: "fundraising.switched",
      entity: "fundraising_settings",
      entityId: 1,
      data: { pageOn, wasOn: before.rows[0]?.page_on ?? false },
    });
    const r = await client.query<{ page_on: boolean; updated_at: string; updated_by: string | null }>(
      "SELECT page_on, updated_at, updated_by FROM fundraising_settings WHERE id = 1",
    );
    const row = r.rows[0];
    return { pageOn: row.page_on, updatedAt: iso(row.updated_at), updatedBy: row.updated_by };
  });
}

// --- signing up ----------------------------------------------------------------------------------

// A slug nobody has: the title's, then -2, -3... Staff may change it before approving.
async function freeSlug(client: PoolClient, title: string): Promise<string> {
  const base = slugify(title);
  const taken = new Set(
    (await client.query<{ slug: string }>("SELECT slug FROM fundraisers WHERE slug = $1 OR slug LIKE $2", [base, `${base}-%`])).rows.map(
      (r) => r.slug,
    ),
  );
  for (const reserved of RESERVED_SLUGS) taken.add(reserved);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export async function createFundraiser(s: SignUp): Promise<FundraiserRecord> {
  return inTransaction(async (client) => {
    const slug = await freeSlug(client, s.title);
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO fundraisers
         (slug, path, kind, title, description, event_date, start_time, venue, town, target_pence, public,
          organiser_name, organiser_email, organiser_phone, social_link, social_ok, wants, post_address,
          newsletter_ok, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 'public')
       RETURNING id`,
      [
        slug, s.path, s.kind, s.title, s.description, s.eventDate, s.startTime, s.venue, s.town, s.targetPence, s.public,
        s.name, s.email, s.phone, s.socialLink, s.socialOk, JSON.stringify(s.wants), s.postAddress, s.newsletterOk,
      ],
    );
    const id = Number(inserted.rows[0].id);
    await insertAudit(client, {
      actor: "public",
      action: "fundraiser.signed_up",
      entity: "fundraiser",
      entityId: id,
      data: { slug, path: s.path, kind: s.kind, title: s.title, public: s.public },
    });
    return reread(client, id);
  });
}

// --- reading -------------------------------------------------------------------------------------

const WITH_SUMS = SELECT.replace(
  "FROM fundraisers f",
  `, ${ONLINE_SQL} AS online_pence, ${CASH_SQL} AS cash_pence, ${WAITING_SQL} AS edit_waiting FROM fundraisers f`,
);

export async function getFundraiser(id: number): Promise<(FundraiserRecord & { meter: Meter; editWaiting: boolean }) | null> {
  const r = await pool.query(`${WITH_SUMS} WHERE f.id = $1`, [id]);
  const row = r.rows[0];
  return row ? { ...toRecord(row), meter: meterOf(row), editWaiting: Boolean(row.edit_waiting) } : null;
}

export interface FundraiserSummary extends FundraiserRecord {
  meter: Meter;
  editWaiting: boolean;
}

/** Every sign up, newest first, for the admin's list. */
export async function listAllFundraisers(): Promise<FundraiserSummary[]> {
  const r = await pool.query(`${WITH_SUMS} ORDER BY f.created_at DESC, f.id DESC`);
  return r.rows.map((row) => ({ ...toRecord(row), meter: meterOf(row), editWaiting: Boolean(row.edit_waiting) }));
}

/** Approved and public, for Get involved. The caller applies isListed for the date rule. */
export async function listApprovedPublic(): Promise<Array<FundraiserRecord & { meter: Meter }>> {
  const r = await pool.query(
    `${WITH_SUMS} WHERE f.status = 'approved' AND f.public = true ORDER BY f.event_date NULLS LAST, f.approved_at DESC, f.id DESC`,
  );
  return r.rows.map((row) => ({ ...toRecord(row), meter: meterOf(row) }));
}

export async function getBySlug(slug: string): Promise<(FundraiserRecord & { meter: Meter }) | null> {
  const r = await pool.query(`${WITH_SUMS} WHERE f.slug = $1`, [slug]);
  const row = r.rows[0];
  return row ? { ...toRecord(row), meter: meterOf(row) } : null;
}

/** The gifts made on a fundraiser's page, for its wall. Hidden ones too; the caller decides. */
export async function wallRows(fundraiserId: number): Promise<WallSourceRow[]> {
  const r = await pool.query(
    `SELECT d.id, dn.full_name, dn.anonymous, d.show_name, d.show_amount, d.amount_pence,
            d.refunded_amount_pence, d.supporter_message, d.message_hidden, d.created_at
       FROM donations d JOIN donors dn ON dn.id = d.donor_id
      WHERE d.fundraiser_id = $1 AND d.payment_status = 'paid'
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT 1000`,
    [fundraiserId],
  );
  return r.rows.map((row) => ({
    donationId: Number(row.id),
    fullName: String(row.full_name ?? ""),
    anonymous: Boolean(row.anonymous),
    showName: Boolean(row.show_name),
    showAmount: Boolean(row.show_amount),
    amountPence: Number(row.amount_pence),
    refundedPence: Number(row.refunded_amount_pence ?? 0),
    message: (row.supporter_message as string | null) ?? null,
    hidden: Boolean(row.message_hidden),
    createdAt: iso(row.created_at) as string,
  }));
}

export interface EditRow {
  id: number;
  changes: FundraiserEdit;
  status: "waiting" | "approved" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

export async function listEdits(fundraiserId: number): Promise<EditRow[]> {
  const r = await pool.query(
    `SELECT id, changes, status, created_at, decided_at, decided_by FROM fundraiser_edits
      WHERE fundraiser_id = $1 ORDER BY (status = 'waiting') DESC, created_at DESC, id DESC`,
    [fundraiserId],
  );
  return r.rows.map((row) => ({
    id: Number(row.id),
    changes: row.changes as FundraiserEdit,
    status: row.status,
    createdAt: iso(row.created_at) as string,
    decidedAt: iso(row.decided_at),
    decidedBy: row.decided_by ?? null,
  }));
}

export interface CashRow {
  id: number;
  amountPence: number;
  paidInOn: string;
  note: string;
  createdBy: string;
  createdAt: string;
}

export async function listCash(fundraiserId: number): Promise<CashRow[]> {
  const r = await pool.query(
    `SELECT id, amount_pence, to_char(paid_in_on, 'YYYY-MM-DD') AS paid_in_on, note, created_by, created_at
       FROM fundraiser_cash WHERE fundraiser_id = $1 ORDER BY paid_in_on DESC, id DESC`,
    [fundraiserId],
  );
  return r.rows.map((row) => ({
    id: Number(row.id),
    amountPence: Number(row.amount_pence),
    paidInOn: row.paid_in_on,
    note: row.note,
    createdBy: row.created_by,
    createdAt: iso(row.created_at) as string,
  }));
}

export interface HistoryRow {
  id: number;
  actor: string;
  action: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export async function fundraiserHistory(fundraiserId: number): Promise<HistoryRow[]> {
  const r = await pool.query(
    `SELECT id, actor, action, data, created_at FROM audit_log
      WHERE entity = 'fundraiser' AND entity_id = $1 ORDER BY id DESC LIMIT 500`,
    [fundraiserId],
  );
  return r.rows.map((row) => ({
    id: Number(row.id),
    actor: row.actor,
    action: row.action,
    data: row.data ?? {},
    createdAt: iso(row.created_at) as string,
  }));
}

// --- staff changes -------------------------------------------------------------------------------

export async function patchFundraiser(id: number, patch: AdminPatch, actor: string): Promise<FundraiserRecord> {
  return inTransaction(async (client) => {
    const before = await lockFundraiser(client, id);
    const changed = await applyPatch(client, id, patch, actor);
    await insertAudit(client, {
      actor,
      action: "fundraiser.updated",
      entity: "fundraiser",
      entityId: id,
      data: { changed, slug: patch.slug ?? before.slug, wasSlug: before.slug },
    });
    return reread(client, id);
  });
}

const ALLOWED_FROM: Record<"approve" | "decline" | "finish", ReadonlyArray<FundraiserRecord["status"]>> = {
  approve: ["new", "declined"],
  decline: ["new", "approved"],
  finish: ["approved"],
};

/** Approve, decline or finish. Refuses a move that makes no sense (finishing a new sign up). */
export async function moveFundraiser(
  id: number,
  move: "approve" | "decline" | "finish",
  actor: string,
  reason: string | null = null,
): Promise<{ before: FundraiserRecord; after: FundraiserRecord }> {
  return inTransaction(async (client) => {
    const before = await lockFundraiser(client, id);
    if (!ALLOWED_FROM[move].includes(before.status)) throw new FundraiserError("bad_status");
    if (move === "approve") {
      await client.query(
        `UPDATE fundraisers SET status = 'approved', approved_at = now(), approved_by = $1, declined_reason = NULL,
                updated_at = now(), updated_by = $1 WHERE id = $2`,
        [actor, id],
      );
    } else if (move === "decline") {
      await client.query(
        `UPDATE fundraisers SET status = 'declined', declined_reason = $1, updated_at = now(), updated_by = $2 WHERE id = $3`,
        [reason, actor, id],
      );
    } else {
      await client.query(`UPDATE fundraisers SET status = 'finished', updated_at = now(), updated_by = $1 WHERE id = $2`, [actor, id]);
    }
    const action = { approve: "fundraiser.approved", decline: "fundraiser.declined", finish: "fundraiser.finished" }[move];
    await insertAudit(client, {
      actor,
      action,
      entity: "fundraiser",
      entityId: id,
      data: { slug: before.slug, wasStatus: before.status, ...(move === "decline" ? { reason } : {}) },
    });
    return { before, after: await reread(client, id) };
  });
}

// --- changes from the organiser ------------------------------------------------------------------

/** Store an organiser's change as waiting. A change of theirs already waiting is replaced. */
export async function requestEdit(fundraiserId: number, changes: FundraiserEdit, tokenHash: string): Promise<EditRow> {
  return inTransaction(async (client) => {
    const f = await lockFundraiser(client, fundraiserId);
    if (f.status !== "approved") throw new FundraiserError("bad_status");
    const waiting = await client.query<{ id: number }>(
      "SELECT id FROM fundraiser_edits WHERE fundraiser_id = $1 AND status = 'waiting' FOR UPDATE",
      [fundraiserId],
    );
    let editId: number;
    if (waiting.rows[0]) {
      editId = Number(waiting.rows[0].id);
      await client.query("UPDATE fundraiser_edits SET changes = $1, created_at = now() WHERE id = $2", [JSON.stringify(changes), editId]);
    } else {
      const ins = await client.query<{ id: number }>(
        "INSERT INTO fundraiser_edits (fundraiser_id, changes) VALUES ($1, $2) RETURNING id",
        [fundraiserId, JSON.stringify(changes)],
      );
      editId = Number(ins.rows[0].id);
    }
    await client.query("UPDATE fundraiser_manage_tokens SET used_at = COALESCE(used_at, now()) WHERE token_hash = $1", [tokenHash]);
    await insertAudit(client, {
      actor: "organiser",
      action: "fundraiser.edit_requested",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { editId, fields: Object.keys(changes), replaced: Boolean(waiting.rows[0]) },
    });
    const r = await client.query(
      "SELECT id, changes, status, created_at, decided_at, decided_by FROM fundraiser_edits WHERE id = $1",
      [editId],
    );
    const row = r.rows[0];
    return {
      id: Number(row.id),
      changes: row.changes,
      status: row.status,
      createdAt: iso(row.created_at) as string,
      decidedAt: null,
      decidedBy: null,
    };
  });
}

/** Approve (apply it to the live page) or reject a waiting change. */
export async function decideEdit(
  fundraiserId: number,
  editId: number,
  approve: boolean,
  actor: string,
): Promise<FundraiserRecord> {
  return inTransaction(async (client) => {
    await lockFundraiser(client, fundraiserId);
    const r = await client.query<{ changes: FundraiserEdit; status: string }>(
      "SELECT changes, status FROM fundraiser_edits WHERE id = $1 AND fundraiser_id = $2 FOR UPDATE",
      [editId, fundraiserId],
    );
    const edit = r.rows[0];
    if (!edit) throw new FundraiserError("not_found");
    if (edit.status !== "waiting") throw new FundraiserError("not_waiting");
    let changed: string[] = [];
    if (approve) changed = await applyPatch(client, fundraiserId, edit.changes as Partial<Record<PatchField, unknown>>, actor);
    await client.query(
      "UPDATE fundraiser_edits SET status = $1, decided_at = now(), decided_by = $2 WHERE id = $3",
      [approve ? "approved" : "rejected", actor, editId],
    );
    await insertAudit(client, {
      actor,
      action: approve ? "fundraiser.edit_approved" : "fundraiser.edit_rejected",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { editId, fields: approve ? changed : Object.keys(edit.changes ?? {}) },
    });
    return reread(client, fundraiserId);
  });
}

// --- cash paid in --------------------------------------------------------------------------------

export async function addCash(
  fundraiserId: number,
  cash: { amountPence: number; paidInOn: string; note: string },
  actor: string,
): Promise<CashRow> {
  return inTransaction(async (client) => {
    await lockFundraiser(client, fundraiserId);
    const r = await client.query(
      `INSERT INTO fundraiser_cash (fundraiser_id, amount_pence, paid_in_on, note, created_by) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, amount_pence, to_char(paid_in_on, 'YYYY-MM-DD') AS paid_in_on, note, created_by, created_at`,
      [fundraiserId, cash.amountPence, cash.paidInOn, cash.note, actor],
    );
    const row = r.rows[0];
    await insertAudit(client, {
      actor,
      action: "fundraiser.cash_added",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { cashId: Number(row.id), amountPence: cash.amountPence, paidInOn: cash.paidInOn, note: cash.note },
    });
    return {
      id: Number(row.id),
      amountPence: Number(row.amount_pence),
      paidInOn: row.paid_in_on,
      note: row.note,
      createdBy: row.created_by,
      createdAt: iso(row.created_at) as string,
    };
  });
}

export async function removeCash(fundraiserId: number, cashId: number, actor: string): Promise<void> {
  await inTransaction(async (client) => {
    const r = await client.query<{ amount_pence: number; paid_in_on: string; note: string }>(
      `DELETE FROM fundraiser_cash WHERE id = $1 AND fundraiser_id = $2
       RETURNING amount_pence, to_char(paid_in_on, 'YYYY-MM-DD') AS paid_in_on, note`,
      [cashId, fundraiserId],
    );
    const row = r.rows[0];
    if (!row) throw new FundraiserError("not_found");
    await insertAudit(client, {
      actor,
      action: "fundraiser.cash_removed",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { cashId, amountPence: Number(row.amount_pence), paidInOn: row.paid_in_on, note: row.note },
    });
  });
}

// --- the supporter wall --------------------------------------------------------------------------

export async function setMessageHidden(fundraiserId: number, donationId: number, hidden: boolean, actor: string): Promise<void> {
  await inTransaction(async (client) => {
    const r = await client.query(
      "UPDATE donations SET message_hidden = $1 WHERE id = $2 AND fundraiser_id = $3 RETURNING id",
      [hidden, donationId, fundraiserId],
    );
    if (!r.rows[0]) throw new FundraiserError("not_found");
    await insertAudit(client, {
      actor,
      action: hidden ? "fundraiser.message_hidden" : "fundraiser.message_shown",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { donationId },
    });
  });
}

// --- manage links --------------------------------------------------------------------------------

export async function findApprovedByEmail(email: string): Promise<FundraiserRecord[]> {
  const r = await pool.query(
    `${SELECT} WHERE lower(f.organiser_email) = lower($1) AND f.status = 'approved' ORDER BY f.created_at DESC LIMIT 5`,
    [email],
  );
  return r.rows.map(toRecord);
}

export async function storeManageToken(record: { tokenHash: string; fundraiserId: number; expiresAt: Date }): Promise<void> {
  await inTransaction(async (client) => {
    await client.query(
      "INSERT INTO fundraiser_manage_tokens (token_hash, fundraiser_id, expires_at) VALUES ($1, $2, $3)",
      [record.tokenHash, record.fundraiserId, record.expiresAt],
    );
    await insertAudit(client, {
      actor: "organiser",
      action: "fundraiser.manage_link_sent",
      entity: "fundraiser",
      entityId: record.fundraiserId,
      data: { expiresAt: record.expiresAt.toISOString() },
    });
  });
}

export async function findManageToken(tokenHash: string): Promise<{ fundraiserId: number; expiresAt: Date } | null> {
  const r = await pool.query<{ fundraiser_id: number; expires_at: Date }>(
    "SELECT fundraiser_id, expires_at FROM fundraiser_manage_tokens WHERE token_hash = $1",
    [tokenHash],
  );
  const row = r.rows[0];
  return row ? { fundraiserId: Number(row.fundraiser_id), expiresAt: new Date(row.expires_at) } : null;
}

export async function waitingEditFor(fundraiserId: number): Promise<EditRow | null> {
  return (await listEdits(fundraiserId)).find((e) => e.status === "waiting") ?? null;
}

// --- gifts from the Stripe webhook ---------------------------------------------------------------

export interface FundraiserGift {
  fundraiserId: number;
  message: string | null;
  showName: boolean;
  showAmount: boolean;
}

/**
 * Inside the webhook's transaction: put a gift on its fundraiser's page, but only when the id names
 * an APPROVED fundraiser. Anything else stays an ordinary donation (no link, no message), and the
 * audit row says so. Returns whether it was linked.
 */
export async function linkFundraiserGift(
  client: PoolClient,
  donationId: number,
  gift: FundraiserGift,
  eventId: string,
): Promise<boolean> {
  const found = await client.query<{ id: number }>(
    "SELECT id FROM fundraisers WHERE id = $1 AND status = 'approved'",
    [gift.fundraiserId],
  );
  if (!found.rows[0]) {
    await insertAudit(client, {
      actor: "stripe",
      action: "fundraiser.gift_not_linked",
      entity: "donation",
      entityId: donationId,
      data: { eventId, fundraiserId: gift.fundraiserId },
    });
    return false;
  }
  await client.query(
    "UPDATE donations SET fundraiser_id = $1, supporter_message = $2, show_name = $3, show_amount = $4 WHERE id = $5",
    [gift.fundraiserId, gift.message, gift.showName, gift.showAmount, donationId],
  );
  await insertAudit(client, {
    actor: "stripe",
    action: "fundraiser.gift_received",
    entity: "fundraiser",
    entityId: gift.fundraiserId,
    data: { eventId, donationId },
  });
  return true;
}
