import { pool } from "./pool";
import { insertAudit } from "./donations";
import { inTransaction } from "./elf-practice";
import type { MadePicture } from "./fundraiser-pictures";
import { clearOutFrom, decemberOf } from "../elf/calendar";

// NBCC Elf Detective School, Christmas Eve and the grand prize (Plan 2c-2): the store for the entries
// (tables in migrations/1791200000490_elf-grand-prize.js). The rules are pure, in src/elf/grand-prize.ts;
// this file reads and writes the rows. One picture a detective a year, replaced in place until the entries
// close, with its bytes kept apart in elf_grand_prize_files so the nightly backup leaves them out. An entry
// is never public: its own family sees it (entryPicture matches both the detective and the family), and
// head elves see every entry whose family has not been removed. Each write is audited in its transaction,
// never with a child's name, a picture or a mobile. The SQL is proved against a real database in CI.

/** Thrown by markWinner when the one winner index refuses the mark, because another head elf marked a
 *  winner at the same moment. Head Elf HQ answers it as a 409 with WINNER_TAKEN_WORDS (src/elf/grand-prize.ts).
 *  The year's entries are locked first, so this is only a safety net (ruling F5). */
export class WinnerTaken extends Error {
  constructor() {
    super("another head elf marked a winner at the same moment");
    this.name = "WinnerTaken";
  }
}

/** Thrown inside saveEntry when the detective is not the family's own, so the transaction stores nothing. */
class NotTheFamilysDetective extends Error {}

const isUniqueClash = (err: unknown): boolean => typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";

// ---- the family's side --------------------------------------------------------------------------------

/** A family sends in, or replaces, a detective's picture for the grand prize: one transaction. The family's
 *  row is locked first, as every photo writer does, so a family's pictures are saved one at a time. The
 *  detective and its family are taken from the one detective row, checked against both, so an entry is only
 *  ever its own family's (the tables cannot tie the two); a detective that is not the family's own stores
 *  nothing and throws. A mobile typed with the entry goes on the family, only when it has none. Then the
 *  entry for the year and the detective is read under lock and replaced in place (its mime, size and sent
 *  time), or added; either way its bytes row is added or replaced by one statement. */
