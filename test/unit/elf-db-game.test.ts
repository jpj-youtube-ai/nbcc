import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// NBCC Elf Detective School wave 2: the game's data layer and the one loader every family route reads
// through. No local database: these read the SQL and parameters each function sends; the BDD in CI
// proves the SQL. Every name here is invented.

const { query, clientQuery, release } = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../../src/db/pool", () => ({
  pool: { query, connect: async () => ({ query: clientQuery, release }) },
}));

import {
  PHOTOS_A_DAY,
  approvedPhoto,
  canRun,
  clearWordTries,
  cluePicture,
  doorCounts,
  doorScrapbook,
  familyDoorsDone,
  familyGuesses,
  familyHasWon,
  familyPhoto,
  familyVisits,
  familyWordTries,
  finderParts,
  giveBackWordTry,
  loadDoorRun,
  loadDoorRunByPosterCode,
  loadDoorRuns,
  loadPractice,
  markAutomaticSnowDays,
  onDoorsSwitchedOn,
  recordWord,
  runOf,
  runsFor,
  saveGuess,
  sendElfPhoto,
  takeDownOwnPhoto,
  takeWordTry,
  visitElf,
  waveOneRuns,
  doorGuesses,
  detectiveDoorsDone,
  type DoorRun,
} from "../../src/db/elf-game";
import { emptyDoor, type DoorSetup } from "../../src/elf/door-setup";
import { ELF_NAMES } from "../../src/elf/names";
import { ELF_DEFAULTS } from "../../src/elf/settings";
import { PRACTICE_CLUES } from "../../src/elf/practice-words";

const ACTOR = "admin:staff@example.org";
const at = (iso: string) => new Date(iso);
// 7 December 2026 is a Monday: a school day, so clue 1 is 5:30pm, then 6pm, 6:30pm, and the place at 7pm.
const FIVE_31 = at("2026-12-07T17:31:00Z");
const FIVE_29 = at("2026-12-07T17:29:00Z");
const SIX_10 = at("2026-12-07T18:10:00Z");

const noPicture = (n: 1 | 2 | 3, words: string | null) => ({ n, words, hasPicture: false, pictureAlt: null });

function fullDoor(over: Partial<DoorSetup> = {}): DoorSetup {
  return {
    ...emptyDoor(7, "abcdefghijkm"),
    placeName: "Pine Cone Café",
    placeTown: "Exampleton",
    placeAddress: "1 Example Street",
    contactEmail: "shop@example.org",
    closesAt: "20:30",
    prize: "A pretend sledge",
    prizeShowOff: true,
    elfName: "Twinkle",
    tagWord: "SNOWBALL 472",
    names: [{ id: 1, name: "The Cone" }],
    clues: [noPicture(1, "Clue one"), noPicture(2, "Clue two"), noPicture(3, "Clue three")],
    ...over,
  };
}

const sqls = () => clientQuery.mock.calls.map((c) => String(c[0]));
const call = (re: RegExp) => clientQuery.mock.calls.find((c) => re.test(String(c[0])));

