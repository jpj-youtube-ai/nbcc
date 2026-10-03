import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-515: the daily pass that sends the automatic emails, and the finished email sent when staff
// press Mark finished. FUNDRAISING IS LIVE, so the guards are what matter most here: nothing at all
// while the Automatic emails switch is off (it ships off) or fundraising is off, never twice, never
// to an address that opted out or is on the suppression list, never to an in memory page, and a
// failed send is given back for another day. Every seam is a fake. Every name is invented.

vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.test", BALL_FROM_EMAIL: "events@nbcc.test" } }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { runTouchEmails, sendFinishedTouch, type TouchDeps } from "../../src/fundraising/touch-runner";
import { meter, type FundraiserRecord, type Meter } from "../../src/fundraising/model";
import type { TouchCandidate } from "../../src/db/fundraising-touch";

type F = FundraiserRecord & { meter: Meter; editWaiting: boolean };
const WANTS = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false };

function fr(over: Partial<FundraiserRecord> = {}, raised = 0): F {
  const base = {
    id: 7, slug: "sams-santa-dash", path: "raising", kind: "santa_dash", title: "Sam's Santa Dash", description: "A dash.",
    eventDate: "2026-12-06", startTime: null, venue: "", town: "Exampleton", targetPence: 50000, public: true, status: "approved",
    name: "Sam Example", email: "sam@example.com", phone: "07700 900123", socialLink: null, socialOk: true, wants: { ...WANTS },
    postAddress: null, postLine1: null, postLine2: null, postTown: null, postPostcode: null, newsletterOk: false, imageSrc: null,
    declinedReason: null, createdAt: "2026-10-01T09:00:00.000Z", approvedAt: "2026-10-06T09:00:00.000Z", approvedBy: "admin:fern@example.com",
    updatedAt: "2026-10-06T09:00:00.000Z", updatedBy: null, cardLine: null, endTime: null, timeTbc: false, venueAddress: null,
    venuePostcode: null, access: [], price: null, booking: null, ticketUrl: null, ageLimit: null, dressCode: null, included: null,
    creditName: null, ...over,
  } as FundraiserRecord;
  return { ...base, meter: meter({ onlinePence: raised, cashPence: 0, targetPence: base.targetPence }), editWaiting: false };
}

const candidate = (f: F, sent: TouchCandidate["touch"]["sent"] = []): TouchCandidate => ({
  f,
  touch: { firstOnlineGiftAt: null, lastOnlineGiftAt: null, finishedAt: null, sent },
  prompt: { lastOnlineGiftAt: null, calls: [] },
});

// 29 November 2026, 8am in the UK: Sam's Santa Dash (6 December) is a week away.
const NOW = new Date("2026-11-29T08:00:00.000Z");

