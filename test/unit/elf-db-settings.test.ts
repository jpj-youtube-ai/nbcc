import { describe, it, expect, vi, beforeEach } from "vitest";

// NBCC Elf Detective School: the one row of settings, and the switch that ships off.

const { query, clientQuery, release } = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../../src/db/pool", () => ({
  pool: { query, connect: async () => ({ query: clientQuery, release }) },
}));

import { ELF_DEFAULTS, getElfSettings, setElfSettings } from "../../src/db/elf";

const ROW = { school_on: true, year: 2026, entry_from_pence: 100, entry_suggested_pence: 500 };

beforeEach(() => {
  query.mockReset();
  clientQuery.mockReset();
  release.mockReset();
});

describe("the school's settings", () => {
  it("reads the row", async () => {
    query.mockResolvedValueOnce({ rows: [ROW] });
    expect(await getElfSettings()).toEqual({ schoolOn: true, year: 2026, entryFromPence: 100, entrySuggestedPence: 500, previewHash: null, placePhone: null, doorsOn: false });
  });

  it("reads the doors switch, off when the column is missing", async () => {
    query.mockResolvedValueOnce({ rows: [{ ...ROW, doors_on: true }] });
    expect((await getElfSettings()).doorsOn).toBe(true);
    expect(String(query.mock.calls[0][0])).toContain("doors_on");
    query.mockResolvedValueOnce({ rows: [ROW] });
    expect((await getElfSettings()).doorsOn).toBe(false);
    expect(ELF_DEFAULTS.doorsOn).toBe(false);
  });

  it("writes the doors switch through the same map", async () => {
    clientQuery.mockImplementation(async () => ({ rows: [ROW] }));
    await setElfSettings({ doorsOn: true }, "staff@example.org");
    const update = clientQuery.mock.calls.find((c) => /UPDATE elf_settings/.test(String(c[0])))!;
    expect(String(update[0])).toContain("doors_on = $1");
    expect(update[1]).toEqual([true, "staff@example.org"]);
  });

  it("reads the place phone", async () => {
    query.mockResolvedValueOnce({ rows: [{ ...ROW, place_phone: "01632 960 123" }] });
    expect((await getElfSettings()).placePhone).toBe("01632 960 123");
    expect(String(query.mock.calls[0][0])).toContain("place_phone");
  });

  it("writes the place phone through the same map", async () => {
    clientQuery.mockImplementation(async () => ({ rows: [ROW] }));
    await setElfSettings({ placePhone: "01632 960 123" }, "staff@example.org");
    const update = clientQuery.mock.calls.find((c) => /UPDATE elf_settings/.test(String(c[0])))!;
    expect(String(update[0])).toContain("place_phone = $1");
    expect(update[1]).toEqual(["01632 960 123", "staff@example.org"]);
  });

  it("reads as switched off, at £1 and £5, when anything goes wrong", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    query.mockRejectedValueOnce(new Error("no database"));
    expect(await getElfSettings()).toEqual({ schoolOn: false, year: 2026, entryFromPence: 100, entrySuggestedPence: 500, previewHash: null, placePhone: null, doorsOn: false });
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getElfSettings()).toEqual(ELF_DEFAULTS);
    expect(ELF_DEFAULTS.schoolOn).toBe(false);
    logged.mockRestore();
  });

  // Final review, minor 13: reading as switched off hides a broken database, so it says so in the log,
  // in one line with the error's own message and nothing else (never a connection string).
  it("logs one line, the error's message only, when the settings cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = Object.assign(new Error("connection lost"), { connectionString: "postgres://user:secret@example.org/db" });
    query.mockRejectedValueOnce(err);
    await getElfSettings();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]).toEqual(["elf settings could not be read, so the school reads as switched off:", "connection lost"]);
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
    // An empty table is not a failure: nothing is logged.
    logged.mockClear();
    query.mockResolvedValueOnce({ rows: [] });
    await getElfSettings();
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  // A database that cannot be reached at all fails with no message of its own (Node's AggregateError
  // for a refused connection), so its code is logged instead, or failing that its kind.
  it("logs the error's code, or its kind, when it has no message", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    query.mockRejectedValueOnce(Object.assign(new AggregateError([], ""), { code: "ECONNREFUSED" }));
    await getElfSettings();
    query.mockRejectedValueOnce(new AggregateError([], ""));
    await getElfSettings();
    expect(logged.mock.calls.map((c) => c[1])).toEqual(["ECONNREFUSED", "AggregateError"]);
    logged.mockRestore();
  });

  it("changes only what it is given, with the row locked, and writes it in the audit log", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (/FOR UPDATE/.test(sql)) return { rows: [{ ...ROW, school_on: false }] };
      if (/^SELECT/.test(sql.trim())) return { rows: [ROW] };
      return { rows: [] };
    });
    const after = await setElfSettings({ schoolOn: true }, "staff@example.org");
    expect(after.schoolOn).toBe(true);
    const sqls = clientQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls.some((s) => /FROM elf_settings WHERE id = 1 FOR UPDATE/.test(s))).toBe(true);
    const update = clientQuery.mock.calls.find((c) => /UPDATE elf_settings/.test(String(c[0])))!;
    expect(String(update[0])).toContain("school_on");
    expect(String(update[0])).not.toContain("entry_from_pence");
    const audit = clientQuery.mock.calls.find((c) => /INSERT INTO audit_log/.test(String(c[0])))!;
    expect(JSON.stringify(audit[1])).toContain("elf.settings");
    expect(sqls).toContain("COMMIT");
    expect(release).toHaveBeenCalled();
  });
});
