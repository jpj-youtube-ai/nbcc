import { describe, it, expect, vi, beforeEach } from "vitest";

// A family a head elf has removed (Head Elf HQ, docs/superpowers/specs/2026-11-05-elf-admin-design.md,
// decision 6) cannot sign in and cannot keep a session. There is no local database, so these read the
// SQL each lookup sends; features/elf-admin.feature proves it against a real one in CI.
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect: vi.fn() } }));

import { activeFamilyByEmail, findElfSession } from "../../src/db/elf";

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

describe("a removed family", () => {
  it("is not found to send a sign in code to", async () => {
    await activeFamilyByEmail("sam@example.org");
    expect(String(query.mock.calls[0][0])).toMatch(/active\s+AND\s+removed_at IS NULL/);
  });

  it("cannot use a session it held before it was removed", async () => {
    await findElfSession("a".repeat(64));
    expect(String(query.mock.calls[0][0])).toMatch(/f\.active\s+AND\s+f\.removed_at IS NULL/);
  });
});