beforeEach(() => {
  query.mockReset();
  clientQuery.mockReset();
  release.mockReset();
  clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

afterEach(() => vi.useRealTimers());

describe("runOf", () => {
  it("is hunting at 5:31pm with the four instants right and the email and closing time carried", () => {
    const run = runOf(fullDoor(), true, FIVE_31);
    expect(run.state).toBe("hunting");
    expect(run.year).toBe(2026);
    expect(run.door).toBe(7);
    expect(run.facts.clue1At).toEqual(at("2026-12-07T17:30:00Z"));
    expect(run.facts.clue2At).toEqual(at("2026-12-07T18:00:00Z"));
    expect(run.facts.clue3At).toEqual(at("2026-12-07T18:30:00Z"));
    expect(run.facts.revealAt).toEqual(at("2026-12-07T19:00:00Z"));
    expect(run.facts.closesAt).toEqual(at("2026-12-07T20:30:00Z"));
    expect(run.facts.foundAt).toBeNull();
    expect(run.contactEmail).toBe("shop@example.org");
    expect(run.closesAt).toBe("20:30");
    expect(run.placeName).toBe("Pine Cone Café");
    expect(run.names).toEqual(["Pine Cone Café", "The Cone"]);
    expect(run.elfName).toBe("Twinkle");
    expect(run.prize).toBe("A pretend sledge");
    expect(run.prizeShowOff).toBe(true);
    expect(run.posterCode).toBe("abcdefghijkm");
    expect(run.clues.map((c) => c.at)).toEqual([run.facts.clue1At, run.facts.clue2At, run.facts.clue3At]);
  });

  it("is a snow day once snowDayAt is set: snow at 5:31pm and still shut at 5:29pm", () => {
    const snowy = fullDoor({ snowDayAt: at("2026-12-07T17:30:00Z") });
    expect(runOf(snowy, true, FIVE_31).state).toBe("snow");
    expect(runOf(snowy, true, FIVE_29).state).toBe("shut");
  });

  it("never guesses a snow day: no tag word and no snowDayAt is still hunting", () => {
    expect(runOf(fullDoor({ tagWord: null }), true, FIVE_31).state).toBe("hunting");
  });

  it("falls back to the elf's stock name", () => {
    expect(runOf(fullDoor({ elfName: null }), true, FIVE_31).elfName).toBe(ELF_NAMES[6]);
  });

  it("carries the found time, found family and gone home", () => {
    const run = runOf(fullDoor({ foundAt: at("2026-12-07T17:45:00Z"), foundFamilyId: 4, goneHomeAt: at("2026-12-08T09:00:00Z") }), true, at("2026-12-07T17:50:00Z"));
    expect(run.state).toBe("found-hidden");
    expect(run.foundFamilyId).toBe(4);
    expect(run.facts.goneHome).toBe(true);
  });

  it("closes an hour after the reveal when the closing time cannot be read, so a door is never left hunting", () => {
    // Clue 1 at 11:59pm on Christmas Eve leaves no time to hunt: closingInstant answers null.
    const late = { ...fullDoor({ door: 24, clue1Time: "23:59", clue2Time: "23:59", clue3Time: "23:59", revealTime: "23:59" }) };
    const run = runOf(late, false, at("2026-12-25T00:30:00Z"));
    expect(run.facts.closesAt).toEqual(new Date(run.facts.revealAt.getTime() + 60 * 60 * 1000));
    expect(Number.isNaN(run.facts.closesAt.getTime())).toBe(false);
  });
});

describe("canRun", () => {
  it("needs a place, a usable tag word and a first clue of words or a picture", () => {
    expect(canRun(fullDoor())).toBe(true);
    expect(canRun(fullDoor({ tagWord: null }))).toBe(false);
    expect(canRun(fullDoor({ tagWord: "SNOWBALL" }))).toBe(false);
    expect(canRun(fullDoor({ placeName: "   " }))).toBe(false);
    expect(canRun(fullDoor({ placeName: null }))).toBe(false);
    expect(canRun(fullDoor({ clues: [noPicture(1, null), noPicture(2, "two"), noPicture(3, "three")] }))).toBe(false);
    expect(canRun(fullDoor({ clues: [{ n: 1, words: null, hasPicture: true, pictureAlt: "A pretend picture" }, noPicture(2, null), noPicture(3, null)] }))).toBe(true);
  });
});

function listDoors(rows: Record<string, unknown>[]) {
  query.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (/FROM elf_door_names|FROM elf_clues/.test(s)) return { rows: [] };
    if (/FROM elf_doors/.test(s)) return { rows };
    if (/FROM elf_practice/.test(s)) return { rows: [] };
    return { rows: [] };
  });
}

function row(door: number, over: Record<string, unknown> = {}) {
  return {
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
    found_at: null,
    found_family_id: null,
    snow_day_at: null,
    snow_day_by: null,
    gone_home_at: null,
    gone_home_by: null,
    ...over,
  };
}

describe("markAutomaticSnowDays", () => {
  it("snows in a started door that cannot run, and leaves a door whose clue is still to come", async () => {
    // Door 7 has a place and a clue but no tag word; door 8 lacks one too, but its clue 1 is tomorrow.
    listDoors([
      row(7, { place_name: "Pine Cone Café" }),
      row(8, { place_name: "Holly Hall" }),
    ]);
    query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/FROM elf_door_names/.test(s)) return { rows: [] };
      if (/FROM elf_clues/.test(s)) return { rows: [{ door: 7, n: 1, words: "Clue one" }, { door: 8, n: 1, words: "Clue one" }] };
      return { rows: [row(7, { place_name: "Pine Cone Café" }), row(8, { place_name: "Holly Hall" })] };
    });
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const marked = await markAutomaticSnowDays(2026, FIVE_31);
    expect(marked).toEqual([7]);
    const updates = clientQuery.mock.calls.filter((c) => /UPDATE elf_doors/.test(String(c[0])));
    expect(updates).toHaveLength(1);
    expect(String(updates[0][0])).toContain("snow_day_by = 'automatic'");
    expect(String(updates[0][0])).toContain("snow_day_at IS NULL");
    expect(updates[0][1]).toEqual([at("2026-12-07T17:30:00Z"), 2026, 7]);
    const audit = JSON.stringify(call(/INSERT INTO audit_log/)![1]);
    expect(audit).toContain("elf.door.snow_day");
    expect(audit).toContain("automatic");
    expect(audit).not.toContain("Pine Cone");
  });

  it("leaves a door that can run, and one already snowed in", async () => {
    query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/FROM elf_door_names/.test(s)) return { rows: [] };
      if (/FROM elf_clues/.test(s)) return { rows: [{ door: 7, n: 1, words: "Clue one" }, { door: 6, n: 1, words: "x" }] };
      return {
        rows: [
          row(7, { place_name: "Pine Cone Café", tag_word: "SNOWBALL 472" }),
          row(6, { snow_day_at: at("2026-12-06T17:30:00Z") }),
        ],
      };
    });
    expect(await markAutomaticSnowDays(2026, FIVE_31)).toEqual([]);
    expect(call(/UPDATE elf_doors/)).toBeUndefined();
  });

  it("does not mark a door when another writer got there first", async () => {
    query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/FROM elf_door_names|FROM elf_clues/.test(s)) return { rows: [] };
      return { rows: [row(7)] };
    });
    clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await markAutomaticSnowDays(2026, FIVE_31)).toEqual([]);
    expect(call(/INSERT INTO audit_log/)).toBeUndefined();
  });
});

