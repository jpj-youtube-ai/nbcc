import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { FUNDRAISER_SELECT, toRecord } from "./fundraisers";
import { RequestError, changeRequestIn, lockRequestRows } from "./fundraising-requests";
import { parseWants } from "../fundraising/requests";
import type { FundraiserRecord } from "../fundraising/model";
import {
  PACK_REQUEST_KIND,
  applyPackAction,
  packRequestSync,
  packSettled,
  packView,
  type PackPress,
  type PackSubject,
  type PackActionInput,
  type PackView,
  type PosterSizes,
  type Signer,
  type StoredItem,
  type StoredPack,
} from "../fundraising/welcome-pack";

// Welcome packs (Jaimie, 2026-10-03): the SQL behind the tick list in Admin > Fundraising. The rules
// are pure, in src/fundraising/welcome-pack.ts; this file only moves rows
// (migrations/1791200000230_welcome-packs.js). A pack has no row until staff first tick something,
// choose who signs its letter, or mark it sent; a thing in it has none until it is ticked or left
// out. Every change writes its audit_log row against the fundraiser in the same transaction, so it
// shows in that fundraiser's History.
//
// A tick also keeps Requests in step (Jaimie, WP3): in the same transaction, the request of the
// thing pressed (and only that one) is marked as it would be by hand, or opened again when the tick
// comes off, by the Requests' own rules and with their own audit line (changeRequestIn,
// src/db/fundraising-requests.ts). A row keeps marked_request once the pack has marked its request,
// and only such a request is ever opened again or has its count put right, so what staff did by
// hand in Requests is never overwritten.

