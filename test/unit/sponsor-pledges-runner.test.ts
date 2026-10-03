import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.example/", BALL_FROM_EMAIL: "events@nbcc.example", ADMIN_SESSION_SECRET: "a-test-secret" },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/clients/email", () => ({ sendFundraisePledge: vi.fn(), sendFundraisePledgeStaff: vi.fn() }));

import {
  runPledgeEmails,
  runPledgeRetention,
  sendAllPayLinks,
  sendDoublePaidAlerts,
  sendPledgeConfirmEmail,
  sendPledgeEmailNow,
  sendPledgeStaffNote,
  pledgeLinks,
  type PledgeRunDeps,
} from "../../src/pledges/runner";
import { verifyPledgeToken } from "../../src/pledges/token";
import type { PledgeRecord, PledgeWithFundraiser } from "../../src/db/pledges";

// Sponsor pledges: the confirm email, the daily pass, and what staff send by hand. The pay email and
// its reminder are automatic emails, so nothing goes unless every guard says yes: the Automatic
// emails switch and fundraising are on, the wording is approved, the address is on neither stop list,
// and the email has not been claimed before. The confirm email is not automatic (it is what makes a
// pledge count at all), but it still respects the stop lists. Every name here is invented.

const NOW = new Date("2026-12-06T08:00:00Z"); // the day after the event below

const live = (over: Partial<PledgeRecord> = {}, f: Partial<PledgeWithFundraiser["f"]> = {}): PledgeWithFundraiser => ({
  p: {
    id: 5,
    fundraiserId: 7,
    firstName: "Alex",
    surname: "Example",
    email: "alex@example.com",
    amountPence: 1000,
    message: null,
    messageHidden: false,
    showName: true,
    showAmount: true,
    giftAid: false,
    status: "open",
    createdAt: "2026-11-01T10:00:00.000Z",
    payEmailClaimedAt: null,
    payEmailSentAt: null,
    reminderClaimedAt: null,
    reminderSentAt: null,
    paidAt: null,
    paidAmountPence: null,
    cashMarkedAt: null,
    cancelledAt: null,
    anonymisedAt: null,
    refunded: false,
    tokenNonce: "nonce-a",
    gaHouse: null,
    gaAddress: null,
    gaPostcode: null,
    gaNonUk: false,
    gaWordingVersion: null,
    gaWordingSnapshot: null,
    gaDeclaredAt: null,
    donationId: null,
    ...over,
  },
  f: {
    id: 7,
    path: "raising",
    public: true,
    status: "approved",
    kind: "run_walk",
    eventDate: "2026-12-05",
    isTeam: false,
    teamId: null,
    inMemory: false,
    finishedAt: null,
    title: "Robin's Santa Dash",
    slug: "robins-santa-dash",
    name: "Robin Testperson",
    ...f,
  },
});

function deps(rows: PledgeWithFundraiser[], over: Partial<PledgeRunDeps> = {}) {
  const d = {
    now: () => NOW,
    touchOn: vi.fn(async () => true),
    fundraisingOn: vi.fn(async () => true),
    approvedWordings: vi.fn(async () => new Set(["pledge_pay", "pledge_reminder"]) as ReadonlySet<string>),
    readLive: vi.fn(async () => rows),
    getPledge: vi.fn(async (id: number) => rows.find((r) => r.p.id === id) ?? null),
    blocked: vi.fn(async () => false),
    claim: vi.fn(async () => true),
    release: vi.fn(async () => undefined),
    markSent: vi.fn(async () => undefined),
    claimResend: vi.fn(async () => true),
    releaseResend: vi.fn(async () => undefined),
    markConfirmSent: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    sendStaff: vi.fn(async () => undefined),
    anonymise: vi.fn(async () => true),
    trim: vi.fn(async () => undefined),
    deleteUnconfirmed: vi.fn(async () => true),
    listDoublePaid: vi.fn(async () => [] as PledgeWithFundraiser[]),
    markAlerted: vi.fn(async () => undefined),
    ...over,
  };
  return d as typeof d & PledgeRunDeps;
}
type Sent = [string, Record<string, string>];
const sentOf = (d: ReturnType<typeof deps>, i = 0) => d.send.mock.calls[i] as unknown as Sent;

