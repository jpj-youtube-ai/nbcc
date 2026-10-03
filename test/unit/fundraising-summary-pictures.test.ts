import { describe, it, expect, vi } from "vitest";

// Profile pictures: the Monday summary's "Waiting on us" counts the photos organisers sent that staff
// still have to check, so a waiting photo is never forgotten (it is kept until staff decide), and
// reads that count with everything else it reads.

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

describe("photos in the Monday summary", () => {
  it("says how many are waiting to be checked, and counts them in what is waiting", () => {
    const c = summaryCounts(inputs({ photosToCheck: 3 }));
    expect(c.photosToCheck).toBe(3);
    expect(c.waiting).toBe(3);
    const lines = summaryLines(c);
    expect(lines.waiting).toContain("3 photos waiting to be checked");
    expect(lines.subject).toContain("3 things waiting");
  });

  it("says one in the singular", () => {
    expect(summaryLines(summaryCounts(inputs({ photosToCheck: 1 }))).waiting).toContain("1 photo waiting to be checked");
  });

  it("says nothing about photos when none is waiting, or the count could not be read", () => {
    expect(summaryLines(summaryCounts(inputs({ photosToCheck: 0 }))).waiting.join(" ")).not.toContain("photo");
    expect(summaryCounts(inputs()).photosToCheck).toBe(0);
  });

  it("is read with the rest of the summary's inputs", async () => {
    query.mockImplementation(async (sql: string) => (/FROM fundraiser_pictures WHERE status = 'pending'/.test(sql) ? { rows: [{ n: "2" }] } : { rows: [] }));
    expect((await readSummaryInputs(NOW)).photosToCheck).toBe(2);
  });
});