function deps(over: Partial<TouchDeps> = {}): TouchDeps & { sent: Array<{ kind: string; to: string; subject: string }> } {
  const sent: Array<{ kind: string; to: string; subject: string }> = [];
  const d: TouchDeps = {
    touchOn: vi.fn(async () => true),
    fundraisingOn: vi.fn(async () => true),
    readState: vi.fn(async () => [candidate(fr({}, 20000))]),
    blocked: vi.fn(async () => false),
    claim: vi.fn(async () => true),
    release: vi.fn(async () => undefined),
    recordSent: vi.fn(async () => undefined),
    send: vi.fn(async (kind: string, _name: string, m: { email: string; subject: string }) => {
      sent.push({ kind, to: m.email, subject: m.subject });
    }),
    ...over,
  };
  return Object.assign(d, { sent });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("the daily pass", () => {
  it("sends the one due, from and replying to the events inbox, claimed first and recorded after", async () => {
    const d = deps();
    const r = await runTouchEmails(NOW, d);
    expect(r).toMatchObject({ considered: 1, sent: 1, skipped: 0, failed: 0 });
    expect(d.sent).toEqual([{ kind: "week_before", to: "sam@example.com", subject: "One week to go, Sam!" }]);
    const message = (d.send as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(message).toMatchObject({ from: "events@nbcc.test", replyTo: "events@nbcc.test" });
    expect(message.html).toContain("https://nbcc.test/fundraise/manage");
    expect(d.claim).toHaveBeenCalledWith(7, "week_before", "system:schedule");
    expect(d.recordSent).toHaveBeenCalledWith(7, "week_before", "system:schedule");
    const claimOrder = (d.claim as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const sendOrder = (d.send as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(sendOrder);
  });

  it("sends nothing, and reads nothing, while the Automatic emails switch is off", async () => {
    const d = deps({ touchOn: vi.fn(async () => false) });
    expect(await runTouchEmails(NOW, d)).toMatchObject({ sent: 0, skipped: "switched off" });
    expect(d.readState).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it("sends nothing while fundraising is switched off", async () => {
    const d = deps({ fundraisingOn: vi.fn(async () => false) });
    expect(await runTouchEmails(NOW, d)).toMatchObject({ sent: 0, skipped: "fundraising off" });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("stops part way if either switch goes off", async () => {
    const on = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
    const d = deps({
      touchOn: on,
      readState: vi.fn(async () => [candidate(fr({ id: 1 }, 20000)), candidate(fr({ id: 2 }, 20000))]),
    });
    const r = await runTouchEmails(NOW, d);
    expect(r.sent).toBe(1);
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it("never sends twice: an email already claimed is not sent again", async () => {
    const d = deps({ claim: vi.fn(async () => false) });
    expect(await runTouchEmails(NOW, d)).toMatchObject({ sent: 0, skipped: 1 });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("never sends one already recorded as sent", async () => {
    const d = deps({ readState: vi.fn(async () => [candidate(fr({}, 20000), [{ kind: "week_before", sentAt: "2026-11-28T08:00:00Z" }])]) });
    await runTouchEmails(NOW, d);
    expect(d.send).not.toHaveBeenCalled();
  });

  it("skips an address that opted out or is on the suppression list, and claims nothing for it", async () => {
    const d = deps({ blocked: vi.fn(async () => true) });
    expect(await runTouchEmails(NOW, d)).toMatchObject({ sent: 0, skipped: 1 });
    expect(d.blocked).toHaveBeenCalledWith("sam@example.com");
    expect(d.claim).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it("sends nothing when the lists cannot be read", async () => {
    const d = deps({ blocked: vi.fn(async () => Promise.reject(new Error("down"))) });
    expect(await runTouchEmails(NOW, d)).toMatchObject({ sent: 0, skipped: 1 });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("never emails an in memory page", async () => {
    const d = deps({ isQuiet: () => true });
    expect(await runTouchEmails(NOW, d)).toMatchObject({ sent: 0 });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("gives a failed send back, so another day can try", async () => {
    const d = deps({ send: vi.fn(async () => Promise.reject(new Error("SES said no"))) });
    expect(await runTouchEmails(NOW, d)).toMatchObject({ sent: 0, failed: 1 });
    expect(d.release).toHaveBeenCalledWith(7, "week_before");
    expect(d.recordSent).not.toHaveBeenCalled();
  });

  it("never throws, even when nothing can be read", async () => {
    const d = deps({ readState: vi.fn(async () => Promise.reject(new Error("down"))) });
    expect(await runTouchEmails(NOW, d)).toMatchObject({ sent: 0, skipped: "could not read" });
  });

  it("sends nothing to a fundraiser that is not due anything", async () => {
    const d = deps({ readState: vi.fn(async () => [candidate(fr({ eventDate: null, targetPence: null }))]) });
    expect(await runTouchEmails(NOW, d)).toMatchObject({ considered: 1, sent: 0 });
  });
});

describe("the finished email, when staff press Mark finished", () => {
  const finished = fr({ status: "finished" }, 61200);

  it("goes at once with the certificate, claimed first", async () => {
    const d = deps();
    expect(await sendFinishedTouch(finished, d)).toBe("sent");
    expect(d.sent).toEqual([{ kind: "finished", to: "sam@example.com", subject: "Thank you from all of us at NBCC" }]);
    expect((d.send as ReturnType<typeof vi.fn>).mock.calls[0][2].html).toContain("/api/fundraise/manage/fundraisers/7/materials/certificate");
    expect(d.claim).toHaveBeenCalledWith(7, "finished", "system:finished");
  });

  it("is not sent while the switch is off, or fundraising is off", async () => {
    expect(await sendFinishedTouch(finished, deps({ touchOn: vi.fn(async () => false) }))).toBe("skipped");
    expect(await sendFinishedTouch(finished, deps({ fundraisingOn: vi.fn(async () => false) }))).toBe("skipped");
  });

  it("is only for a finished public page raising money, never in memory, never to an opted out address", async () => {
    expect(await sendFinishedTouch(fr({ status: "approved" }, 100), deps())).toBe("skipped");
    expect(await sendFinishedTouch(fr({ status: "finished", path: "event" }), deps())).toBe("skipped");
    expect(await sendFinishedTouch(finished, deps({ isQuiet: () => true }))).toBe("skipped");
    expect(await sendFinishedTouch(finished, deps({ blocked: vi.fn(async () => true) }))).toBe("skipped");
  });

  it("is never sent twice", async () => {
    const d = deps({ claim: vi.fn(async () => false) });
    expect(await sendFinishedTouch(finished, d)).toBe("skipped");
    expect(d.send).not.toHaveBeenCalled();
  });

  it("gives the claim back if the send fails, and never throws", async () => {
    const d = deps({ send: vi.fn(async () => Promise.reject(new Error("SES said no"))) });
    expect(await sendFinishedTouch(finished, d)).toBe("failed");
    expect(d.release).toHaveBeenCalledWith(7, "finished");
  });
});

// The daily 8am job (src/scripts/send-reminders.ts) only runs when started directly, so its wiring
// is read from the source, as fundraising-summary-runner.test.ts does.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("the daily 8am job", () => {
  const source = readFileSync(resolve(__dirname, "../../src/scripts/send-reminders.ts"), "utf8");

  it("runs the automatic emails inside their own try/catch", () => {
    const at = source.indexOf("runTouchEmails(");
    expect(at, "send-reminders.ts never runs the automatic emails").toBeGreaterThan(-1);
    const before = source.lastIndexOf("try {", at);
    const catchAt = source.indexOf("} catch (err) {", at);
    expect(source.slice(before, catchAt).match(/await import\(/g)).toHaveLength(1);
    expect(source.slice(catchAt, catchAt + 120)).toContain("fundraising automatic emails");
  });

  it("runs them before the pool is closed", () => {
    expect(source.indexOf("runTouchEmails(")).toBeLessThan(source.indexOf("await pool.end();"));
  });
});
