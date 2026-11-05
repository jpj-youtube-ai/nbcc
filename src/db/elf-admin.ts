import type { PoolClient } from "pg";
import { pool } from "./pool";
import { recordAudit, writeWithAudit, type AuditInput } from "./donations";
import type { HqNumbers } from "../elf/admin-hq";
import type { DetectiveChange, FamilyChange, FamilyFilter } from "../elf/admin-families";

// NBCC Elf Detective School: what Head Elf HQ reads from the database, and the changes a head elf makes
// (docs/superpowers/specs/2026-11-05-elf-admin-design.md). Only families that are active (they paid)
// count anywhere, and a removed family only under the Removed filter. Every change goes in the audit
// log with the head elf who made it, in the same transaction. The routes are src/routes/admin-elf.ts;
// the SQL is proved against a real database by features/elf-admin.feature in CI.

const n = (v: unknown): number => Number(v ?? 0) || 0;

/** HQ's numbers, as of `now`. */
export async function elfHqNumbers(now: Date): Promise<HqNumbers> {
  const r = await pool.query<Record<string, string>>(
    `WITH fams AS (SELECT id FROM elf_families WHERE active AND removed_at IS NULL),
          dets AS (SELECT d.name_approved FROM elf_detectives d JOIN fams ON fams.id = d.family_id WHERE d.active),
          paid AS (SELECT o.* FROM elf_orders o JOIN fams ON fams.id = o.family_id WHERE o.status = 'paid')
     SELECT (SELECT COUNT(*) FROM fams) AS families,
            (SELECT COUNT(*) FROM dets) AS detectives,
            (SELECT COUNT(*) FROM dets WHERE NOT name_approved) AS names_to_check,
            (SELECT COUNT(*) FROM elf_orders WHERE status = 'pending' AND created_at < $1::timestamptz - interval '1 hour') AS waiting,
            (SELECT COALESCE(SUM(entry_pence), 0) FROM paid) AS entry,
            (SELECT COALESCE(SUM(donation_pence), 0) FROM paid) AS gift,
            (SELECT COALESCE(SUM(donation_pence) FILTER (WHERE gift_aid), 0) FROM paid) AS gift_aid`,
    [now.toISOString()],
  );
  const row = r.rows[0] ?? {};
  return {
    families: n(row.families),
    detectives: n(row.detectives),
    namesToCheck: n(row.names_to_check),
    waitingPayments: n(row.waiting),
    entryPence: n(row.entry),
    giftPence: n(row.gift),
    giftAidPence: n(row.gift_aid),
  };
}

export interface RecruitRow {
  detectiveId: number;
  familyId: number;
  firstName: string;
  surname: string;
  badgeNumber: number | null;
  approved: boolean;
  look: unknown;
}

/** The newest detectives, newest badge first: a badge is given when the payment goes through. */
export async function elfRecruits(limit: number): Promise<RecruitRow[]> {
  const r = await pool.query<{ id: number; family_id: number; first_name: string; surname: string; badge_number: number | null; name_approved: boolean; look: unknown }>(
    `SELECT d.id, d.family_id, d.first_name, d.surname, d.badge_number, d.name_approved, d.look
       FROM elf_detectives d JOIN elf_families f ON f.id = d.family_id
      WHERE d.active AND f.active AND f.removed_at IS NULL
      ORDER BY d.badge_number DESC NULLS LAST, d.id DESC
      LIMIT $1`,
    [Math.max(1, Math.min(50, Math.floor(limit)))],
  );
  return r.rows.map((d) => ({
    detectiveId: d.id,
    familyId: d.family_id,
    firstName: d.first_name,
    surname: d.surname,
    badgeNumber: d.badge_number,
    approved: d.name_approved,
    look: d.look,
  }));
}

// ---- Families -----------------------------------------------------------------------------------

export interface FamilySummaryRow {
  id: number;
  grownUpName: string;
  email: string;
  enrolledAt: Date;
  removed: boolean;
  detectives: { id: number; firstName: string; badgeNumber: number | null; approved: boolean; look: unknown }[];
}

