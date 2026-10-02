import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-493: what the fundraising emails actually send. TASK-497: the first name in the thank you,
// "Your page is live" held until fundraising is switched on, and the emails about a change. Every
// name and address here is invented.

const mail = vi.hoisted(() => ({
  sendFundraiseThanks: vi.fn(),
  sendFundraiseStaff: vi.fn(),
  sendFundraiseApproved: vi.fn(),
  sendFundraiseCode: vi.fn(),
  sendFundraiseFinishedStaff: vi.fn(),
  sendFundraiseEditApproved: vi.fn(),
  sendFundraiseEditRejected: vi.fn(),
}));
const db = vi.hoisted(() => ({ claimNextWaitingLiveEmail: vi.fn(), markLiveEmailWaiting: vi.fn(), fundraisingIsOn: vi.fn() }));
vi.mock("../../src/clients/email", () => mail);
vi.mock("../../src/db/fundraisers", () => db);
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.test", BALL_FROM_EMAIL: "events@nbcc.test" },
}));

import {
  sendSignUpEmails,
  sendApprovedEmail,
  sendWaitingLiveEmails,
  sendEditDecisionEmail,
  sendSignInCodeEmail,
  sendFinishedStaffEmail,
  manageUrl,
} from "../../src/fundraising/send";
import type { FundraiserRecord } from "../../src/fundraising/model";

const SPAM = "Cheap watches at spam.example, click now";
const record = (over: Partial<FundraiserRecord> = {}): FundraiserRecord => ({
  id: 9, slug: "sams-walk", path: "raising", kind: "run_walk", title: SPAM, description: SPAM, eventDate: null,
  startTime: null, venue: "", town: "", targetPence: null, public: true, status: "approved", name: SPAM,
  email: "victim@example.com", phone: "07700 900456", socialLink: null, socialOk: false,
  wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false }, postAddress: null, newsletterOk: false,
  imageSrc: null, declinedReason: null, createdAt: "2026-10-02T10:00:00.000Z", approvedAt: null, approvedBy: null,
  updatedAt: "2026-10-02T10:00:00.000Z", updatedBy: null, ...over,
});

beforeEach(() => {
  for (const fn of Object.values(mail)) fn.mockReset().mockResolvedValue(undefined);
  for (const fn of Object.values(db)) fn.mockReset().mockResolvedValue(undefined);
  db.fundraisingIsOn.mockResolvedValue(true);
});

// The claim answers with each of these in turn, then nothing, as the database would.
function waitingQueue(...rows: FundraiserRecord[]) {
  const queue = [...rows];
  db.claimNextWaitingLiveEmail.mockImplementation(async () => queue.shift() ?? null);
}

describe("after a sign up", () => {
  it("sends the address they typed a thank you with no more of their words than one plain first name", async () => {
    await sendSignUpEmails(record());
    const sent = mail.sendFundraiseThanks.mock.calls[0][1];
    expect(sent.email).toBe("victim@example.com");
    expect(sent.subject + sent.html + sent.text).not.toContain("spam.example");
    expect(sent.text).toContain("Hi there Cheap,");
  });

  it("greets them by their first name", async () => {
    await sendSignUpEmails(record({ name: "Sam Example" }));
    expect(mail.sendFundraiseThanks.mock.calls[0][1].text).toContain("Hi there Sam,");
  });

  it("sends the team everything they typed, to the events inbox only", async () => {
    await sendSignUpEmails(record());
    const sent = mail.sendFundraiseStaff.mock.calls[0][1];
    expect(sent.email).toBe("events@nbcc.test");
    expect(sent.text).toContain("spam.example");
  });
});

describe("after approval", () => {
  it("links the page of someone with a page", async () => {
    expect(await sendApprovedEmail(record({ title: "Sam's Walk", name: "Sam Example" }))).toBe(true);
    const sent = mail.sendFundraiseApproved.mock.calls[0][1];
    expect(sent.subject).toBe("Your fundraising page is live: Sam's Walk");
    expect(sent.text).toContain("https://nbcc.test/fundraise/sams-walk");
  });

  it("tells anyone without a page they are on our list", async () => {
    await sendApprovedEmail(record({ title: "Sam's Walk", name: "Sam Example", public: false }));
    const sent = mail.sendFundraiseApproved.mock.calls[0][1];
    expect(sent.subject).toBe("You're on our list: Sam's Walk");
    expect(sent.text).not.toContain("/fundraise/sams-walk");
  });

  it("says false, and throws nothing, when the email does not go", async () => {
    mail.sendFundraiseApproved.mockRejectedValue(new Error("SES is down"));
    expect(await sendApprovedEmail(record())).toBe(false);
  });
});

