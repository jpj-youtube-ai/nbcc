import { describe, it, expect, vi, beforeEach } from "vitest";

// insertStory (Task B1) is a single INSERT ... RETURNING id against the SEPARATE
// storiesPool — deliberately NO audit table (that lives in the charity DB and must
// never be referenced from this feature). Mirrors the mocked-pool style of
// test/unit/portal-tokens.test.ts, but against storiesPool.query directly (no
// pool.connect/transaction — a single statement needs none).
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/stories-pool", () => ({ storiesPool: { query: queryMock } }));

import { insertStory } from "../../src/db/stories";
import type { StoryRecord } from "../../src/stories/schema";

const record: StoryRecord = {
  submitter_role: "supported",
  story_text: "A story.",
  short_quote: null,
  use_scope: "internal_only",
  consent_share_first_name: false,
  consent_share_town: false,
  third_party_consent: false,
  contact_for_more: false,
  photo_interest: false,
  submitter_first_name: null,
  submitter_email: null,
  submitter_phone: null,
  submitter_town: null,
  age_band: null,
  gender: null,
  recipient_type: null,
  heard_about: null,
  confirmed_over_16: true,
};

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [{ id: 7 }], rowCount: 1 });
});

describe("insertStory", () => {
  it("inserts a story row via storiesPool and returns its id", async () => {
    const result = await insertStory(record);
    expect(result).toEqual({ id: 7 });
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/insert into stories/i);
    expect(sql).toMatch(/returning id/i);
    expect(params).toContain("A story.");
  });

  it("never queries the audit_log table (no cross-DB audit for stories)", async () => {
    await insertStory(record);
    const sqls = queryMock.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /audit_log/i.test(s))).toBe(false);
  });
});