export interface DetectiveRow {
  id: number;
  familyId: number;
  firstName: string;
  surname: string;
  badgeNumber: number | null;
  approved: boolean;
  look: unknown;
}

export interface FamilySheetRow {
  id: number;
  grownUpName: string;
  email: string;
  newsletter: boolean;
  enrolledAt: Date;
  removedAt: Date | null;
  removedBy: string | null;
  detectives: Omit<DetectiveRow, "familyId">[];
  payments: { reference: string; status: string; paidAt: Date | null; entryPence: number; giftPence: number; giftAid: boolean }[];
}

/** A search typed in the box: words to match names and emails, and a badge number if it is one. */
function searchTerms(q: string): { like: string; badge: number | null } {
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const badge = /^(?:EDS\s*)?0*(\d{1,7})$/i.exec(q.trim());
  return { like, badge: badge ? Number(badge[1]) : null };
}

const FILTER_SQL: Record<FamilyFilter, string> = {
  all: "m.removed_at IS NULL",
  check: "m.removed_at IS NULL AND EXISTS (SELECT 1 FROM elf_detectives d WHERE d.family_id = m.id AND d.active AND NOT d.name_approved)",
  week: "m.removed_at IS NULL AND m.created_at >= $3::timestamptz - interval '7 days'",
  removed: "m.removed_at IS NOT NULL",
};

/** The families a search and a filter find, newest first, a page at a time, with each filter's count. */
export async function listElfFamilies(o: { q: string; filter: FamilyFilter; offset: number; limit: number; now: Date }): Promise<{ rows: FamilySummaryRow[]; total: number; counts: Record<FamilyFilter, number> }> {
  const { like, badge } = searchTerms(o.q);
  const matched = `matched AS (
      SELECT f.id, f.grown_up_name, f.email, f.created_at, f.removed_at
        FROM elf_families f
       WHERE f.active
         AND $3::timestamptz IS NOT NULL -- every parameter is used in both queries, so Postgres can type it
         AND ($1 = '%%' OR f.grown_up_name ILIKE $1 OR f.email ILIKE $1
              OR EXISTS (SELECT 1 FROM elf_detectives d WHERE d.family_id = f.id AND d.active
                          AND (d.first_name ILIKE $1 OR d.surname ILIKE $1 OR d.badge_number = $2::int))))`;
  const counts = await pool.query<Record<string, string>>(
    `WITH ${matched}
     SELECT COUNT(*) FILTER (WHERE ${FILTER_SQL.all}) AS all_families,
            COUNT(*) FILTER (WHERE ${FILTER_SQL.check}) AS check_families,
            COUNT(*) FILTER (WHERE ${FILTER_SQL.week}) AS week_families,
            COUNT(*) FILTER (WHERE ${FILTER_SQL.removed}) AS removed_families
       FROM matched m`,
    [like, badge, o.now.toISOString()],
  );
  const rows = await pool.query<{ id: number; grown_up_name: string; email: string; created_at: Date; removed: boolean; detectives: FamilySummaryRow["detectives"] }>(
    `WITH ${matched}
     SELECT m.id, m.grown_up_name, m.email, m.created_at, m.removed_at IS NOT NULL AS removed,
            COALESCE((SELECT json_agg(json_build_object('id', d.id, 'firstName', d.first_name, 'badgeNumber', d.badge_number,
                                                        'approved', d.name_approved, 'look', d.look) ORDER BY d.id)
                        FROM elf_detectives d WHERE d.family_id = m.id AND d.active), '[]'::json) AS detectives
       FROM matched m
      WHERE ${FILTER_SQL[o.filter]}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $4 OFFSET $5`,
    [like, badge, o.now.toISOString(), Math.max(1, Math.min(100, o.limit)), Math.max(0, o.offset)],
  );
  const c = counts.rows[0] ?? {};
  const all = { all: n(c.all_families), check: n(c.check_families), week: n(c.week_families), removed: n(c.removed_families) };
  return {
    rows: rows.rows.map((r) => ({ id: r.id, grownUpName: r.grown_up_name, email: r.email, enrolledAt: r.created_at, removed: r.removed, detectives: r.detectives ?? [] })),
    total: all[o.filter],
    counts: all,
  };
}

