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
import { WORDING_KEYS } from "../../src/fundraising/touch-rules";

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
    againLink: vi.fn(async (id: number) => `https://nbcc.test/fundraise?again=token-for-${id}`),
    // Every new wording approved, unless a test says otherwise.
    approvedWordings: vi.fn(async () => new Set<string>(WORDING_KEYS)),
    markFinishedPending: vi.fn(async () => undefined),
    clearFinishedPending: vi.fn(async () => undefined),
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
  vi.spyOn(console, "info").mockImplementation(() => undefined);
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

  it("says clearly in the log that a failed send may still have reached them, and will be tried again", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await runTouchEmails(NOW, deps({ send: vi.fn(async () => Promise.reject(new Error("timed out"))) }));
    const said = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(said).toMatch(/fundraiser 7/);
    expect(said).toMatch(/may still have reached them/);
    expect(said).toMatch(/tried again on a later run/);
    expect(said).toContain("timed out");
    expect(said).not.toContain("sam@example.com");
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

describe("new wording waits for sign off (Jaimie, 2026-10-03)", () => {
  // Sam has reached the target and has no date: only "target" (new wording) is due.
  const atTarget = () => [candidate(fr({ eventDate: null }, 50000))];
  const approving = (...keys: string[]) => vi.fn(async () => new Set<string>(keys));

  it("skips an email whose new wording is not approved: not claimed, not sent, so it can go once approved", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const d = deps({ readState: vi.fn(async () => atTarget()), approvedWordings: approving() });
    const r = await runTouchEmails(NOW, d);
    expect(r).toMatchObject({ considered: 1, sent: 0, failed: 0, waiting: 1 });
    expect(d.claim).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect(d.recordSent).not.toHaveBeenCalled();
    const said = info.mock.calls.map((c) => c.join(" ")).join(" | ");
    expect(said).toMatch(/fundraiser 7/);
    expect(said).toMatch(/target/);
    expect(said).toMatch(/waiting for sign off/);
    expect(said).not.toContain("sam@example.com");
  });

  it("sends it once its wording is approved", async () => {
    const d = deps({ readState: vi.fn(async () => atTarget()), approvedWordings: approving("target") });
    expect(await runTouchEmails(NOW, d)).toMatchObject({ sent: 1, waiting: 0 });
    expect(d.sent[0].kind).toBe("target");
  });

  it("still sends the wording that was already approved, whatever is waiting", async () => {
    // A week before (approved 2026-10-02) and target are both due: a week before goes.
    const d = deps({ readState: vi.fn(async () => [candidate(fr({}, 50000))]), approvedWordings: approving() });
    expect(await runTouchEmails(NOW, d)).toMatchObject({ sent: 1 });
    expect(d.sent[0].kind).toBe("week_before");
  });

  it("holds back the nothing raised version on its own: approving the usual one is not enough", async () => {
    // Finished two days ago, with nothing raised: the finished email's nothing raised version.
    const done = [{ ...candidate(fr({ status: "finished", eventDate: null }, 0)), touch: { firstOnlineGiftAt: null, lastOnlineGiftAt: null, finishedAt: "2026-11-27T15:00:00Z", finishedPending: "held" as const, sent: [] } }];
    const held = deps({ readState: vi.fn(async () => done), approvedWordings: approving("finished") });
    expect(await runTouchEmails(NOW, held)).toMatchObject({ sent: 0, waiting: 1 });
    expect(held.claim).not.toHaveBeenCalled();
    const ok = deps({ readState: vi.fn(async () => done), approvedWordings: approving("finished_zero") });
    expect(await runTouchEmails(NOW, ok)).toMatchObject({ sent: 1 });
    expect(ok.sent[0].kind).toBe("finished");
    expect(ok.claim).toHaveBeenCalledWith(7, "finished", "system:schedule");
  });

  it("sends no new wording at all when the approvals cannot be read, but the rest still goes", async () => {
    const down = vi.fn(async () => Promise.reject(new Error("down")));
    const d = deps({ readState: vi.fn(async () => [candidate(fr({}, 50000)), candidate(fr({ id: 8, eventDate: null }, 50000))]), approvedWordings: down });
    expect(await runTouchEmails(NOW, d)).toMatchObject({ sent: 1, waiting: 1 });
    expect(d.sent.map((m) => m.kind)).toEqual(["week_before"]);
  });

  it("holds back the finished email at Mark finished until it is approved, without claiming it, and marks it held", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const d = deps({ approvedWordings: approving("finished_zero") });
    expect(await sendFinishedTouch(fr({ status: "finished" }, 61200), d)).toBe("skipped");
    expect(d.claim).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect(d.markFinishedPending).toHaveBeenCalledWith(7, "held");
    expect(info.mock.calls.map((c) => c.join(" ")).join(" | ")).toMatch(/fundraiser 7.*waiting for sign off/);
    const ok = deps({ approvedWordings: approving("finished") });
    expect(await sendFinishedTouch(fr({ status: "finished" }, 61200), ok)).toBe("sent");
  });
});

