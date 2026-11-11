import { pool } from "./pool";
import { insertAudit } from "./donations";
import { inTransaction } from "./elf-practice";
import { loadDoorRun, loadPractice, type DoorRun } from "./elf-game";
import { headElfName } from "../elf/alerts";
import { isDoor, type Door } from "../elf/calendar";
import { openedAt, shownAt } from "../elf/doors";

// NBCC Elf Detective School wave 2: the photo check and the photo log in Head Elf HQ's Finds tab. The
// tables are Plan 2a's (elf_photos, elf_photo_files in migrations/1791200000440_elf-game.js). A photo
// is shown to the public only once a head elf approves it, so the check is the gate; the rules that
// keep a child's photo from sitting beside that child's elf are here and in src/db/elf-game.ts:
//   * at most one photo a family on each door (approving one replaces the family's other approved
//     photo at that door, and deletes its bytes, in the same transaction);
//   * a door's photos stay hidden until approved photos from two different families are on it.
// A decline or a take down deletes the bytes at once (C8); the rows stay, for the log. The SQL is
// proved against a real database in CI; test/unit/elf-db-photos.test.ts reads what is sent.

/** A photo waiting for a head elf, with what the check shows beside it. Head elves see the family's
 *  full name; nothing here is ever given to a family or the public. */
export interface PhotoCheck {
  id: number;
  token: string;
  year: number;
  door: Door | 0;
  practice: boolean;
  sentAt: Date;
  family: { id: number; grownUpName: string; detectives: number };
  placeName: string | null;
  /** When the door's place is shown, or null when it already is. */
  placeShownAt: Date | null;
  /** True when no other family has an approved photo on this door, so approving it would still leave
   *  it hidden until a second family's photo is approved. */
  firstFamily: boolean;
}

interface WaitingSql {
  id: number;
  token: string;
  year: number;
  door: number;
  sent_at: Date;
  family_id: number;
  grown_up_name: string;
  detectives: number;
  first_family: boolean;
}

const asDoor = (n: number): Door | 0 => (n === 0 ? 0 : isDoor(n) ? n : 0);

/** The photos waiting for a head elf, oldest first. Removed families' photos are left out. */
export async function photosWaiting(now: Date): Promise<PhotoCheck[]> {
  const res = await pool.query<WaitingSql>(
    `SELECT p.id, p.token, p.year, p.door, p.sent_at, f.id AS family_id, f.grown_up_name,
            (SELECT count(*)::int FROM elf_detectives d WHERE d.family_id = f.id AND d.active) AS detectives,
            NOT EXISTS (
              SELECT 1 FROM elf_photos o JOIN elf_families fo ON fo.id = o.family_id
               WHERE o.year = p.year AND o.door = p.door AND o.status = 'approved' AND o.deleted_at IS NULL
                 AND fo.removed_at IS NULL AND o.family_id <> p.family_id
            ) AS first_family
       FROM elf_photos p JOIN elf_families f ON f.id = p.family_id
      WHERE p.status = 'waiting' AND f.removed_at IS NULL
      ORDER BY p.sent_at, p.id`,
  );
  const runs = new Map<string, Promise<DoorRun | null>>();
  const runFor = (year: number, door: number): Promise<DoorRun | null> => {
    const key = `${year}:${door}`;
    let run = runs.get(key);
    if (!run) {
      run = door === 0 ? loadPractice(now) : isDoor(door) ? loadDoorRun(year, door, now) : Promise.resolve(null);
      runs.set(key, run);
    }
    return run;
  };
  const out: PhotoCheck[] = [];
  for (const r of res.rows) {
    const run = await runFor(r.year, r.door);
    out.push({
      id: r.id,
      token: r.token,
      year: r.year,
      door: asDoor(r.door),
      practice: r.door === 0,
      sentAt: r.sent_at,
      family: { id: r.family_id, grownUpName: r.grown_up_name, detectives: Number(r.detectives) },
      placeName: run?.placeName ?? null,
      placeShownAt: run && openedAt(run.facts, now) === null ? shownAt(run.facts) : null,
      firstFamily: r.first_family === true,
    });
  }
  return out;
}

