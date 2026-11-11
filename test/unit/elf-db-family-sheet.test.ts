import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-613: a family's sheet in Head Elf HQ carries the grown up's mobile, so a head elf can ring the
// grand prize winner on Christmas Eve. Read from elf_families.mobile (1791200000460_elf-family-mobile.js).
// Every family here is invented.

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect: vi.fn() } }));

import { elfFamilySheet } from "../../src/db/elf-admin";

const FAMILY = { id: 3, grown_up_name: "Sam Example", email: "sam@example.org", newsletter: false, created_at: new Date("2026-11-13T19:04:00Z"), removed_at: null, removed_by: null };

function answer(family: Record<string, unknown> | null) {
  query.mockImplementation(async (sql: string) => {
    if (/FROM elf_families/.test(sql)) return { rows: family ? [family] : [] };
    return { rows: [] };
  });
}

beforeEach(() => query.mockReset());

describe("a family's sheet", () => {
  it("carries the grown up's mobile as it is kept", async () => {
    answer({ ...FAMILY, mobile: "+447700900123" });
    const sheet = await elfFamilySheet(3);
    expect(sheet?.mobile).toBe("+447700900123");
    const families = query.mock.calls.map((c) => String(c[0])).find((s) => /FROM elf_families/.test(s))!;
    expect(families).toMatch(/SELECT [^;]*\bmobile\b[^;]* FROM elf_families/);
  });

  it("has none for a family that enrolled before mobiles were asked for", async () => {
    answer({ ...FAMILY, mobile: null });
    expect((await elfFamilySheet(3))?.mobile).toBeNull();
  });
});