describe("catching up the thank you in the daily run", () => {
  // Sam's Santa Dash, marked finished two days before NOW, with £612 raised.
  const finishedSam = (over: Partial<FundraiserRecord> = {}, pending: "held" | "failed" | null = "held", sent: TouchCandidate["touch"]["sent"] = []) => [
    {
      ...candidate(fr({ status: "finished", eventDate: null, ...over }, 61200)),
      touch: { firstOnlineGiftAt: null, lastOnlineGiftAt: null, finishedAt: "2026-11-27T15:00:00Z", finishedPending: pending, sent },
    },
  ];

  it("never sends the thank you to a page marked finished while automatic emails were off, once they are on", async () => {
    // Switched off at Mark finished: nothing is held or failed, so nothing is marked...
    const off = deps({ touchOn: vi.fn(async () => false) });
    expect(await sendFinishedTouch(fr({ status: "finished" }, 61200), off)).toBe("skipped");
    expect(off.markFinishedPending).not.toHaveBeenCalled();
    // ...and switched on later, the daily run never sends it.
    const d = deps({ readState: vi.fn(async () => finishedSam({}, null)) });
    expect(await runTouchEmails(NOW, d)).toMatchObject({ sent: 0 });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("sends one held for sign off once it is approved, once, and clears the mark", async () => {
    const d = deps({ readState: vi.fn(async () => finishedSam()) });
    expect(await runTouchEmails(NOW, d)).toMatchObject({ sent: 1 });
    expect(d.sent).toEqual([{ kind: "finished", to: "sam@example.com", subject: "Thank you from all of us at NBCC" }]);
    expect(d.claim).toHaveBeenCalledWith(7, "finished", "system:schedule");
    expect(d.clearFinishedPending).toHaveBeenCalledWith(7);
    const again = deps({ readState: vi.fn(async () => finishedSam({}, "held", [{ kind: "finished", sentAt: "2026-11-29T08:00:00Z" }])) });
    expect(await runTouchEmails(new Date("2026-11-30T08:00:00Z"), again)).toMatchObject({ sent: 0 });
  });

  it("marks a thank you whose send failed at Mark finished, and the daily run tries it again", async () => {
    const failed = deps({ send: vi.fn(async () => Promise.reject(new Error("SES said no"))) });
    expect(await sendFinishedTouch(fr({ status: "finished" }, 61200), failed)).toBe("failed");
    expect(failed.release).toHaveBeenCalledWith(7, "finished");
    expect(failed.markFinishedPending).toHaveBeenCalledWith(7, "failed");
    const d = deps({ readState: vi.fn(async () => finishedSam({}, "failed")) });
    expect(await runTouchEmails(NOW, d)).toMatchObject({ sent: 1 });
    expect(d.sent[0].kind).toBe("finished");
  });

  it("does not mark one that was never going to go: opted out, already sent, or in memory", async () => {
    for (const over of [{ blocked: vi.fn(async () => true) }, { claim: vi.fn(async () => false) }, { isQuiet: () => true }]) {
      const d = deps(over);
      expect(await sendFinishedTouch(fr({ status: "finished" }, 61200), d)).toBe("skipped");
      expect(d.markFinishedPending).not.toHaveBeenCalled();
    }
  });

  it("skips the catch-up for an in memory page, one not public, and while switched off", async () => {
    expect(await runTouchEmails(NOW, deps({ readState: vi.fn(async () => finishedSam()), isQuiet: () => true }))).toMatchObject({ sent: 0 });
    expect(await runTouchEmails(NOW, deps({ readState: vi.fn(async () => finishedSam({ public: false })) }))).toMatchObject({ sent: 0 });
    const off = deps({ readState: vi.fn(async () => finishedSam()), touchOn: vi.fn(async () => false) });
    expect(await runTouchEmails(NOW, off)).toMatchObject({ sent: 0, skipped: "switched off" });
    expect(off.send).not.toHaveBeenCalled();
  });

  it("while the thank you is held, sends no year on in its place", async () => {
    // Its date a year before NOW: a year on is due too.
    const d = deps({ readState: vi.fn(async () => finishedSam({ eventDate: "2025-11-27" })), approvedWordings: vi.fn(async () => new Set<string>()) });
    expect(await runTouchEmails(NOW, d)).toMatchObject({ sent: 0, waiting: 1 });
    expect(d.claim).not.toHaveBeenCalled();
  });
});

describe("a year on: Do it again", () => {
  // 6 December 2027: a year after Sam's Santa Dash.
  const YEAR_ON = new Date("2027-12-06T08:00:00.000Z");
  const finished = () => [candidate(fr({ status: "finished" }, 61200))];

  // The real in memory guard (no stand in): a year on from a page in memory of someone, nothing goes
  // and no Do it again link is ever made for it.
  it("never goes to a page in memory of someone, and makes no link for it", async () => {
    for (const memory of [{ inMemory: true, memoryName: "Jean Example" }, { kind: "in_memory" }]) {
      const d = deps({ readState: vi.fn(async () => [candidate(fr({ status: "finished", ...memory } as Partial<FundraiserRecord>, 61200))]) });
      expect(await runTouchEmails(YEAR_ON, d)).toMatchObject({ sent: 0 });
      expect(d.againLink).not.toHaveBeenCalled();
      expect(d.send).not.toHaveBeenCalled();
      expect(d.claim).not.toHaveBeenCalled();
    }
  });

  it("makes a one use link to the form, filled in from last year, and puts it on the button", async () => {
    const d = deps({ readState: vi.fn(async () => finished()) });
    expect(await runTouchEmails(YEAR_ON, d)).toMatchObject({ sent: 1 });
    expect(d.sent[0].kind).toBe("year_on");
    expect(d.againLink).toHaveBeenCalledWith(7);
    const message = (d.send as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(message.html).toContain('href="https://nbcc.test/fundraise?again=token-for-7"');
    expect(message.text).toContain("Do it again: https://nbcc.test/fundraise?again=token-for-7");
  });

  it("makes no link for any other email", async () => {
    const d = deps();
    await runTouchEmails(NOW, d);
    expect(d.againLink).not.toHaveBeenCalled();
  });

  it("sends nothing, and gives the claim back, when the link cannot be made", async () => {
    const d = deps({ readState: vi.fn(async () => finished()), againLink: vi.fn(async () => Promise.reject(new Error("down"))) });
    expect(await runTouchEmails(YEAR_ON, d)).toMatchObject({ sent: 0, failed: 1 });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.release).toHaveBeenCalledWith(7, "year_on");
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
