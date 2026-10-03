import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { canSendPictures, pictureLimitReached, type PictureKind, type PictureRow, type PictureStatus } from "../fundraising/pictures";

// Profile pictures (Jaimie, 2026-10-03): the SQL behind the pictures an organiser sends. The rules
// are pure, in src/fundraising/pictures.ts; this file only moves rows.
//
//   - Sending: under the fundraiser's row lock, only by its own organiser, only while it is approved
//     with a page, and at most ten in any 24 hours. A newer one replaces the one of its kind still
//     waiting, so staff only ever see the latest.
//   - A picture's bytes stay in its row and never leave in a list: each is read by itself, for its
//     owner, for staff, or (only an approved profile photo, on a page that is up) for the public.
//   - Approving a main photo copies it into event_images and points the page's image_src at it, so
//     it is exactly a photo staff uploaded, and staff can still change it the usual way. The copy is
//     remembered (event_image_id): replacing it, or taking it off, deletes the copy, so its address
//     answers nothing; and its address is only served while it is the page's photo (getEventImage).
//   - Data kept to what is needed: a picture's bytes go once it is not used, replaced or taken off
//     (the row stays, for the audit), and purgePictureBytes (the daily task) lets go of anything left
//     after 30 days. One still waiting is kept until staff decide; the Monday summary counts them. An admin can delete a picture for good.
//   - A page in memory of someone has no round photo of its organiser: none is approved or served.
//   - Every write a person makes records an audit_log row in the SAME transaction, against entity
//     "fundraiser" and its id, so it shows in that fundraiser's History.

export type PictureErrorReason = "not_found" | "bad_status" | "not_waiting" | "not_allowed";