type Querier = Pick<PoolClient, "query">;

async function readSheet(q: Querier, id: number): Promise<FamilySheetRow | null> {
  const f = await q.query<{ id: number; grown_up_name: string; email: string; newsletter: boolean; created_at: Date; removed_at: Date | null; removed_by: string | null }>(
    "SELECT id, grown_up_name, email, newsletter, created_at, removed_at, removed_by FROM elf_families WHERE id = $1 AND active",
    [id],
  );
  const fam = f.rows[0];
  if (!fam) return null;
  const d = await q.query<{ id: number; first_name: string; surname: string; badge_number: number | null; name_approved: boolean; look: unknown }>(
    "SELECT id, first_name, surname, badge_number, name_approved, look FROM elf_detectives WHERE family_id = $1 AND active ORDER BY id",
    [id],
  );
  const p = await q.query<{ reference: string; status: string; paid_at: Date | null; entry_pence: number; donation_pence: number; gift_aid: boolean }>(
    "SELECT reference, status, paid_at, entry_pence, donation_pence, gift_aid FROM elf_orders WHERE family_id = $1 ORDER BY created_at DESC, id DESC",
    [id],
  );
  return {
    id: fam.id,
    grownUpName: fam.grown_up_name,
    email: fam.email,
    newsletter: fam.newsletter,
    enrolledAt: fam.created_at,
    removedAt: fam.removed_at,
    removedBy: fam.removed_by,
    detectives: d.rows.map((x) => ({ id: x.id, firstName: x.first_name, surname: x.surname, badgeNumber: x.badge_number, approved: x.name_approved, look: x.look })),
    payments: p.rows.map((x) => ({ reference: x.reference, status: x.status, paidAt: x.paid_at, entryPence: x.entry_pence, giftPence: x.donation_pence, giftAid: x.gift_aid })),
  };
}

/** A family's sheet: its details, its detectives and every payment it started. */
export async function elfFamilySheet(id: number): Promise<FamilySheetRow | null> {
  return readSheet(pool, id);
}

/** Thrown inside an audited write when there is nothing to change, so the transaction rolls back. */
class NotThere extends Error {}

/** writeWithAudit, answering null when the write finds nothing to change. */
async function audited<T>(write: (client: PoolClient) => Promise<T>, audit: (result: T) => AuditInput): Promise<T | null> {
  try {
    return await writeWithAudit(write, audit);
  } catch (err) {
    if (err instanceof NotThere) return null;
    throw err;
  }
}

/** Changes a detective's names or their tick, as the head elf `actor`. Null when there is no such
 *  active detective in an active family. */
export async function changeElfDetective(id: number, change: DetectiveChange, actor: string): Promise<DetectiveRow | null> {
  type Before = { first_name: string; surname: string; name_approved: boolean };
  let before: Before | null = null;
  return audited(
    async (client) => {
      const was = await client.query<Before>(
        `SELECT d.first_name, d.surname, d.name_approved FROM elf_detectives d JOIN elf_families f ON f.id = d.family_id
          WHERE d.id = $1 AND d.active AND f.active FOR UPDATE OF d`,
        [id],
      );
      before = was.rows[0] ?? null;
      if (!before) throw new NotThere();
      const r = await client.query<{ id: number; family_id: number; first_name: string; surname: string; badge_number: number | null; name_approved: boolean; look: unknown }>(
        `UPDATE elf_detectives SET first_name = COALESCE($2, first_name), surname = COALESCE($3, surname), name_approved = COALESCE($4, name_approved)
          WHERE id = $1
         RETURNING id, family_id, first_name, surname, badge_number, name_approved, look`,
        [id, change.firstName ?? null, change.surname ?? null, change.approved ?? null],
      );
      const d = r.rows[0];
      return { id: d.id, familyId: d.family_id, firstName: d.first_name, surname: d.surname, badgeNumber: d.badge_number, approved: d.name_approved, look: d.look };
    },
    (d) => ({
      actor,
      action: "elf.detective.changed",
      entity: "elf_detective",
      entityId: d.id,
      data: {
        familyId: d.familyId,
        before: before && { firstName: before.first_name, surname: before.surname, approved: before.name_approved },
        after: { firstName: d.firstName, surname: d.surname, approved: d.approved },
      },
    }),
  );
}

