import { describe, it, expect, vi, beforeEach } from "vitest";

// NBCC Elf Detective School wave 2: the doors data layer. There is no local database, so these read
// the SQL and parameters each function sends; features/elf-doors.feature proves them in CI.

const { query, clientQuery, release } = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../../src/db/pool", () => ({
  pool: { query, connect: async () => ({ query: clientQuery, release }) },
}));

import {
  addElfDoorName,
  changeElfDoor,
  ensureElfDoors,
  getElfDoor,
  getElfDoorByPosterCode,
  listElfDoors,
  markElfTagPrinted,
  removeElfDoorName,
  saveElfClue,
  savePastedClues,
  setElfTagWord,
  tickElfDoor,
} from "../../src/db/elf-doors";

const ACTOR = "admin:staff@example.org";

function doorRow(door: number, over: Record<string, unknown> = {}) {
  return {
    year: 2026,
    door,
    place_name: null,
    place_town: null,
    place_address: null,
    contact_name: null,
    contact_phone: null,
    contact_email: null,
    closes_at: null,
    elf_spot: null,
    agreed_by: null,
    prize: null,
    prize_show_off: false,
    elf_name: null,
    tag_word: null,
    tag_printed_at: null,
    clue1_time: null,
    clue2_time: null,
    clue3_time: null,
    reveal_time: null,
    poster_code: `code${door}`,
    dropped_off_at: null,
    dropped_off_by: null,
    thanked_at: null,
    thanked_by: null,
    ...over,
  };
}

/** A fake transaction: the door rows, names and clues it holds, and what else it was asked. */
function fakeClient(o: { door?: Record<string, unknown> | null; names?: { id: number; name: string }[]; clues?: { n: number; words: string }[] } = {}) {
  const door = o.door === undefined ? doorRow(7, { place_name: "Pine Cone Café" }) : o.door;
  clientQuery.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (/FROM elf_doors/.test(s) && /^\s*SELECT/.test(s)) return { rows: door ? [door] : [] };
    if (/FROM elf_door_names/.test(s) && /^\s*SELECT/.test(s)) return { rows: o.names ?? [] };
    if (/FROM elf_clues/.test(s) && /^\s*SELECT/.test(s)) return { rows: o.clues ?? [] };
    return { rows: [], rowCount: 1 };
  });
}

const sqls = () => clientQuery.mock.calls.map((c) => String(c[0]));
const call = (re: RegExp) => clientQuery.mock.calls.find((c) => re.test(String(c[0])));

beforeEach(() => {
  query.mockReset();
  clientQuery.mockReset();
  release.mockReset();
});