describe("waveOneRuns", () => {
  it("gives the 24 doors as wave 1 showed them: shut, no words, stock elves, no prize", () => {
    const runs = waveOneRuns(2026, SIX_10);
    expect(runs).toHaveLength(24);
    expect(runs.map((r) => r.door)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    for (const r of runs) {
      expect(r.state).toBe("shut");
      expect(r.year).toBe(2026);
      expect(r.clues).toEqual([]);
      expect(r.names).toEqual([]);
      expect(r.placeName).toBeNull();
      expect(r.prize).toBeNull();
      expect(r.prizeShowOff).toBe(false);
      expect(r.posterCode).toBe("");
      expect(r.tagWord).toBeNull();
      expect(r.facts.snowDay).toBe(false);
      expect(r.facts.foundAt).toBeNull();
      expect(r.elfName).toBe(ELF_NAMES[r.door - 1]);
    }
  });

  it("keeps a door whose default clue 1 is past shut, and one still to come at its default time", () => {
    const runs = waveOneRuns(2026, SIX_10);
    expect(runs[6].facts.clue1At.getTime()).toBeGreaterThan(at("2100-01-01T00:00:00Z").getTime());
    expect(runs[7].facts.clue1At).toEqual(at("2026-12-08T17:30:00Z"));
  });
});

describe("runsFor", () => {
  const settingsOff = { ...ELF_DEFAULTS, schoolOn: true, doorsOn: false };
  const settingsOn = { ...ELF_DEFAULTS, schoolOn: true, doorsOn: true };

  it("never reads the doors with the switch off, and gives wave 1's doors", async () => {
    const out = await runsFor({ settings: settingsOff, now: SIX_10, practice: false });
    expect(query).not.toHaveBeenCalled();
    expect(out.runs).toHaveLength(24);
    expect(out.runs.every((r) => r.state === "shut" && r.clues.length === 0)).toBe(true);
    expect(out.practice).toBeNull();
  });

  it("adds door 0 for a practice browser, even with the switch off, and never the real doors", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/FROM elf_practice/.test(String(sql))) {
        return {
          rows: [
            {
              started_at: at("2026-12-07T17:00:00Z"),
              started_by: "x",
              place_name: "The Pretend Kettle",
              place_town: "Exampleton",
              elf_name: "Tinsel",
              tag_word: "SNOWBALL 472",
              poster_code: "practicecode",
              clue1_at: at("2026-12-07T18:01:00Z"),
              clue2_at: at("2026-12-07T18:04:00Z"),
              clue3_at: at("2026-12-07T18:07:00Z"),
              reveal_at: at("2026-12-07T18:10:00Z"),
              found_at: null,
              found_family_id: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const out = await runsFor({ settings: settingsOff, now: SIX_10, practice: true });
    expect(query.mock.calls.every((c) => !/FROM elf_doors/.test(String(c[0])))).toBe(true);
    expect(out.practice?.door).toBe(0);
    expect(out.practice?.year).toBe(0);
    expect(out.practice?.state).toBe("hunting");
    expect(out.runs.every((r) => r.door >= 1)).toBe(true);
  });

  it("reads the real doors with the switch on, and no practice unless asked", async () => {
    listDoors([row(7, { place_name: "Pine Cone Café" })]);
    const out = await runsFor({ settings: settingsOn, now: SIX_10, practice: false });
    expect(query.mock.calls.some((c) => /FROM elf_doors/.test(String(c[0])))).toBe(true);
    expect(query.mock.calls.some((c) => /FROM elf_practice/.test(String(c[0])))).toBe(false);
    expect(out.runs).toHaveLength(24);
    expect(out.practice).toBeNull();
    expect(out.runs[6].placeName).toBe("Pine Cone Café");
  });
});

describe("the loaders", () => {
  it("reads a door with no row as an empty door, and never ensures the rows", async () => {
    listDoors([row(7, { place_name: "Pine Cone Café" })]);
    const runs = await loadDoorRuns(2026, SIX_10);
    expect(runs).toHaveLength(24);
    expect(runs[0].placeName).toBeNull();
    expect(runs[0].posterCode).toBe("");
    expect(query.mock.calls.every((c) => !/INSERT/.test(String(c[0])))).toBe(true);
  });

  it("loads one door, with an empty door for no row", async () => {
    query.mockImplementation(async () => ({ rows: [] }));
    const run = await loadDoorRun(2026, 7, SIX_10);
    expect(run.door).toBe(7);
    expect(run.placeName).toBeNull();
    expect(run.state).toBe("hunting");
  });

  it("matches a poster code, and never matches an empty one", async () => {
    expect(await loadDoorRunByPosterCode("", SIX_10)).toBeNull();
    expect(query).not.toHaveBeenCalled();
    query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/FROM elf_door_names|FROM elf_clues/.test(s)) return { rows: [] };
      return { rows: [{ year: 2026, ...row(7, { poster_code: "abcdefghijkm" }) }] };
    });
    const run = await loadDoorRunByPosterCode("abcdefghijkm", SIX_10);
    expect(run?.door).toBe(7);
    expect(run?.year).toBe(2026);
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
    expect(await loadDoorRunByPosterCode("zzzzzzzzzzzz", SIX_10)).toBeNull();
  });

  it("loads the practice door as door 0 of year 0, with the pretend clues and an hour to close", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          started_at: at("2026-12-07T17:00:00Z"),
          started_by: "x",
          place_name: "The Pretend Kettle",
          place_town: "Exampleton",
          elf_name: "Tinsel",
          tag_word: "SNOWBALL 472",
          poster_code: "practicecode",
          clue1_at: at("2026-12-07T18:01:00Z"),
          clue2_at: at("2026-12-07T18:04:00Z"),
          clue3_at: at("2026-12-07T18:07:00Z"),
          reveal_at: at("2026-12-07T18:10:00Z"),
          found_at: null,
          found_family_id: null,
        },
      ],
    });
    const run = (await loadPractice(SIX_10)) as DoorRun;
    expect(run.year).toBe(0);
    expect(run.door).toBe(0);
    expect(run.names).toEqual(["The Pretend Kettle"]);
    expect(run.clues.map((c) => c.words)).toEqual([...PRACTICE_CLUES]);
    expect(run.clues.map((c) => c.at)).toEqual([at("2026-12-07T18:01:00Z"), at("2026-12-07T18:04:00Z"), at("2026-12-07T18:07:00Z")]);
    expect(run.facts.closesAt).toEqual(at("2026-12-07T19:10:00Z"));
    expect(run.posterCode).toBe("practicecode");
    expect(run.elfName).toBe("Tinsel");
    query.mockResolvedValueOnce({ rows: [] });
    expect(await loadPractice(SIX_10)).toBeNull();
  });
});

