// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-646: a live total is FROZEN once per send. A send is not one moment: the worker renders per
// recipient, tick after tick, sometimes over days. So on the job's first tick (before it is marked
// running) the worker reads each source the newsletter uses with the UNCACHED reader, inside
// try/catch, and writes data.sent = { value, at } into the newsletter's stored document through one
// narrowly named database function. Everyone gets the same number; a failed read or write never stops
// the send, and every reader then sees the fallback words, never "0 bags".

const h = vi.hoisted(() => {
  const state: { doc: unknown; job: Record<string, unknown> } = { doc: null, job: {} };
  return {
    state,
    sendNewsletter: vi.fn(async (m: { html: string; text: string }) => void m),
    readLiveNumberNow: vi.fn(async (s: string): Promise<number> => (s ? 312 : 0)),
    freeze: vi.fn(),
    markJobRunning: vi.fn(async () => undefined),
  };
});

vi.mock("../../src/config", () => ({
  config: {
    ADMIN_SESSION_SECRET: "freeze-test-secret",
    PORTAL_BASE_URL: "https://nbcc.scot",
    NEWSLETTER_FROM_EMAIL: "news@example.com",
    NEWSLETTER_REPLY_TO_EMAIL: "reply@example.com",
    NEWSLETTER_DAILY_SEND_CAP: 1000,
  },
}));
vi.mock("../../src/db/newsletters", () => ({
  getNewsletter: vi.fn(async () => ({ id: 7, subject: "Hello", bodyHtml: "<p>old</p>", bodyJson: h.state.doc })),
  setNewsletterDeliverySummary: vi.fn(async () => undefined),
  freezeNewsletterLiveTotals: (...args: unknown[]) => h.freeze(...args),
}));
vi.mock("../../src/db/newsletter-events", () => ({ recordNewsletterSends: vi.fn(async () => undefined) }));
vi.mock("../../src/db/newsletter-send-jobs", () => ({
  listRunnableJobs: vi.fn(async () => [h.state.job]),
  markJobRunning: h.markJobRunning,
  finishJobIfDrained: vi.fn(async () => false),
  claimRecipients: vi.fn(async () => [{ id: 1, donorId: 5, subscriberId: null, email: "reader@example.com", fullName: "Ada Reader" }]),
  markRecipientSent: vi.fn(async () => undefined),
  deferRecipient: vi.fn(async () => undefined),
  listGivenUpRecipients: vi.fn(async () => []),
  reviveRecipients: vi.fn(async () => 0),
  markRecipientFailed: vi.fn(async () => undefined),
  sentTodayCount: vi.fn(async () => 0),
  jobOutcome: vi.fn(async () => ({ sent: 1, failed: 0, failedEmails: [] })),
  reclaimStalledRecipients: vi.fn(async () => undefined),
}));
vi.mock("../../src/clients/email", () => ({ sendNewsletter: h.sendNewsletter }));
vi.mock("../../src/newsletter/live-numbers", () => ({ readLiveNumberNow: h.readLiveNumberNow }));
vi.mock("../../src/newsletter/send-pacing", () => ({ tickAllowance: () => 1, TICK_SECONDS: 20 }));

import { runSendTick } from "../../src/newsletter/send-worker";
import { withFrozenTotals } from "../../src/newsletter/live-blocks";

const DOC = {
  blocks: [
    { type: "text", variant: 0, data: { text: "Hello" }, size: 0 },
    { type: "liveTotal", variant: 3, data: { source: "redBag", after: "bags filled so far", fallbackText: "Every gift helps fill a Red Bag." }, size: 0 },
    { type: "countdown", variant: 2, data: { date: "2026-12-24", label: "until Christmas Eve" }, size: 0 },
  ],
};
const NOW = new Date("2026-12-01T10:00:00Z");
const sentHtml = (): string => (h.sendNewsletter.mock.calls[0]?.[0] as { html: string }).html;
const sentText = (): string => (h.sendNewsletter.mock.calls[0]?.[0] as { text: string }).text;

beforeEach(() => {
  h.state.doc = JSON.parse(JSON.stringify(DOC));
  h.state.job = { id: 11, newsletterId: 7, pending: 1, total: 1, rollout: "all", perMinute: 600, dailyCap: null, startedAt: null };
  h.sendNewsletter.mockClear();
  h.readLiveNumberNow.mockReset();
  h.readLiveNumberNow.mockResolvedValue(312);
  h.markJobRunning.mockClear();
  // The stand-in database function does what the real one does to the stored document.
  h.freeze.mockReset();
  h.freeze.mockImplementation(async (_id: number, _job: number, values: Record<string, number | null>, at: string) => {
    h.state.doc = withFrozenTotals(h.state.doc, values, at);
    return true;
  });
});

describe("the first tick of a send", () => {
  it("reads each source once, uncached, freezes it into the newsletter before the job is marked running, and sends that number", async () => {
    await runSendTick(NOW);
    expect(h.readLiveNumberNow).toHaveBeenCalledTimes(1);
    expect(h.readLiveNumberNow).toHaveBeenCalledWith("redBag");
    expect(h.freeze).toHaveBeenCalledWith(7, 11, { redBag: 312 }, NOW.toISOString());
    expect(h.freeze.mock.invocationCallOrder[0]).toBeLessThan(h.markJobRunning.mock.invocationCallOrder[0]);
    expect(sentText()).toContain("312 bags filled so far");
  });

  it("counts the countdown from the UK day it is sent", async () => {
    await runSendTick(NOW);
    expect(sentText()).toContain("23 sleeps until Christmas Eve (Thursday 24 December)");
  });

  it("does not read or freeze again once the job has started", async () => {
    h.state.job.startedAt = "2026-11-30T09:00:00.000Z";
    h.state.doc = withFrozenTotals(DOC, { redBag: 200 }, "2026-11-30T09:00:00.000Z");
    await runSendTick(NOW);
    expect(h.readLiveNumberNow).not.toHaveBeenCalled();
    expect(h.freeze).not.toHaveBeenCalled();
    expect(sentText()).toContain("200 bags filled so far");
  });

  it("reads nothing for a newsletter with no live total", async () => {
    h.state.doc = { blocks: [DOC.blocks[0]] };
    await runSendTick(NOW);
    expect(h.readLiveNumberNow).not.toHaveBeenCalled();
    expect(h.freeze).not.toHaveBeenCalled();
    expect(h.sendNewsletter).toHaveBeenCalledTimes(1);
  });
});

describe("when something goes wrong, the send is unharmed", () => {
  it("a failed read freezes no number: the email goes, with the fallback words and no 0 bags", async () => {
    h.readLiveNumberNow.mockRejectedValue(new Error("database away"));
    await runSendTick(NOW);
    expect(h.freeze).toHaveBeenCalledWith(7, 11, { redBag: null }, NOW.toISOString());
    expect(h.sendNewsletter).toHaveBeenCalledTimes(1);
    expect(sentText()).toContain("Every gift helps fill a Red Bag.");
    expect(sentHtml()).not.toMatch(/\b0 bags/);
  });

  it("a failed write is logged and the email still goes, with the fallback words", async () => {
    h.freeze.mockRejectedValue(new Error("write refused"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await runSendTick(NOW);
    expect(h.sendNewsletter).toHaveBeenCalledTimes(1);
    expect(sentText()).toContain("Every gift helps fill a Red Bag.");
    expect(sentText()).not.toContain("312");
    expect(log.mock.calls.map((c) => String(c[0])).join(" ")).toContain("freezing");
    log.mockRestore();
  });
});