describe("ensureElfDoors", () => {
  it("sends one insert of 24 rows, each with its own poster code, and leaves existing rows alone", async () => {
    query.mockResolvedValue({ rows: [] });
    await ensureElfDoors(2026);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain("INSERT INTO elf_doors");
    expect(String(sql)).toContain("ON CONFLICT (year, door) DO NOTHING");
    expect(params[0]).toBe(2026);
    // year, then a poster code and a tag word for each of the 24 doors
    expect(params).toHaveLength(1 + 24 * 2);
    const codes = params.slice(1).filter((_: unknown, i: number) => i % 2 === 0);
    expect(new Set(codes).size).toBe(24);
  });

  it("tries once more with new codes when a poster code clashes", async () => {
    query.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "23505" }));
    query.mockResolvedValue({ rows: [] });
    await ensureElfDoors(2026);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1][1]).not.toBe(query.mock.calls[0][1][1]);
  });

  it("gives up after the second clash, and passes other errors on at once", async () => {
    const clash = Object.assign(new Error("dup"), { code: "23505" });
    query.mockRejectedValue(clash);
    await expect(ensureElfDoors(2026)).rejects.toBe(clash);
    expect(query).toHaveBeenCalledTimes(2);
    query.mockReset();
    query.mockRejectedValue(new Error("down"));
    await expect(ensureElfDoors(2026)).rejects.toThrow("down");
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("listElfDoors and getElfDoor", () => {
  it("turns rows into doors, with names in id order and clues 1, 2 and 3", async () => {
    query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/FROM elf_door_names/.test(s)) {
        return { rows: [{ door: 7, id: 9, name: "The Cone" }, { door: 7, id: 4, name: "Pine Cone Cafe" }] };
      }
      if (/FROM elf_clues/.test(s)) return { rows: [{ door: 7, n: 3, words: "Third" }, { door: 7, n: 1, words: "First" }] };
      return {
        rows: [
          doorRow(7, { place_name: "Pine Cone Café", prize_show_off: true, closes_at: "18:00", tag_printed_at: new Date("2026-11-10T10:00:00Z") }),
          doorRow(8),
        ],
      };
    });
    const doors = await listElfDoors(2026);
    expect(doors.map((d) => d.door)).toEqual([7, 8]);
    expect(String(query.mock.calls[0][0])).toMatch(/ORDER BY door/);
    const seven = doors[0];
    expect(seven.placeName).toBe("Pine Cone Café");
    expect(seven.prizeShowOff).toBe(true);
    expect(seven.closesAt).toBe("18:00");
    expect(seven.posterCode).toBe("code7");
    expect(seven.tagPrintedAt).toEqual(new Date("2026-11-10T10:00:00Z"));
    expect(seven.names).toEqual([{ id: 4, name: "Pine Cone Cafe" }, { id: 9, name: "The Cone" }]);
    expect(seven.clues).toEqual([
      { n: 1, words: "First", hasPicture: false, pictureAlt: null },
      { n: 2, words: null, hasPicture: false, pictureAlt: null },
      { n: 3, words: "Third", hasPicture: false, pictureAlt: null },
    ]);
    expect(doors[1].names).toEqual([]);
    expect(doors[1].clues.map((c) => c.words)).toEqual([null, null, null]);
  });

  it("answers null for a door with no row", async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await getElfDoor(2026, 7)).toBeNull();
  });

  it("reads one door with its names and clues", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/FROM elf_door_names/.test(String(sql))) return { rows: [{ id: 1, name: "Cone" }] };
      if (/FROM elf_clues/.test(String(sql))) return { rows: [{ n: 2, words: "Two" }] };
      return { rows: [doorRow(7)] };
    });
    const d = await getElfDoor(2026, 7);
    expect(d?.names).toEqual([{ id: 1, name: "Cone" }]);
    expect(d?.clues[1]).toEqual({ n: 2, words: "Two", hasPicture: false, pictureAlt: null });
  });
});

describe("changeElfDoor", () => {
  it("writes only the keys it knows, and audits the field names, never the values", async () => {
    fakeClient();
    const out = await changeElfDoor(2026, 7, { placeName: "Pine Cone Café", nonsense: 1 } as never, ACTOR);
    expect(out?.door).toBe(7);
    const update = call(/UPDATE elf_doors/)!;
    expect(String(update[0])).toContain("place_name = $1");
    expect(String(update[0])).not.toContain("nonsense");
    expect(String(update[0])).not.toContain("place_town");
    expect(String(update[0])).toContain("updated_at = now()");
    expect(update[1]).toEqual(["Pine Cone Café", ACTOR, 2026, 7]);
    const audit = call(/INSERT INTO audit_log/)!;
    const text = JSON.stringify(audit[1]);
    expect(text).toContain("elf.door.change");
    expect(text).toContain('"placeName"');
    expect(text).not.toContain("Pine Cone");
    expect(sqls()).toContain("COMMIT");
  });

  it("can clear a field with null", async () => {
    fakeClient();
    await changeElfDoor(2026, 7, { prize: null }, ACTOR);
    expect(call(/UPDATE elf_doors/)![1]).toEqual([null, ACTOR, 2026, 7]);
  });

  it("answers null and writes nothing for a door with no row", async () => {
    fakeClient({ door: null });
    expect(await changeElfDoor(2026, 7, { prize: "A prize" }, ACTOR)).toBeNull();
    expect(call(/UPDATE elf_doors/)).toBeUndefined();
    expect(call(/INSERT INTO audit_log/)).toBeUndefined();
    expect(sqls()).toContain("ROLLBACK");
  });
});

