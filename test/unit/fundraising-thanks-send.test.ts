import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-507: sending the thank yous staff approved, in the background, one gift at a time. Each gift
// is claimed before its email; a giver with no address, on the suppression list, or who has opted
// out is skipped, as is a gift no longer thankable (refunded, paid in, fundraiser not running), and
// why is recorded for staff; a failed send is recorded and the run goes on; nothing ever throws. The database and the email client are mocked. Every name and address
// here is invented.

const db = vi.hoisted(() => ({
  claimNextQueuedThanksGift: vi.fn(),
  finishThanksGift: vi.fn(),
  markThanksDeliveredIfDone: vi.fn(),
  failStaleSending: vi.fn(),
  undeliveredDoneThanks: vi.fn(),
}));
const { suppressedAmong, optedOutAmong, sendFundraiseSupporterThanks } = vi.hoisted(() => ({
  suppressedAmong: vi.fn(),
  optedOutAmong: vi.fn(),
  sendFundraiseSupporterThanks: vi.fn(),
}));
vi.mock("../../src/db/fundraiser-thanks", () => db);
vi.mock("../../src/db/email-suppressions", () => ({ suppressedAmong }));
vi.mock("../../src/db/email-opt-outs", () => ({ optedOutAmong }));
vi.mock("../../src/clients/email", () => ({ sendFundraiseSupporterThanks }));
vi.mock("../../src/config", () => ({ config: { BALL_FROM_EMAIL: "events@nbcc.test", PORTAL_BASE_URL: "https://nbcc.test/", NODE_ENV: "test" } }));

import { sendQueuedThanks } from "../../src/fundraising/thanks-send";
import type { QueuedThanksGift } from "../../src/db/fundraiser-thanks";

const queued = (over: Partial<QueuedThanksGift> = {}): QueuedThanksGift => ({
  id: 70,
  thanksId: 3,
  fundraiserId: 9,
  donationId: 41,
  message: "Thank you so much!",
  title: "Sam's Walk",
  organiserName: "Sam Sample",
  donorName: "Alex Example",
  email: "alex@example.com",
  alreadySent: false,
  paymentStatus: "paid",
  amountPence: 2000,
  refundedPence: 0,
  paidIn: false,
  fundraiserStatus: "approved",
  ...over,
});

