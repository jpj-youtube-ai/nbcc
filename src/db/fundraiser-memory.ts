import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { memoryTitle } from "../fundraising/in-memory";

// In memory pages (Jaimie, 2026-10-03): the SQL for staff's part. The rules are in
// src/fundraising/in-memory.ts; the routes in src/routes/fundraise-memory.ts. Every write records who
// did it in audit_log, in the same transaction, against the fundraiser, so it shows in its History.
//
//   approveMemoryMessage   on an in memory page every message waits for staff; approving one puts
//                          it on the page (and back on, if it had been hidden)
//   heldMessageCounts      how many messages wait on each in memory page, for the admin's pills
//   countHeldMessages      the same, added up, for the Monday summary
//   markMemoryYearOnDone   a year on, staff decide whether to get in touch; this marks it dealt with

export type MemoryErrorReason = "not_found";

export class MemoryError extends Error {
  constructor(public readonly reason: MemoryErrorReason) {
    super(`fundraiser memory: ${reason}`);
    this.name = "MemoryError";
  }
}

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
 * Staff approve a giver's message on an in memory page: it shows on the page from now on. Only a
 * gift on THIS fundraiser, with a message; anything else reads as not there.
 */
export async function approveMemoryMessage(fundraiserId: number, donationId: number, actor: string): Promise<void> {
  await inTransaction(async (client) => {
    const r = await client.query(
      `UPDATE donations SET message_approved_at = now(), message_approved_by = $1, message_hidden = false
        WHERE id = $2 AND fundraiser_id = $3 AND supporter_message IS NOT NULL
          AND fundraiser_id IN (SELECT id FROM fundraisers WHERE in_memory)
        RETURNING id`,
      [actor, donationId, fundraiserId],
    );
    if (!r.rows[0]) throw new MemoryError("not_found");
    await insertAudit(client, {
      actor,
      action: "fundraiser.message_approved",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { donationId },
    });
  });
}

// A message still to check: on an in memory page, paid, with words in it, never approved and not
// hidden by staff (hiding one is how staff say no).
const HELD = `FROM donations d JOIN fundraisers f ON f.id = d.fundraiser_id
  WHERE f.in_memory AND d.payment_status = 'paid' AND d.supporter_message IS NOT NULL AND btrim(d.supporter_message) <> ''
    AND d.message_approved_at IS NULL AND NOT d.message_hidden`;

/** Fundraiser id -> how many messages wait for staff on it. Only in memory pages, only those with some. */
export async function heldMessageCounts(): Promise<Record<number, number>> {
  const r = await pool.query(`SELECT d.fundraiser_id, count(*) AS n ${HELD} GROUP BY d.fundraiser_id`);
  const out: Record<number, number> = {};
  for (const row of r.rows) out[Number(row.fundraiser_id)] = Number(row.n);
  return out;
}

/** Every message waiting for staff on an in memory page, for the Monday summary. */
export async function countHeldMessages(): Promise<number> {
  const r = await pool.query(`SELECT count(*) AS n ${HELD}`);
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * A year on, staff have decided whether to get in touch (and perhaps have): the reminder goes. Only
 * on an in memory page, and only once. An optional note for the History.
 */
export async function markMemoryYearOnDone(fundraiserId: number, actor: string, note: string): Promise<void> {
  await inTransaction(async (client) => {
    const r = await client.query(
      `UPDATE fundraisers SET memory_reminder_done_at = now(), memory_reminder_done_by = $1
        WHERE id = $2 AND in_memory AND memory_reminder_done_at IS NULL
        RETURNING id`,
      [actor, fundraiserId],
    );
    if (!r.rows[0]) throw new MemoryError("not_found");
    await insertAudit(client, {
      actor,
      action: "fundraiser.memory_year_on_done",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { note },
    });
  });
}

/**
 * An admin corrects who an in memory page remembers, their dates, who set it up, or the target
 * choice, under the row's lock, with what it was and is now in the audit (the sign up's History).
 * The permission is never changed. Only on an in memory page.
 */
export async function setFundraiserMemory(
  fundraiserId: number,
  edit: { memoryName: string; memoryDates: string | null; memorySetupBy: string; memoryShowTarget: boolean | null },
  actor: string,
): Promise<void> {
  await inTransaction(async (client) => {
    const r = await client.query(
      `SELECT memory_name, memory_dates, memory_setup_by, memory_show_target, in_memory, title FROM fundraisers WHERE id = $1 FOR UPDATE`,
      [fundraiserId],
    );
    const before = r.rows[0];
    if (!before || before.in_memory !== true) throw new MemoryError("not_found");
    await client.query(
      `UPDATE fundraisers SET memory_name = $1, memory_dates = $2, memory_setup_by = $3, memory_show_target = $4,
              updated_at = now(), updated_by = $5
        WHERE id = $6`,
      [edit.memoryName, edit.memoryDates, edit.memorySetupBy, edit.memoryShowTarget, actor, fundraiserId],
    );
    // Review fix: a page still called "In memory of <old name>" (as the sign up names it) follows the
    // corrected name. One the family named themselves keeps its name.
    let title: { was: string; now: string } | null = null;
    const oldTitle = before.memory_name ? memoryTitle(String(before.memory_name)) : null;
    const newTitle = memoryTitle(edit.memoryName);
    if (oldTitle && before.title === oldTitle && newTitle !== oldTitle) {
      await client.query("UPDATE fundraisers SET title = $1 WHERE id = $2", [newTitle, fundraiserId]);
      title = { was: oldTitle, now: newTitle };
    }
    await insertAudit(client, {
      actor,
      action: "fundraiser.memory_changed",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: {
        was: {
          memoryName: before.memory_name ?? null,
          memoryDates: before.memory_dates ?? null,
          memorySetupBy: before.memory_setup_by ?? null,
          memoryShowTarget: before.memory_show_target ?? null,
        },
        now: edit,
        ...(title ? { title } : {}),
      },
    });
  });
}