/** How many photos are waiting for a head elf (removed families' photos are not counted). */
export async function countPhotosWaiting(): Promise<number> {
  const res = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM elf_photos p JOIN elf_families f ON f.id = p.family_id
      WHERE p.status = 'waiting' AND f.removed_at IS NULL`,
  );
  return Number(res.rows[0]?.n ?? 0);
}

/** The bytes of a photo for a head elf to look at, in any status while its bytes are kept. */
export async function photoForStaff(id: number): Promise<{ mime: string; bytes: Buffer } | null> {
  const res = await pool.query<{ mime: string | null; bytes: Buffer }>(
    "SELECT p.mime, f.bytes FROM elf_photos p JOIN elf_photo_files f ON f.photo_id = p.id WHERE p.id = $1",
    [id],
  );
  const r = res.rows[0];
  return r ? { mime: r.mime ?? "image/jpeg", bytes: r.bytes } : null;
}

/** A head elf approves or declines a waiting photo. Locks are taken in the order the family's own
 *  sending takes them (the family row, then the photo rows), so the two never deadlock. "already" when
 *  someone got there first (nothing is written); null when there is no such photo. Approving replaces
 *  the same family's other approved photo at the same door and deletes its bytes; declining deletes
 *  this photo's bytes. The audit note holds the decision only, never the reason or a place. */
export async function decidePhoto(
  id: number,
  decision: "approved" | "declined",
  actor: string,
  reason: string | null,
): Promise<"done" | "already" | null> {
  return inTransaction(async (client) => {
    const who = await client.query<{ family_id: number }>("SELECT family_id FROM elf_photos WHERE id = $1", [id]);
    if (who.rows.length === 0) return null;
    await client.query("SELECT id FROM elf_families WHERE id = $1 FOR UPDATE", [who.rows[0].family_id]);
    const row = await client.query<{ id: number; status: string; year: number; door: number; family_id: number }>(
      "SELECT id, status, year, door, family_id FROM elf_photos WHERE id = $1 FOR UPDATE",
      [id],
    );
    const p = row.rows[0];
    if (!p) return null;
    if (p.status !== "waiting") return "already" as const;
    if (decision === "approved") {
      await client.query(
        `UPDATE elf_photos SET status = 'approved', decided_at = now(), decided_by = $2 WHERE id = $1`,
        [id, actor],
      );
      const replaced = await client.query<{ id: number }>(
        `UPDATE elf_photos SET status = 'replaced'
          WHERE year = $1 AND door = $2 AND family_id = $3 AND status = 'approved' AND id <> $4 RETURNING id`,
        [p.year, p.door, p.family_id, id],
      );
      if (replaced.rows.length > 0) {
        await client.query("DELETE FROM elf_photo_files WHERE photo_id = ANY($1::int[])", [replaced.rows.map((r) => r.id)]);
      }
    } else {
      await client.query(
        `UPDATE elf_photos SET status = 'declined', decided_at = now(), decided_by = $2, decline_reason = $3 WHERE id = $1`,
        [id, actor, reason],
      );
      await client.query("DELETE FROM elf_photo_files WHERE photo_id = ANY($1::int[])", [[id]]);
    }
    await insertAudit(client, { actor, action: "elf.photo.decided", entity: "elf_photo", entityId: id, data: { decision } });
    return "done" as const;
  });
}

/** A head elf takes a photo down (from approved or waiting): gone from the page at once and its bytes
 *  deleted. The reason, if given, is kept for head elves in the log; the audit note holds none. */
export async function takeDownPhoto(id: number, actor: string, reason: string | null): Promise<boolean> {
  return inTransaction(async (client) => {
    const who = await client.query<{ family_id: number }>("SELECT family_id FROM elf_photos WHERE id = $1", [id]);
    if (who.rows.length === 0) return false;
    await client.query("SELECT id FROM elf_families WHERE id = $1 FOR UPDATE", [who.rows[0].family_id]);
    const up = await client.query<{ id: number }>(
      // The reason is kept in decline_reason: a photo that was taken down was not declined, so the
      // column is free, and the log reads it by the status.
      `UPDATE elf_photos SET status = 'taken-down', taken_down_at = now(), taken_down_by = $2, decline_reason = $3
        WHERE id = $1 AND status IN ('approved', 'waiting') RETURNING id`,
      [id, actor, reason],
    );
    if (up.rows.length === 0) return false;
    await client.query("DELETE FROM elf_photo_files WHERE photo_id = ANY($1::int[])", [[id]]);
    await insertAudit(client, { actor, action: "elf.photo.taken_down", entity: "elf_photo", entityId: id, data: {} });
    return true;
  });
}

// ---- the log ------------------------------------------------------------------------------------------

export interface PhotoLogRow {
  id: number;
  door: Door | 0;
  practice: boolean;
  family: { grownUpName: string };
  status: string;
  steps: { at: Date; words: string }[];
}

interface LogSql {
  id: number;
  year: number;
  door: number;
  grown_up_name: string;
  status: string;
  sent_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
  decline_reason: string | null;
  taken_down_at: Date | null;
  taken_down_by: string | null;
  deleted_at: Date | null;
}

const LOG_SELECT = `SELECT p.id, p.year, p.door, f.grown_up_name, p.status, p.sent_at, p.decided_at, p.decided_by,
            p.decline_reason, p.taken_down_at, p.taken_down_by, p.deleted_at
       FROM elf_photos p JOIN elf_families f ON f.id = p.family_id`;

/** Who an actor string ("admin:<email>") is: the head elf's name, or the email when there is no row. */
async function namesOf(rows: LogSql[]): Promise<(actor: string | null) => string> {
  const emails = new Set<string>();
  for (const r of rows) {
    for (const a of [r.decided_by, r.taken_down_by]) {
      if (a && a.startsWith("admin:")) emails.add(a.slice("admin:".length).toLowerCase());
    }
  }
  const names = new Map<string, string>();
  if (emails.size > 0) {
    const users = await pool.query<{ full_name: string; email: string }>(
      "SELECT full_name, email FROM users WHERE lower(email) = ANY($1::text[])",
      [[...emails]],
    );
    for (const u of users.rows) names.set(u.email.toLowerCase(), headElfName(u));
  }
  return (actor) => {
    const email = (actor ?? "").replace(/^admin:/, "");
    return names.get(email.toLowerCase()) ?? email;
  };
}

function stepsOf(r: LogSql, name: (actor: string | null) => string): { at: Date; words: string }[] {
  const steps = [{ at: r.sent_at, words: "Sent" }];
  if (r.status === "declined" && r.decided_at) {
    steps.push({ at: r.decided_at, words: `Declined by ${name(r.decided_by)}${r.decline_reason ? `: ${r.decline_reason}` : ""}` });
  } else if (r.decided_at) {
    steps.push({ at: r.decided_at, words: `Approved by ${name(r.decided_by)}` });
  }
  if (r.taken_down_at) {
    if (r.taken_down_by === "family") steps.push({ at: r.taken_down_at, words: "Taken down by the family" });
    else steps.push({ at: r.taken_down_at, words: `Taken down by ${name(r.taken_down_by)}${r.decline_reason ? `: ${r.decline_reason}` : ""}` });
  }
  if (r.deleted_at) steps.push({ at: r.deleted_at, words: "Deleted" });
  return steps;
}

/** Every photo, newest first, as the lines the log shows. */
export async function photoLog(limit: number): Promise<PhotoLogRow[]> {
  const res = await pool.query<LogSql>(`${LOG_SELECT} ORDER BY p.sent_at DESC, p.id DESC LIMIT $1`, [limit]);
  const name = await namesOf(res.rows);
  return res.rows.map((r) => ({
    id: r.id,
    door: asDoor(r.door),
    practice: r.door === 0,
    family: { grownUpName: r.grown_up_name },
    status: r.status,
    steps: stepsOf(r, name),
  }));
}

const clock = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Europe/London" });

/** The newest step of one photo, as "Approved by Alex Example at 6:13pm" (a reason is left off), or
 *  null when there is no such photo. What a head elf who lost the race is shown. */
export async function photoStep(id: number): Promise<string | null> {
  const res = await pool.query<LogSql>(`${LOG_SELECT} WHERE p.id = $1`, [id]);
  const r = res.rows[0];
  if (!r) return null;
  const name = await namesOf([r]);
  const last = stepsOf(r, name).at(-1)!;
  return `${last.words.replace(/: [\s\S]*$/, "")} at ${clock.format(last.at).replace(/\s/g, "").toLowerCase()}`;
}

// ---- the end of the season ----------------------------------------------------------------------------

const londonParts = (d: Date): { year: number; month: number } => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "numeric" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month) };
};

/** The December a photo belongs to: its year, or for a practice photo (year 0) the December it was
 *  sent in (one sent in January belongs to the December before). */
function seasonOf(year: number, sentAt: Date): number {
  if (year > 0) return year;
  const { year: y, month } = londonParts(sentAt);
  return month === 1 ? y - 1 : y;
}

/** From 31 January of the year after its December, every photo is deleted: its bytes row goes and its
 *  row reads 'deleted'. 31 January starts at midnight, which in London in January is midnight UTC.
 *  Answers how many were deleted. Idempotent: it runs on every worker tick. */
export async function deleteExpiredPhotoFiles(now: Date): Promise<number> {
  return inTransaction(async (client) => {
    const found = await client.query<{ id: number; year: number; sent_at: Date }>(
      "SELECT id, year, sent_at FROM elf_photos WHERE status <> 'deleted' AND deleted_at IS NULL",
    );
    const ids = found.rows.filter((r) => Date.UTC(seasonOf(r.year, r.sent_at) + 1, 0, 31) <= now.getTime()).map((r) => r.id);
    if (ids.length === 0) return 0;
    await client.query("DELETE FROM elf_photo_files WHERE photo_id = ANY($1::int[])", [ids]);
    const up = await client.query(
      "UPDATE elf_photos SET status = 'deleted', deleted_at = $2 WHERE id = ANY($1::int[]) AND status <> 'deleted'",
      [ids, now],
    );
    return up.rowCount ?? 0;
  });
}