const isUniqueClash = (err: unknown): boolean => typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";

/** Changes a family's grown up name or email, as the head elf `actor`. A new email ends the family's
 *  sessions and any code sent to the old one. "email-taken" when another family has that email. */
export async function changeElfFamily(id: number, change: FamilyChange, actor: string): Promise<FamilySheetRow | "email-taken" | null> {
  type Before = { grown_up_name: string; email: string };
  let before: Before | null = null;
  try {
    const done = await audited(
      async (client) => {
        const was = await client.query<Before>("SELECT grown_up_name, email FROM elf_families WHERE id = $1 AND active FOR UPDATE", [id]);
        before = was.rows[0] ?? null;
        if (!before) throw new NotThere();
        await client.query("UPDATE elf_families SET grown_up_name = COALESCE($2, grown_up_name), email = COALESCE($3, email) WHERE id = $1", [id, change.grownUpName ?? null, change.email ?? null]);
        if (change.email && change.email !== before.email) {
          await client.query("DELETE FROM elf_sessions WHERE family_id = $1", [id]);
          await client.query("DELETE FROM elf_sign_in_codes WHERE email = $1", [before.email]);
        }
        return (await readSheet(client, id)) as FamilySheetRow;
      },
      (f) => ({
        actor,
        action: "elf.family.changed",
        entity: "elf_family",
        entityId: f.id,
        data: { before: before && { grownUpName: before.grown_up_name, email: before.email }, after: { grownUpName: f.grownUpName, email: f.email } },
      }),
    );
    return done;
  } catch (err) {
    if (isUniqueClash(err)) return "email-taken";
    throw err;
  }
}

/** Marks a family removed, as the head elf `actor`: it cannot sign in, its sessions and codes end, and
 *  it leaves the counts and the money. Removing a family already removed changes nothing. */
export async function removeElfFamily(id: number, actor: string): Promise<FamilySheetRow | null> {
  return audited(
    async (client) => {
      const f = await client.query<{ email: string; removed_at: Date | null }>("SELECT email, removed_at FROM elf_families WHERE id = $1 AND active FOR UPDATE", [id]);
      if (!f.rows[0]) throw new NotThere();
      if (!f.rows[0].removed_at) await client.query("UPDATE elf_families SET removed_at = now(), removed_by = $2 WHERE id = $1", [id, actor]);
      await client.query("DELETE FROM elf_sessions WHERE family_id = $1", [id]);
      await client.query("DELETE FROM elf_sign_in_codes WHERE email = $1", [f.rows[0].email]);
      return (await readSheet(client, id)) as FamilySheetRow;
    },
    (f) => ({ actor, action: "elf.family.removed", entity: "elf_family", entityId: f.id, data: { grownUpName: f.grownUpName } }),
  );
}

/** Puts a removed family back, as the head elf `actor`. */
export async function restoreElfFamily(id: number, actor: string): Promise<FamilySheetRow | null> {
  return audited(
    async (client) => {
      const f = await client.query("UPDATE elf_families SET removed_at = NULL, removed_by = NULL WHERE id = $1 AND active RETURNING id", [id]);
      if (!f.rows[0]) throw new NotThere();
      return (await readSheet(client, id)) as FamilySheetRow;
    },
    (f) => ({ actor, action: "elf.family.restored", entity: "elf_family", entityId: f.id, data: { grownUpName: f.grownUpName } }),
  );
}

/** Notes in the audit log that a head elf sent a family a sign in code. */
export async function noteSignInCodeSent(familyId: number, actor: string): Promise<void> {
  await recordAudit({ actor, action: "elf.sign_in_code.sent", entity: "elf_family", entityId: familyId });
}