describe("guesses", () => {
  it("upserts a guess", async () => {
    await saveGuess(2026, 7, 3, { text: "The Cone", norm: "the cone" }, FIVE_31);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain("INSERT INTO elf_guesses");
    expect(String(sql)).toContain("ON CONFLICT (year, door, family_id) DO UPDATE");
    expect(params).toEqual([2026, 7, 3, "The Cone", "the cone", FIVE_31]);
  });

  it("maps a family's guesses by door", async () => {
    query.mockResolvedValueOnce({ rows: [{ door: 7, text: "The Cone", norm: "the cone", saved_at: FIVE_31 }] });
    const m = await familyGuesses(2026, 3);
    expect(m.get(7)).toEqual({ text: "The Cone", norm: "the cone", at: FIVE_31 });
  });

  it("leaves removed families out of a door's guesses", async () => {
    query.mockResolvedValueOnce({ rows: [{ family_id: 3, text: "The Cone", norm: "the cone", saved_at: FIVE_31 }] });
    const list = await doorGuesses(2026, 7);
    expect(String(query.mock.calls[0][0])).toContain("removed_at IS NULL");
    expect(list).toEqual([{ familyId: 3, guess: { text: "The Cone", norm: "the cone", at: FIVE_31 } }]);
  });
});

describe("word tries", () => {
  it("takes a try with one upsert and returns the count", async () => {
    query.mockResolvedValueOnce({ rows: [{ wrong: 3 }] });
    expect(await takeWordTry(2026, 7, 3)).toBe(3);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain("ON CONFLICT");
    expect(String(sql)).toContain("wrong = elf_word_tries.wrong + 1");
    expect(String(sql)).toContain("RETURNING wrong");
    expect(params).toEqual([2026, 7, 3]);
  });

  it("gives one back, never below 0", async () => {
    await giveBackWordTry(2026, 7, 3);
    expect(String(query.mock.calls[0][0])).toContain("GREATEST(wrong - 1, 0)");
  });

  it("lists a family's tries", async () => {
    query.mockResolvedValueOnce({ rows: [{ door: 7, wrong: 2 }] });
    expect(await familyWordTries(2026, 3)).toEqual([{ door: 7, wrong: 2 }]);
  });

  it("clears the tries and audits the ids, not the words", async () => {
    await clearWordTries(2026, 7, 3, ACTOR);
    expect(String(call(/UPDATE elf_word_tries/)![0])).toContain("wrong = 0");
    const audit = call(/INSERT INTO audit_log/)!;
    expect(audit[1][0]).toBe(ACTOR);
    expect(audit[1][1]).toBe("elf.word_tries.cleared");
    expect(JSON.stringify(audit[1][4])).toBe(JSON.stringify({ year: 2026, door: 7, familyId: 3 }));
  });
});