describe("the links in the emails", () => {
  it("are signed for that pledge, each for its own purpose", () => {
    const links = pledgeLinks({ id: 5, tokenNonce: "nonce-a" });
    expect(links.payUrl.startsWith("https://nbcc.example/pledge/pay?t=5.")).toBe(true);
    expect(links.cancelUrl.startsWith("https://nbcc.example/pledge/cancel?t=5.")).toBe(true);
    expect(links.confirmUrl.startsWith("https://nbcc.example/pledge/confirm?t=5.")).toBe(true);
    const pay = new URL(links.payUrl).searchParams.get("t");
    const confirm = new URL(links.confirmUrl).searchParams.get("t");
    expect(verifyPledgeToken(pay, () => "nonce-a", "a-test-secret")).toBe(5);
    expect(verifyPledgeToken(confirm, () => "nonce-a", "a-test-secret", "confirm")).toBe(5);
    expect(verifyPledgeToken(confirm, () => "nonce-a", "a-test-secret")).toBeNull();
  });
});

describe("the confirm email, sent when someone pledges", () => {
  const waiting = () => live({ status: "unconfirmed" });

  it("goes at once, from the events inbox, with no name kept in the log", async () => {
    const d = deps([waiting()]);
    expect(await sendPledgeConfirmEmail(waiting(), d)).toBe("sent");
    const [kind, message] = sentOf(d);
    expect(kind).toBe("pledge_confirm");
    expect(d.send.mock.calls[0].length).toBe(2);
    expect(message.email).toBe("alex@example.com");
    expect(message.from).toBe("events@nbcc.example");
    expect(message.replyTo).toBe("events@nbcc.example");
    expect(message.subject).toBe("Please confirm your £10 pledge");
    expect(message.html).toContain("https://nbcc.example/pledge/confirm?t=5.");
    expect(d.markConfirmSent).toHaveBeenCalledWith(5);
  });

  it("goes whatever the automatic emails switch and the wording approvals say", async () => {
    const d = deps([waiting()], { touchOn: vi.fn(async () => false), approvedWordings: vi.fn(async () => new Set<string>()) });
    expect(await sendPledgeConfirmEmail(waiting(), d)).toBe("sent");
    expect(d.touchOn).not.toHaveBeenCalled();
  });

  it("never goes to an address on a stop list, or when the lists cannot be read", async () => {
    const stopped = deps([waiting()], { blocked: vi.fn(async () => true) });
    expect(await sendPledgeConfirmEmail(waiting(), stopped)).toBe("blocked");
    expect(stopped.send).not.toHaveBeenCalled();
    const down = deps([waiting()], { blocked: vi.fn(async () => Promise.reject(new Error("down"))) });
    expect(await sendPledgeConfirmEmail(waiting(), down)).toBe("blocked");
    expect(down.send).not.toHaveBeenCalled();
  });

  it("never throws when the send fails", async () => {
    const d = deps([waiting()], { send: vi.fn(async () => Promise.reject(new Error("smtp"))) });
    expect(await sendPledgeConfirmEmail(waiting(), d)).toBe("failed");
    expect(d.markConfirmSent).not.toHaveBeenCalled();
  });
});

