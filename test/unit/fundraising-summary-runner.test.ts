import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-503: the Monday summary's runner, riding the daily 8am task. Mondays only, once a week,
// nothing without anyone to send to, a failed send logged and never thrown, and the week given back
// when nothing went. It is ONE email with everyone on the To line, so Reply all reaches the team,
// and only nbcc.scot addresses are ever put on it. The database and the mail client are stood in for. Every address is invented.

vi.mock("../../src/config", () => ({
  config: { BALL_FROM_EMAIL: "events@nbcc.test", PORTAL_BASE_URL: "https://nbcc.test" },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { runFundraisingSummary, sendSummaryTest, type SummaryDeps } from "../../src/fundraising/summary-runner";

const MONDAY = new Date("2026-12-07T08:00:00Z");
const TUESDAY = new Date("2026-12-08T08:00:00Z");

let deps: SummaryDeps & { [k: string]: ReturnType<typeof vi.fn> };
let sent: Array<{ email: string; alsoTo?: string[]; subject: string; from: string; replyTo: string; html: string }>;

beforeEach(() => {
  sent = [];
  deps = {
    getSettings: vi.fn().mockResolvedValue({ recipients: ["fern@nbcc.scot", "rowan@nbcc.scot"], lastWeek: "2026-11-30" }),
    claim: vi.fn().mockResolvedValue({ previous: "2026-11-30" }),
    release: vi.fn().mockResolvedValue(undefined),
    readInputs: vi.fn().mockImplementation(async (now: Date) => ({ now, fundraisers: [], gifts: [], cash: [], calls: [], invites: [] })),
    send: vi.fn().mockImplementation(async (m) => {
      sent.push(m);
    }),
    record: vi.fn().mockResolvedValue(undefined),
  } as unknown as typeof deps;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("the Monday summary run", () => {
  it("does nothing on any day but Monday", async () => {
    expect(await runFundraisingSummary(TUESDAY, deps)).toEqual({ sent: 0, failed: 0, skipped: "not today" });
    expect(deps.claim).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("does nothing when this Monday's has already gone", async () => {
    deps.getSettings.mockResolvedValue({ recipients: ["fern@nbcc.scot"], lastWeek: "2026-12-07" });
    expect((await runFundraisingSummary(MONDAY, deps)).skipped).toBe("not today");
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("does nothing, and claims nothing, when nobody is on the list", async () => {
    deps.getSettings.mockResolvedValue({ recipients: [], lastWeek: null });
    expect(await runFundraisingSummary(MONDAY, deps)).toEqual({ sent: 0, failed: 0, skipped: "nobody to send to" });
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("does nothing when another run has claimed the week", async () => {
    deps.claim.mockResolvedValue(null);
    expect((await runFundraisingSummary(MONDAY, deps)).skipped).toBe("already sent");
    expect(sent).toEqual([]);
  });

  it("sends one email with everyone on the To line, from and replying to the events inbox", async () => {
    expect(await runFundraisingSummary(MONDAY, deps)).toEqual({ sent: 2, failed: 0 });
    expect(deps.claim).toHaveBeenCalledWith("2026-12-07");
    expect(sent).toHaveLength(1);
    const [m] = sent;
    expect([m.email, ...(m.alsoTo ?? [])]).toEqual(["fern@nbcc.scot", "rowan@nbcc.scot"]);
    expect(m.from).toBe("events@nbcc.test");
    expect(m.replyTo).toBe("events@nbcc.test");
    expect(m.subject).toBe("Fundraising this week: £0 raised, nothing waiting");
    expect(m.html).toContain("https://nbcc.test/admin");
    expect(deps.record).toHaveBeenCalledWith({ week: "2026-12-07", sent: 2, failed: 0 });
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("sends to one person alone when the list has one", async () => {
    deps.getSettings.mockResolvedValue({ recipients: ["fern@nbcc.scot"], lastWeek: null });
    expect(await runFundraisingSummary(MONDAY, deps)).toEqual({ sent: 1, failed: 0 });
    expect(sent[0].email).toBe("fern@nbcc.scot");
    expect(sent[0].alsoTo ?? []).toEqual([]);
  });

  it("leaves any address that is not nbcc.scot off the To line, and logs how many without naming them", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    deps.getSettings.mockResolvedValue({
      recipients: ["fern@nbcc.scot", "old@example.com", "rowan@news.nbcc.scot", "Rowan@NBCC.scot", "sly@nbcc.scot.example.com"],
      lastWeek: null,
    });
    expect(await runFundraisingSummary(MONDAY, deps)).toEqual({ sent: 2, failed: 0 });
    expect([sent[0].email, ...(sent[0].alsoTo ?? [])]).toEqual(["fern@nbcc.scot", "Rowan@NBCC.scot"]);
    const said = [...log.mock.calls, ...(console.error as unknown as ReturnType<typeof vi.fn>).mock.calls].map((c) => c.join(" ")).join(" | ");
    expect(said).toMatch(/3 address(es)? left out/);
    expect(said).not.toMatch(/example\.com|news\.nbcc|@/);
    log.mockRestore();
  });

  it("does nothing, and claims nothing, when nobody on the list has an nbcc.scot address", async () => {
    deps.getSettings.mockResolvedValue({ recipients: ["old@example.com", "rowan@news.nbcc.scot"], lastWeek: null });
    expect(await runFundraisingSummary(MONDAY, deps)).toEqual({ sent: 0, failed: 0, skipped: "nobody to send to" });
    expect(deps.claim).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("gives the week back when it did not go, so a rerun can try again, and counts everyone as failed", async () => {
    deps.send.mockRejectedValue(new Error("SES is down"));
    expect(await runFundraisingSummary(MONDAY, deps)).toEqual({ sent: 0, failed: 2 });
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
    expect(deps.release).toHaveBeenCalledWith("2026-12-07", "2026-11-30");
    expect(deps.record).toHaveBeenCalledWith({ week: "2026-12-07", sent: 0, failed: 2 });
  });

  it("never throws: a failed read is logged, and the week given back", async () => {
    deps.readInputs.mockRejectedValue(new Error("database away"));
    expect(await runFundraisingSummary(MONDAY, deps)).toEqual({ sent: 0, failed: 0, skipped: "could not read" });
    expect(deps.release).toHaveBeenCalledWith("2026-12-07", "2026-11-30");
    deps.getSettings.mockRejectedValue(new Error("database away"));
    expect((await runFundraisingSummary(MONDAY, deps)).skipped).toBe("could not read");
  });
});

describe("a test of the summary", () => {
  it("goes only to the person asking, marked as a test, on any day", async () => {
    await sendSummaryTest("fern@example.com", TUESDAY, deps);
    expect(sent).toHaveLength(1);
    expect(sent[0].email).toBe("fern@example.com");
    expect(sent[0].alsoTo ?? []).toEqual([]);
    expect(sent[0].subject).toMatch(/^Test: Fundraising this week:/);
    expect(deps.claim).not.toHaveBeenCalled();
    expect(deps.getSettings).not.toHaveBeenCalled();
  });

  it("throws when it did not go, so the admin can say so", async () => {
    deps.send.mockRejectedValue(new Error("SES said no"));
    await expect(sendSummaryTest("fern@example.com", TUESDAY, deps)).rejects.toThrow();
  });
});

// The daily 8am job (src/scripts/send-reminders.ts) only runs when started directly, so its wiring
// is read from the source, as analytics-retention-job.test.ts does.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("the daily 8am job", () => {
  const source = readFileSync(resolve(__dirname, "../../src/scripts/send-reminders.ts"), "utf8");

  it("runs the summary inside its own try/catch", () => {
    const at = source.indexOf("runFundraisingSummary(");
    expect(at, "send-reminders.ts never runs the summary").toBeGreaterThan(-1);
    const before = source.lastIndexOf("try {", at);
    const catchAt = source.indexOf("} catch (err) {", at);
    expect(source.slice(before, catchAt).match(/await import\(/g)).toHaveLength(1);
    expect(source.slice(catchAt, catchAt + 120)).toContain("fundraising summary");
  });

  it("runs it before the pool is closed", () => {
    expect(source.indexOf("runFundraisingSummary(")).toBeLessThan(source.indexOf("await pool.end();"));
  });
});