describe("addElfDoorName", () => {
  it("answers taken, and inserts nothing, for the place's own name said another way", async () => {
    fakeClient();
    expect(await addElfDoorName(2026, 7, "the pine cone cafe", ACTOR)).toBe("taken");
    expect(call(/INSERT INTO elf_door_names/)).toBeUndefined();
    expect(call(/INSERT INTO audit_log/)).toBeUndefined();
    expect(String(call(/FROM elf_doors/)![0])).toContain("FOR UPDATE");
  });

  it("answers taken for a name the door already has", async () => {
    fakeClient({ names: [{ id: 3, name: "The Cone" }] });
    expect(await addElfDoorName(2026, 7, "cone", ACTOR)).toBe("taken");
  });

  it("adds a new name and audits that a name was added, not what it was", async () => {
    fakeClient();
    await addElfDoorName(2026, 7, "Cone Corner", ACTOR);
    const ins = call(/INSERT INTO elf_door_names/)!;
    expect(ins[1]).toEqual([2026, 7, "Cone Corner", ACTOR]);
    const audit = call(/INSERT INTO audit_log/)!;
    expect(JSON.stringify(audit[1])).toContain("elf.door.name.add");
    expect(JSON.stringify(audit[1])).not.toContain("Cone Corner");
  });

  it("answers null for a door with no row", async () => {
    fakeClient({ door: null });
    expect(await addElfDoorName(2026, 7, "Cone", ACTOR)).toBeNull();
  });
});

describe("removeElfDoorName", () => {
  it("deletes that name from that door", async () => {
    fakeClient();
    await removeElfDoorName(2026, 7, 12, ACTOR);
    const del = call(/DELETE FROM elf_door_names/)!;
    expect(String(del[0])).toMatch(/id = \$1 AND year = \$2 AND door = \$3/);
    expect(del[1]).toEqual([12, 2026, 7]);
    expect(JSON.stringify(call(/INSERT INTO audit_log/)![1])).toContain("elf.door.name.remove");
  });

  it("answers null for a door with no row", async () => {
    fakeClient({ door: null });
    expect(await removeElfDoorName(2026, 7, 12, ACTOR)).toBeNull();
  });
});

describe("setElfTagWord and markElfTagPrinted", () => {
  it("sets the word and clears the printed mark", async () => {
    fakeClient();
    await setElfTagWord(2026, 7, "SNOWBALL 472", ACTOR);
    const update = call(/UPDATE elf_doors/)!;
    expect(String(update[0])).toContain("tag_word = $1");
    expect(String(update[0])).toContain("tag_printed_at = NULL");
    expect(update[1]).toEqual(["SNOWBALL 472", ACTOR, 2026, 7]);
    expect(JSON.stringify(call(/INSERT INTO audit_log/)![1])).not.toContain("SNOWBALL");
  });

  it("marks the tag printed", async () => {
    fakeClient();
    await markElfTagPrinted(2026, 7, ACTOR);
    expect(String(call(/UPDATE elf_doors/)![0])).toContain("tag_printed_at = now()");
    expect(JSON.stringify(call(/INSERT INTO audit_log/)![1])).toContain("elf.door.tag.printed");
  });

  it("does nothing, and says nothing, for a door with no row", async () => {
    fakeClient({ door: null });
    await expect(markElfTagPrinted(2026, 7, ACTOR)).resolves.toBeUndefined();
    expect(call(/INSERT INTO audit_log/)).toBeUndefined();
  });
});