function queue(...gifts: QueuedThanksGift[]) {
  const list = [...gifts];
  db.claimNextQueuedThanksGift.mockImplementation(async () => list.shift() ?? null);
}

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.failStaleSending.mockResolvedValue([]);
  db.undeliveredDoneThanks.mockResolvedValue([]);
  db.finishThanksGift.mockResolvedValue(undefined);
  db.markThanksDeliveredIfDone.mockResolvedValue(false);
  suppressedAmong.mockReset().mockResolvedValue(new Set());
  optedOutAmong.mockReset().mockResolvedValue(new Set());
  sendFundraiseSupporterThanks.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("sending the approved thank yous", () => {
  // The readthrough (2026-10-04): a thank you from a page in memory of someone comes from Jodie.
  it("sends the in memory one from Jodie, replying to Jodie, with her address in it", async () => {
    queue(queued({ inMemory: true }));
    expect(await sendQueuedThanks()).toEqual({ sent: 1, skipped: 0, failed: 0 });
    const msg = sendFundraiseSupporterThanks.mock.calls[0][1];
    expect(msg).toMatchObject({ email: "alex@example.com", from: "Jodie at NBCC <jodie@nbcc.scot>", replyTo: "jodie@nbcc.scot" });
    expect(msg.html + msg.text).not.toContain("events@");
    expect(msg.html).toContain("mailto:jodie@nbcc.scot");
  });

  it("still checks the suppression and opt out lists before an in memory one", async () => {
    suppressedAmong.mockResolvedValue(new Set(["alex@example.com"]));
    queue(queued({ inMemory: true }));
    expect(await sendQueuedThanks()).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(sendFundraiseSupporterThanks).not.toHaveBeenCalled();
  });

  it("emails the giver email 20, from and replying to the events inbox, and records it sent", async () => {
    queue(queued());
    expect(await sendQueuedThanks()).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(sendFundraiseSupporterThanks).toHaveBeenCalledTimes(1);
    const [name, msg] = sendFundraiseSupporterThanks.mock.calls[0];
    expect(name).toBe("Alex Example");
    expect(msg).toMatchObject({ email: "alex@example.com", from: "events@nbcc.test", replyTo: "events@nbcc.test", subject: "A thank you from Sam" });
    expect(msg.html).toContain("Thank you so much!");
    expect(msg.html).toContain("Sam&#39;s Walk");
    expect(db.finishThanksGift).toHaveBeenCalledWith(70, "sent", null);
    expect(db.markThanksDeliveredIfDone).toHaveBeenCalledWith(3);
  });

  // 2026-10-04: the keep in touch links are built on the public site address the other fundraising
  // emails use, and are the same for every giver: nothing of theirs is in them.
  it("invites the giver to keep in touch, with plain links to the site and nothing of theirs in them", async () => {
    queue(queued());
    await sendQueuedThanks();
    const msg = sendFundraiseSupporterThanks.mock.calls[0][1];
    expect(msg.html).toContain('href="https://nbcc.test/newsletter"');
    expect(msg.html).toContain('href="https://nbcc.test/get-involved"');
    expect(msg.text).toContain("Join our mailing list: https://nbcc.test/newsletter");
    expect(msg.text).toContain("Get involved page: https://nbcc.test/get-involved");
    expect(msg.html + msg.text).not.toMatch(/nbcc\.test\/[^\s"<]*[?#&=]/);
    expect(msg.html + msg.text).not.toMatch(/alex|token/i);
  });

  it("keeps the in memory one free of the keep in touch links", async () => {
    queue(queued({ inMemory: true }));
    await sendQueuedThanks();
    const msg = sendFundraiseSupporterThanks.mock.calls[0][1];
    expect(msg.html + msg.text).not.toContain("nbcc.test/");
    expect(msg.html + msg.text).not.toContain("mailing list");
  });

  it("never puts the organiser's address anywhere, so a reply goes to NBCC", async () => {
    queue(queued());
    await sendQueuedThanks();
    expect(JSON.stringify(sendFundraiseSupporterThanks.mock.calls[0])).not.toContain("sam@");
  });

  it("checks the suppression list at send time, and skips an address on it", async () => {
    suppressedAmong.mockResolvedValue(new Set(["alex@example.com"]));
    queue(queued({ email: "Alex@Example.com" }));
    expect(await sendQueuedThanks()).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(suppressedAmong).toHaveBeenCalledWith(["Alex@Example.com"]);
    expect(sendFundraiseSupporterThanks).not.toHaveBeenCalled();
    expect(db.finishThanksGift).toHaveBeenCalledWith(70, "skipped", "suppressed");
  });

  it("skips a giver with no address", async () => {
    queue(queued({ id: 71, email: null }));
    expect(await sendQueuedThanks()).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(db.finishThanksGift).toHaveBeenCalledWith(71, "skipped", "no_email");
    expect(sendFundraiseSupporterThanks).not.toHaveBeenCalled();
  });

  it("checks the opt out list at send time, by address, and skips an address on it", async () => {
    optedOutAmong.mockResolvedValue(new Set(["alex@example.com"]));
    queue(queued({ id: 72, email: "Alex@Example.com" }));
    expect(await sendQueuedThanks()).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(optedOutAmong).toHaveBeenCalledWith(["Alex@Example.com"]);
    expect(db.finishThanksGift).toHaveBeenCalledWith(72, "skipped", "opted_out");
    expect(sendFundraiseSupporterThanks).not.toHaveBeenCalled();
  });

  it("treats an opt out list it cannot read as a reason not to send", async () => {
    optedOutAmong.mockRejectedValue(new Error("db down"));
    queue(queued());
    expect(await sendQueuedThanks()).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(sendFundraiseSupporterThanks).not.toHaveBeenCalled();
  });

  it.each([
    [{ refundedPence: 2000 }, "refunded"],
    [{ paymentStatus: "refunded" }, "refunded"],
    [{ paidIn: true }, "paid_in"],
    [{ fundraiserStatus: "declined" }, "not_running"],
  ])("skips a gift no longer thankable when its turn comes: %j", async (over, reason) => {
    queue(queued({ id: 73, ...(over as Partial<QueuedThanksGift>) }));
    expect(await sendQueuedThanks()).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(db.finishThanksGift).toHaveBeenCalledWith(73, "skipped", reason);
    expect(sendFundraiseSupporterThanks).not.toHaveBeenCalled();
  });

  it("sends one person this thank you once, however many of their gifts it picked", async () => {
    queue(queued({ id: 73, alreadySent: true }));
    await sendQueuedThanks();
    expect(sendFundraiseSupporterThanks).not.toHaveBeenCalled();
    expect(db.finishThanksGift).toHaveBeenCalledWith(73, "skipped", "duplicate");
  });

  it("treats a suppression list it cannot read as a reason not to send", async () => {
    suppressedAmong.mockRejectedValue(new Error("db down"));
    queue(queued());
    expect(await sendQueuedThanks()).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(sendFundraiseSupporterThanks).not.toHaveBeenCalled();
    expect(db.finishThanksGift).toHaveBeenCalledWith(70, "failed", null);
  });

  it("records a failed send and goes on to the next", async () => {
    sendFundraiseSupporterThanks.mockRejectedValueOnce(new Error("SES said no"));
    queue(queued({ id: 74 }), queued({ id: 75, email: "jo@example.com" }));
    expect(await sendQueuedThanks()).toEqual({ sent: 1, skipped: 0, failed: 1 });
    expect(db.finishThanksGift).toHaveBeenCalledWith(74, "failed", null);
    expect(db.finishThanksGift).toHaveBeenCalledWith(75, "sent", null);
  });

  it("sends one at a time: the next is claimed only after the last email has gone", async () => {
    const order: string[] = [];
    queue(queued({ id: 76 }), queued({ id: 77 }));
    const claim = db.claimNextQueuedThanksGift.getMockImplementation()!;
    db.claimNextQueuedThanksGift.mockImplementation(async () => {
      order.push("claim");
      return claim();
    });
    sendFundraiseSupporterThanks.mockImplementation(async () => {
      order.push("send start");
      await new Promise((r) => setTimeout(r, 5));
      order.push("send end");
    });
    await sendQueuedThanks();
    expect(order).toEqual(["claim", "send start", "send end", "claim", "send start", "send end", "claim"]);
  });

  it("never throws, even when the database cannot be reached", async () => {
    db.failStaleSending.mockRejectedValue(new Error("db down"));
    db.claimNextQueuedThanksGift.mockRejectedValue(new Error("db down"));
    await expect(sendQueuedThanks()).resolves.toEqual({ sent: 0, skipped: 0, failed: 0 });
  });

  it("first gives up on gifts a restart left sending, then closes their thank yous at the end", async () => {
    const order: string[] = [];
    db.failStaleSending.mockImplementation(async () => (order.push("give up"), [5]));
    db.undeliveredDoneThanks.mockImplementation(async () => (order.push("find finished"), [5]));
    queue();
    await sendQueuedThanks();
    expect(order).toEqual(["give up", "find finished"]);
    expect(db.markThanksDeliveredIfDone).toHaveBeenCalledWith(5);
  });

  it("closes any approved thank you with nothing left to send that was never marked (one with no gifts left, or a mark that failed)", async () => {
    db.undeliveredDoneThanks.mockResolvedValue([6, 8]);
    queue();
    await sendQueuedThanks();
    expect(db.markThanksDeliveredIfDone).toHaveBeenCalledWith(6);
    expect(db.markThanksDeliveredIfDone).toHaveBeenCalledWith(8);
  });

  it("still sends when closing finished thank yous fails", async () => {
    db.undeliveredDoneThanks.mockRejectedValue(new Error("db down"));
    queue(queued());
    expect(await sendQueuedThanks()).toEqual({ sent: 1, skipped: 0, failed: 0 });
  });

  it("does not start a second run beside one going, but the one going picks up what was approved meanwhile", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const list = [queued({ id: 80 })];
    db.claimNextQueuedThanksGift.mockImplementation(async () => list.shift() ?? null);
    sendFundraiseSupporterThanks.mockImplementationOnce(async () => gate);
    const first = sendQueuedThanks();
    await new Promise((r) => setTimeout(r, 0));
    list.push(queued({ id: 81 }));
    const second = await sendQueuedThanks();
    expect(second).toEqual({ sent: 0, skipped: 0, failed: 0 });
    release();
    expect(await first).toEqual({ sent: 2, skipped: 0, failed: 0 });
    expect(db.finishThanksGift).toHaveBeenCalledWith(81, "sent", null);
  });
});
