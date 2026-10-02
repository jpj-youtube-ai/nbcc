import { describe, it, expect, vi } from "vitest";

// TASK-506: the Monday summary's "Waiting on us" counts the news updates staff still have to check,
// and reads that count with everything else it reads.

const { query, connect } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { summaryCounts, summaryLines, type SummaryInputs } from "../../src/fundraising/summary";
import { readSummaryInputs } from "../../src/db/fundraising-team";

const NOW = new Date("2026-12-07T08:00:00Z"); // a Monday
const inputs = (over: Partial<SummaryInputs> = {}): SummaryInputs => ({
  now: NOW,
  fundraisers: [],
  gifts: [],
  cash: [],
  calls: [],
  invites: [],
  ...over,
});

describe("news updates in the Monday summary", () => {
  it("says how many are waiting to be checked, and counts them in what is waiting", () => {
    const c = summaryCounts(inputs({ newsToCheck: 3 }));
    expect(c.newsToCheck).toBe(3);
    expect(c.waiting).toBe(3);
    const lines = summaryLines(c);
    expect(lines.waiting).toContain("3 news updates to check");
    expect(lines.subject).toContain("3 things waiting");
  });

  it("says one in the singular", () => {
    expect(summaryLines(summaryCounts(inputs({ newsToCheck: 1 }))).waiting).toContain("1 news update to check");
  });

  it("says nothing about news when none is waiting, or the count could not be read", () => {
    expect(summaryLines(summaryCounts(inputs({ newsToCheck: 0 }))).waiting.join(" ")).not.toContain("news");
    const unread = summaryCounts(inputs());
    expect(unread.newsToCheck).toBe(0);
    expect(unread.waiting).toBe(0);
  });

  it("is read with the rest of the summary's inputs", async () => {
    query.mockImplementation(async (sql: string) => (/FROM fundraiser_updates WHERE status = 'pending'/.test(sql) ? { rows: [{ n: "2" }] } : { rows: [] }));
    expect((await readSummaryInputs(NOW)).newsToCheck).toBe(2);
  });
});
