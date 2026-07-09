import { describe, it, expect, vi, beforeEach } from "vitest";

// Task C (REQ intent: "Admin panel can view, tag and manage submitted stories, incl.
// withdrawal."). listStories / getStory / updateStory are the admin's ONLY access to
// story data — all via storiesPool (mirrors insertStory's mocked-pool style in
// test/unit/stories-model.test.ts), never src/db/pool.ts / the charity DB.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/stories-pool", () => ({ storiesPool: { query: queryMock } }));

import { listStories, getStory, updateStory, deleteStory } from "../../src/db/stories";

beforeEach(() => {
  queryMock.mockReset();
});

describe("listStories", () => {
  it("lists newest-first via storiesPool with no filters", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 2 }, { id: 1 }] });
    const rows = await listStories({});
    expect(rows).toEqual([{ id: 2 }, { id: 1 }]);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/from stories/i);
    expect(sql).toMatch(/order by created_at desc/i);
    expect(params).toEqual([]);
  });

  it("filters by status when provided", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await listStories({ status: "new" });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/status = \$1/i);
    expect(params).toEqual(["new"]);
  });

  it("filters by use_scope when provided", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await listStories({ useScope: "public" });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/use_scope = \$1/i);
    expect(params).toEqual(["public"]);
  });

  it("filters by both status and use_scope together", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await listStories({ status: "withdrawn", useScope: "internal_only" });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/status = \$1/i);
    expect(sql).toMatch(/use_scope = \$2/i);
    expect(params).toEqual(["withdrawn", "internal_only"]);
  });

  it("never selects submitter_email/phone in the list projection (PII minimisation)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await listStories({});
    const [sql] = queryMock.mock.calls[0];
    expect(sql).not.toMatch(/submitter_email/i);
    expect(sql).not.toMatch(/submitter_phone/i);
  });
});

describe("getStory", () => {
  it("returns the full row by id via storiesPool", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 5, story_text: "hello" }] });
    const row = await getStory(5);
    expect(row).toEqual({ id: 5, story_text: "hello" });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/from stories/i);
    expect(sql).toMatch(/where id = \$1/i);
    expect(params).toEqual([5]);
  });

  it("returns null when no row matches", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const row = await getStory(999);
    expect(row).toBeNull();
  });
});

describe("updateStory", () => {
  it("updates status only", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 3, status: "reviewed" }] });
    const row = await updateStory(3, { status: "reviewed" });
    expect(row).toEqual({ id: 3, status: "reviewed" });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/update stories set/i);
    expect(sql).toMatch(/status = \$1/i);
    expect(params).toEqual(["reviewed", 3]);
  });

  it("updates admin_tags and admin_notes together", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 3 }] });
    await updateStory(3, { adminTags: ["funding", "xmas-2026"], adminNotes: "great case study" });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/admin_tags = \$1/i);
    expect(sql).toMatch(/admin_notes = \$2/i);
    expect(params).toEqual([["funding", "xmas-2026"], "great case study", 3]);
  });

  it("returns null when the id does not exist", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const row = await updateStory(404, { status: "withdrawn" });
    expect(row).toBeNull();
  });

  it("never queries the audit_log table (no cross-DB audit for stories)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 3 }] });
    await updateStory(3, { status: "withdrawn" });
    const sqls = queryMock.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /audit_log/i.test(s))).toBe(false);
  });
});

// G2 item 6: real hard-delete (erasure). A DELETE FROM stories via storiesPool — the ONLY
// way a submitter's details are permanently erased rather than merely marked withdrawn
// (updateStory's status='withdrawn' above STOPS the story being used, but keeps the row).
describe("deleteStory", () => {
  it("deletes the row by id via storiesPool and returns true when a row was removed", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    const result = await deleteStory(3);
    expect(result).toBe(true);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/delete from stories/i);
    expect(sql).toMatch(/where id = \$1/i);
    expect(params).toEqual([3]);
  });

  it("returns false when no row matched the id", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });
    const result = await deleteStory(404);
    expect(result).toBe(false);
  });

  it("never queries the audit_log table (no cross-DB audit for stories)", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await deleteStory(3);
    const sqls = queryMock.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /audit_log/i.test(s))).toBe(false);
  });
});
