import { describe, it, expect, vi, beforeEach } from "vitest";

// NBCC Elf Detective School, Christmas Eve and the grand prize (Plan 2c-2): the store for the entries. No
// local database: these read the SQL and parameters each function sends; the BDD in CI proves the SQL.
// Every name and number here is invented: the repository is public.

const { query, clientQuery, release } = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../../src/db/pool", () => ({
  pool: { query, connect: async () => ({ query: clientQuery, release }) },
}));

import {
  WinnerTaken,
  countEntries,
  entryPicture,
  familyEntries,
  familyHasMobile,
  listEntries,
  markWinner,
  saveEntry,
  staffEntryPicture,
} from "../../src/db/elf-grand-prize";

const ACTOR = "admin:alex@example.org";
const MOBILE = "+447700900123";
const at = (iso: string) => new Date(iso);
const SENT = at("2026-12-24T11:45:00Z");
const LATER = at("2026-12-24T12:10:00Z");
const picture = { mime: "image/jpeg" as const, bytes: Buffer.from("a pretend picture"), width: 1200, height: 900 };

/** The SQL with its spaces and line breaks made single spaces, to read as one line. */
const flat = (sql: unknown) => String(sql).replace(/\s+/g, " ").trim();
const sqls = () => clientQuery.mock.calls.map((c) => flat(c[0]));
const call = (re: RegExp) => clientQuery.mock.calls.find((c) => re.test(flat(c[0])));
const indexOf = (re: RegExp) => sqls().findIndex((s) => re.test(s));
const sent = (re: RegExp) => clientQuery.mock.calls.some((c) => re.test(flat(c[0])));

