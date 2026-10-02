import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { canPostNews, newsLimitReached, type NewsPhotoMime, type NewsRow, type NewsStatus } from "../fundraising/news";

// TASK-506: the SQL behind news updates on a fundraiser's page. The rules are pure, in
// src/fundraising/news.ts; this file only moves rows.
//
//   - Posting: under the fundraiser's row lock, only by its own organiser, only while it is approved
//     with a page, and at most five in any 24 hours (counted under the same lock, so two sent at
//     once cannot both slip past the fifth). Every one is stored pending.
//   - A photo's bytes stay in the row, and never leave in a list: each is read by itself, for its
//     owner, for staff, or (only while its update is approved, on a page that is up) for the public.
//   - Every write a person makes records an audit_log row in the SAME transaction, against entity
//     "fundraiser" and its id, so it shows in that fundraiser's History.

export type NewsErrorReason = "not_found" | "bad_status" | "not_waiting";

export class NewsError extends Error {
  constructor(public readonly reason: NewsErrorReason) {
    super(`fundraiser news: ${reason}`);
    this.name = "NewsError";
  }
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

// Every column but the photo's bytes.
const COLUMNS = "id, fundraiser_id, body, status, photo_id, created_at, decided_at, decided_by, reject_reason";

function toNews(r: Row): NewsRow {
  return {
    id: Number(r.id),
    fundraiserId: Number(r.fundraiser_id),
    text: String(r.body),
    status: r.status as NewsStatus,
    photoId: r.photo_id == null ? null : String(r.photo_id),
    createdAt: iso(r.created_at) as string,
    decidedAt: iso(r.decided_at),
    decidedBy: r.decided_by == null ? null : String(r.decided_by),
    rejectReason: r.reject_reason == null ? null : String(r.reject_reason),
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

// --- the organiser --------------------------------------------------------------------------------

export interface NewsPhoto {
  mime: NewsPhotoMime;
  bytes: Buffer;
}

/**
 * The signed in organiser (`email`) posts an update to their own fundraiser. "limit" when it has had
 * five in the last 24 hours (nothing is stored). Someone else's fundraiser reads as not there.
 */
export async function postUpdate(
  fundraiserId: number,
  email: string,
  post: { text: string; photo: NewsPhoto | null },
): Promise<{ verdict: "ok"; update: NewsRow } | { verdict: "limit" }> {
  return inTransaction(async (client) => {
    const f = (
      await client.query("SELECT id, organiser_email, status, public, path FROM fundraisers WHERE id = $1 FOR UPDATE", [fundraiserId])
    ).rows[0] as Row | undefined;
    if (!f || String(f.organiser_email).trim().toLowerCase() !== email.trim().toLowerCase()) throw new NewsError("not_found");
    if (!canPostNews({ status: f.status as never, public: Boolean(f.public), path: f.path as never })) throw new NewsError("bad_status");
    const counted = await client.query(
      "SELECT count(*) AS n FROM fundraiser_updates WHERE fundraiser_id = $1 AND created_at > now() - interval '24 hours'",
      [fundraiserId],
    );
    if (newsLimitReached(Number(counted.rows[0]?.n ?? 0))) return { verdict: "limit" as const };
    const photo = post.photo;
    const ins = await client.query(
      `INSERT INTO fundraiser_updates (fundraiser_id, body, photo_id, photo_mime, photo_bytes, photo_byte_size)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
      [fundraiserId, post.text, photo ? randomUUID() : null, photo?.mime ?? null, photo?.bytes ?? null, photo ? photo.bytes.length : null],
    );
    const update = toNews(ins.rows[0]);
    await insertAudit(client, {
      actor: "organiser",
      action: "fundraiser.news_posted",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { updateId: update.id, photo: photo !== null },
    });
    return { verdict: "ok" as const, update };
  });
}

/** The updates on these fundraisers, newest first, without any photo's bytes. */
export async function listUpdates(fundraiserIds: number[]): Promise<NewsRow[]> {
  if (fundraiserIds.length === 0) return [];
  const r = await pool.query(`SELECT ${COLUMNS} FROM fundraiser_updates WHERE fundraiser_id = ANY($1) ORDER BY created_at DESC, id DESC`, [
    fundraiserIds,
  ]);
  return r.rows.map(toNews);
}

/** What the public page shows: the approved ones, newest first. */
export async function approvedForPage(fundraiserId: number): Promise<NewsRow[]> {
  const r = await pool.query(
    `SELECT ${COLUMNS} FROM fundraiser_updates WHERE fundraiser_id = $1 AND status = 'approved' ORDER BY created_at DESC, id DESC`,
    [fundraiserId],
  );
  return r.rows.map(toNews);
}

type Photo = { mime: string; bytes: Buffer };
const toPhoto = (r: Row | undefined): Photo | null => (r ? { mime: String(r.photo_mime), bytes: r.photo_bytes as Buffer } : null);

/** A photo for the organiser it belongs to (their fundraiser's email), whatever its update's status. */
export async function photoForOwner(updateId: number, email: string): Promise<Photo | null> {
  const r = await pool.query(
    `SELECT u.photo_mime, u.photo_bytes FROM fundraiser_updates u JOIN fundraisers f ON f.id = u.fundraiser_id
      WHERE u.id = $1 AND lower(f.organiser_email) = $2 AND u.photo_bytes IS NOT NULL`,
    [updateId, email.trim().toLowerCase()],
  );
  return toPhoto(r.rows[0]);
}

/** A photo for staff, by the fundraiser it belongs to. */
export async function photoForStaff(fundraiserId: number, updateId: number): Promise<Photo | null> {
  const r = await pool.query(
    "SELECT photo_mime, photo_bytes FROM fundraiser_updates WHERE id = $1 AND fundraiser_id = $2 AND photo_bytes IS NOT NULL",
    [updateId, fundraiserId],
  );
  return toPhoto(r.rows[0]);
}

/**
 * A photo for anyone: only while its update is approved, on a public raising money page that is up
 * (approved or finished). The caller checks fundraising is switched on.
 */
export async function publicPhoto(photoId: string): Promise<Photo | null> {
  const r = await pool.query(
    `SELECT u.photo_mime, u.photo_bytes FROM fundraiser_updates u JOIN fundraisers f ON f.id = u.fundraiser_id
      WHERE u.photo_id = $1 AND u.status = 'approved' AND u.photo_bytes IS NOT NULL
        AND f.public = true AND f.path = 'raising' AND f.status IN ('approved', 'finished')`,
    [photoId],
  );
  return toPhoto(r.rows[0]);
}

// --- staff ----------------------------------------------------------------------------------------

/** Updates waiting for staff, for the Monday summary. */
export async function countPendingUpdates(): Promise<number> {
  const r = await pool.query("SELECT count(*) AS n FROM fundraiser_updates WHERE status = 'pending'");
  return Number(r.rows[0]?.n ?? 0);
}

/** How many wait on each fundraiser, for the "Updates to check" pill on the admin's list. */
export async function pendingByFundraiser(): Promise<Record<number, number>> {
  const r = await pool.query("SELECT fundraiser_id, count(*) AS n FROM fundraiser_updates WHERE status = 'pending' GROUP BY fundraiser_id");
  const out: Record<number, number> = {};
  for (const row of r.rows) out[Number(row.fundraiser_id)] = Number(row.n);
  return out;
}

export type NewsDecision = "approve" | "reject" | "hide" | "show";

// Where each decision may start from, and where it leaves the update.
const MOVES: Record<NewsDecision, { from: NewsStatus; to: NewsStatus; action: string }> = {
  approve: { from: "pending", to: "approved", action: "fundraiser.news_approved" },
  reject: { from: "pending", to: "rejected", action: "fundraiser.news_rejected" },
  hide: { from: "approved", to: "hidden", action: "fundraiser.news_hidden" },
  show: { from: "hidden", to: "approved", action: "fundraiser.news_shown" },
};

/**
 * Approve or reject a waiting update, or hide an approved one (and show it again). A reason given
 * with a reject is kept for staff only. Anything that does not fit where it is up to (decided
 * already, or by someone else meanwhile) is "not_waiting".
 */
export async function decideUpdate(
  fundraiserId: number,
  updateId: number,
  decision: NewsDecision,
  actor: string,
  reason: string | null = null,
): Promise<NewsRow> {
  const move = MOVES[decision];
  return inTransaction(async (client) => {
    const found = await client.query("SELECT status FROM fundraiser_updates WHERE id = $1 AND fundraiser_id = $2 FOR UPDATE", [
      updateId,
      fundraiserId,
    ]);
    const row = found.rows[0] as Row | undefined;
    if (!row) throw new NewsError("not_found");
    if (row.status !== move.from) throw new NewsError("not_waiting");
    const keptReason = decision === "reject" ? reason : null;
    const r = await client.query(
      `UPDATE fundraiser_updates SET status = $1, decided_at = now(), decided_by = $2,
              reject_reason = COALESCE($3, reject_reason)
        WHERE id = $4 RETURNING ${COLUMNS}`,
      [move.to, actor, keptReason, updateId],
    );
    await insertAudit(client, {
      actor,
      action: move.action,
      entity: "fundraiser",
      entityId: fundraiserId,
      data: keptReason ? { updateId, reason: keptReason } : { updateId },
    });
    return toNews(r.rows[0]);
  });
}
