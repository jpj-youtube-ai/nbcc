import { describe, it, expect, vi } from "vitest";

// TASK-515: the Monday summary's "Waiting on us" has one line for the smart call prompts showing
// today (behind, ahead, on track, gone quiet, and the materials to offer), each a call to make.

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

describe("call prompts in the Monday summary", () => {
  it("says what each call is about, in one line, and counts each in what is waiting", () => {
    const c = summaryCounts(inputs({ prompts: { behind: 2, ahead: 1, onTrack: 1, quiet: 3, materials: 4 } }));
    expect(c.prompts).toEqual({ behind: 2, ahead: 1, onTrack: 1, quiet: 3, materials: 4 });
    expect(c.waiting).toBe(11);
    const lines = summaryLines(c);
    expect(lines.waiting).toContain("11 calls to make from the prompts: 2 behind, 3 gone quiet, 1 ahead, 1 on track and 4 to offer materials");
    expect(lines.subject).toContain("11 things waiting");
  });

  it("says one in the singular, and only what there is", () => {
    const lines = summaryLines(summaryCounts(inputs({ prompts: { behind: 1, ahead: 0, onTrack: 0, quiet: 0, materials: 0 } })));
    expect(lines.waiting).toContain("1 call to make from the prompts: 1 behind");
  });

  it("says nothing when there are none, or they could not be counted", () => {
    expect(summaryLines(summaryCounts(inputs({ prompts: { behind: 0, ahead: 0, onTrack: 0, quiet: 0, materials: 0 } }))).waiting).toEqual([]);
    const unread = summaryCounts(inputs());
    expect(unread.waiting).toBe(0);
    expect(summaryLines(unread).waiting.join(" ")).not.toContain("prompts");
  });

  it("is read with the rest of the summary's inputs, and a failure leaves it out", async () => {
    query.mockImplementation(async () => ({ rows: [] }));
    expect((await readSummaryInputs(NOW)).prompts).toEqual({ behind: 0, ahead: 0, onTrack: 0, quiet: 0, materials: 0 });
    query.mockImplementation(async (sql: string) => {
      if (/FROM fundraiser_touchpoints/.test(sql)) throw new Error("no such table yet");
      return { rows: [] };
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await readSummaryInputs(NOW)).prompts).toBeUndefined();
  });
});