describe("familyHasWon", () => {
  it("asks the doors for a find by the family", async () => {
    query.mockResolvedValueOnce({ rows: [{ won: true }] });
    expect(await familyHasWon(2026, 3)).toBe(true);
    expect(String(query.mock.calls[0][0])).toContain("found_family_id");
    query.mockResolvedValueOnce({ rows: [{ won: false }] });
    expect(await familyHasWon(2026, 3)).toBe(false);
  });
});

describe("recordWord", () => {
  const base = { year: 2026, door: 7 as const, familyId: 3, detectiveIds: [10, 11], shownAt: at("2026-12-07T19:00:00Z"), at: at("2026-12-07T17:45:00Z"), looks: { 10: { a: 1 }, 11: { b: 2 } } };

  function tx(o: { claimRows: number; stamped?: number[] }) {
    clientQuery.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/UPDATE elf_doors/.test(s)) return { rows: [], rowCount: o.claimRows };
      if (/INSERT INTO elf_visits/.test(s)) return { rows: (o.stamped ?? [10, 11]).map((d) => ({ detective_id: d })), rowCount: (o.stamped ?? [10, 11]).length };
      return { rows: [], rowCount: 0 };
    });
  }

  it("wins when the claim row updates: found_at is set under found_at IS NULL, and the visit counts from the claim", async () => {
    tx({ claimRows: 1 });
    const r = await recordWord({ ...base, won: true });
    expect(r).toEqual({ won: true, countsFrom: base.at, stamped: [10, 11] });
    const s = sqls();
    expect(s[0]).toBe("BEGIN");
    const claim = call(/UPDATE elf_doors/)!;
    expect(String(claim[0])).toContain("found_at IS NULL");
    expect(String(claim[0])).toContain("found_family_id");
    expect(claim[1]).toEqual([base.at, 3, 2026, 7]);
    const visits = call(/INSERT INTO elf_visits/)!;
    expect(String(visits[0])).toContain("ON CONFLICT (year, door, detective_id) DO NOTHING");
    expect(String(visits[0])).toContain("RETURNING detective_id");
    expect(visits[1]).toContain(true);
    expect(s[s.length - 1]).toBe("COMMIT");
    const audit = call(/INSERT INTO audit_log/)!;
    expect(audit[1][0]).toBe("family");
    expect(audit[1][1]).toBe("elf.door.found");
    expect(release).toHaveBeenCalled();
  });

  it("loses when the UPDATE's rowCount is 0: someone was first, so the visit counts from the shown time and found is false", async () => {
    tx({ claimRows: 0 });
    const r = await recordWord({ ...base, won: true });
    expect(r.won).toBe(false);
    expect(r.countsFrom).toEqual(base.shownAt);
    expect(r.stamped).toEqual([10, 11]);
    const visits = call(/INSERT INTO elf_visits/)!;
    expect(visits[1]).toContain(false);
    expect(visits[1]).toContain(base.shownAt);
    expect(visits[1]).not.toContain(true);
    expect(JSON.stringify(call(/INSERT INTO audit_log/)![1])).toContain("elf.door.visited");
  });

  it("counts a late typer from the time they typed, when that is after the shown time", async () => {
    tx({ claimRows: 0 });
    const late = at("2026-12-07T19:30:00Z");
    const r = await recordWord({ ...base, won: true, at: late });
    expect(r.countsFrom).toEqual(late);
  });

  it("a plain visit never touches the door's found time", async () => {
    tx({ claimRows: 0 });
    const r = await recordWord({ ...base, won: false });
    expect(call(/UPDATE elf_doors/)).toBeUndefined();
    expect(r.won).toBe(false);
    expect(r.countsFrom).toEqual(base.shownAt);
  });

  it("marks the practice door found for door 0, and never updates elf_doors", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/UPDATE elf_practice/.test(s)) return { rows: [], rowCount: 1 };
      if (/INSERT INTO elf_visits/.test(s)) return { rows: [{ detective_id: 10 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const r = await recordWord({ ...base, year: 0, door: 0, detectiveIds: [10], won: true });
    expect(r.won).toBe(true);
    expect(call(/UPDATE elf_doors/)).toBeUndefined();
    expect(String(call(/UPDATE elf_practice/)![0])).toContain("found_at IS NULL");
  });

  it("rolls back when the stamps cannot be written", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (/INSERT INTO elf_visits/.test(String(sql))) throw new Error("boom");
      return { rows: [], rowCount: 1 };
    });
    await expect(recordWord({ ...base, won: true })).rejects.toThrow("boom");
    expect(sqls()).toContain("ROLLBACK");
    expect(call(/INSERT INTO audit_log/)).toBeUndefined();
  });

  it("stamps only the detectives it has", async () => {
    tx({ claimRows: 1, stamped: [] });
    const r = await recordWord({ ...base, detectiveIds: [], won: false });
    expect(r.stamped).toEqual([]);
    expect(call(/INSERT INTO elf_visits/)).toBeUndefined();
  });
});

