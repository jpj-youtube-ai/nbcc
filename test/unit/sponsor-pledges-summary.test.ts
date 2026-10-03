import { describe, it, expect, vi } from "vitest";

// Sponsor pledges in the Monday summary: "N pledges unpaid 2 weeks after the event", under Waiting on
// us. If they cannot be counted, the summary still goes, without that line. Every number is invented.

const { countUnpaidPledges, countDoublePaidPledges } = vi.hoisted(() => ({ countUnpaidPledges: vi.fn(), countDoublePaidPledges: vi.fn(async () => 0) }));
vi.mock("../../src/db/pledges", () => ({ countUnpaidPledges, countDoublePaidPledges }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { summaryCounts, summaryLines } from "../../src/fundraising/summary";
import { readSummaryInputs } from "../../src/db/fundraising-team";

const NOW = new Date("2026-12-21T08:00:00Z");
const empty = { now: NOW, fundraisers: [], gifts: [], cash: [], calls: [], invites: [] };

describe("unpaid pledges on Monday", () => {
  it("says how many are unpaid two weeks on, and adds them to the things waiting", () => {
    const c = summaryCounts({ ...empty, pledgesUnpaid: 4 });
    expect(c.pledgesUnpaid).toBe(4);
    expect(c.waiting).toBe(4);
    expect(summaryLines(c).waiting).toEqual(["4 pledges unpaid 2 weeks after the event"]);
    expect(summaryLines(summaryCounts({ ...empty, pledgesUnpaid: 1 })).waiting).toEqual(["1 pledge unpaid 2 weeks after the event"]);
  });

  it("says nothing when there are none, or the count is not given", () => {
    expect(summaryLines(summaryCounts(empty)).waiting).toEqual([]);
    expect(summaryCounts(empty).pledgesUnpaid).toBe(0);
  });

  it("reads the count for the summary", async () => {
    countUnpaidPledges.mockResolvedValue(2);
    expect((await readSummaryInputs(NOW)).pledgesUnpaid).toBe(2);
    expect(countUnpaidPledges).toHaveBeenCalledWith(NOW);
  });

  it("says how many were paid twice, for someone to check and refund", async () => {
    const c = summaryCounts({ ...empty, pledgesPaidTwice: 2 });
    expect(c.waiting).toBe(2);
    expect(summaryLines(c).waiting).toEqual(["2 pledges paid twice: check and refund"]);
    expect(summaryLines(summaryCounts({ ...empty, pledgesPaidTwice: 1 })).waiting).toEqual(["1 pledge paid twice: check and refund"]);
    countUnpaidPledges.mockResolvedValue(0);
    countDoublePaidPledges.mockResolvedValue(3);
    expect((await readSummaryInputs(NOW)).pledgesPaidTwice).toBe(3);
    countDoublePaidPledges.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await readSummaryInputs(NOW)).pledgesPaidTwice).toBe(0);
    countDoublePaidPledges.mockResolvedValue(0);
  });

  it("still sends the summary when the count cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    countUnpaidPledges.mockRejectedValue(new Error("db down"));
    expect((await readSummaryInputs(NOW)).pledgesUnpaid).toBe(0);
  });
});
