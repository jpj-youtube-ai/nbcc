import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-646: the one new write, freezeNewsletterLiveTotals. It may only set data.sent on the live total
// blocks of a newsletter that is being sent and whose send job has not started, and nothing else: the
// SQL is guarded in the statements themselves, and the write only lands if the stored document has
// not changed since it was read.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock } }));

import { freezeNewsletterLiveTotals } from "../../src/db/newsletters";

const STORED = {
  merge: { nameFallback: "", greetingFallback: "friend" },
  blocks: [
    { type: "text", variant: 0, data: { text: "Hello" }, size: 0 },
    { type: "liveTotal", variant: 0, data: { source: "sleigh", after: "raised" }, size: 0 },
  ],
};
const AT = "2026-12-01T10:00:00.000Z";
let stored: unknown = STORED;
let updated = 1;

beforeEach(() => {
  stored = STORED;
  updated = 1;
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => {
    if (/^\s*SELECT/i.test(sql)) return { rows: stored === null ? [] : [{ body_json: stored }], rowCount: stored === null ? 0 : 1 };
    if (/^\s*UPDATE/i.test(sql)) return { rows: [], rowCount: updated };
    return { rows: [], rowCount: 0 };
  });
});

const calls = () => queryMock.mock.calls.map((c) => ({ sql: String(c[0]), params: c[1] as unknown[] }));

describe("freezeNewsletterLiveTotals", () => {
  it("reads and writes only a sent newsletter whose own send job has not started", async () => {
    await freezeNewsletterLiveTotals(7, 11, { sleigh: 123400 }, AT);
    const [read, write] = calls();
    for (const q of [read, write]) {
      expect(q.sql).toContain("n.status = 'sent'");
      expect(q.sql).toContain("j.id = $2");
      expect(q.sql).toContain("j.newsletter_id = n.id");
      expect(q.sql).toContain("j.started_at IS NULL");
      expect(q.params.slice(0, 2)).toEqual([7, 11]);
    }
    expect(write.sql).toMatch(/SET body_json = \$3::jsonb/);
    expect(write.sql).not.toMatch(/subject|body_html|status =\s*'(draft|sent)',|sent_at/i);
    // Only if the document is still the one that was read.
    expect(write.sql).toContain("n.body_json = $4::jsonb");
    expect(JSON.parse(write.params[3] as string)).toEqual(STORED);
  });

  it("changes nothing but data.sent on the live totals", async () => {
    expect(await freezeNewsletterLiveTotals(7, 11, { sleigh: 123400 }, AT)).toBe(true);
    const written = JSON.parse(calls()[1].params[2] as string);
    expect(written.merge).toEqual(STORED.merge);
    expect(written.blocks[0]).toEqual(STORED.blocks[0]);
    expect(written.blocks[1]).toEqual({ ...STORED.blocks[1], data: { source: "sleigh", after: "raised", sent: { value: 123400, at: AT } } });
  });

  it("writes nothing when the newsletter is not one being sent, or has no document", async () => {
    stored = null;
    expect(await freezeNewsletterLiveTotals(7, 11, { sleigh: 1 }, AT)).toBe(false);
    expect(calls()).toHaveLength(1);
  });

  it("says so when the write did not land", async () => {
    updated = 0;
    expect(await freezeNewsletterLiveTotals(7, 11, { sleigh: 1 }, AT)).toBe(false);
  });
});