describe("tickElfDoor", () => {
  it("ticking on sets the time and who", async () => {
    fakeClient();
    await tickElfDoor(2026, 7, "droppedOff", true, ACTOR);
    const update = call(/UPDATE elf_doors/)!;
    expect(String(update[0])).toContain("dropped_off_at = now()");
    expect(String(update[0])).toContain("dropped_off_by = $1");
    expect(update[1]).toEqual([ACTOR, 2026, 7]);
  });

  it("ticking off clears both", async () => {
    fakeClient();
    await tickElfDoor(2026, 7, "thanked", false, ACTOR);
    const update = call(/UPDATE elf_doors/)!;
    expect(String(update[0])).toContain("thanked_at = NULL");
    expect(String(update[0])).toContain("thanked_by = NULL");
    expect(update[1]).toEqual([ACTOR, 2026, 7]);
  });
});

describe("saveElfClue", () => {
  it("upserts the words", async () => {
    fakeClient();
    await saveElfClue(2026, 7, 2, "Look high", ACTOR);
    const up = call(/INSERT INTO elf_clues/)!;
    expect(String(up[0])).toContain("ON CONFLICT (year, door, n) DO UPDATE");
    expect(up[1]).toEqual([2026, 7, 2, "Look high", ACTOR]);
    expect(JSON.stringify(call(/INSERT INTO audit_log/)![1])).not.toContain("Look high");
  });

  it("removes the clue when the words are null", async () => {
    fakeClient();
    await saveElfClue(2026, 7, 2, null, ACTOR);
    expect(call(/INSERT INTO elf_clues/)).toBeUndefined();
    expect(call(/DELETE FROM elf_clues/)![1]).toEqual([2026, 7, 2]);
  });

  it("answers null for a door with no row", async () => {
    fakeClient({ door: null });
    expect(await saveElfClue(2026, 7, 1, "x", ACTOR)).toBeNull();
  });

  it("clears the words of a clue that has a picture, and deletes the row only when it has none", async () => {
    fakeClient();
    await saveElfClue(2026, 7, 2, null, ACTOR);
    const clear = call(/UPDATE elf_clues/)!;
    expect(String(clear[0])).toContain("words = NULL");
    expect(String(clear[0])).toContain("picture IS NOT NULL");
    expect(String(call(/DELETE FROM elf_clues/)![0])).toContain("picture IS NULL");
  });
});

describe("the game's columns on a door", () => {
  it("reads found, snow day and gone home, and a clue's picture flag and alt text", async () => {
    query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/FROM elf_door_names/.test(s)) return { rows: [] };
      if (/FROM elf_clues/.test(s)) return { rows: [{ door: 7, n: 1, words: null, has_picture: true, picture_alt: "A pretend picture" }] };
      return {
        rows: [
          doorRow(7, {
            found_at: new Date("2026-12-07T18:00:00Z"),
            found_family_id: 12,
            snow_day_at: new Date("2026-12-07T17:30:00Z"),
            snow_day_by: "automatic",
            gone_home_at: new Date("2026-12-08T09:00:00Z"),
            gone_home_by: ACTOR,
          }),
        ],
      };
    });
    const [d] = await listElfDoors(2026);
    expect(d.foundAt).toEqual(new Date("2026-12-07T18:00:00Z"));
    expect(d.foundFamilyId).toBe(12);
    expect(d.snowDayAt).toEqual(new Date("2026-12-07T17:30:00Z"));
    expect(d.snowDayBy).toBe("automatic");
    expect(d.goneHomeAt).toEqual(new Date("2026-12-08T09:00:00Z"));
    expect(d.goneHomeBy).toBe(ACTOR);
    expect(d.clues[0]).toEqual({ n: 1, words: null, hasPicture: true, pictureAlt: "A pretend picture" });
  });

  it("reads all of them as empty when the columns are null", async () => {
    query.mockImplementation(async (sql: string) => (/FROM elf_door_names|FROM elf_clues/.test(String(sql)) ? { rows: [] } : { rows: [doorRow(7)] }));
    const [d] = await listElfDoors(2026);
    expect([d.foundAt, d.foundFamilyId, d.snowDayAt, d.snowDayBy, d.goneHomeAt, d.goneHomeBy]).toEqual([null, null, null, null, null, null]);
  });

  it("ticks snow day and gone home, in their own columns and audit actions", async () => {
    fakeClient();
    await tickElfDoor(2026, 7, "snowDay", true, ACTOR);
    expect(String(call(/UPDATE elf_doors/)![0])).toContain("snow_day_at = now()");
    expect(String(call(/UPDATE elf_doors/)![0])).toContain("snow_day_by = $1");
    expect(JSON.stringify(call(/INSERT INTO audit_log/)![1])).toContain("elf.door.snow_day");
    clientQuery.mockReset();
    fakeClient();
    await tickElfDoor(2026, 7, "goneHome", false, ACTOR);
    expect(String(call(/UPDATE elf_doors/)![0])).toContain("gone_home_at = NULL");
    expect(String(call(/UPDATE elf_doors/)![0])).toContain("gone_home_by = NULL");
    expect(JSON.stringify(call(/INSERT INTO audit_log/)![1])).toContain("elf.door.gone_home");
  });

  it("finds a door by its poster code, and answers null for none", async () => {
    query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/FROM elf_door_names|FROM elf_clues/.test(s)) return { rows: [] };
      return { rows: [doorRow(9, { poster_code: "abcdefghijkm" })] };
    });
    const d = await getElfDoorByPosterCode("abcdefghijkm");
    expect(d?.door).toBe(9);
    expect(query.mock.calls[0][1]).toEqual(["abcdefghijkm"]);
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
    expect(await getElfDoorByPosterCode("zzzzzzzzzzzz")).toBeNull();
  });
});

