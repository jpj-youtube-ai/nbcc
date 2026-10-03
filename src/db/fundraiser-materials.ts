import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { TRACKED_PIECES, TRACKED, scanCampaign } from "../fundraising/material-codes";
import { applyPrintAsk, type LastAsk, type PrintAsk, type PrintKind } from "../fundraising/print-requests";
import { stateOf, type RequestRow } from "../fundraising/requests";

// TASK-512: the SQL behind round two of the materials. The rules are pure, in
// src/fundraising/material-codes.ts and src/fundraising/print-requests.ts.
//
//   materialScans     a fundraiser's QR code scans per printed piece. Nothing new is stored: the
//                     site's visit counter (analytics_views, TASK-479) already records a visit that
//                     arrives with utm_medium=qr as channel 'qr', with its utm_campaign, and every
//                     piece's short link adds its own (f12-a4). Counted once per person per day, as
//                     Analytics counts visitors. Kept as long as Analytics keeps anything (13 months).
//   askToPrint        an organiser's "Ask us to print these": their posters or leaflets request
//                     (fundraiser_requests, TASK-505) and how many they want (fundraisers.wants),
//                     in one transaction with its audit_log row, so it shows in the fundraiser's
//                     History. The fundraiser's row is locked first, as changeRequest does, so an
//                     ask and a staff change at once take turns.

export class PrintAskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintAskError";
  }
}

/** One fundraiser's scans by tag. */
export async function materialScans(fundraiserId: number): Promise<{ campaign: string; scans: number }[]> {
  const tags = TRACKED_PIECES.map((p) => scanCampaign(fundraiserId, TRACKED[p]));
  const r = await pool.query<{ campaign: string; scans: number }>(
    `SELECT campaign, count(DISTINCT visitor || '@' || day::text)::int AS scans
       FROM analytics_views
      WHERE channel = 'qr' AND campaign = ANY($1::text[])
      GROUP BY campaign`,
    [tags],
  );
  return r.rows.map((row) => ({ campaign: row.campaign, scans: Number(row.scans) }));
}

/**
 * Fundraisers' titles by id, to name their pieces' scans in Admin > Analytics. Only those that have
 * materials (approved or finished): anyone with Analytics could add a tag to an address, so a sign up
 * that is new or declined is never named there (it shows as "Fundraiser 12").
 */
export async function fundraiserTitles(ids: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const r = await pool.query<{ id: number; title: string }>("SELECT id, title FROM fundraisers WHERE id = ANY($1::int[]) AND status IN ('approved', 'finished')", [unique]);
  return new Map(r.rows.map((row) => [Number(row.id), String(row.title)]));
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

const text = (v: unknown): string | null => (v == null ? null : String(v));

/**
 * The organiser's ask, made the posters or leaflets request. Throws PrintAskError, writing nothing,
 * when the fundraiser is gone or past asking. `actor` is "organiser", as for every organiser action.
 */
export async function askToPrint(fundraiserId: number, ask: PrintAsk, actor: string, today: string): Promise<{ words: string }> {
  return inTransaction(async (client) => {
    const found = await client.query(
      `SELECT id, status, to_char(event_date, 'YYYY-MM-DD') AS event_date, wants, post_line1, post_address
         FROM fundraisers WHERE id = $1 FOR UPDATE`,
      [fundraiserId],
    );
    const f = found.rows[0];
    if (!f) throw new PrintAskError("We could not find that fundraiser.");
    const cur = await client.query(
      `SELECT fundraiser_id, kind, status, quantity, quantity_back, how,
              to_char(sent_on, 'YYYY-MM-DD') AS sent_on, to_char(back_on, 'YYYY-MM-DD') AS back_on,
              to_char(done_on, 'YYYY-MM-DD') AS done_on, handled_by, going, note, back_note, link, updated_at, updated_by
         FROM fundraiser_requests WHERE fundraiser_id = $1 AND kind = $2 FOR UPDATE`,
      [fundraiserId, ask.kind],
    );
    const c = cur.rows[0];
    const current: RequestRow | null = c
      ? {
          fundraiserId,
          kind: ask.kind,
          status: c.status,
          quantity: c.quantity == null ? null : Number(c.quantity),
          quantityBack: c.quantity_back == null ? null : Number(c.quantity_back),
          how: c.how ?? null,
          sentOn: text(c.sent_on),
          backOn: text(c.back_on),
          doneOn: text(c.done_on),
          handledBy: text(c.handled_by),
          going: text(c.going),
          note: text(c.note),
          backNote: text(c.back_note),
          link: text(c.link),
          updatedAt: null,
          updatedBy: text(c.updated_by),
        }
      : null;
    const hasAddress = !!(text(f.post_line1)?.trim() || text(f.post_address)?.trim());
    const result = applyPrintAsk({ status: f.status, eventDate: text(f.event_date), hasAddress }, current, ask, today);
    if (!result.ok) throw new PrintAskError(result.message);
    await client.query(
      `UPDATE fundraisers SET wants = jsonb_set(COALESCE(wants, '{}'::jsonb), $2::text[], to_jsonb($3::int)), updated_at = now() WHERE id = $1`,
      [fundraiserId, [result.wantsKey], result.total],
    );
    const s = result.state;
    await client.query(
      `INSERT INTO fundraiser_requests
         (fundraiser_id, kind, status, quantity, quantity_back, how, sent_on, back_on, done_on, handled_by, going,
          note, back_note, link, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (fundraiser_id, kind) DO UPDATE SET
         status = EXCLUDED.status, quantity = EXCLUDED.quantity, quantity_back = EXCLUDED.quantity_back,
         how = EXCLUDED.how, sent_on = EXCLUDED.sent_on, back_on = EXCLUDED.back_on, done_on = EXCLUDED.done_on,
         handled_by = EXCLUDED.handled_by, going = EXCLUDED.going, note = EXCLUDED.note,
         back_note = EXCLUDED.back_note, link = EXCLUDED.link, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [fundraiserId, ask.kind, s.status, s.quantity, s.quantityBack, s.how, s.sentOn, s.backOn, s.doneOn, s.handledBy, s.going, s.note, s.backNote, s.link, actor],
    );
    const asked = result.words.replace(/^.*?they asked us to print /, "");
    await insertAudit(client, {
      actor,
      action: "fundraiser.print_requested",
      entity: "fundraiser",
      entityId: fundraiserId,
      // As Undo does (changeRequest): the request as it stood before, so a re-opened ask never loses
      // what was sent.
      data: { ...ask, asked, total: result.total, words: result.words, before: current ? stateOf(current) : null },
    });
    return { words: result.words };
  });
}

/** Each kind's last ask, newest first, for the organiser's own view. */
export async function lastPrintAsks(fundraiserId: number): Promise<LastAsk[]> {
  const r = await pool.query<{ kind: string; asked: string; asked_on: string }>(
    `SELECT DISTINCT ON (data->>'kind') data->>'kind' AS kind, data->>'asked' AS asked,
            to_char(created_at AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS asked_on
       FROM audit_log
      WHERE entity = 'fundraiser' AND entity_id = $1 AND action = 'fundraiser.print_requested'
      ORDER BY data->>'kind', id DESC`,
    [fundraiserId],
  );
  return r.rows
    .filter((row) => (row.kind === "posters" || row.kind === "leaflets") && row.asked)
    .map((row) => ({ kind: row.kind as PrintKind, words: row.asked, on: row.asked_on }));
}
