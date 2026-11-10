import { pool } from "./pool";
import { writeWithAudit } from "./donations";

// TASK-588: the named QR codes (src/site/qr-named.ts) and their scans, one number per code per UK
// day. A code is never deleted, because its id is printed on it for good (/q/c<id>): staff hide one
// they have finished with, and it still forwards. Every change staff make is in the audit log.

export interface QrCodeRecord {
  id: number;
  name: string;
  target: string;
  hidden: boolean;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface ScanDay {
  codeId: number;
  day: string;
  scans: number;
}

const COLUMNS = `id, name, target, hidden, created_at, updated_by, updated_at`;

function toRecord(r: Record<string, unknown>): QrCodeRecord {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
  return {
    id: Number(r.id),
    name: String(r.name),
    target: String(r.target),
    hidden: r.hidden === true,
    createdAt: iso(r.created_at),
    updatedBy: String(r.updated_by),
    updatedAt: iso(r.updated_at),
  };
}

/** Every named code, newest first. */
export async function listQrCodes(): Promise<QrCodeRecord[]> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM qr_codes ORDER BY id DESC`);
  return rows.map(toRecord);
}

/** Every code's scans, by day. Small: one row per code per day it was scanned. */
export async function listScanDays(): Promise<ScanDay[]> {
  const { rows } = await pool.query(`SELECT code_id, to_char(day, 'YYYY-MM-DD') AS day, scans FROM qr_code_scans`);
  return rows.map((r) => ({ codeId: Number(r.code_id), day: String(r.day), scans: Number(r.scans) }));
}

/**
 * The oldest code with this exact name (and, when given, going to this target), or null. For codes the
 * site makes for itself by name, such as the Santa Sleigh's (src/db/sleigh.ts), found again each time.
 */
export async function findQrCodeByName(name: string, target?: string): Promise<QrCodeRecord | null> {
  const { rows } =
    target === undefined
      ? await pool.query(`SELECT ${COLUMNS} FROM qr_codes WHERE name = $1 ORDER BY id ASC LIMIT 1`, [name])
      : await pool.query(`SELECT ${COLUMNS} FROM qr_codes WHERE name = $1 AND target = $2 ORDER BY id ASC LIMIT 1`, [name, target]);
  return rows[0] ? toRecord(rows[0]) : null;
}

/** The one read a scan makes: where code `id` goes now, or null when there is no such code. */
export async function qrCodeTarget(id: number): Promise<string | null> {
  const { rows } = await pool.query(`SELECT target FROM qr_codes WHERE id = $1`, [id]);
  return rows[0] ? String(rows[0].target) : null;
}

/** Add one to code `id`'s count for the UK day `day`. A code that is not there counts nothing. */
export async function countScan(id: number, day: string): Promise<void> {
  await pool.query(
    `INSERT INTO qr_code_scans (code_id, day, scans)
     SELECT id, $2::date, 1 FROM qr_codes WHERE id = $1
     ON CONFLICT (code_id, day) DO UPDATE SET scans = qr_code_scans.scans + 1`,
    [id, day],
  );
}

/** Make a code. `name` and `target` are already checked (cleanName, isDestination). */
export async function createQrCode(name: string, target: string, actor: string): Promise<QrCodeRecord> {
  return writeWithAudit(
    async (client) => {
      const { rows } = await client.query(
        `INSERT INTO qr_codes (name, target, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING ${COLUMNS}`,
        [name, target, actor],
      );
      return toRecord(rows[0]);
    },
    (code) => ({ actor, action: "qr_code.created", entity: "qr_code", entityId: code.id, data: { name, target } }),
  );
}

export interface QrCodeChange {
  name?: string;
  target?: string;
  hidden?: boolean;
}

// Thrown inside the transaction when the code is not there, so nothing is written, not even an audit row.
class NoSuchCode extends Error {}

/** Rename a code, change where it goes, or hide or show it. Null when there is no such code. */
export async function updateQrCode(id: number, change: QrCodeChange, actor: string): Promise<QrCodeRecord | null> {
  try {
    const r = await writeWithAudit(
      async (client) => {
        const before = await client.query(`SELECT ${COLUMNS} FROM qr_codes WHERE id = $1 FOR UPDATE`, [id]);
        if (!before.rows[0]) throw new NoSuchCode();
        const { rows } = await client.query(
          `UPDATE qr_codes
              SET name = COALESCE($2, name), target = COALESCE($3, target), hidden = COALESCE($4, hidden),
                  updated_by = $5, updated_at = now()
            WHERE id = $1
        RETURNING ${COLUMNS}`,
          [id, change.name ?? null, change.target ?? null, change.hidden ?? null, actor],
        );
        return { before: toRecord(before.rows[0]), after: toRecord(rows[0]) };
      },
      (r) => ({
        actor,
        action: "qr_code.updated",
        entity: "qr_code",
        entityId: id,
        data: { before: { name: r.before.name, target: r.before.target, hidden: r.before.hidden }, change },
      }),
    );
    return r.after;
  } catch (err) {
    if (err instanceof NoSuchCode) return null;
    throw err;
  }
}

/** The names of the codes with these ids, for Admin > Analytics' QR codes list. */
export async function qrCodeNames(ids: readonly number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const { rows } = await pool.query(`SELECT id, name FROM qr_codes WHERE id = ANY($1::int[])`, [ids]);
  return new Map(rows.map((r) => [Number(r.id), String(r.name)]));
}
