import type { PoolClient } from "pg";
import { pool } from "./pool";
import { makePosterCode, makeTagWord } from "../elf/door-codes";

// NBCC Elf Detective School wave 2: the practice door. One row (elf_practice, migrations/
// 1791200000440_elf-game.js) with absolute clue times, so a practice evening can be played at any time
// of day. Its game rows live in the same tables as the real doors, as year 0, door 0, and are cleared
// whenever a practice is started or cleared. The row names a pretend place; it is seen only by a
// browser holding the preview cookie. The SQL is proved against a real database in CI.

export interface PracticeRow {
  startedAt: Date;
  startedBy: string;
  placeName: string;
  placeTown: string;
  elfName: string;
  tagWord: string;
  posterCode: string;
  clue1At: Date;
  clue2At: Date;
  clue3At: Date;
  revealAt: Date;
  foundAt: Date | null;
  foundFamilyId: number | null;
}

interface PracticeSql {
  started_at: Date;
  started_by: string;
  place_name: string;
  place_town: string;
  elf_name: string;
  tag_word: string;
  poster_code: string;
  clue1_at: Date;
  clue2_at: Date;
  clue3_at: Date;
  reveal_at: Date;
  found_at: Date | null;
  found_family_id: number | null;
}

const COLUMNS =
  "started_at, started_by, place_name, place_town, elf_name, tag_word, poster_code, clue1_at, clue2_at, clue3_at, reveal_at, found_at, found_family_id";

function practiceFrom(r: PracticeSql): PracticeRow {
  return {
    startedAt: r.started_at,
    startedBy: r.started_by,
    placeName: r.place_name,
    placeTown: r.place_town,
    elfName: r.elf_name,
    tagWord: r.tag_word,
    posterCode: r.poster_code,
    clue1At: r.clue1_at,
    clue2At: r.clue2_at,
    clue3At: r.clue3_at,
    revealAt: r.reveal_at,
    foundAt: r.found_at ?? null,
    foundFamilyId: r.found_family_id ?? null,
  };
}

/** The practice door's rows in each game table, and the practice row itself. */
async function deletePractice(client: Pick<PoolClient, "query">): Promise<void> {
  await client.query("DELETE FROM elf_practice");
  await client.query("DELETE FROM elf_guesses WHERE year = 0");
  await client.query("DELETE FROM elf_word_tries WHERE year = 0");
  await client.query("DELETE FROM elf_visits WHERE year = 0");
  // The photo bytes (elf_photo_files) go with their photos, by the table's cascade.
  await client.query("DELETE FROM elf_photos WHERE year = 0");
}

/** Runs `work` in one transaction: committed when it returns, rolled back when it throws. */
export async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
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

/** Starts a practice evening: clue 1 a minute from `now`, each later time `minutesApart` after the one
 *  before, the place shown `minutesApart` after clue 3. Replaces any earlier practice and its play. */
export async function startPractice(o: {
  placeName: string;
  placeTown: string;
  elfName: string;
  minutesApart: number;
  startedBy: string;
  now: Date;
}): Promise<PracticeRow> {
  const minute = 60 * 1000;
  const clue1At = new Date(o.now.getTime() + minute);
  const gap = o.minutesApart * minute;
  const clue2At = new Date(clue1At.getTime() + gap);
  const clue3At = new Date(clue2At.getTime() + gap);
  const revealAt = new Date(clue3At.getTime() + gap);
  return inTransaction(async (client) => {
    await deletePractice(client);
    const r = await client.query<PracticeSql>(
      `INSERT INTO elf_practice (id, started_at, started_by, place_name, place_town, elf_name, tag_word, poster_code, clue1_at, clue2_at, clue3_at, reveal_at)
       VALUES (1, $11, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${COLUMNS}`,
      [o.startedBy, o.placeName, o.placeTown, o.elfName, makeTagWord(), makePosterCode(), clue1At, clue2At, clue3At, revealAt, o.now],
    );
    return practiceFrom(r.rows[0]);
  });
}

/** The practice door, or null when none is set. */
export async function getPractice(): Promise<PracticeRow | null> {
  const r = await pool.query<PracticeSql>(`SELECT ${COLUMNS} FROM elf_practice WHERE id = 1`);
  return r.rows[0] ? practiceFrom(r.rows[0]) : null;
}

/** Removes the practice door and everything played at it. */
export async function clearPractice(): Promise<void> {
  await inTransaction(async (client) => {
    await deletePractice(client);
  });
}

/** Sets the practice door's found time, once. True when this call was the one that set it. `q` is the
 *  caller's transaction, when it has one. */
export async function markPracticeFound(familyId: number, at: Date, q: Pick<PoolClient, "query"> = pool): Promise<boolean> {
  const r = await q.query(
    "UPDATE elf_practice SET found_at = $1, found_family_id = $2 WHERE id = 1 AND found_at IS NULL",
    [at, familyId],
  );
  return (r.rowCount ?? 0) > 0;
}
