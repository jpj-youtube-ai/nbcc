import { describe, it, expect, vi } from "vitest";

// TASK-507: the Monday summary's "Waiting on us" counts the thank yous organisers sent that staff
// have still to check: "1 thank you to check", "3 thank yous to check". If they cannot be counted,
// the summary still goes, without that line. Every number is invented.

const { countPendingThanks } = vi.hoisted(() => ({ countPendingThanks: vi.fn() }));
vi.mock("../../src/db/fundraiser-thanks", () => ({ countPendingThanks }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { summaryCounts, summaryLines } from "../../src/fundraising/summary";
import { readSummaryInputs } from "../../src/db/fundraising-team";

const NOW = new Date("2026-12-07T08:00:00Z");
const empty = { now: NOW, fundraisers: [], gifts: [], cash: [], calls: [], invites: [] };

describe("thank yous to check on Monday", () => {
  it("says how many are waiting, and adds them to the things waiting", () => {
    const c = summaryCounts({ ...empty, thanksToCheck: 3 });
    expect(c.thanksToCheck).toBe(3);
    expect(c.waiting).toBe(3);
    expect(summaryLines(c).waiting).toEqual(["3 thank yous to check"]);
    expect(summaryLines(summaryCounts({ ...empty, thanksToCheck: 1 })).waiting).toEqual(["1 thank you to check"]);
  });

  it("says nothing when none are waiting, or the count is not given", () => {
    expect(summaryLines(summaryCounts(empty)).waiting).toEqual([]);
    expect(summaryCounts(empty).thanksToCheck).toBe(0);
  });

  it("reads the count for the summary", async () => {
    countPendingThanks.mockResolvedValue(2);
    expect((await readSummaryInputs(NOW)).thanksToCheck).toBe(2);
  });

  it("still sends the summary when the count cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    countPendingThanks.mockRejectedValue(new Error("db down"));
    expect((await readSummaryInputs(NOW)).thanksToCheck).toBe(0);
  });
});
