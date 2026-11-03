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
    expect(await getElfSettings()).toEqual({ schoolOn: true, year: 2026, entryFromPence: 100, entrySuggestedPence: 500 });
  });

  it("reads as switched off, at £1 and £5, when anything goes wrong", async () => {
    query.mockRejectedValueOnce(new Error("no database"));
    expect(await getElfSettings()).toEqual({ schoolOn: false, year: 2026, entryFromPence: 100, entrySuggestedPence: 500 });
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getElfSettings()).toEqual(ELF_DEFAULTS);
    expect(ELF_DEFAULTS.schoolOn).toBe(false);
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