export async function saveEntry(o: {
  year: number;
  detectiveId: number;
  familyId: number;
  picture: MadePicture;
  mobile: string | null;
  at: Date;
}): Promise<{ id: number; replaced: boolean }> {
  return inTransaction(async (client) => {
    await client.query("SELECT id FROM elf_families WHERE id = $1 FOR UPDATE", [o.familyId]);
    const checked = await client.query<{ id: number; family_id: number }>(
      "SELECT id, family_id FROM elf_detectives WHERE id = $1 AND family_id = $2 AND active",
      [o.detectiveId, o.familyId],
    );
    const own = checked.rows[0];
    if (!own) throw new NotTheFamilysDetective(`detective ${o.detectiveId} is not one of family ${o.familyId}'s`);
    const detectiveId = Number(own.id);
    const familyId = Number(own.family_id);
    if (o.mobile !== null) {
      await client.query("UPDATE elf_families SET mobile = $2 WHERE id = $1 AND mobile IS NULL", [familyId, o.mobile]);
    }
    const there = await client.query<{ id: number }>(
      "SELECT id FROM elf_grand_prize_entries WHERE year = $1 AND detective_id = $2 FOR UPDATE",
      [o.year, detectiveId],
    );
    const replaced = there.rows.length > 0;
    let id: number;
    if (replaced) {
      id = Number(there.rows[0].id);
      await client.query("UPDATE elf_grand_prize_entries SET mime = $2, width = $3, height = $4, sent_at = $5 WHERE id = $1", [
        id,
        o.picture.mime,
        o.picture.width,
        o.picture.height,
        o.at,
      ]);
    } else {
      const ins = await client.query<{ id: number }>(
        `INSERT INTO elf_grand_prize_entries (year, detective_id, family_id, mime, width, height, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [o.year, detectiveId, familyId, o.picture.mime, o.picture.width, o.picture.height, o.at],
      );
      id = Number(ins.rows[0].id);
    }
    // One statement for the bytes on both paths: the backups keep the entries but leave their pictures out,
    // so after a restore an entry can have no bytes row, and a plain UPDATE would then store nothing.
    await client.query(
      "INSERT INTO elf_grand_prize_files (entry_id, bytes) VALUES ($1, $2) ON CONFLICT (entry_id) DO UPDATE SET bytes = EXCLUDED.bytes",
      [id, o.picture.bytes],
    );
    await insertAudit(client, {
      actor: "family",
      action: "elf.grand_prize.entry",
      entity: "elf_grand_prize_entry",
      entityId: id,
      data: { year: o.year, familyId, replaced },
    });
    return { id, replaced };
  });
}

/** Does the family have a mobile number? Read without the number itself. */
export async function familyHasMobile(familyId: number): Promise<boolean> {
  const r = await pool.query<{ has: boolean }>("SELECT mobile IS NOT NULL AS has FROM elf_families WHERE id = $1", [familyId]);
  return r.rows[0]?.has === true;
}

/** The family's entries this year: each detective's id, to when its picture came in. */
export async function familyEntries(year: number, familyId: number): Promise<Map<number, { sentAt: Date }>> {
  const r = await pool.query<{ detective_id: number; sent_at: Date }>(
    "SELECT detective_id, sent_at FROM elf_grand_prize_entries WHERE year = $1 AND family_id = $2",
    [year, familyId],
  );
  return new Map(r.rows.map((row) => [Number(row.detective_id), { sentAt: row.sent_at }]));
}

/** A detective's entry picture, for its own family only: the detective and the family must both match.
 *  Null when there is none. */
export async function entryPicture(year: number, detectiveId: number, familyId: number): Promise<{ mime: string; bytes: Buffer } | null> {
  const r = await pool.query<{ mime: string; bytes: Buffer }>(
    `SELECT e.mime, b.bytes FROM elf_grand_prize_entries e
       JOIN elf_grand_prize_files b ON b.entry_id = e.id
      WHERE e.year = $1 AND e.detective_id = $2 AND e.family_id = $3`,
    [year, detectiveId, familyId],
  );
  const row = r.rows[0];
  return row ? { mime: row.mime, bytes: row.bytes } : null;
}

// ---- Head Elf HQ's side -------------------------------------------------------------------------------

/** An entry as head elves see it in Head Elf HQ's Grand prize part. */
export interface StaffEntry {
  id: number;
  /** The detective's full name (head elves only). */
  detective: string;
  grownUpName: string;
  /** The family's mobile, +447 and nine digits, or null when it has none. */
  mobile: string | null;
  /** When the picture came in: a replaced picture moves it to the newest picture's time. */
  sentAt: Date;
  winner: boolean;
}

/** Every entry of the year, oldest first, leaving removed families out: the detective by full name, the
 *  grown up, the family's mobile, and whether it is the winner. */
export async function listEntries(year: number): Promise<StaffEntry[]> {
  const r = await pool.query<{
    id: number;
    first_name: string;
    surname: string;
    grown_up_name: string;
    mobile: string | null;
    sent_at: Date;
    winner: boolean;
  }>(
    `SELECT e.id, d.first_name, d.surname, f.grown_up_name, f.mobile, e.sent_at, e.winner_at IS NOT NULL AS winner
       FROM elf_grand_prize_entries e
       JOIN elf_detectives d ON d.id = e.detective_id
       JOIN elf_families f ON f.id = e.family_id
      WHERE e.year = $1 AND f.removed_at IS NULL
      ORDER BY e.sent_at, e.id`,
    [year],
  );
  return r.rows.map((row) => ({
    id: Number(row.id),
    detective: `${row.first_name} ${row.surname}`,
    grownUpName: row.grown_up_name,
    mobile: row.mobile ?? null,
    sentAt: row.sent_at,
    winner: row.winner === true,
  }));
}

/** How many entries the year has, counted as listEntries lists them. */
export async function countEntries(year: number): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM elf_grand_prize_entries e
       JOIN elf_families f ON f.id = e.family_id
      WHERE e.year = $1 AND f.removed_at IS NULL`,
    [year],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** An entry's picture for head elves, by the entry's id, as listEntries lists it (its family not removed).
 *  Null when there is none. */
export async function staffEntryPicture(year: number, id: number): Promise<{ mime: string; bytes: Buffer } | null> {
  const r = await pool.query<{ mime: string; bytes: Buffer }>(
    `SELECT e.mime, b.bytes FROM elf_grand_prize_entries e
       JOIN elf_grand_prize_files b ON b.entry_id = e.id
       JOIN elf_families f ON f.id = e.family_id
      WHERE e.year = $1 AND e.id = $2 AND f.removed_at IS NULL`,
    [year, id],
  );
  const row = r.rows[0];
  return row ? { mime: row.mime, bytes: row.bytes } : null;
}

/** A head elf (`actor`) marks an entry as the year's one winner: one transaction. Every entry of the year is
 *  locked first, in id order, so two head elves marking at the same moment take turns and the later marking
 *  wins (ruling F5). False, with nothing changed, when the entry is not one of the year's, or its family has
 *  been removed (the list leaves it out). The year's other winner is cleared in one statement and this one
 *  marked in the next, because the one winner index is checked row by row. Throws WinnerTaken if the index
 *  still refuses the mark. */
export async function markWinner(year: number, id: number, actor: string): Promise<boolean> {
  try {
    return await inTransaction(async (client) => {
      const entries = await client.query<{ id: number; present: boolean }>(
        `SELECT e.id, f.removed_at IS NULL AS present
           FROM elf_grand_prize_entries e
           JOIN elf_families f ON f.id = e.family_id
          WHERE e.year = $1
          ORDER BY e.id FOR UPDATE OF e`,
        [year],
      );
      if (!entries.rows.some((e) => Number(e.id) === id && e.present === true)) return false;
      await client.query(
        "UPDATE elf_grand_prize_entries SET winner_at = NULL, winner_by = NULL WHERE year = $1 AND id <> $2 AND winner_at IS NOT NULL",
        [year, id],
      );
      await client.query("UPDATE elf_grand_prize_entries SET winner_at = now(), winner_by = $3 WHERE year = $1 AND id = $2", [year, id, actor]);
      await insertAudit(client, { actor, action: "elf.grand_prize.winner", entity: "elf_grand_prize_entry", entityId: id, data: { year, entryId: id } });
      return true;
    });
  } catch (err) {
    if (isUniqueClash(err)) throw new WinnerTaken();
    throw err;
  }
}

// ---- the end of January clear out ------------------------------------------------------------------

/** From 31 January after the December its picture came in for, every entry is deleted, as the entry page promises
 *  ("it is deleted at the end of January"): its picture goes with it (elf_grand_prize_files is ON DELETE CASCADE, and
 *  is never in the backups, so deleted means gone), and so does the winner's mark. The December is worked out from
 *  sent_at by the rule a practice photo's clear out uses (decemberOf, src/elf/calendar.ts), never from the entry's
 *  year: in production an entry is sent on Christmas Eve of its year, so the answer is the same, and in BDD, played
 *  in last year's December, a picture sent today belongs to the coming December, so a ticking worker never deletes it
 *  in the middle of a scenario. One transaction. Answers how many were deleted. Idempotent: it runs on every worker
 *  tick. */
export async function deleteExpiredGrandPrizeEntries(now: Date): Promise<number> {
  return inTransaction(async (client) => {
    const found = await client.query<{ id: number; sent_at: Date }>("SELECT id, sent_at FROM elf_grand_prize_entries");
    const ids = found.rows.filter((r) => clearOutFrom(decemberOf(r.sent_at)).getTime() <= now.getTime()).map((r) => Number(r.id));
    if (ids.length === 0) return 0;
    const gone = await client.query<{ id: number }>("DELETE FROM elf_grand_prize_entries WHERE id = ANY($1::int[]) RETURNING id", [ids]);
    return gone.rows.length;
  });
}