describe("when fundraising is switched on", () => {
  it("sends Your page is live to everyone waiting, claiming one at a time past the last", async () => {
    waitingQueue(
      record({ id: 9, slug: "sams-walk", name: "Sam Example", email: "sam@example.com" }),
      record({ id: 10, slug: "kims-quiz", name: "Kim Example", email: "kim@example.com" }),
    );
    expect(await sendWaitingLiveEmails()).toEqual({ sent: 2, failed: 0 });
    expect(mail.sendFundraiseApproved.mock.calls.map((c) => c[1].email)).toEqual(["sam@example.com", "kim@example.com"]);
    expect(mail.sendFundraiseApproved.mock.calls[1][1].text).toContain("https://nbcc.test/fundraise/kims-quiz");
    expect(db.claimNextWaitingLiveEmail.mock.calls.map((c) => c[0])).toEqual([0, 9, 10]);
    expect(db.markLiveEmailWaiting).not.toHaveBeenCalled();
  });

  it("checks the switch before each one", async () => {
    waitingQueue(record({ id: 9 }), record({ id: 10 }));
    await sendWaitingLiveEmails();
    expect(db.fundraisingIsOn).toHaveBeenCalledTimes(3);
    expect(db.fundraisingIsOn.mock.invocationCallOrder[0]).toBeLessThan(db.claimNextWaitingLiveEmail.mock.invocationCallOrder[0]);
  });

  it("stops if fundraising is switched off again part way, leaving the rest waiting", async () => {
    waitingQueue(record({ id: 9 }), record({ id: 10 }));
    db.fundraisingIsOn.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await sendWaitingLiveEmails()).toEqual({ sent: 1, failed: 0 });
    expect(db.claimNextWaitingLiveEmail).toHaveBeenCalledTimes(1);
  });

  it("says so in the log when it stops early, so a quiet stop is visible", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    waitingQueue(record({ id: 9 }));
    db.fundraisingIsOn.mockResolvedValueOnce(false);
    expect(await sendWaitingLiveEmails()).toEqual({ sent: 0, failed: 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("fundraising live emails stopped"));
    warn.mockRestore();
  });

  it("marks one whose email failed as waiting again, and still sends the rest", async () => {
    waitingQueue(record({ id: 9, email: "sam@example.com" }), record({ id: 10, email: "kim@example.com" }));
    mail.sendFundraiseApproved.mockRejectedValueOnce(new Error("SES is down"));
    expect(await sendWaitingLiveEmails()).toEqual({ sent: 1, failed: 1 });
    expect(db.markLiveEmailWaiting).toHaveBeenCalledWith(9);
    expect(mail.sendFundraiseApproved).toHaveBeenCalledTimes(2);
  });

  it("sends nothing when nobody is waiting, so switching on twice emails nobody twice", async () => {
    waitingQueue();
    expect(await sendWaitingLiveEmails()).toEqual({ sent: 0, failed: 0 });
    expect(mail.sendFundraiseApproved).not.toHaveBeenCalled();
  });

  it("never throws, even when the database does", async () => {
    db.claimNextWaitingLiveEmail.mockRejectedValue(new Error("database went away"));
    await expect(sendWaitingLiveEmails()).resolves.toEqual({ sent: 0, failed: 0 });
  });
});