describe("savePastedClues", () => {
  const doors = [
    { door: 3 as const, line: 1, clues: [{ n: 1 as const, words: "a" }, { n: 2 as const, words: "b" }, { n: 3 as const, words: "c" }] },
    { door: 9 as const, line: 5, clues: [{ n: 1 as const, words: "d" }, { n: 2 as const, words: "e" }, { n: 3 as const, words: "f" }] },
  ];

  it("upserts every clue and audits the door numbers in one transaction", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const out = await savePastedClues(2026, doors, ACTOR);
    expect(out).toEqual({ doors: 2, clues: 6 });
    const s = sqls();
    expect(s[0]).toBe("BEGIN");
    expect(s.filter((q) => /INSERT INTO elf_clues/.test(q))).toHaveLength(6);
    expect(s.every((q) => !/INSERT INTO elf_clues/.test(q) || q.includes("ON CONFLICT (year, door, n) DO UPDATE"))).toBe(true);
    expect(s[s.length - 1]).toBe("COMMIT");
    const audit = call(/INSERT INTO audit_log/)!;
    const text = JSON.stringify(audit[1]);
    expect(text).toContain("elf.clues.paste");
    expect(text).toContain("[3,9]");
    expect(text).not.toContain('"a"');
  });

  it("locks the doors' rows first, in ascending door order, whatever order they came in", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    await savePastedClues(2026, [doors[1], doors[0]], ACTOR);
    const s = sqls();
    expect(s[0]).toBe("BEGIN");
    expect(s[1]).toContain("FROM elf_doors");
    expect(s[1]).toContain("ORDER BY door");
    expect(s[1]).toContain("FOR UPDATE");
    expect(clientQuery.mock.calls[1][1]).toEqual([2026, [3, 9]]);
    expect(s.findIndex((q) => /INSERT INTO elf_clues/.test(q))).toBeGreaterThan(1);
  });

  it("rolls everything back when an upsert throws", async () => {
    let n = 0;
    clientQuery.mockImplementation(async (sql: string) => {
      if (/INSERT INTO elf_clues/.test(String(sql)) && ++n === 3) throw new Error("boom");
      return { rows: [], rowCount: 1 };
    });
    await expect(savePastedClues(2026, doors, ACTOR)).rejects.toThrow("boom");
    expect(sqls()).toContain("ROLLBACK");
    expect(sqls()).not.toContain("COMMIT");
    expect(call(/INSERT INTO audit_log/)).toBeUndefined();
    expect(release).toHaveBeenCalled();
  });
});
