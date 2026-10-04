import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import {
  applyRequestAction,
  parseWants,
  stateOf,
  type RequestActionInput,
  type RequestKind,
  type RequestRow,
  type RequestSubject,
} from "../fundraising/requests";

// TASK-505: the SQL behind the requests in Admin > Fundraising. The rules are pure, in
// src/fundraising/requests.ts; this file only moves rows. One row per fundraiser and kind, made the
// first time staff act on it. Every change writes its audit_log row against the fundraiser in the
// same transaction, so it shows in that fundraiser's History.

export class RequestError extends Error {
  constructor(
    public readonly reason: "not_found" | "not_asked" | "conflict" | "not_allowed" | "invalid",
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const text = (v: unknown): string | null => (v == null ? null : String(v));
const int = (v: unknown): number | null => (v == null ? null : Number(v));

// Dates as UK days, never through a Date, so a day is never moved by a time zone.
const COLUMNS = `fundraiser_id, kind, status, quantity, quantity_back, how,
       to_char(sent_on, 'YYYY-MM-DD') AS sent_on, to_char(back_on, 'YYYY-MM-DD') AS back_on,
       to_char(done_on, 'YYYY-MM-DD') AS done_on, handled_by, going, note, back_note, link,
       updated_at, updated_by`;

function toRow(r: Row): RequestRow {
  return {
    fundraiserId: Number(r.fundraiser_id),
    kind: r.kind as RequestRow["kind"],
    status: r.status as RequestRow["status"],
    quantity: int(r.quantity),
    quantityBack: int(r.quantity_back),
    how: (r.how as RequestRow["how"]) ?? null,
    sentOn: text(r.sent_on),
    backOn: text(r.back_on),
    doneOn: text(r.done_on),
    handledBy: text(r.handled_by),
    going: text(r.going),
    note: text(r.note),
    backNote: text(r.back_note),
    link: text(r.link),
    updatedAt: iso(r.updated_at),
    updatedBy: text(r.updated_by),
  };
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

/** Every request staff have acted on, for the list, the Monday summary and the totals. */
export async function listRequestRows(): Promise<RequestRow[]> {
  const r = await pool.query(`SELECT ${COLUMNS} FROM fundraiser_requests ORDER BY fundraiser_id, id`);
  return r.rows.map(toRow);
}

/** One fundraiser's requests (the organiser's private area reads only their own). */
export async function listRequestRowsFor(fundraiserId: number): Promise<RequestRow[]> {
  const r = await pool.query(`SELECT ${COLUMNS} FROM fundraiser_requests WHERE fundraiser_id = $1 ORDER BY id`, [fundraiserId]);
  return r.rows.map(toRow);
}

/**
 * Move one request on, change how many went, or Undo one step. The fundraiser's row is locked first,
 * so two changes at once (even to a request with no row yet) take turns, and the second finds the
 * step it saw has gone (a conflict) rather than making it twice. Throws RequestError, writing nothing.
 */
export async function changeRequest(
  fundraiserId: number,
  kind: RequestKind,
  input: RequestActionInput,
  actor: string,
  today: string,
): Promise<{ row: RequestRow; words: string }> {
  return inTransaction(async (client) => {
    const found = await client.query(
      `SELECT id, status, wants, social_ok, to_char(event_date, 'YYYY-MM-DD') AS event_date
         FROM fundraisers WHERE id = $1 FOR UPDATE`,
      [fundraiserId],
    );
    const f = found.rows[0];
    if (!f) throw new RequestError("not_found", "That fundraiser no longer exists");
    const subject: RequestSubject = {
      status: f.status as RequestSubject["status"],
      wants: parseWants(f.wants),
      socialOk: Boolean(f.social_ok),
      eventDate: text(f.event_date),
    };
    return changeRequestIn(client, fundraiserId, subject, kind, input, actor, today);
  });
}

/** Every request of one fundraiser, locked, inside a transaction that already holds the fundraiser's row. */
export async function lockRequestRows(client: PoolClient, fundraiserId: number): Promise<RequestRow[]> {
  const r = await client.query(`SELECT ${COLUMNS} FROM fundraiser_requests WHERE fundraiser_id = $1 ORDER BY id FOR UPDATE`, [fundraiserId]);
  return r.rows.map(toRow);
}

/**
 * The change itself, inside a transaction that already holds the fundraiser's row (changeRequest
 * above; and a welcome pack's tick, which marks the matching request with the same rules and the
 * same audit line: src/db/welcome-packs.ts). Throws RequestError, writing nothing. `updatedBy` is
 * who the row says changed it last: the actor, unless the pack made the change (it says so there, so
 * a later change by hand is told apart).
 */
export async function changeRequestIn(
  client: PoolClient,
  fundraiserId: number,
  subject: RequestSubject,
  kind: RequestKind,
  input: RequestActionInput,
  actor: string,
  today: string,
  updatedBy: string = actor,
): Promise<{ row: RequestRow; words: string }> {
  {
    const cur = await client.query(`SELECT ${COLUMNS} FROM fundraiser_requests WHERE fundraiser_id = $1 AND kind = $2 FOR UPDATE`, [
      fundraiserId,
      kind,
    ]);
    const current = cur.rows[0] ? toRow(cur.rows[0]) : null;
    const result = applyRequestAction(subject, kind, current, input, today);
    if (!result.ok) throw new RequestError(result.reason, result.message, result.field);
    const s = result.state;
    const written = await client.query(
      `INSERT INTO fundraiser_requests
         (fundraiser_id, kind, status, quantity, quantity_back, how, sent_on, back_on, done_on, handled_by, going,
          note, back_note, link, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (fundraiser_id, kind) DO UPDATE SET
         status = EXCLUDED.status, quantity = EXCLUDED.quantity, quantity_back = EXCLUDED.quantity_back,
         how = EXCLUDED.how, sent_on = EXCLUDED.sent_on, back_on = EXCLUDED.back_on, done_on = EXCLUDED.done_on,
         handled_by = EXCLUDED.handled_by, going = EXCLUDED.going, note = EXCLUDED.note,
         back_note = EXCLUDED.back_note, link = EXCLUDED.link, updated_at = now(), updated_by = EXCLUDED.updated_by
       RETURNING ${COLUMNS}`,
      [
        fundraiserId,
        kind,
        s.status,
        s.quantity,
        s.quantityBack,
        s.how,
        s.sentOn,
        s.backOn,
        s.doneOn,
        s.handledBy,
        s.going,
        s.note,
        s.backNote,
        s.link,
        updatedBy,
      ],
    );
    const { action, from, ...entered } = input;
    const data: Record<string, unknown> = { kind, action, from, to: s.status, words: result.words };
    if (action === "undo") {
      if (current) data.before = stateOf(current);
    } else {
      data.entered = entered;
    }
    await insertAudit(client, { actor, action: "fundraiser.request_updated", entity: "fundraiser", entityId: fundraiserId, data });
    return { row: toRow(written.rows[0]), words: result.words };
  }
}
