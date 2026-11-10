import type { PoolClient } from "pg";
import { pool } from "./pool";
import { writeWithAudit, type AuditInput } from "./donations";
import type { Door } from "../elf/calendar";
import { DOOR_COUNT } from "../elf/calendar";
import type { DoorSetup } from "../elf/door-setup";
import { emptyDoor } from "../elf/door-setup";
import { makePosterCode, makeTagWord } from "../elf/door-codes";
import { normalisePlaceName } from "../elf/place-names";
import type { ClueN, PastedDoor } from "../elf/clue-paste";

// NBCC Elf Detective School wave 2: the 24 doors (tables in migrations/1791200000420_elf-doors.js).
// Design: docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md. These rows name the secret
// places, so they are for staff only, and an audit record names the fields changed, never their values.
// The routes are src/routes/admin-elf-doors.ts; the SQL is proved against a real database in CI.

export type DoorChange = Partial<
  Pick<
    DoorSetup,
    | "placeName"
    | "placeTown"
    | "placeAddress"
    | "contactName"
    | "contactPhone"
    | "contactEmail"
    | "closesAt"
    | "elfSpot"
    | "agreedBy"
    | "prize"
    | "prizeShowOff"
    | "elfName"
    | "clue1Time"
    | "clue2Time"
    | "clue3Time"
    | "revealTime"
  >
>;

/** Each key a head elf may change, and the column it lives in. Nothing else is ever written. */
const DOOR_COLUMNS: Record<keyof DoorChange, string> = {
  placeName: "place_name",
  placeTown: "place_town",
  placeAddress: "place_address",
  contactName: "contact_name",
  contactPhone: "contact_phone",
  contactEmail: "contact_email",
  closesAt: "closes_at",
  elfSpot: "elf_spot",
  agreedBy: "agreed_by",
  prize: "prize",
  prizeShowOff: "prize_show_off",
  elfName: "elf_name",
  clue1Time: "clue1_time",
  clue2Time: "clue2_time",
  clue3Time: "clue3_time",
  revealTime: "reveal_time",
};

type Querier = Pick<PoolClient, "query">;

interface DoorRow {
  door: number;
  place_name: string | null;
  place_town: string | null;
  place_address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  closes_at: string | null;
  elf_spot: string | null;
  agreed_by: string | null;
  prize: string | null;
  prize_show_off: boolean;
  elf_name: string | null;
  tag_word: string | null;
  tag_printed_at: Date | null;
  clue1_time: string | null;
  clue2_time: string | null;
  clue3_time: string | null;
  reveal_time: string | null;
  poster_code: string;
  dropped_off_at: Date | null;
  dropped_off_by: string | null;
  thanked_at: Date | null;
  thanked_by: string | null;
}

interface NameRow {
  door?: number;
  id: number;
  name: string;
}

interface ClueRow {
  door?: number;
  n: number;
  words: string;
}

const DOOR_COLUMN_LIST =
  `door, place_name, place_town, place_address, contact_name, contact_phone, contact_email, closes_at, elf_spot,
   agreed_by, prize, prize_show_off, elf_name, tag_word, tag_printed_at, clue1_time, clue2_time, clue3_time,
   reveal_time, poster_code, dropped_off_at, dropped_off_by, thanked_at, thanked_by`;

function doorFrom(row: DoorRow, names: NameRow[], clues: ClueRow[]): DoorSetup {
  const d = emptyDoor(row.door as Door, row.poster_code);
  return {
    ...d,
    placeName: row.place_name,
    placeTown: row.place_town,
    placeAddress: row.place_address,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    closesAt: row.closes_at,
    elfSpot: row.elf_spot,
    agreedBy: row.agreed_by,
    prize: row.prize,
    prizeShowOff: row.prize_show_off,
    elfName: row.elf_name,
    tagWord: row.tag_word,
    tagPrintedAt: row.tag_printed_at,
    clue1Time: row.clue1_time,
    clue2Time: row.clue2_time,
    clue3Time: row.clue3_time,
    revealTime: row.reveal_time,
    droppedOffAt: row.dropped_off_at,
    droppedOffBy: row.dropped_off_by,
    thankedAt: row.thanked_at,
    thankedBy: row.thanked_by,
    names: [...names].sort((a, b) => a.id - b.id).map((x) => ({ id: x.id, name: x.name })),
    clues: ([1, 2, 3] as const).map((n) => ({ n, words: clues.find((c) => c.n === n)?.words ?? null })),
  };
}

/** One door with its names and clues; null when it has no row. `lock` holds the door row for the
 *  rest of the transaction. */
async function readDoor(q: Querier, year: number, door: Door, lock = false): Promise<DoorSetup | null> {
  const r = await q.query<DoorRow>(
    `SELECT ${DOOR_COLUMN_LIST} FROM elf_doors WHERE year = $1 AND door = $2${lock ? " FOR UPDATE" : ""}`,
    [year, door],
  );
  const row = r.rows[0];
  if (!row) return null;
  const names = await q.query<NameRow>("SELECT id, name FROM elf_door_names WHERE year = $1 AND door = $2 ORDER BY id", [year, door]);
  const clues = await q.query<ClueRow>("SELECT n, words FROM elf_clues WHERE year = $1 AND door = $2 ORDER BY n", [year, door]);
  return doorFrom(row, names.rows, clues.rows);
}

