import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// NBCC Elf Detective School wave 2: the practice door's one row. No local database: these read the
// SQL and parameters each function sends; the BDD practice evening proves them in CI.

const { query, clientQuery, release } = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../../src/db/pool", () => ({
  pool: { query, connect: async () => ({ query: clientQuery, release }) },
}));

import { clearPractice, getPractice, markPracticeFound, startPractice } from "../../src/db/elf-practice";
import { PRACTICE_CLUES, PRACTICE_ELF_NAME } from "../../src/elf/practice-words";

const sqls = () => clientQuery.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  query.mockReset();
  clientQuery.mockReset();
  release.mockReset();
  clientQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO elf_practice/.test(String(sql))) {
      return {
        rows: [
          {
            started_at: new Date("2026-11-10T15:00:00Z"),
            started_by: params[0],
            place_name: params[1],
            place_town: params[2],
            elf_name: params[3],
            tag_word: params[4],
            poster_code: params[5],
            clue1_at: params[6],
            clue2_at: params[7],
            clue3_at: params[8],
            reveal_at: params[9],
            found_at: null,
            found_family_id: null,
          },
        ],
      };
    }
    return { rows: [], rowCount: 0 };
  });
});

afterEach(() => vi.useRealTimers());

describe("the practice words", () => {
  it("are plainly pretend", () => {
    expect(PRACTICE_CLUES).toEqual([
      "Practice clue 1: it lives where the kettle lives.",
      "Practice clue 2: look under something you sit on.",
      "Practice clue 3: it is on the desk by the window.",
    ]);
    expect(PRACTICE_ELF_NAME).toBe("Tinsel");
  });
});

describe("startPractice", () => {
  const now = new Date("2026-11-10T15:00:00Z");

  it("sets the four times a minute and then each gap apart, after clearing year 0, in one transaction", async () => {
    const row = await startPractice({ placeName: "The Pretend Kettle", placeTown: "Exampleton", elfName: "Tinsel", minutesApart: 3, startedBy: "admin:staff@example.org", now });
    expect(row.clue1At).toEqual(new Date("2026-11-10T15:01:00Z"));
    expect(row.clue2At).toEqual(new Date("2026-11-10T15:04:00Z"));
    expect(row.clue3At).toEqual(new Date("2026-11-10T15:07:00Z"));
    expect(row.revealAt).toEqual(new Date("2026-11-10T15:10:00Z"));
    expect(row.foundAt).toBeNull();
    expect(row.tagWord.length).toBeGreaterThan(3);
    expect(row.posterCode).toHaveLength(12);
    const s = sqls();
    expect(s[0]).toBe("BEGIN");
    const insertAt = s.findIndex((q) => /INSERT INTO elf_practice/.test(q));
    for (const table of ["elf_practice", "elf_guesses", "elf_word_tries", "elf_visits", "elf_photos"]) {
      const at = s.findIndex((q) => new RegExp(`DELETE FROM ${table}\\b`).test(q));
      expect(at, table).toBeGreaterThan(0);
      expect(at, table).toBeLessThan(insertAt);
    }
    expect(s[s.length - 1]).toBe("COMMIT");
    expect(release).toHaveBeenCalled();
  });

  it("rolls back when the insert fails", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (/INSERT INTO elf_practice/.test(String(sql))) throw new Error("boom");
      return { rows: [] };
    });
    await expect(startPractice({ placeName: "A", placeTown: "B", elfName: "C", minutesApart: 3, startedBy: "x", now })).rejects.toThrow("boom");
    expect(sqls()).toContain("ROLLBACK");
  });
});

describe("clearPractice", () => {
  it("deletes the row and every year 0 row of the four game tables", async () => {
    await clearPractice();
    const s = sqls();
    expect(s.some((q) => /DELETE FROM elf_practice/.test(q))).toBe(true);
    for (const table of ["elf_guesses", "elf_word_tries", "elf_visits", "elf_photos"]) {
      const q = s.find((x) => new RegExp(`DELETE FROM ${table}\\b`).test(x));
      expect(q, table).toBeDefined();
      expect(q).toContain("year = 0");
    }
    expect(s[0]).toBe("BEGIN");
    expect(s[s.length - 1]).toBe("COMMIT");
  });
});

// Starting and clearing a practice are a head elf's writes, so each is noted in the audit log, in the
// same transaction as the write. The note never carries the place, its town, the elf's name or the word.
describe("the audit log", () => {
  const now = new Date("2026-11-10T15:00:00Z");
  const audits = () => clientQuery.mock.calls.filter((c) => /INSERT INTO audit_log/.test(String(c[0])));
  const inside = () => {
    const s = sqls();
    const at = s.findIndex((q) => /INSERT INTO audit_log/.test(q));
    expect(at).toBeGreaterThan(s.indexOf("BEGIN"));
    expect(at).toBeLessThan(s.lastIndexOf("COMMIT"));
  };

  it("notes a practice started, by whom and how many minutes apart, and nothing it names", async () => {
    const row = await startPractice({ placeName: "The Pretend Kettle", placeTown: "Exampleton", elfName: "Pip", minutesApart: 3, startedBy: "admin:staff@example.org", now });
    expect(audits()).toHaveLength(1);
    const params = audits()[0][1] as unknown[];
    expect(params).toEqual(["admin:staff@example.org", "elf.practice.started", "elf_practice", 1, { minutesApart: 3 }]);
    for (const secret of ["The Pretend Kettle", "Exampleton", "Pip", row.tagWord]) expect(JSON.stringify(params)).not.toContain(secret);
    inside();
  });

  it("notes a practice cleared by a head elf, with nothing it named", async () => {
    await clearPractice("admin:staff@example.org");
    expect(audits()).toHaveLength(1);
    expect(audits()[0][1]).toEqual(["admin:staff@example.org", "elf.practice.cleared", "elf_practice", 1, {}]);
    inside();
  });

  it("writes no note when the practice is cleared with no head elf, as switching on December's doors does", async () => {
    await clearPractice();
    expect(audits()).toHaveLength(0);
  });
});

describe("getPractice and markPracticeFound", () => {
  it("reads the row, or null when there is none", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          started_at: new Date("2026-11-10T15:00:00Z"),
          started_by: "x",
          place_name: "The Pretend Kettle",
          place_town: "Exampleton",
          elf_name: "Tinsel",
          tag_word: "SNOWBALL 472",
          poster_code: "abcdefghijkm",
          clue1_at: new Date("2026-11-10T15:01:00Z"),
          clue2_at: new Date("2026-11-10T15:04:00Z"),
          clue3_at: new Date("2026-11-10T15:07:00Z"),
          reveal_at: new Date("2026-11-10T15:10:00Z"),
          found_at: null,
          found_family_id: null,
        },
      ],
    });
    const p = await getPractice();
    expect(p?.placeName).toBe("The Pretend Kettle");
    expect(p?.posterCode).toBe("abcdefghijkm");
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getPractice()).toBeNull();
  });

  it("sets found_at once, and says whether this call was the one", async () => {
    const at = new Date("2026-11-10T15:05:00Z");
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(await markPracticeFound(7, at)).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain("found_at IS NULL");
    expect(params).toEqual([at, 7]);
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await markPracticeFound(8, at)).toBe(false);
  });
});
