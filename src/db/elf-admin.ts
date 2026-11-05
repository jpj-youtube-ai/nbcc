import { pool } from "./pool";
import type { HqNumbers } from "../elf/admin-hq";

// NBCC Elf Detective School: what Head Elf HQ reads from the database, and the changes a head elf makes
// (docs/superpowers/specs/2026-11-05-elf-admin-design.md). Only families that are active (they paid)
// and have not been removed count anywhere. The routes are src/routes/admin-elf.ts; the SQL is proved
// against a real database by features/elf-admin.feature in CI.

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