/** Thrown inside an audited write when there is nothing to change, so the transaction rolls back. */
class NotThere extends Error {}

/** Thrown inside addElfDoorName when the name is already one the door has. */
class NameTaken extends Error {}

/** writeWithAudit, answering null when the write finds nothing to change. */
async function audited<T>(write: (client: PoolClient) => Promise<T>, audit: (result: T) => AuditInput): Promise<T | null> {
  try {
    return await writeWithAudit(write, audit);
  } catch (err) {
    if (err instanceof NotThere) return null;
    throw err;
  }
}

const isUniqueClash = (err: unknown): boolean => typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";

/** Locks a door's row and reads it whole, or ends the write as "no such door". */
async function lockedDoor(client: PoolClient, year: number, door: Door): Promise<DoorSetup> {
  const d = await readDoor(client, year, door, true);
  if (!d) throw new NotThere();
  return d;
}

// ---- reading ---------------------------------------------------------------------------------------

/** Adds any of the year's 24 doors that have no row yet, each with its own poster code and tag word. */
export async function ensureElfDoors(year: number): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const params: unknown[] = [year];
    const rows: string[] = [];
    for (let door = 1; door <= DOOR_COUNT; door++) {
      params.push(makePosterCode(), makeTagWord());
      rows.push(`($1, ${door}, $${params.length - 1}, $${params.length})`);
    }
    try {
      await pool.query(
        `INSERT INTO elf_doors (year, door, poster_code, tag_word)
         VALUES ${rows.join(", ")}
         ON CONFLICT (year, door) DO NOTHING`,
        params,
      );
      return;
    } catch (err) {
      // A poster code that clashes with another is a one in a billion chance: new codes, once.
      if (attempt === 0 && isUniqueClash(err)) continue;
      throw err;
    }
  }
}

/** The year's doors in door order, each with its names and its three clues. */
export async function listElfDoors(year: number): Promise<DoorSetup[]> {
  const doors = await pool.query<DoorRow>(`SELECT ${DOOR_COLUMN_LIST} FROM elf_doors WHERE year = $1 ORDER BY door`, [year]);
  const names = await pool.query<NameRow>("SELECT door, id, name FROM elf_door_names WHERE year = $1 ORDER BY door, id", [year]);
  const clues = await pool.query<ClueRow>("SELECT door, n, words FROM elf_clues WHERE year = $1 ORDER BY door, n", [year]);
  return doors.rows.map((row) =>
    doorFrom(
      row,
      names.rows.filter((x) => x.door === row.door),
      clues.rows.filter((x) => x.door === row.door),
    ),
  );
}

/** One door, or null when it has no row. */
export async function getElfDoor(year: number, door: Door): Promise<DoorSetup | null> {
  return readDoor(pool, year, door);
}

// ---- changing --------------------------------------------------------------------------------------

/** Changes the details a head elf types in, writing only the keys present. */
export async function changeElfDoor(year: number, door: Door, change: DoorChange, actor: string): Promise<DoorSetup | null> {
  const keys = (Object.keys(DOOR_COLUMNS) as (keyof DoorChange)[]).filter((k) => Object.prototype.hasOwnProperty.call(change, k) && change[k] !== undefined);
  return audited(
    async (client) => {
      await lockedDoor(client, year, door);
      const sets = keys.map((k, i) => `${DOOR_COLUMNS[k]} = $${i + 1}`);
      await client.query(
        `UPDATE elf_doors SET ${[...sets, "updated_at = now()", `updated_by = $${keys.length + 1}`].join(", ")}
          WHERE year = $${keys.length + 2} AND door = $${keys.length + 3}`,
        [...keys.map((k) => change[k]), actor, year, door],
      );
      return (await readDoor(client, year, door)) as DoorSetup;
    },
    () => ({ actor, action: "elf.door.change", entity: "elf_door", entityId: door, data: { year, fields: keys } }),
  );
}

/** Adds a name that counts for the door. "taken" when it is the place's name, or one of its names, said
 *  another way (checked with the door row locked, so two at once cannot both add it). */
export async function addElfDoorName(year: number, door: Door, name: string, actor: string): Promise<DoorSetup | null | "taken"> {
  try {
    return await audited(
      async (client) => {
        const d = await lockedDoor(client, year, door);
        const wanted = normalisePlaceName(name);
        const held = [d.placeName ?? "", ...d.names.map((x) => x.name)].map(normalisePlaceName);
        if (held.includes(wanted)) throw new NameTaken();
        await client.query("INSERT INTO elf_door_names (year, door, name, added_by) VALUES ($1, $2, $3, $4)", [year, door, name, actor]);
        return (await readDoor(client, year, door)) as DoorSetup;
      },
      () => ({ actor, action: "elf.door.name.add", entity: "elf_door", entityId: door, data: { year } }),
    );
  } catch (err) {
    if (err instanceof NameTaken) return "taken";
    throw err;
  }
}