describe("the daily pledge emails", () => {
  it("sends the pay email the day after the event, claimed first, from and replying to the events inbox", async () => {
    const d = deps([live()]);
    const out = await runPledgeEmails(NOW, d);
    expect(out).toEqual({ considered: 1, sent: 1, failed: 0, skipped: 0, waiting: 0 });
    expect(d.claim).toHaveBeenCalledWith(5, "pledge_pay");
    const [kind, message] = sentOf(d);
    expect(kind).toBe("pledge_pay");
    expect(message.email).toBe("alex@example.com");
    expect(message.from).toBe("events@nbcc.example");
    expect(message.replyTo).toBe("events@nbcc.example");
    expect(message.subject).toBe("Robin finished Robin's Santa Dash! Here's your link to pay your £10 pledge");
    expect(message.html).toContain("https://nbcc.example/pledge/pay?t=5.");
    expect(d.markSent).toHaveBeenCalledWith(5, 7, "pledge_pay", "system:schedule");
    expect(d.claim.mock.invocationCallOrder[0]).toBeLessThan(d.send.mock.invocationCallOrder[0]);
  });

  it("never sends it for a pledge the sponsor has not confirmed", async () => {
    const d = deps([live({ status: "unconfirmed" })]);
    expect((await runPledgeEmails(NOW, d)).sent).toBe(0);
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("sends nothing before the event is over", async () => {
    const d = deps([live()]);
    const out = await runPledgeEmails(new Date("2026-12-05T08:00:00Z"), d);
    expect(out.sent).toBe(0);
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("sends nothing while the automatic emails are switched off", async () => {
    const d = deps([live()], { touchOn: vi.fn(async () => false) });
    expect(await runPledgeEmails(NOW, d)).toMatchObject({ sent: 0, skipped: "switched off" });
    expect(d.readLive).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it("sends nothing while fundraising is switched off", async () => {
    const d = deps([live()], { fundraisingOn: vi.fn(async () => false) });
    expect(await runPledgeEmails(NOW, d)).toMatchObject({ sent: 0, skipped: "fundraising off" });
  });

  it("holds the email while its wording is waiting for sign off, without claiming it", async () => {
    const d = deps([live()], { approvedWordings: vi.fn(async () => new Set(["pledge_reminder"]) as ReadonlySet<string>) });
    const out = await runPledgeEmails(NOW, d);
    expect(out).toMatchObject({ sent: 0, waiting: 1 });
    expect(d.claim).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it("counts approvals that cannot be read as none approved", async () => {
    const d = deps([live()], { approvedWordings: vi.fn(async () => Promise.reject(new Error("down"))) });
    expect(await runPledgeEmails(NOW, d)).toMatchObject({ sent: 0, waiting: 1 });
  });

  it("never emails an address on a stop list, and does not claim it", async () => {
    const d = deps([live()], { blocked: vi.fn(async () => true) });
    expect(await runPledgeEmails(NOW, d)).toMatchObject({ sent: 0, skipped: 1 });
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("does not email when the stop lists cannot be read", async () => {
    const d = deps([live()], { blocked: vi.fn(async () => Promise.reject(new Error("down"))) });
    expect(await runPledgeEmails(NOW, d)).toMatchObject({ sent: 0, skipped: 1 });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("never sends one another run has claimed", async () => {
    const d = deps([live()], { claim: vi.fn(async () => false) });
    expect(await runPledgeEmails(NOW, d)).toMatchObject({ sent: 0, skipped: 1 });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("gives the claim back when the send fails, so another day can try", async () => {
    const d = deps([live()], { send: vi.fn(async () => Promise.reject(new Error("smtp"))) });
    expect(await runPledgeEmails(NOW, d)).toMatchObject({ sent: 0, failed: 1 });
    expect(d.release).toHaveBeenCalledWith(5, "pledge_pay");
    expect(d.markSent).not.toHaveBeenCalled();
  });

  it("sends the one reminder a week after the pay email", async () => {
    const sent = live({ payEmailClaimedAt: "2026-12-06T08:00:00.000Z", payEmailSentAt: "2026-12-06T08:00:02.000Z" });
    const d = deps([sent]);
    expect((await runPledgeEmails(new Date("2026-12-12T08:00:00Z"), d)).sent).toBe(0);
    const out = await runPledgeEmails(new Date("2026-12-13T08:00:00Z"), d);
    expect(out.sent).toBe(1);
    expect(d.claim).toHaveBeenCalledWith(5, "pledge_reminder");
    expect(sentOf(d)[0]).toBe("pledge_reminder");
  });

  it("stops part way when the switch goes off", async () => {
    let on = 0;
    const d = deps([live(), live({ id: 6, email: "sam@example.com" })], { touchOn: vi.fn(async () => (on += 1) <= 2) });
    const out = await runPledgeEmails(NOW, d);
    expect(out.sent).toBe(1);
  });

  it("never throws", async () => {
    const d = deps([], { readLive: vi.fn(async () => Promise.reject(new Error("down"))) });
    expect(await runPledgeEmails(NOW, d)).toMatchObject({ sent: 0, skipped: "could not read" });
  });
});

describe("the daily tidy up of personal details", () => {
  it("anonymises an unpaid pledge 90 days after its pay email, whatever the switches say", async () => {
    const old = live({ payEmailClaimedAt: "2026-08-01T08:00:00.000Z", payEmailSentAt: "2026-08-01T08:00:00.000Z" }, { eventDate: "2026-07-31" });
    const d = deps([old, live()], { touchOn: vi.fn(async () => false) });
    expect(await runPledgeRetention(NOW, d)).toEqual({ anonymised: 1, trimmed: 0, deleted: 0, failed: 0 });
    expect(d.anonymise).toHaveBeenCalledTimes(1);
    expect(d.anonymise).toHaveBeenCalledWith(5);
  });

  it("deletes a pledge nobody confirmed within 7 days, and leaves a newer one", async () => {
    const d = deps([live({ status: "unconfirmed", createdAt: "2026-11-29T07:00:00.000Z" }), live({ id: 6, status: "unconfirmed", createdAt: "2026-12-03T07:00:00.000Z" })]);
    expect(await runPledgeRetention(NOW, d)).toEqual({ anonymised: 0, trimmed: 0, deleted: 1, failed: 0 });
    expect(d.deleteUnconfirmed).toHaveBeenCalledWith(5);
  });

  it("takes the email off a pledge paid 90 days ago", async () => {
    const d = deps([live({ status: "paid", paidAt: "2026-08-01T08:00:00.000Z", paidAmountPence: 1000 })]);
    expect(await runPledgeRetention(NOW, d)).toEqual({ anonymised: 0, trimmed: 1, deleted: 0, failed: 0 });
  });

  it("counts a failure and carries on", async () => {
    const old = live({ payEmailSentAt: "2026-08-01T08:00:00.000Z" }, { eventDate: "2026-07-31" });
    const d = deps([old, { ...old, p: { ...old.p, id: 6 } }], { anonymise: vi.fn(async (id: number) => (id === 5 ? Promise.reject(new Error("x")) : true)) });
    expect(await runPledgeRetention(NOW, d)).toEqual({ anonymised: 1, trimmed: 0, deleted: 0, failed: 1 });
  });
});

describe("staff sending the pay link by hand", () => {
  const sentBefore = () => live({ payEmailClaimedAt: "2026-12-06T08:00:00.000Z", payEmailSentAt: "2026-12-06T08:00:02.000Z" });

  it("sends the pay email for an open pledge once it is due, held so it cannot go twice", async () => {
    const d = deps([sentBefore()]);
    expect(await sendPledgeEmailNow(5, "admin:fern@example.com", d)).toBe("sent");
    expect(sentOf(d)[0]).toBe("pledge_pay");
    expect(d.claimResend).toHaveBeenCalledWith(5);
    expect(d.claimResend.mock.invocationCallOrder[0]).toBeLessThan(d.send.mock.invocationCallOrder[0]);
    expect(d.markSent).toHaveBeenCalledWith(5, 7, "pledge_pay", "admin:fern@example.com");
  });

  it("is refused before the link is due", async () => {
    const d = deps([live()], { now: () => new Date("2026-12-04T08:00:00Z") });
    expect(await sendPledgeEmailNow(5, "admin:x", d)).toBe("early");
    expect(d.send).not.toHaveBeenCalled();
  });

  it("obeys every rule the daily task does: the switch, fundraising, the wording, the stop lists", async () => {
    expect(await sendPledgeEmailNow(5, "admin:x", deps([live()], { touchOn: vi.fn(async () => false) }))).toBe("switched_off");
    expect(await sendPledgeEmailNow(5, "admin:x", deps([live()], { fundraisingOn: vi.fn(async () => false) }))).toBe("off");
    expect(await sendPledgeEmailNow(5, "admin:x", deps([live()], { approvedWordings: vi.fn(async () => new Set<string>()) }))).toBe("waiting");
    expect(await sendPledgeEmailNow(5, "admin:x", deps([live()], { blocked: vi.fn(async () => true) }))).toBe("blocked");
  });

  it("is refused when it went in the last ten minutes", async () => {
    const d = deps([sentBefore()], { claimResend: vi.fn(async () => false) });
    expect(await sendPledgeEmailNow(5, "admin:x", d)).toBe("too_soon");
    expect(d.send).not.toHaveBeenCalled();
  });

  it("refuses a pledge that is not open, has no address left, or whose page no longer has pledges", async () => {
    expect(await sendPledgeEmailNow(5, "admin:x", deps([live({ status: "paid" })]))).toBe("not_open");
    expect(await sendPledgeEmailNow(5, "admin:x", deps([live({ status: "unconfirmed" })]))).toBe("not_open");
    expect(await sendPledgeEmailNow(5, "admin:x", deps([live({ email: null, anonymisedAt: "2027-01-01T00:00:00.000Z" })]))).toBe("not_open");
    expect(await sendPledgeEmailNow(5, "admin:x", deps([live({}, { public: false })]))).toBe("page");
    expect(await sendPledgeEmailNow(9, "admin:x", deps([live()]))).toBe("not_found");
  });

  it("says so when the send fails, and lets it be tried again", async () => {
    const d = deps([live()], { send: vi.fn(async () => Promise.reject(new Error("smtp"))) });
    expect(await sendPledgeEmailNow(5, "admin:x", d)).toBe("failed");
    expect(d.releaseResend).toHaveBeenCalledWith(5);
  });
});

describe("new pay links for everyone unpaid (after the signing secret changes)", () => {
  it("sends one to every open pledge that has had a pay link, and to nobody else", async () => {
    const had = (id: number, over: Partial<PledgeRecord> = {}) => live({ id, payEmailClaimedAt: "2026-12-06T08:00:00.000Z", payEmailSentAt: "2026-12-06T08:00:02.000Z", ...over });
    const d = deps([had(5), had(6, { status: "paid" }), live({ id: 7 }), had(8, { status: "cancelled" }), had(9)]);
    expect(await sendAllPayLinks("admin:jaimie@example.com", d)).toEqual({ sent: 2, skipped: 0, failed: 0, stopped: null });
    expect(d.claimResend.mock.calls.map((c) => (c as unknown as [number])[0])).toEqual([5, 9]);
  });

  it("stops at once, saying why, when the rules say nothing may go", async () => {
    const had = live({ payEmailClaimedAt: "2026-12-06T08:00:00.000Z", payEmailSentAt: "2026-12-06T08:00:02.000Z" });
    const d = deps([had, { ...had, p: { ...had.p, id: 6 } }], { approvedWordings: vi.fn(async () => new Set<string>()) });
    expect(await sendAllPayLinks("admin:x", d)).toEqual({ sent: 0, skipped: 0, failed: 0, stopped: "waiting" });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("counts the ones held back or failed, and carries on", async () => {
    const had = (id: number) => live({ id, payEmailClaimedAt: "2026-12-06T08:00:00.000Z", payEmailSentAt: "2026-12-06T08:00:02.000Z" });
    const d = deps([had(5), had(6)], { claimResend: vi.fn(async (id: number) => id !== 5) });
    expect(await sendAllPayLinks("admin:x", d)).toEqual({ sent: 1, skipped: 1, failed: 0, stopped: null });
  });
});

describe("telling the events inbox", () => {
  it("about pledges paid twice, once, with no sponsor's name or address", async () => {
    const twice = live({ status: "paid", doublePaidAt: "2026-12-07T10:00:00.000Z" });
    const d = deps([], { listDoublePaid: vi.fn(async () => [twice]) });
    expect(await sendDoublePaidAlerts(d)).toBe(1);
    const message = d.sendStaff.mock.calls[0][0] as unknown as Record<string, string>;
    expect(message.email).toBe("events@nbcc.example");
    expect(message.subject).toBe("1 pledge paid twice: check and refund");
    expect(message.text).toContain("Robin's Santa Dash: pledge 5 (£10)");
    expect(message.text).not.toContain("Alex");
    expect(message.text).not.toContain("alex@example.com");
    expect(message.html).toContain("https://nbcc.example/admin");
    expect(d.markAlerted).toHaveBeenCalledWith([5]);
  });

  it("sends nothing when there is nothing to say, and never throws", async () => {
    const none = deps([]);
    expect(await sendDoublePaidAlerts(none)).toBe(0);
    expect(none.sendStaff).not.toHaveBeenCalled();
    const broken = deps([], { listDoublePaid: vi.fn(async () => Promise.reject(new Error("down"))) });
    expect(await sendDoublePaidAlerts(broken)).toBe(0);
  });

  it("does not mark them told when the email fails, so the next run tries again", async () => {
    const d = deps([], { listDoublePaid: vi.fn(async () => [live({ status: "paid" })]), sendStaff: vi.fn(async () => Promise.reject(new Error("smtp"))) });
    expect(await sendDoublePaidAlerts(d)).toBe(0);
    expect(d.markAlerted).not.toHaveBeenCalled();
  });

  it("a plain note, such as a pledge an organiser hid from their page", async () => {
    const d = deps([]);
    await sendPledgeStaffNote("A pledge was hidden by its organiser", ["Robin's Santa Dash: pledge 5 was hidden from the page."], d);
    const message = d.sendStaff.mock.calls[0][0] as unknown as Record<string, string>;
    expect(message.subject).toBe("A pledge was hidden by its organiser");
    expect(message.from).toBe("events@nbcc.example");
  });
});
