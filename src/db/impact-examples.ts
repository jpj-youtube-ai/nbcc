import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { sortExamples, type ImpactExample, type MeterLineKey } from "../impact/examples";

// What gifts could do: the impact_examples table (migrations/1791200000200), and the list as last
// read. Generic on purpose: fundraiser, event and team pages read it now (loadImpactExamples), and a
// Fill a Red Bag page will later.
//
// The pages use the list as last read, kept for a minute (IMPACT_CACHE_MS). A change made here is
// read again at once on this server; another server sees it within the minute. Every change writes
// its audit_log row in the same transaction, against entity "impact_example" and the example's id.

export const IMPACT_CACHE_MS = 60_000;

/** not_found: not there any more. fixed: the meter line counts with it, so its amount and words stay. */
export class ImpactExampleError extends Error {
  constructor(public readonly reason: "not_found" | "fixed") {
    super(reason);
  }
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const text = (v: unknown): string | null => (v == null ? null : String(v));

function toExample(r: Row): ImpactExample {
  return {
    id: Number(r.id),
    amountPence: Number(r.amount_pence),
    wording: String(r.wording),
    active: Boolean(r.active),
    sortOrder: Number(r.sort_order) || 0,
    onGiveForm: Boolean(r.on_give_form),
    meterLine: (text(r.meter_line) as MeterLineKey | null) ?? null,
    createdAt: iso(r.created_at),
    createdBy: text(r.created_by),
    updatedAt: iso(r.updated_at),
    updatedBy: text(r.updated_by),
  };
}

const COLUMNS = "id, amount_pence, wording, active, sort_order, on_give_form, meter_line, created_at, created_by, updated_at, updated_by";

/** Every example, on or off, in the list's order. */
export async function listImpactExamples(): Promise<ImpactExample[]> {
  const r = await pool.query(`SELECT ${COLUMNS} FROM impact_examples`);
  return sortExamples(r.rows.map(toExample));
}

let readAt = 0;
let cached: ImpactExample[] | null = null;

/** Forget the list as last read, so the next loadImpactExamples reads it again. */
export function forgetImpactExamples(): void {
  readAt = 0;
  cached = null;
}

/**
 * The list, as read in the last minute, or read now (fresh: always read now). Never throws: if the
 * database cannot answer, the list last read stands, or none at all before any has been (a page
 * then simply shows no examples).
 */
export async function loadImpactExamples(o: { fresh?: boolean; now?: number } = {}): Promise<ImpactExample[]> {
  const now = o.now ?? Date.now();
  if (!o.fresh && cached && now - readAt < IMPACT_CACHE_MS) return cached;
  try {
    const list = await listImpactExamples();
    cached = list;
    readAt = now;
    return list;
  } catch (err) {
    console.error("impact examples read failed:", err instanceof Error ? err.message : err);
    return cached ?? [];
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
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** After a change here: this server reads the list again now, so the pages show it at once. */
async function rereadAfterChange(): Promise<void> {
  forgetImpactExamples();
  await loadImpactExamples({ fresh: true });
}

export interface NewImpactExample {
  amountPence: number;
  wording: string;
  onGiveForm: boolean;
}

/** Add an example, switched on, at the end of the list. */
export async function addImpactExample(e: NewImpactExample, actor: string): Promise<ImpactExample> {
  const added = await inTransaction(async (client) => {
    const next = await client.query<{ next: number }>("SELECT COALESCE(max(sort_order), 0) + 10 AS next FROM impact_examples");
    const sortOrder = Number(next.rows[0]?.next) || 10;
    const r = await client.query(
      `INSERT INTO impact_examples (amount_pence, wording, active, on_give_form, sort_order, created_by, updated_by)
       VALUES ($1, $2, true, $3, $4, $5, $5)
       RETURNING ${COLUMNS}`,
      [e.amountPence, e.wording, e.onGiveForm, sortOrder, actor],
    );
    const example = toExample(r.rows[0]);
    await insertAudit(client, {
      actor,
      action: "impact.example_added",
      entity: "impact_example",
      entityId: example.id,
      data: { amountPence: e.amountPence, wording: e.wording, onGiveForm: e.onGiveForm },
    });
    return example;
  });
  await rereadAfterChange();
  return added;
}

export interface ImpactExampleChange {
  amountPence?: number;
  wording?: string;
  active?: boolean;
  onGiveForm?: boolean;
}

/**
 * Change an example's amount or words, switch it off or on, or choose whether the give form shows it.
 * One the meter line counts with (meter_line) keeps its amount and words: only on and off.
 */
export async function updateImpactExample(id: number, change: ImpactExampleChange, actor: string): Promise<ImpactExample> {
  const after = await inTransaction(async (client) => {
    const found = await client.query(`SELECT ${COLUMNS} FROM impact_examples WHERE id = $1 FOR UPDATE`, [id]);
    if (!found.rows[0]) throw new ImpactExampleError("not_found");
    const before = toExample(found.rows[0]);
    // The line under the meter counts with these two, in fixed words: only on and off for them.
    const changesWords =
      (change.amountPence !== undefined && change.amountPence !== before.amountPence) ||
      (change.wording !== undefined && change.wording !== before.wording);
    if (before.meterLine && changesWords) throw new ImpactExampleError("fixed");
    const next = {
      amountPence: change.amountPence ?? before.amountPence,
      wording: change.wording ?? before.wording,
      active: change.active ?? before.active,
      onGiveForm: change.onGiveForm ?? before.onGiveForm,
    };
    const r = await client.query(
      `UPDATE impact_examples
          SET amount_pence = $2, wording = $3, active = $4, on_give_form = $5, updated_at = now(), updated_by = $6
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      [id, next.amountPence, next.wording, next.active, next.onGiveForm, actor],
    );
    await insertAudit(client, {
      actor,
      action: "impact.example_changed",
      entity: "impact_example",
      entityId: id,
      data: {
        ...next,
        was: { amountPence: before.amountPence, wording: before.wording, active: before.active, onGiveForm: before.onGiveForm },
      },
    });
    return toExample(r.rows[0]);
  });
  await rereadAfterChange();
  return after;
}

/**
 * Move an example one place up or down the list, past any switched the other way (the card lists
 * the ones switched off apart). At the end already, nothing changes.
 */
export async function moveImpactExample(id: number, direction: "up" | "down", actor: string): Promise<void> {
  const moved = await inTransaction(async (client) => {
    const r = await client.query<{ id: number; active?: boolean }>("SELECT id, active FROM impact_examples ORDER BY sort_order, id FOR UPDATE");
    const ids = r.rows.map((x) => Number(x.id));
    const at = ids.indexOf(id);
    if (at < 0) throw new ImpactExampleError("not_found");
    const step = direction === "up" ? -1 : 1;
    let to = at + step;
    while (to >= 0 && to < ids.length && Boolean(r.rows[to].active) !== Boolean(r.rows[at].active)) to += step;
    if (to < 0 || to >= ids.length) return false;
    [ids[at], ids[to]] = [ids[to], ids[at]];
    // Numbered afresh in tens, so two never share a place.
    for (let i = 0; i < ids.length; i++) {
      await client.query("UPDATE impact_examples SET sort_order = $2 WHERE id = $1", [ids[i], (i + 1) * 10]);
    }
    await insertAudit(client, { actor, action: "impact.example_moved", entity: "impact_example", entityId: id, data: { direction } });
    return true;
  });
  if (moved) await rereadAfterChange();
}