export class PackError extends Error {
  constructor(
    public readonly reason: "not_found" | "no_pack" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "PackError";
  }
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const text = (v: unknown): string | null => (v == null ? null : String(v));
const whole = (v: unknown): number => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

const toItem = (r: Row): StoredItem => ({
  key: String(r.key),
  label: String(r.label),
  quantity: r.quantity == null ? null : Number(r.quantity),
  tickedAt: iso(r.ticked_at),
  tickedBy: text(r.ticked_by),
  skippedReason: text(r.skipped_reason),
  markedRequest: r.marked_request === true,
});

const toPack = (r: Row, items: StoredItem[]): StoredPack => ({
  sentAt: iso(r.sent_at),
  sentBy: text(r.sent_by),
  signer: text(r.signer),
  signerRole: text(r.signer_role),
  items,
});

const PACK_COLUMNS = "id, fundraiser_id, sent_at, sent_by, signer, signer_role";
const ITEM_COLUMNS = "i.pack_id, p.fundraiser_id, i.key, i.label, i.quantity, i.ticked_at, i.ticked_by, i.skipped_reason, i.marked_request";

/** Every pack staff have touched, by fundraiser. */
export async function listPacks(): Promise<Map<number, StoredPack>> {
  const [packs, items] = await Promise.all([
    pool.query(`SELECT ${PACK_COLUMNS} FROM welcome_packs`),
    pool.query(`SELECT ${ITEM_COLUMNS} FROM welcome_pack_items i JOIN welcome_packs p ON p.id = i.pack_id ORDER BY i.id`),
  ]);
  const byFundraiser = new Map<number, StoredItem[]>();
  for (const r of items.rows as Row[]) {
    const id = Number(r.fundraiser_id);
    byFundraiser.set(id, [...(byFundraiser.get(id) ?? []), toItem(r)]);
  }
  return new Map((packs.rows as Row[]).map((r) => [Number(r.fundraiser_id), toPack(r, byFundraiser.get(Number(r.fundraiser_id)) ?? [])]));
}

/** One fundraiser's pack as stored, or null when staff have not touched it. */
export async function getPack(fundraiserId: number): Promise<StoredPack | null> {
  const found = await pool.query(`SELECT ${PACK_COLUMNS} FROM welcome_packs WHERE fundraiser_id = $1`, [fundraiserId]);
  const p = found.rows[0] as Row | undefined;
  if (!p) return null;
  const items = await pool.query(
    `SELECT ${ITEM_COLUMNS} FROM welcome_pack_items i JOIN welcome_packs p ON p.id = i.pack_id WHERE p.fundraiser_id = $1 ORDER BY i.id`,
    [fundraiserId],
  );
  return toPack(p, (items.rows as Row[]).map(toItem));
}

// The poster sizes of an organiser's last "Ask us to print these" (src/db/fundraiser-materials.ts
// keeps the ask in audit_log). The sign up form asks only how many posters; the sizes are known only
// when they asked that way.
const SIZES_SQL = `SELECT DISTINCT ON (entity_id) entity_id AS fundraiser_id, data->>'a4' AS a4, data->>'a3' AS a3
       FROM audit_log
      WHERE entity = 'fundraiser' AND action = 'fundraiser.print_requested' AND data->>'kind' = 'posters'`;

export async function listPosterSizes(): Promise<Map<number, PosterSizes>> {
  const r = await pool.query(`${SIZES_SQL} ORDER BY entity_id, id DESC`);
  return new Map((r.rows as Row[]).map((row) => [Number(row.fundraiser_id), { a4: whole(row.a4), a3: whole(row.a3) }]));
}

export async function posterSizesFor(fundraiserId: number, client: Pick<PoolClient, "query"> = pool): Promise<PosterSizes | null> {
  const r = await client.query(`${SIZES_SQL} AND entity_id = $1 ORDER BY entity_id, id DESC`, [fundraiserId]);
  const row = r.rows[0] as Row | undefined;
  return row ? { a4: whole(row.a4), a3: whole(row.a3) } : null;
}

/**
 * The pages whose pack has gone with nothing more owed, for the Monday summary. A pack sent with the
 * T-shirt left out while it waited for a size is not one of them once the size has come in: the
 * summary then counts that page as having something to send.
 */
export async function settledPackIds(fundraisers: Array<PackSubject & { id: number }>): Promise<Set<number>> {
  const [stored, sizes] = await Promise.all([listPacks(), listPosterSizes()]);
  return new Set(fundraisers.filter((f) => packSettled(f, stored.get(f.id) ?? null, sizes.get(f.id) ?? null)).map((f) => f.id));
}

/** Who this staff member last chose to sign a letter: offered first on their next one. */
export async function lastSignerFor(actor: string): Promise<Signer | null> {
  const r = await pool.query("SELECT signer, signer_role FROM welcome_packs WHERE signer_by = $1 AND signer IS NOT NULL ORDER BY signer_at DESC NULLS LAST, id DESC LIMIT 1", [actor]);
  const row = r.rows[0] as Row | undefined;
  return row ? { name: String(row.signer), role: text(row.signer_role) } : null;
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

/** The pack as it is stored now, read inside the transaction. */
async function readPack(client: PoolClient, fundraiserId: number, lock: boolean): Promise<{ id: number; pack: StoredPack } | null> {
  const packs = await client.query(`SELECT ${PACK_COLUMNS} FROM welcome_packs WHERE fundraiser_id = $1${lock ? " FOR UPDATE" : ""}`, [fundraiserId]);
  const p = packs.rows[0] as Row | undefined;
  if (!p) return null;
  const items = await client.query(
    `SELECT ${ITEM_COLUMNS} FROM welcome_pack_items i JOIN welcome_packs p ON p.id = i.pack_id WHERE i.pack_id = $1 ORDER BY i.id`,
    [p.id],
  );
  return { id: Number(p.id), pack: toPack(p, (items.rows as Row[]).map(toItem)) };
}

/** "fern@example.com" from "admin:fern@example.com": who handled a request the pack marked. */
const whoOf = (actor: string) => actor.replace(/^admin:/, "").slice(0, 100);

export interface PackChanged {
  view: PackView;
  /** For the History; empty when the press changed nothing. */
  words: string;
  /** What it did to the requests it looks after, in the Requests' own words. */
  requestWords: string[];
  fundraiser: FundraiserRecord;
}

/**
 * One press on the tick list. The fundraiser's row is locked first, so two presses at once take
 * turns and the second sees the pack as the first left it. A press that leaves the pack as it stands
 * writes nothing and records nothing. Throws PackError, writing nothing. `today` is the UK day, for
 * a request the tick marks as sent.
 */
export async function changePack(fundraiserId: number, input: PackActionInput, actor: string, today: string): Promise<PackChanged> {
  return inTransaction(async (client) => {
    const found = await client.query(`${FUNDRAISER_SELECT}\n    WHERE f.id = $1 FOR UPDATE`, [fundraiserId]);
    if (!found.rows[0]) throw new PackError("not_found", "That fundraiser no longer exists");
    const f = toRecord(found.rows[0]);
    const before = await readPack(client, fundraiserId, true);
    const sizes = await posterSizesFor(fundraiserId, client);
    const view = packView(f, before?.pack ?? null, sizes);
    if (!view) throw new PackError("no_pack", "There is no pack for this one: it is not approved, or it asked for nothing.");
    const result = applyPackAction(view, input);
    if (!result.ok) throw new PackError(result.reason, result.message);
    const c = result.change;
    if (!c) return { view, words: "", requestWords: [], fundraiser: f };

    const packId = before ? before.id : Number((await client.query("INSERT INTO welcome_packs (fundraiser_id) VALUES ($1) RETURNING id", [fundraiserId])).rows[0].id);
    const data: Record<string, unknown> = { ...input, words: result.words };
    if (c.type === "tick" || c.type === "skip") {
      const reason = c.type === "skip" ? c.reason : null;
      await client.query(
        `INSERT INTO welcome_pack_items (pack_id, key, label, quantity, ticked_at, ticked_by, skipped_reason)
         VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() END, $6, $7)
         ON CONFLICT (pack_id, key) DO UPDATE SET
           label = EXCLUDED.label, quantity = EXCLUDED.quantity, ticked_at = EXCLUDED.ticked_at, ticked_by = EXCLUDED.ticked_by,
           skipped_reason = EXCLUDED.skipped_reason, updated_at = now()`,
        [packId, c.key, c.label, c.quantity, c.type === "tick", actor, reason],
      );
      data.label = c.label;
      data.quantity = c.quantity;
    } else if (c.type === "untick") {
      await client.query("DELETE FROM welcome_pack_items WHERE pack_id = $1 AND key = $2", [packId, c.key]);
    } else if (c.type === "send") {
      await client.query("UPDATE welcome_packs SET sent_at = now(), sent_by = $2, updated_at = now() WHERE id = $1", [packId, actor]);
    } else if (c.type === "undo") {
      await client.query("UPDATE welcome_packs SET sent_at = NULL, sent_by = NULL, updated_at = now() WHERE id = $1", [packId]);
      data.was = { sentAt: view.sentAt, sentBy: view.sentBy };
    } else {
      await client.query("UPDATE welcome_packs SET signer = $2, signer_role = $3, signer_by = $4, signer_at = now(), updated_at = now() WHERE id = $1", [
        packId,
        c.name,
        c.role,
        actor,
      ]);
    }
    await insertAudit(client, { actor, action: "fundraiser.pack_updated", entity: "fundraiser", entityId: fundraiserId, data });

    const after = await readPack(client, fundraiserId, false);
    const fresh = packView(f, after?.pack ?? null, sizes) ?? view;

    // Requests in step with this press: only the request of the thing pressed, and on Pack sent only
    // those still to send. Not for Undo of Sent (the ticks stand) or a change of signer.
    const requestWords: string[] = [];
    if (c.type === "tick" || c.type === "untick" || c.type === "skip" || c.type === "send") {
      const press: PackPress = c.type === "send" ? { type: "send" } : { type: c.type, key: c.key };
      const pressedKind = press.type === "send" ? null : (PACK_REQUEST_KIND[press.key] ?? null);
      // Had the pack marked this request? As its rows stood before the press (an untick removes one).
      const marked = !!pressedKind && (before?.pack.items ?? []).some((i) => PACK_REQUEST_KIND[i.key] === pressedKind && i.markedRequest === true);
      const steps = press.type === "send" || pressedKind ? packRequestSync(fresh, await lockRequestRows(client, fundraiserId), { today, by: whoOf(actor), press, marked }) : [];
      const subject = { status: f.status, wants: parseWants(f.wants), socialOk: f.socialOk, eventDate: f.eventDate };
      for (const step of steps) {
        try {
          requestWords.push((await changeRequestIn(client, fundraiserId, subject, step.kind, step.input, actor, today)).words);
          // The pack's own record of what it marked: set when it marks, cleared when it opens again.
          const keys = Object.keys(PACK_REQUEST_KIND).filter((k) => PACK_REQUEST_KIND[k] === step.kind);
          await client.query("UPDATE welcome_pack_items SET marked_request = $2 WHERE pack_id = $1 AND key = ANY($3::text[])", [packId, step.input.action !== "undo", keys]);
        } catch (err) {
          // A request the Requests' own rules will not move (it has moved on by hand) is left as it
          // is: the tick still stands. Anything else stops the whole press.
          if (!(err instanceof RequestError)) throw err;
        }
      }
    }
    return { view: fresh, words: result.words, requestWords, fundraiser: f };
  });
}