beforeEach(() => {
  query.mockReset();
  clientQuery.mockReset();
  release.mockReset();
  clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("saveEntry", () => {
  const base = { year: 2026, detectiveId: 11, familyId: 3, picture, mobile: null, at: SENT };
  const ENTRY_READ = /^SELECT id FROM elf_grand_prize_entries WHERE year = \$1 AND detective_id = \$2 FOR UPDATE$/;

  /** The transaction's answers: whether the detective is the family's, and the entry already there, if any. */
  function entryTx(o: { existing?: number; detective?: boolean } = {}) {
    clientQuery.mockImplementation(async (sql: string) => {
      const s = flat(sql);
      if (/FROM elf_detectives/.test(s)) return o.detective === false ? { rows: [], rowCount: 0 } : { rows: [{ id: 11, family_id: 3 }], rowCount: 1 };
      if (ENTRY_READ.test(s)) return o.existing ? { rows: [{ id: o.existing }], rowCount: 1 } : { rows: [], rowCount: 0 };
      if (/^INSERT INTO elf_grand_prize_entries/.test(s)) return { rows: [{ id: 21 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
  }

  it("stores a new entry: the family locked, the entry read under lock, then the entry and its picture inserted", async () => {
    entryTx();
    expect(await saveEntry(base)).toEqual({ id: 21, replaced: false });
    const s = sqls();
    expect(s[0]).toBe("BEGIN");
    expect(s[1]).toBe("SELECT id FROM elf_families WHERE id = $1 FOR UPDATE");
    expect(clientQuery.mock.calls[1][1]).toEqual([3]);
    const read = call(ENTRY_READ)!;
    expect(read[1]).toEqual([2026, 11]);
    const insert = call(/^INSERT INTO elf_grand_prize_entries/)!;
    expect(flat(insert[0])).toBe(
      "INSERT INTO elf_grand_prize_entries (year, detective_id, family_id, mime, width, height, sent_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    );
    expect(insert[1]).toEqual([2026, 11, 3, "image/jpeg", 1200, 900, SENT]);
    expect(call(/^INSERT INTO elf_grand_prize_files/)![1]).toEqual([21, picture.bytes]);
    expect(indexOf(ENTRY_READ)).toBeGreaterThan(1);
    expect(indexOf(/^INSERT INTO elf_grand_prize_entries/)).toBeGreaterThan(indexOf(ENTRY_READ));
    expect(indexOf(/^INSERT INTO elf_grand_prize_files/)).toBeGreaterThan(indexOf(/^INSERT INTO elf_grand_prize_entries/));
    expect(s[s.length - 1]).toBe("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("sends no mobile UPDATE, and no UPDATE at all, for a new entry without a mobile", async () => {
    entryTx();
    await saveEntry(base);
    expect(sent(/^UPDATE/)).toBe(false);
  });

  it("replaces the entry that is there: its mime, size, sent time and bytes, never a second entry", async () => {
    entryTx({ existing: 21 });
    expect(await saveEntry({ ...base, at: LATER })).toEqual({ id: 21, replaced: true });
    const entry = call(/^UPDATE elf_grand_prize_entries/)!;
    expect(flat(entry[0])).toBe("UPDATE elf_grand_prize_entries SET mime = $2, width = $3, height = $4, sent_at = $5 WHERE id = $1");
    expect(entry[1]).toEqual([21, "image/jpeg", 1200, 900, LATER]);
    const bytes = call(/^UPDATE elf_grand_prize_files/)!;
    expect(flat(bytes[0])).toBe("UPDATE elf_grand_prize_files SET bytes = $2 WHERE entry_id = $1");
    expect(bytes[1]).toEqual([21, picture.bytes]);
    expect(sent(/^INSERT INTO elf_grand_prize_entries/)).toBe(false);
    expect(sent(/^INSERT INTO elf_grand_prize_files/)).toBe(false);
    expect(indexOf(/^UPDATE elf_grand_prize_entries/)).toBeGreaterThan(indexOf(ENTRY_READ));
    expect(sqls()[sqls().length - 1]).toBe("COMMIT");
  });

  it("puts a mobile typed with the entry on the family, only when the family has none", async () => {
    entryTx();
    await saveEntry({ ...base, mobile: MOBILE });
    const mobile = call(/^UPDATE elf_families SET mobile/)!;
    expect(flat(mobile[0])).toBe("UPDATE elf_families SET mobile = $2 WHERE id = $1 AND mobile IS NULL");
    expect(mobile[1]).toEqual([3, MOBILE]);
    expect(indexOf(/^UPDATE elf_families SET mobile/)).toBeGreaterThan(indexOf(/FROM elf_families WHERE id = \$1 FOR UPDATE/));
    expect(indexOf(/^UPDATE elf_families SET mobile/)).toBeLessThan(indexOf(/^INSERT INTO elf_grand_prize_entries/));
  });

  it("notes the entry in the audit log by the family, with no name, no mobile and no picture", async () => {
    entryTx({ existing: 21 });
    await saveEntry({ ...base, mobile: MOBILE });
    const audit = call(/^INSERT INTO audit_log/)!;
    expect(audit[1]).toEqual(["family", "elf.grand_prize.entry", "elf_grand_prize_entry", 21, { year: 2026, familyId: 3, replaced: true }]);
    expect(JSON.stringify(audit[1])).not.toContain("7700900123");
    expect(indexOf(/^INSERT INTO audit_log/)).toBeLessThan(sqls().indexOf("COMMIT"));
  });

  // Rulings from Task 1's review: nothing in the tables ties an entry's detective to its family, so the
  // detective and the family are taken from the one detective row, checked against both.
  it("checks the detective is the family's own, active, before it reads or writes an entry", async () => {
    entryTx();
    await saveEntry({ ...base, mobile: MOBILE });
    const check = call(/FROM elf_detectives/)!;
    expect(flat(check[0])).toBe("SELECT id, family_id FROM elf_detectives WHERE id = $1 AND family_id = $2 AND active");
    expect(check[1]).toEqual([11, 3]);
    expect(indexOf(/FROM elf_detectives/)).toBeGreaterThan(indexOf(/FROM elf_families WHERE id = \$1 FOR UPDATE/));
    expect(indexOf(/FROM elf_detectives/)).toBeLessThan(indexOf(/^UPDATE elf_families SET mobile/));
    expect(indexOf(/FROM elf_detectives/)).toBeLessThan(indexOf(ENTRY_READ));
  });

  it("stores nothing, the mobile included, for a detective that is not the family's", async () => {
    entryTx({ detective: false });
    await expect(saveEntry({ ...base, mobile: MOBILE })).rejects.toThrow();
    expect(sent(/^INSERT INTO/)).toBe(false);
    expect(sent(/^UPDATE/)).toBe(false);
    expect(sqls()).toContain("ROLLBACK");
    expect(sqls()).not.toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rolls back when the picture cannot be stored, and notes nothing", async () => {
    entryTx();
    const answer = clientQuery.getMockImplementation()!;
    clientQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/^INSERT INTO elf_grand_prize_files/.test(flat(sql))) throw new Error("boom");
      return answer(sql, params);
    });
    await expect(saveEntry(base)).rejects.toThrow("boom");
    expect(sqls()).toContain("ROLLBACK");
    expect(sent(/^INSERT INTO audit_log/)).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("the family's own entries", () => {
  it("knows whether the family has a mobile, without reading the number", async () => {
    query.mockResolvedValueOnce({ rows: [{ has: true }] });
    expect(await familyHasMobile(3)).toBe(true);
    expect(flat(query.mock.calls[0][0])).toBe("SELECT mobile IS NOT NULL AS has FROM elf_families WHERE id = $1");
    expect(query.mock.calls[0][1]).toEqual([3]);
    query.mockResolvedValueOnce({ rows: [{ has: false }] });
    expect(await familyHasMobile(3)).toBe(false);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await familyHasMobile(4)).toBe(false);
  });

  it("maps each of the family's detectives to its entry this year", async () => {
    query.mockResolvedValueOnce({ rows: [{ detective_id: 11, sent_at: SENT }, { detective_id: 12, sent_at: LATER }] });
    const entries = await familyEntries(2026, 3);
    expect(entries).toBeInstanceOf(Map);
    expect([...entries]).toEqual([
      [11, { sentAt: SENT }],
      [12, { sentAt: LATER }],
    ]);
    expect(flat(query.mock.calls[0][0])).toBe("SELECT detective_id, sent_at FROM elf_grand_prize_entries WHERE year = $1 AND family_id = $2");
    expect(query.mock.calls[0][1]).toEqual([2026, 3]);
    query.mockResolvedValueOnce({ rows: [] });
    expect((await familyEntries(2026, 4)).size).toBe(0);
  });

  it("gives an entry's picture only to its own family: the detective and the family must both match", async () => {
    query.mockResolvedValueOnce({ rows: [{ mime: "image/jpeg", bytes: Buffer.from("x") }] });
    expect(await entryPicture(2026, 11, 3)).toEqual({ mime: "image/jpeg", bytes: Buffer.from("x") });
    const sql = flat(query.mock.calls[0][0]);
    expect(sql).toContain("JOIN elf_grand_prize_files b ON b.entry_id = e.id");
    expect(sql).toContain("WHERE e.year = $1 AND e.detective_id = $2 AND e.family_id = $3");
    expect(query.mock.calls[0][1]).toEqual([2026, 11, 3]);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await entryPicture(2026, 11, 4)).toBeNull();
  });
});

describe("the entries for head elves", () => {
  it("lists the year's entries oldest first, each detective by full name, leaving removed families out", async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: 21, first_name: "Ruby", surname: "Tinselfoot", grown_up_name: "Sam Example", mobile: MOBILE, sent_at: SENT, winner: false },
        { id: 22, first_name: "Mia", surname: "Snowsleuth", grown_up_name: "Alex Example", mobile: null, sent_at: LATER, winner: true },
      ],
    });
    expect(await listEntries(2026)).toEqual([
      { id: 21, detective: "Ruby Tinselfoot", grownUpName: "Sam Example", mobile: MOBILE, sentAt: SENT, winner: false },
      { id: 22, detective: "Mia Snowsleuth", grownUpName: "Alex Example", mobile: null, sentAt: LATER, winner: true },
    ]);
    const sql = flat(query.mock.calls[0][0]);
    expect(sql).toContain("e.winner_at IS NOT NULL AS winner");
    expect(sql).toContain("JOIN elf_detectives d ON d.id = e.detective_id");
    expect(sql).toContain("WHERE e.year = $1 AND f.removed_at IS NULL");
    expect(sql).toMatch(/ORDER BY e\.sent_at, e\.id$/);
    expect(query.mock.calls[0][1]).toEqual([2026]);
  });

  it("counts the year's entries as the list does, leaving removed families out", async () => {
    query.mockResolvedValueOnce({ rows: [{ n: "2" }] });
    expect(await countEntries(2026)).toBe(2);
    const sql = flat(query.mock.calls[0][0]);
    expect(sql).toContain("count(*)");
    expect(sql).toContain("WHERE e.year = $1 AND f.removed_at IS NULL");
    expect(query.mock.calls[0][1]).toEqual([2026]);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await countEntries(2026)).toBe(0);
  });

  it("gives head elves any listed entry's picture by its id", async () => {
    query.mockResolvedValueOnce({ rows: [{ mime: "image/png", bytes: Buffer.from("y") }] });
    expect(await staffEntryPicture(2026, 21)).toEqual({ mime: "image/png", bytes: Buffer.from("y") });
    const sql = flat(query.mock.calls[0][0]);
    expect(sql).toContain("JOIN elf_grand_prize_files b ON b.entry_id = e.id");
    expect(sql).toContain("WHERE e.year = $1 AND e.id = $2 AND f.removed_at IS NULL");
    expect(query.mock.calls[0][1]).toEqual([2026, 21]);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await staffEntryPicture(2026, 99)).toBeNull();
  });
});

describe("markWinner", () => {
  const LOCK = /^SELECT e\.id, f\.removed_at IS NULL AS present FROM elf_grand_prize_entries e JOIN elf_families f ON f\.id = e\.family_id WHERE e\.year = \$1 ORDER BY e\.id FOR UPDATE OF e$/;
  const CLEAR = /^UPDATE elf_grand_prize_entries SET winner_at = NULL, winner_by = NULL WHERE year = \$1 AND id <> \$2 AND winner_at IS NOT NULL$/;
  const MARK = /^UPDATE elf_grand_prize_entries SET winner_at = now\(\), winner_by = \$3 WHERE year = \$1 AND id = \$2$/;

  /** The year's entries as the lock reads them: each id, and whether its family is still there. */
  function winnerTx(entries: { id: number; present?: boolean }[], fail?: (sql: string) => Error | null) {
    clientQuery.mockImplementation(async (sql: string) => {
      const s = flat(sql);
      const err = fail?.(s);
      if (err) throw err;
      if (LOCK.test(s)) return { rows: entries.map((e) => ({ id: e.id, present: e.present ?? true })), rowCount: entries.length };
      return { rows: [], rowCount: 1 };
    });
  }

  // Ruling F5: the lock is on the year alone, so a second head elf marking at the same moment waits for
  // the first, then clears the first's mark and sets its own: there is only ever one winner, the later.
  it("locks every entry of the year in id order before it changes anything", async () => {
    winnerTx([{ id: 21 }, { id: 22 }]);
    expect(await markWinner(2026, 22, ACTOR)).toBe(true);
    const s = sqls();
    expect(s[0]).toBe("BEGIN");
    expect(s[1]).toMatch(LOCK);
    expect(clientQuery.mock.calls[1][1]).toEqual([2026]);
  });

  // The rulings from Task 1's review: the one winner index is checked row by row, so the old mark is
  // cleared in one statement and the new one set in the next.
  it("clears the year's other winner in one statement, then marks this one in the next, by the head elf", async () => {
    winnerTx([{ id: 21 }, { id: 22 }]);
    await markWinner(2026, 22, ACTOR);
    const s = sqls();
    expect(indexOf(CLEAR)).toBe(2);
    expect(indexOf(MARK)).toBe(3);
    expect(clientQuery.mock.calls[2][1]).toEqual([2026, 22]);
    expect(clientQuery.mock.calls[3][1]).toEqual([2026, 22, ACTOR]);
    expect(s[s.length - 1]).toBe("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("notes the winner in the audit log by the head elf, with the year and the entry", async () => {
    winnerTx([{ id: 21 }, { id: 22 }]);
    await markWinner(2026, 22, ACTOR);
    const audit = call(/^INSERT INTO audit_log/)!;
    expect(audit[1]).toEqual([ACTOR, "elf.grand_prize.winner", "elf_grand_prize_entry", 22, { year: 2026, entryId: 22 }]);
    expect(indexOf(/^INSERT INTO audit_log/)).toBeGreaterThan(indexOf(MARK));
    expect(indexOf(/^INSERT INTO audit_log/)).toBeLessThan(sqls().indexOf("COMMIT"));
  });

  it("answers false and changes nothing when the entry is not one of the year's", async () => {
    winnerTx([{ id: 21 }]);
    expect(await markWinner(2026, 99, ACTOR)).toBe(false);
    expect(sent(/^UPDATE/)).toBe(false);
    expect(sent(/^INSERT INTO audit_log/)).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("answers false and changes nothing for an entry whose family has been removed, as the list leaves it out", async () => {
    winnerTx([{ id: 21, present: false }, { id: 22 }]);
    expect(await markWinner(2026, 21, ACTOR)).toBe(false);
    expect(sent(/^UPDATE/)).toBe(false);
    expect(sent(/^INSERT INTO audit_log/)).toBe(false);
  });

  it("answers WinnerTaken when the one winner index refuses the mark, and rolls back", async () => {
    const clash = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    winnerTx([{ id: 21 }, { id: 22 }], (s) => (MARK.test(s) ? clash : null));
    await expect(markWinner(2026, 22, ACTOR)).rejects.toBeInstanceOf(WinnerTaken);
    expect(sqls()).toContain("ROLLBACK");
    expect(sent(/^INSERT INTO audit_log/)).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("lets any other failure through as it is", async () => {
    winnerTx([{ id: 21 }, { id: 22 }], (s) => (CLEAR.test(s) ? new Error("boom") : null));
    const err = await markWinner(2026, 22, ACTOR).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(WinnerTaken);
    expect((err as Error).message).toBe("boom");
    expect(sqls()).toContain("ROLLBACK");
  });
});