describe("visits", () => {
  it("lists a family's visits", async () => {
    query.mockResolvedValueOnce({ rows: [{ door: 7, detective_id: 10, counts_from: FIVE_31, found: true }] });
    expect(await familyVisits(2026, 3)).toEqual([{ door: 7, detectiveId: 10, countsFrom: FIVE_31, found: true }]);
  });

  it("names the finder's detectives, leaving a removed family out", async () => {
    query.mockResolvedValueOnce({ rows: [{ first_name: "Ruby", surname: "Tinselfoot", name_approved: true }] });
    expect(await finderParts(2026, 7)).toEqual([{ firstName: "Ruby", surname: "Tinselfoot", approved: true }]);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("removed_at IS NULL");
    expect(sql).toContain("found");
  });
});

describe("familyDoorsDone and detectiveDoorsDone", () => {
  // Door 7 is open (nobody found it, so the place was shown when it closed, 8:30pm); the family guessed before then.
  const open = runOf(fullDoor(), true, at("2026-12-07T21:00:00Z"));
  const snowed = runOf(fullDoor({ door: 8, snowDayAt: at("2026-12-08T17:30:00Z") }), true, at("2026-12-08T19:30:00Z"));
  const now = at("2026-12-08T19:30:00Z");

  function db() {
    query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/FROM elf_detectives/.test(s) && /family_id = \$1/.test(s) && !/WHERE id/.test(s)) return { rows: [{ id: 10 }, { id: 11 }] };
      if (/FROM elf_detectives WHERE id/.test(s)) return { rows: [{ family_id: 3 }] };
      if (/FROM elf_guesses/.test(s)) return { rows: [{ door: 7, text: "The Cone", norm: "cone", saved_at: at("2026-12-07T18:00:00Z") }] };
      if (/FROM elf_visits/.test(s)) {
        return {
          rows: [
            { door: 7, detective_id: 10, counts_from: at("2026-12-07T19:00:00Z"), found: false },
            { door: 9, detective_id: 11, counts_from: at("2026-12-09T09:00:00Z"), found: false },
            { door: 0, detective_id: 11, counts_from: at("2026-12-07T19:00:00Z"), found: false },
          ],
        };
      }
      return { rows: [] };
    });
  }

  it("gives each detective the cracked doors of the family, their own counted stamps, and the snow days", async () => {
    db();
    const m = await familyDoorsDone(2026, 3, [open, snowed], now);
    expect(m.get(10)).toEqual({ cracked: [7], visited: [7], snow: [8] });
    // detective 11's stamp for door 9 does not count until 9 December, and the practice door never counts
    expect(m.get(11)).toEqual({ cracked: [7], visited: [], snow: [8] });
  });

  it("gives one detective's doors", async () => {
    db();
    expect(await detectiveDoorsDone(2026, 10, [open, snowed], now)).toEqual({ cracked: [7], visited: [7], snow: [8] });
  });
});