describe("after staff decide a change", () => {
  it("tells them their update is live on their page, with the link, while fundraising is on", async () => {
    await sendEditDecisionEmail(record({ title: "Sam's Walk", name: "Sam Example" }), true, true);
    const sent = mail.sendFundraiseEditApproved.mock.calls[0][1];
    expect(sent.email).toBe("victim@example.com");
    expect(sent.from).toBe("events@nbcc.test");
    expect(sent.replyTo).toBe("events@nbcc.test");
    expect(sent.subject).toBe("Your update is live: Sam's Walk");
    expect(sent.text).toContain("they’re now on your page");
    expect(sent.text).toContain("https://nbcc.test/fundraise/sams-walk");
  });

  // Only a page that is up says "on your page" or "still live": an event, a private sign up, one
  // declined or finished, or any while fundraising is switched off, gets the neutral words.
  it.each([
    ["fundraising is switched off", {}, false],
    ["it is an event", { path: "event" as const }, true],
    ["it is private", { public: false }, true],
    ["it was declined", { status: "declined" as const }, true],
    ["it is finished", { status: "finished" as const }, true],
  ])("says the change is saved, with no page link, when %s", async (_what, over, on) => {
    await sendEditDecisionEmail(record({ title: "Sam's Walk", ...over }), true, on);
    const sent = mail.sendFundraiseEditApproved.mock.calls[0][1];
    expect(sent.subject).toBe("Your update is saved: Sam's Walk");
    expect(sent.text).toContain("they’re all saved");
    expect(sent.text).not.toContain("on your page");
    expect(sent.text).not.toContain("/fundraise/sams-walk");
    mail.sendFundraiseEditRejected.mockClear();
    await sendEditDecisionEmail(record({ title: "Sam's Walk", ...over }), false, on);
    const held = mail.sendFundraiseEditRejected.mock.calls[0][1];
    expect(held.text).toContain("Nothing to worry about: everything stays just as it was.");
    expect(held.text).not.toContain("still live");
  });

  it("tells them about their update when it is rejected, their page still live", async () => {
    await sendEditDecisionEmail(record({ title: "Sam's Walk", name: "Sam Example" }), false, true);
    expect(mail.sendFundraiseEditApproved).not.toHaveBeenCalled();
    const sent = mail.sendFundraiseEditRejected.mock.calls[0][1];
    expect(sent.subject).toBe("About your update to Sam's Walk");
    expect(sent.text).toContain("your page is still live, just as it was, and gifts are still coming in");
  });

  it("throws nothing when the email does not go", async () => {
    mail.sendFundraiseEditRejected.mockRejectedValue(new Error("SES is down"));
    await expect(sendEditDecisionEmail(record(), false, true)).resolves.toBe(false);
  });
});

// TASK-501: the sign in code (email 8) to the address asked for, and the note to the events inbox
// when an organiser presses "I've finished".
describe("the sign in code", () => {
  it("goes to the email asked for, from and replying to the events inbox, with the code", async () => {
    await sendSignInCodeEmail("sam@example.com", "Sam Example", "482915");
    const [name, sent] = mail.sendFundraiseCode.mock.calls[0];
    expect(name).toBe("Sam Example");
    expect(sent).toMatchObject({ email: "sam@example.com", from: "events@nbcc.test", replyTo: "events@nbcc.test" });
    expect(sent.subject).toBe("Your NBCC sign in code: 482 915");
    expect(sent.text).toContain("Hi Sam,");
  });

  it("never throws, and never logs the code", async () => {
    mail.sendFundraiseCode.mockRejectedValue(new Error("SES is down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendSignInCodeEmail("sam@example.com", "Sam Example", "482915")).resolves.toBeUndefined();
    expect(quiet.mock.calls.flat().map(String).join(" ")).not.toContain("482915");
    quiet.mockRestore();
  });
});

describe("I've finished, to the events inbox", () => {
  it("goes to the events inbox, replying to the organiser", async () => {
    await sendFinishedStaffEmail(record({ name: "Sam Example", title: "Sam's Walk" }), 12550);
    const [, sent] = mail.sendFundraiseFinishedStaff.mock.calls[0];
    expect(sent).toMatchObject({ email: "events@nbcc.test", from: "events@nbcc.test", replyTo: "victim@example.com" });
    expect(sent.text).toContain("£125.50");
    expect(sent.text).toContain("https://nbcc.test/admin");
  });

  it("never throws", async () => {
    mail.sendFundraiseFinishedStaff.mockRejectedValue(new Error("SES is down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendFinishedStaffEmail(record(), 0)).resolves.toBeUndefined();
    quiet.mockRestore();
  });
});

describe("the private area's address", () => {
  it("is on the public site", () => expect(manageUrl()).toBe("https://nbcc.test/fundraise/manage"));
});