/** Takes one name off a door. */
export async function removeElfDoorName(year: number, door: Door, id: number, actor: string): Promise<DoorSetup | null> {
  return audited(
    async (client) => {
      await lockedDoor(client, year, door);
      await client.query("DELETE FROM elf_door_names WHERE id = $1 AND year = $2 AND door = $3", [id, year, door]);
      return (await readDoor(client, year, door)) as DoorSetup;
    },
    () => ({ actor, action: "elf.door.name.remove", entity: "elf_door", entityId: door, data: { year, nameId: id } }),
  );
}

/** Sets the door's tag word, and so the printed tag is no longer the right one. */
export async function setElfTagWord(year: number, door: Door, word: string, actor: string): Promise<DoorSetup | null> {
  return audited(
    async (client) => {
      await lockedDoor(client, year, door);
      await client.query(
        `UPDATE elf_doors SET tag_word = $1, tag_printed_at = NULL, updated_at = now(), updated_by = $2
          WHERE year = $3 AND door = $4`,
        [word, actor, year, door],
      );
      return (await readDoor(client, year, door)) as DoorSetup;
    },
    () => ({ actor, action: "elf.door.tag.set", entity: "elf_door", entityId: door, data: { year } }),
  );
}

/** Notes that the door's tag has been printed. */
export async function markElfTagPrinted(year: number, door: Door, actor: string): Promise<void> {
  await audited(
    async (client) => {
      await lockedDoor(client, year, door);
      await client.query(
        "UPDATE elf_doors SET tag_printed_at = now(), updated_at = now(), updated_by = $1 WHERE year = $2 AND door = $3",
        [actor, year, door],
      );
      return true;
    },
    () => ({ actor, action: "elf.door.tag.printed", entity: "elf_door", entityId: door, data: { year } }),
  );
}

/** Ticks "dropped off" or "thanked" on or off. On records the time and who; off clears both. */
export async function tickElfDoor(
  year: number,
  door: Door,
  which: "droppedOff" | "thanked",
  on: boolean,
  actor: string,
): Promise<DoorSetup | null> {
  const [atColumn, byColumn] = which === "droppedOff" ? ["dropped_off_at", "dropped_off_by"] : ["thanked_at", "thanked_by"];
  return audited(
    async (client) => {
      await lockedDoor(client, year, door);
      if (on) {
        await client.query(
          `UPDATE elf_doors SET ${atColumn} = now(), ${byColumn} = $1, updated_at = now(), updated_by = $1
            WHERE year = $2 AND door = $3`,
          [actor, year, door],
        );
      } else {
        await client.query(
          `UPDATE elf_doors SET ${atColumn} = NULL, ${byColumn} = NULL, updated_at = now(), updated_by = $1
            WHERE year = $2 AND door = $3`,
          [actor, year, door],
        );
      }
      return (await readDoor(client, year, door)) as DoorSetup;
    },
    () => ({ actor, action: "elf.door.tick", entity: "elf_door", entityId: door, data: { year, which, on } }),
  );
}

// ---- clues -----------------------------------------------------------------------------------------

const UPSERT_CLUE_SQL = `INSERT INTO elf_clues (year, door, n, words, updated_by) VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (year, door, n) DO UPDATE SET words = EXCLUDED.words, updated_at = now(), updated_by = EXCLUDED.updated_by`;

/** Saves one clue's words; null words removes the clue. */
export async function saveElfClue(year: number, door: Door, n: ClueN, words: string | null, actor: string): Promise<DoorSetup | null> {
  return audited(
    async (client) => {
      await lockedDoor(client, year, door);
      if (words === null) {
        await client.query("DELETE FROM elf_clues WHERE year = $1 AND door = $2 AND n = $3", [year, door, n]);
      } else {
        await client.query(UPSERT_CLUE_SQL, [year, door, n, words, actor]);
      }
      return (await readDoor(client, year, door)) as DoorSetup;
    },
    () => ({ actor, action: "elf.clue.save", entity: "elf_door", entityId: door, data: { year, n, removed: words === null } }),
  );
}

/** Saves a pasted file's clues for several doors in one go: all of them or none. */
export async function savePastedClues(year: number, doors: PastedDoor[], actor: string): Promise<{ doors: number; clues: number }> {
  return writeWithAudit(
    async (client) => {
      let clues = 0;
      for (const d of doors) {
        for (const c of d.clues) {
          await client.query(UPSERT_CLUE_SQL, [year, d.door, c.n, c.words, actor]);
          clues++;
        }
      }
      return { doors: doors.length, clues };
    },
    () => ({ actor, action: "elf.clues.paste", entity: "elf_door", entityId: null, data: { year, doors: doors.map((d) => d.door) } }),
  );
}
