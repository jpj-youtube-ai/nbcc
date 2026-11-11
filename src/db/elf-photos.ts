import { pool } from "./pool";
import { insertAudit } from "./donations";
import { inTransaction } from "./elf-practice";
import { loadDoorRun, loadPractice, type DoorRun } from "./elf-game";
import { headElfName } from "../elf/alerts";
import { isDoor, type Door } from "../elf/calendar";
import { openedAt, shownAt } from "../elf/doors";
import { approvedFamiliesSql } from "./elf-photo-sql";

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
            ${approvedFamiliesSql("p", true)} = 0 AS first_family
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

/** The door of the oldest photo waiting for a head elf (0 for the practice door), or null when none waits:
 *  what the photo alert names. One small read, without removed families. */
export async function oldestWaitingPhotoDoor(): Promise<Door | 0 | null> {
  const res = await pool.query<{ door: number }>(
    `SELECT p.door FROM elf_photos p JOIN elf_families f ON f.id = p.family_id
      WHERE p.status = 'waiting' AND f.removed_at IS NULL
      ORDER BY p.sent_at, p.id LIMIT 1`,
  );
  const r = res.rows[0];
  return r ? asDoor(Number(r.door)) : null;
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
 *  deleted. The reason, if given, is kept for head elves in the log; the audit note holds none. True when it
 *  was taken down, false when it was not up, null when there is no such photo. */
export async function takeDownPhoto(id: number, actor: string, reason: string | null): Promise<boolean | null> {
  return inTransaction(async (client) => {
    const who = await client.query<{ family_id: number }>("SELECT family_id FROM elf_photos WHERE id = $1", [id]);
    if (who.rows.length === 0) return null;
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
  /** An approved photo that no one sees yet because no second family's photo is approved on its door. */
  held: boolean;
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
  held?: boolean;
}

const LOG_SELECT = `SELECT p.id, p.year, p.door, f.grown_up_name, p.status, p.sent_at, p.decided_at, p.decided_by,
            p.decline_reason, p.taken_down_at, p.taken_down_by, p.deleted_at,
            (p.status = 'approved' AND ${approvedFamiliesSql("p")} < 2) AS held
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
  // The decision is read from the columns, never from the status: from 31 January every expired row reads
  // 'deleted', and the log keeps its lines. A decline has decided_at and a reason and no taken_down_at; an
  // approval that was later taken down has taken_down_at, and that take down's reason shares decline_reason.
  const declined = !!r.decided_at && (r.status === "declined" || (!!r.decline_reason && !r.taken_down_at));
  if (declined && r.decided_at) {
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

/** The photos, newest first, as the lines the log shows: every photo that is up, however old, since its line
 *  is the only place a head elf can take it down; and the newest `limit` of the rest. One statement, so the
 *  answer is one moment's. */
export async function photoLog(limit: number): Promise<PhotoLogRow[]> {
  const res = await pool.query<LogSql>(
    `${LOG_SELECT}
      WHERE p.status = 'approved'
         OR p.id IN (SELECT q.id FROM elf_photos q WHERE q.status <> 'approved' ORDER BY q.sent_at DESC, q.id DESC LIMIT $1)
      ORDER BY p.sent_at DESC, p.id DESC`,
    [limit],
  );
  const name = await namesOf(res.rows);
  return res.rows.map((r) => ({
    id: r.id,
    door: asDoor(r.door),
    practice: r.door === 0,
    family: { grownUpName: r.grown_up_name },
    status: r.status,
    held: r.held === true,
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
  // A photo the family replaced while it waited has no time of its own: say so in words.
  if (r.status === "replaced") return "Replaced by a newer photo from the family";
  const name = await namesOf([r]);
  const last = stepsOf(r, name).at(-1)!;
  const time = clock.format(last.at).replace(/\s/g, "").toLowerCase().replace(/:00(?=[ap]m)/, "");
  return `${last.words.replace(/: [\s\S]*$/, "")} at ${time}`;
}

// ---- the end of the season ----------------------------------------------------------------------------

const londonParts = (d: Date): { year: number; month: number } => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "numeric" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month) };
};

/** The December a photo belongs to: its year, or for a practice photo (year 0) the December it was
 *  sent in. One sent in January before the 31st belongs to the December before; one sent on or after
 *  31 January belongs to the coming December, so no practice photo is past its clear out the moment it
 *  is sent. January in London is on GMT, so its midnight is midnight UTC. */
function seasonOf(year: number, sentAt: Date): number {
  if (year > 0) return year;
  const { year: y, month } = londonParts(sentAt);
  return month === 1 && sentAt.getTime() < Date.UTC(y, 0, 31) ? y - 1 : y;
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
    // The photo rows first and then their bytes, the order every other photo writer takes.
    const up = await client.query<{ id: number }>(
      "UPDATE elf_photos SET status = 'deleted', deleted_at = $2 WHERE id = ANY($1::int[]) AND status <> 'deleted' RETURNING id",
      [ids, now],
    );
    if (up.rows.length === 0) return 0;
    await client.query("DELETE FROM elf_photo_files WHERE photo_id = ANY($1::int[])", [up.rows.map((r) => r.id)]);
    return up.rows.length;
  });
}
