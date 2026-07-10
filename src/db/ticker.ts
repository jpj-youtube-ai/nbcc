// TASK-178 (REQ-003): read + write layer for supporter_ticker. Public reads (active names for the
// ticker) use the pool directly; admin writes run inside a transaction that also appends an audit_log
// row, so the change and its audit commit together. Pure validation lives in src/ticker/model.ts.
import { pool } from "./pool";
import { insertAudit } from "./donations";
import type { SupporterCreate, SupporterUpdate } from "../ticker/model";

export interface Supporter {
  id: number;
  name: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

interface SupporterRow {
  id: number;
  name: string;
  active: boolean;
  sort_order: number;
  created_at: string;
}

const mapRow = (r: SupporterRow): Supporter => ({
  id: r.id,
  name: r.name,
  active: r.active,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
});

// Public: the active supporter NAMES for the ticker, in display order (sort_order, then id).
export async function listActiveSupporterNames(): Promise<string[]> {
  const res = await pool.query<{ name: string }>(
    `SELECT name FROM supporter_ticker WHERE active = true ORDER BY sort_order ASC, id ASC`,
  );
  return res.rows.map((r) => r.name);
}

// Admin: every supporter (active and hidden), display order first.
export async function listSupporters(): Promise<Supporter[]> {
  const res = await pool.query<SupporterRow>(
    `SELECT id, name, active, sort_order, created_at FROM supporter_ticker ORDER BY sort_order ASC, id ASC`,
  );
  return res.rows.map(mapRow);
}

// Add a supporter (audited). Returns the new id.
export async function createSupporter(input: SupporterCreate, actor: string): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<{ id: number }>(
      `INSERT INTO supporter_ticker (name, active, sort_order)
       VALUES ($1, COALESCE($2, true), COALESCE($3, 0)) RETURNING id`,
      [input.name, input.active ?? null, input.sortOrder ?? null],
    );
    const id = res.rows[0].id;
    await insertAudit(client, {
      actor,
      action: "supporter.created",
      entity: "supporter_ticker",
      entityId: id,
      data: { name: input.name },
    });
    await client.query("COMMIT");
    return id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Update a supporter's name/active/sortOrder (audited). Returns whether a row was changed.
export async function updateSupporter(id: number, patch: SupporterUpdate, actor: string): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.name !== undefined) { sets.push(`name = $${i++}`); vals.push(patch.name); }
  if (patch.active !== undefined) { sets.push(`active = $${i++}`); vals.push(patch.active); }
  if (patch.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); vals.push(patch.sortOrder); }
  if (sets.length === 0) return false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<{ id: number }>(
      `UPDATE supporter_ticker SET ${sets.join(", ")} WHERE id = $${i} RETURNING id`,
      [...vals, id],
    );
    if (res.rows.length === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    await insertAudit(client, {
      actor,
      action: "supporter.updated",
      entity: "supporter_ticker",
      entityId: id,
      data: { ...patch },
    });
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Remove a supporter (audited). Returns whether a row was deleted.
export async function deleteSupporter(id: number, actor: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<{ id: number }>(
      `DELETE FROM supporter_ticker WHERE id = $1 RETURNING id`,
      [id],
    );
    if (res.rows.length === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    await insertAudit(client, {
      actor,
      action: "supporter.deleted",
      entity: "supporter_ticker",
      entityId: id,
      data: { supporterId: id },
    });
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