export class PictureError extends Error {
  constructor(public readonly reason: PictureErrorReason) {
    super(`fundraiser picture: ${reason}`);
    this.name = "PictureError";
  }
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

// Every column but the picture's bytes.
const COLUMNS =
  "id, fundraiser_id, kind, status, photo_id, (bytes IS NOT NULL) AS has_bytes, width, height, created_at, decided_at, decided_by, decline_reason";

function toPicture(r: Row): PictureRow {
  return {
    id: Number(r.id),
    fundraiserId: Number(r.fundraiser_id),
    kind: r.kind as PictureKind,
    status: r.status as PictureStatus,
    photoId: String(r.photo_id),
    hasPhoto: Boolean(r.has_bytes),
    width: Number(r.width),
    height: Number(r.height),
    createdAt: iso(r.created_at) as string,
    decidedAt: iso(r.decided_at),
    decidedBy: r.decided_by == null ? null : String(r.decided_by),
    declineReason: r.decline_reason == null ? null : String(r.decline_reason),
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

/** A picture as the server made it (src/fundraising/picture-process.ts). */
export interface MadePicture {
  mime: "image/jpeg" | "image/png" | "image/webp";
  bytes: Buffer;
  width: number;
  height: number;
}

/**
 * The signed in organiser (`email`) sends a picture for their own fundraiser. "limit" when it has had
 * ten in the last 24 hours (nothing is stored). Someone else's fundraiser reads as not there.
 */
export async function sendPicture(
  fundraiserId: number,
  email: string,
  kind: PictureKind,
  picture: MadePicture,
): Promise<{ verdict: "ok"; picture: PictureRow } | { verdict: "limit" }> {
  return inTransaction(async (client) => {
    const f = (
      await client.query("SELECT id, organiser_email, status, public, path FROM fundraisers WHERE id = $1 FOR UPDATE", [fundraiserId])
    ).rows[0] as Row | undefined;
    if (!f || String(f.organiser_email).trim().toLowerCase() !== email.trim().toLowerCase()) throw new PictureError("not_found");
    if (!canSendPictures({ status: f.status as never, public: Boolean(f.public), path: f.path as never })) throw new PictureError("bad_status");
    const counted = await client.query(
      "SELECT count(*) AS n FROM fundraiser_pictures WHERE fundraiser_id = $1 AND created_at > now() - interval '24 hours'",
      [fundraiserId],
    );
    if (pictureLimitReached(Number(counted.rows[0]?.n ?? 0))) return { verdict: "limit" as const };
    // Never rewritten in place: a picture staff are looking at cannot be swapped under them.
    const replaced = await client.query(
      `UPDATE fundraiser_pictures SET status = 'replaced', decided_at = now(), decided_by = 'organiser', bytes = NULL
        WHERE fundraiser_id = $1 AND kind = $2 AND status = 'pending' RETURNING id`,
      [fundraiserId, kind],
    );
    const ins = await client.query(
      `INSERT INTO fundraiser_pictures (fundraiser_id, kind, photo_id, mime, bytes, byte_size, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
      [fundraiserId, kind, randomUUID(), picture.mime, picture.bytes, picture.bytes.length, picture.width, picture.height],
    );
    const row = toPicture(ins.rows[0]);
    await insertAudit(client, {
      actor: "organiser",
      action: "fundraiser.picture_sent",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { pictureId: row.id, kind, replaced: replaced.rows.map((r: Row) => Number(r.id)) },
    });
    return { verdict: "ok" as const, picture: row };
  });
}

/** How many pictures a fundraiser sent in the last 24 hours: asked before anything is decoded. */
export async function countSentToday(fundraiserId: number): Promise<number> {
  const r = await pool.query(
    "SELECT count(*) AS n FROM fundraiser_pictures WHERE fundraiser_id = $1 AND created_at > now() - interval '24 hours'",
    [fundraiserId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** The pictures of these fundraisers, newest first, without their bytes. */
export async function listPictures(fundraiserIds: number[]): Promise<PictureRow[]> {
  if (fundraiserIds.length === 0) return [];
  const r = await pool.query(`SELECT ${COLUMNS} FROM fundraiser_pictures WHERE fundraiser_id = ANY($1) ORDER BY created_at DESC, id DESC`, [
    fundraiserIds,
  ]);
  return r.rows.map(toPicture);
}

type Bytes = { mime: string; bytes: Buffer };
const toBytes = (r: Row | undefined): Bytes | null => (r ? { mime: String(r.mime), bytes: r.bytes as Buffer } : null);

/** A picture for the organiser it belongs to (their fundraiser's email), whatever its status. */
export async function pictureForOwner(pictureId: number, email: string): Promise<Bytes | null> {
  const r = await pool.query(
    `SELECT p.mime, p.bytes FROM fundraiser_pictures p JOIN fundraisers f ON f.id = p.fundraiser_id
      WHERE p.id = $1 AND lower(f.organiser_email) = $2 AND p.bytes IS NOT NULL`,
    [pictureId, email.trim().toLowerCase()],
  );
  return toBytes(r.rows[0]);
}

/** A picture for staff, by the fundraiser it belongs to. */
export async function pictureForStaff(fundraiserId: number, pictureId: number): Promise<Bytes | null> {
  const r = await pool.query("SELECT mime, bytes FROM fundraiser_pictures WHERE id = $1 AND fundraiser_id = $2 AND bytes IS NOT NULL", [
    pictureId,
    fundraiserId,
  ]);
  return toBytes(r.rows[0]);
}

/**
 * A profile photo for anyone: only while it is approved, on a public page that is up (approved or
 * finished). The caller checks fundraising is switched on.
 */
export async function publicProfilePhoto(photoId: string): Promise<Bytes | null> {
  const r = await pool.query(
    `SELECT p.mime, p.bytes FROM fundraiser_pictures p JOIN fundraisers f ON f.id = p.fundraiser_id
      WHERE p.photo_id = $1 AND p.kind = 'profile' AND p.status = 'approved'
        AND f.public = true AND f.path IN ('raising', 'event') AND f.status IN ('approved', 'finished')
        AND NOT f.in_memory AND p.bytes IS NOT NULL`,
    [photoId],
  );
  return toBytes(r.rows[0]);
}

/** Each fundraiser's approved profile photo id, for its page and its team's page. One query. */
export async function approvedProfilePhotos(fundraiserIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (fundraiserIds.length === 0) return out;
  const r = await pool.query(
    `SELECT p.fundraiser_id, p.photo_id FROM fundraiser_pictures p JOIN fundraisers f ON f.id = p.fundraiser_id
      WHERE p.fundraiser_id = ANY($1) AND p.kind = 'profile' AND p.status = 'approved' AND NOT f.in_memory`,
    [fundraiserIds],
  );
  for (const row of r.rows) out.set(Number(row.fundraiser_id), String(row.photo_id));
  return out;
}

// --- staff ----------------------------------------------------------------------------------------

/** How many wait on each fundraiser, for the "Pictures to check" pill on the admin's list. */
export async function pendingPicturesByFundraiser(): Promise<Record<number, number>> {
  const r = await pool.query("SELECT fundraiser_id, count(*) AS n FROM fundraiser_pictures WHERE status = 'pending' GROUP BY fundraiser_id");
  const out: Record<number, number> = {};
  for (const row of r.rows) out[Number(row.fundraiser_id)] = Number(row.n);
  return out;
}

export type PictureDecision = "approve" | "decline" | "remove";

const MOVES: Record<PictureDecision, { from: PictureStatus; to: PictureStatus; action: string; keepBytes: boolean }> = {
  approve: { from: "pending", to: "approved", action: "fundraiser.picture_approved", keepBytes: true },
  decline: { from: "pending", to: "declined", action: "fundraiser.picture_declined", keepBytes: false },
  remove: { from: "approved", to: "removed", action: "fundraiser.picture_removed", keepBytes: false },
};

const copySrc = (imageId: string) => `/media/events/${imageId}`;

/**
 * Main photos' copies in event_images: taken off the page (its image_src cleared, only where it is
 * still one of these) and deleted, so their addresses answer nothing.
 */
async function dropCopies(client: PoolClient, fundraiserId: number, imageIds: string[], actor: string): Promise<void> {
  if (imageIds.length === 0) return;
  await client.query("UPDATE fundraisers SET image_src = NULL, updated_at = now(), updated_by = $3 WHERE id = $1 AND image_src = ANY($2)", [
    fundraiserId,
    imageIds.map(copySrc),
    actor,
  ]);
  await client.query("DELETE FROM event_images WHERE id = ANY($1)", [imageIds]);
}

/**
 * Approve or decline a waiting picture, or take one in use off the page (a main photo comes off the
 * page too, and its copy is deleted). A note given with a decline is for the organiser, who sees it
 * in their private area. Anything that does not fit where it is up to (decided already, replaced, or
 * by someone else meanwhile) is "not_waiting"; a round photo on a page in memory of someone is
 * "not_allowed".
 */
export async function decidePicture(
  fundraiserId: number,
  pictureId: number,
  decision: PictureDecision,
  actor: string,
  opts: { reason?: string | null; adminId?: number | null } = {},
): Promise<PictureRow> {
  const move = MOVES[decision];
  return inTransaction(async (client) => {
    const found = await client.query(
      `SELECT p.status, p.kind, p.event_image_id, f.in_memory FROM fundraiser_pictures p JOIN fundraisers f ON f.id = p.fundraiser_id
        WHERE p.id = $1 AND p.fundraiser_id = $2 FOR UPDATE OF p`,
      [pictureId, fundraiserId],
    );
    const row = found.rows[0] as Row | undefined;
    if (!row) throw new PictureError("not_found");
    const kind = row.kind as PictureKind;
    if (row.status !== move.from) throw new PictureError("not_waiting");
    if (decision === "approve" && kind === "profile" && row.in_memory === true) throw new PictureError("not_allowed");
    let eventImageId: string | null = null;
    if (decision === "approve") {
      // The one in use steps aside first: only one of each kind is ever in use. Its bytes go, and so
      // does a main photo's copy.
      const inUse = await client.query(
        "SELECT id, event_image_id FROM fundraiser_pictures WHERE fundraiser_id = $1 AND kind = $2 AND status = 'approved' FOR UPDATE",
        [fundraiserId, kind],
      );
      const oldIds = inUse.rows.map((r: Row) => Number(r.id));
      if (oldIds.length) {
        await client.query(
          `UPDATE fundraiser_pictures SET status = 'replaced', decided_at = now(), decided_by = $2, bytes = NULL, event_image_id = NULL
            WHERE id = ANY($1)`,
          [oldIds, actor],
        );
        await dropCopies(client, fundraiserId, inUse.rows.map((r: Row) => r.event_image_id).filter(Boolean).map(String), actor);
      }
      if (kind === "main") {
        eventImageId = randomUUID();
        await client.query(
          "INSERT INTO event_images (id, mime, bytes, byte_size, uploaded_by) SELECT $1, mime, bytes, byte_size, $2 FROM fundraiser_pictures WHERE id = $3",
          [eventImageId, opts.adminId ?? null, pictureId],
        );
        await client.query("UPDATE fundraisers SET image_src = $1, updated_at = now(), updated_by = $2 WHERE id = $3", [
          copySrc(eventImageId),
          actor,
          fundraiserId,
        ]);
      }
    }
    if (decision === "remove" && row.event_image_id) await dropCopies(client, fundraiserId, [String(row.event_image_id)], actor);
    const reason = decision === "decline" && opts.reason ? opts.reason : null;
    const r = await client.query(
      `UPDATE fundraiser_pictures SET status = $1, decided_at = now(), decided_by = $2, decline_reason = $3,
              bytes = CASE WHEN $5 THEN bytes ELSE NULL END, event_image_id = $6
        WHERE id = $4 RETURNING ${COLUMNS}`,
      [move.to, actor, reason, pictureId, move.keepBytes, eventImageId],
    );
    await insertAudit(client, {
      actor,
      action: move.action,
      entity: "fundraiser",
      entityId: fundraiserId,
      data: reason ? { pictureId, kind, reason } : { pictureId, kind },
    });
    return toPicture(r.rows[0]);
  });
}

/** An admin deletes a picture for good: its row, and any copy on the page. The audit row stays. */
export async function deletePicture(fundraiserId: number, pictureId: number, actor: string): Promise<void> {
  await inTransaction(async (client) => {
    const found = await client.query("SELECT status, kind, event_image_id FROM fundraiser_pictures WHERE id = $1 AND fundraiser_id = $2 FOR UPDATE", [
      pictureId,
      fundraiserId,
    ]);
    const row = found.rows[0] as Row | undefined;
    if (!row) throw new PictureError("not_found");
    if (row.event_image_id) await dropCopies(client, fundraiserId, [String(row.event_image_id)], actor);
    await client.query("DELETE FROM fundraiser_pictures WHERE id = $1", [pictureId]);
    await insertAudit(client, {
      actor,
      action: "fundraiser.picture_deleted",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { pictureId, kind: row.kind, status: row.status },
    });
  });
}

/** Photos waiting for staff, for the Monday summary: a waiting photo is kept until staff decide. */
export async function countPendingPictures(): Promise<number> {
  const r = await pool.query("SELECT count(*) AS n FROM fundraiser_pictures WHERE status = 'pending'");
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * The daily clear out (src/scripts/send-reminders.ts): the bytes of a picture not used, replaced or
 * taken off go after 30 days (most went when it was decided); and a main photo staff have since
 * swapped for another under "Photo for its page" is no longer in use, so its copy and bytes go too.
 * A photo still waiting for staff is never touched, however long it waits: the Monday summary
 * counts those, so staff are nudged instead.
 */
export async function purgePictureBytes(): Promise<{ cleared: number; swapped: number }> {
  return inTransaction(async (client) => {
    const swapped = await client.query(
      // The copy's id is read before the row forgets it (RETURNING sees the new, empty value).
      `WITH gone AS (
         SELECT p.id, p.event_image_id FROM fundraiser_pictures p JOIN fundraisers f ON f.id = p.fundraiser_id
          WHERE p.kind = 'main' AND p.status = 'approved' AND p.event_image_id IS NOT NULL
            AND f.image_src IS DISTINCT FROM '/media/events/' || p.event_image_id::text
          FOR UPDATE OF p)
       UPDATE fundraiser_pictures p SET status = 'replaced', decided_at = now(), decided_by = 'page photo changed', bytes = NULL, event_image_id = NULL
         FROM gone WHERE p.id = gone.id
       RETURNING gone.event_image_id AS old_copy`,
    );
    const copies = swapped.rows.map((r: Row) => r.old_copy).filter(Boolean).map(String);
    if (copies.length) await client.query("DELETE FROM event_images WHERE id = ANY($1)", [copies]);
    const cleared = await client.query(
      `UPDATE fundraiser_pictures SET bytes = NULL
        WHERE bytes IS NOT NULL AND status NOT IN ('pending', 'approved') AND created_at < now() - interval '30 days'`,
    );
    return { cleared: cleared.rowCount ?? 0, swapped: swapped.rowCount ?? 0 };
  });
}