describe("doorCounts", () => {
  it("counts the families that cracked it and those who visited, leaving removed families out", async () => {
    const run = runOf(fullDoor(), true, at("2026-12-07T21:00:00Z"));
    query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/FROM elf_guesses/.test(s)) {
        return {
          rows: [
            { family_id: 1, text: "the cone", norm: "cone", saved_at: at("2026-12-07T18:00:00Z") },
            { family_id: 2, text: "Elsewhere", norm: "elsewhere", saved_at: at("2026-12-07T18:00:00Z") },
            { family_id: 3, text: "Pine Cone Café", norm: "pineconecafe", saved_at: at("2026-12-07T20:35:00Z") },
          ],
        };
      }
      return { rows: [{ n: "4" }] };
    });
    const counts = await doorCounts(2026, 7, at("2026-12-07T21:00:00Z"), run);
    expect(counts).toEqual({ cracked: 1, visited: 4 });
    for (const c of query.mock.calls) expect(String(c[0])).toContain("removed_at IS NULL");
  });
});

describe("doorScrapbook", () => {
  it("reads visits that count by now and approved photos, both without removed families, in the scrapbook's order", async () => {
    query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/FROM elf_visits/.test(s)) {
        return {
          rows: [
            { id: 5, counts_from: at("2026-12-07T19:10:00Z"), found: false, first_name: "Sam", surname: "Snowsleuth", name_approved: false },
            { id: 4, counts_from: at("2026-12-07T19:20:00Z"), found: true, first_name: "Ruby", surname: "Tinselfoot", name_approved: true },
          ],
        };
      }
      if (/FROM elf_photos/.test(s)) return { rows: [{ token: "zzzzzzzzzzzz" }, { token: "aaaaaaaaaaaa" }] };
      return { rows: [] };
    });
    const book = await doorScrapbook(2026, 7, at("2026-12-07T20:00:00Z"));
    const sql = query.mock.calls.map((c) => String(c[0]));
    expect(sql.every((q) => q.includes("removed_at IS NULL"))).toBe(true);
    expect(sql.find((q) => /elf_visits/.test(q))).toContain("counts_from <=");
    expect(sql.find((q) => /elf_photos/.test(q))).toContain("'approved'");
    expect(sql.find((q) => /elf_photos/.test(q))).toContain("deleted_at IS NULL");
    expect(book.elves.map((e) => e.visitId)).toEqual([4, 5]);
    expect(book.elves[0].pictureUrl).toBe("/elf/door/7/elf/4.png");
    expect(book.photos.map((p) => p.token)).toEqual(["aaaaaaaaaaaa", "zzzzzzzzzzzz"]);
    expect(book.photos[0].url).toBe("/elf/door/7/photo/aaaaaaaaaaaa.jpg");
    expect(book.count).toBe(4);
  });
});

describe("photos", () => {
  const picture = { mime: "image/jpeg" as const, bytes: Buffer.from("pretend"), width: 800, height: 600 };

  function photoTx(o: { sent?: number } = {}) {
    clientQuery.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/count\(\*\)/i.test(s)) return { rows: [{ n: String(o.sent ?? 0) }] };
      if (/UPDATE elf_photos/.test(s)) return { rows: [{ id: 41 }], rowCount: 1 };
      if (/INSERT INTO elf_photos/.test(s)) return { rows: [{ id: 42 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
  }

  it("sends five a day, and no more", () => {
    expect(PHOTOS_A_DAY).toBe(5);
  });

  it("answers limit at 5 in 24 hours and stores nothing", async () => {
    photoTx({ sent: 5 });
    const r = await sendElfPhoto({ year: 2026, door: 7, familyId: 3, picture, at: FIVE_31 });
    expect(r).toBe("limit");
    expect(call(/INSERT INTO elf_photos/)).toBeUndefined();
    expect(call(/INSERT INTO elf_photo_files/)).toBeUndefined();
    expect(sqls()[sqls().length - 1]).toBe("ROLLBACK");
  });

  it("replaces the waiting photo for the door, deletes its bytes, and stores the new one under a 12 character token", async () => {
    photoTx({ sent: 1 });
    const r = await sendElfPhoto({ year: 2026, door: 7, familyId: 3, picture, at: FIVE_31 });
    expect(typeof r).toBe("object");
    const token = (r as { token: string }).token;
    expect(token).toHaveLength(12);
    const replace = call(/UPDATE elf_photos/)!;
    expect(String(replace[0])).toContain("'replaced'");
    expect(String(replace[0])).toContain("status = 'waiting'");
    expect(String(call(/DELETE FROM elf_photo_files/)![0])).toContain("photo_id");
    const ins = call(/INSERT INTO elf_photos/)!;
    expect(ins[1]).toContain(token);
    expect(call(/INSERT INTO elf_photo_files/)![1]).toEqual([42, picture.bytes]);
    const audit = call(/INSERT INTO audit_log/)!;
    expect(audit[1][1]).toBe("elf.photo.sent");
    expect(JSON.stringify(audit[1])).not.toContain(token);
  });

  it("reads an approved photo as waiting while the place is hidden", async () => {
    query.mockResolvedValue({ rows: [{ token: "aaaaaaaaaaaa", status: "approved" }] });
    expect(await familyPhoto(2026, 7, 3, false)).toEqual({ token: "aaaaaaaaaaaa", status: "waiting" });
    expect(await familyPhoto(2026, 7, 3, true)).toEqual({ token: "aaaaaaaaaaaa", status: "approved" });
  });

  it("never gives a family a decline's reason, and skips replaced, taken down and deleted photos", async () => {
    query.mockResolvedValue({ rows: [{ token: "aaaaaaaaaaaa", status: "declined", decline_reason: "Pretend reason" }] });
    const p = await familyPhoto(2026, 7, 3, true);
    expect(p).toEqual({ token: "aaaaaaaaaaaa", status: "declined" });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).not.toContain("decline_reason");
    expect(sql).toContain("'replaced'");
    expect(sql).toContain("'taken-down'");
    expect(sql).toContain("'deleted'");
    query.mockResolvedValue({ rows: [] });
    expect(await familyPhoto(2026, 7, 3, true)).toBeNull();
  });

  it("takes down the family's own photo and deletes its bytes in the same transaction", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (/UPDATE elf_photos/.test(String(sql))) return { rows: [{ id: 42 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    expect(await takeDownOwnPhoto(2026, 7, 3, FIVE_31)).toBe(true);
    const up = call(/UPDATE elf_photos/)!;
    expect(String(up[0])).toContain("'taken-down'");
    expect(String(up[0])).toContain("taken_down_by = 'family'");
    expect(String(up[0])).toContain("status IN ('waiting', 'approved')");
    const s = sqls();
    const del = s.findIndex((q) => /DELETE FROM elf_photo_files/.test(q));
    expect(del).toBeGreaterThan(s.indexOf("BEGIN"));
    expect(del).toBeLessThan(s.indexOf("COMMIT"));
    expect(JSON.stringify(call(/INSERT INTO audit_log/)![1])).toContain("elf.photo.taken_down");
  });

  it("answers false and deletes nothing when the family has no photo to take down", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await takeDownOwnPhoto(2026, 7, 3, FIVE_31)).toBe(false);
    expect(call(/DELETE FROM elf_photo_files/)).toBeUndefined();
    expect(call(/INSERT INTO audit_log/)).toBeUndefined();
  });

  it("serves a photo only when approved and its bytes are present", async () => {
    query.mockResolvedValueOnce({ rows: [{ mime: "image/jpeg", bytes: Buffer.from("x") }] });
    expect(await approvedPhoto(2026, 7, "aaaaaaaaaaaa")).toEqual({ mime: "image/jpeg", bytes: Buffer.from("x") });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("status = 'approved'");
    expect(sql).toContain("elf_photo_files");
    query.mockResolvedValueOnce({ rows: [] });
    expect(await approvedPhoto(2026, 7, "bbbbbbbbbbbb")).toBeNull();
  });
});

describe("visitElf, cluePicture and the switch", () => {
  it("reads a visit's elf, or null", async () => {
    query.mockResolvedValueOnce({ rows: [{ look: { costume: "tree" }, detective_id: 10 }] });
    expect(await visitElf(2026, 7, 5)).toEqual({ look: { costume: "tree" }, detectiveId: 10 });
    query.mockResolvedValueOnce({ rows: [] });
    expect(await visitElf(2026, 7, 6)).toBeNull();
  });

  it("reads a clue's picture, or null", async () => {
    query.mockResolvedValueOnce({ rows: [{ picture: Buffer.from("p"), picture_mime: "image/png" }] });
    expect(await cluePicture(2026, 7, 1)).toEqual({ mime: "image/png", bytes: Buffer.from("p") });
    expect(String(query.mock.calls[0][0])).toContain("picture IS NOT NULL");
    query.mockResolvedValueOnce({ rows: [] });
    expect(await cluePicture(2026, 7, 2)).toBeNull();
  });

  it("clears the practice door when the doors are switched on", async () => {
    await onDoorsSwitchedOn();
    expect(sqls().some((q) => /DELETE FROM elf_practice/.test(q))).toBe(true);
    expect(sqls().some((q) => /DELETE FROM elf_guesses/.test(q) && /year = 0/.test(q))).toBe(true);
  });
});
