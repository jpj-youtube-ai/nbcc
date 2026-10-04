import { describe, it, expect, vi, beforeEach } from "vitest";

// In memory pages (Jaimie, 2026-10-03): the only automatic email the organiser of an in memory page
// gets is email 19, in the words Jaimie approved on 2026-10-02 (gentler, no fun sign off), when staff
// approve the page. No thank you for signing up (it is upbeat), and no emails about changes or news
// updates: staff write personally. The sign in code still goes, as they ask for it. The events inbox
// is told who it remembers and who set it up. Every name and address here is invented.

const mail = vi.hoisted(() => ({
  sendFundraiseThanks: vi.fn(),
  sendFundraiseStaff: vi.fn(),
  sendFundraiseApproved: vi.fn(),
  sendFundraiseCode: vi.fn(),
  sendFundraiseMemoryReceipt: vi.fn(),
  sendFundraiseFinishedStaff: vi.fn(),
  sendFundraiseEditApproved: vi.fn(),
  sendFundraiseEditRejected: vi.fn(),
  sendFundraiseNewsApproved: vi.fn(),
  sendFundraiseNewsRejected: vi.fn(),
}));
const db = vi.hoisted(() => ({ claimNextWaitingLiveEmail: vi.fn(), markLiveEmailWaiting: vi.fn(), fundraisingIsOn: vi.fn() }));
vi.mock("../../src/clients/email", () => mail);
vi.mock("../../src/db/fundraisers", () => db);
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.test", BALL_FROM_EMAIL: "events@nbcc.test" },
}));

import { buildInMemoryApprovedEmail } from "../../src/fundraising/memory-emails";
import { buildSignUpStaffEmail } from "../../src/fundraising/emails";
import {
  sendApprovedEmail,
  sendEditDecisionEmail,
  sendNewsDecisionEmail,
  sendSignInCodeEmail,
  sendSignUpEmails,
} from "../../src/fundraising/send";
import type { FundraiserRecord } from "../../src/fundraising/model";

const record = (over: Partial<FundraiserRecord> = {}): FundraiserRecord => ({
  id: 9, slug: "ime", path: "raising", kind: "other", title: "In memory of Margaret Exampleton", description: "Remembering Margaret.",
  eventDate: null, startTime: null, venue: "", town: "", targetPence: 50000, public: true, status: "approved", name: "Sam Example",
  email: "sam@example.com", phone: "07700 900456", socialLink: null, socialOk: false,
  wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
  postAddress: null, postLine1: null, postLine2: null, postTown: null, postPostcode: null, newsletterOk: false,
  imageSrc: null, declinedReason: null, createdAt: "2026-10-02T10:00:00.000Z", approvedAt: null, approvedBy: null,
  updatedAt: "2026-10-02T10:00:00.000Z", updatedBy: null, cardLine: null, endTime: null, timeTbc: false, venueAddress: null,
  venuePostcode: null, access: [], price: null, booking: null, ticketUrl: null, ageLimit: null, dressCode: null, included: null,
  creditName: null, inMemory: true, memoryName: "Margaret Exampleton", memoryDates: "1948 to 2026", memorySetupBy: "funeral_director",
  memoryPermission: true, memoryShowTarget: false, ...over,
});

beforeEach(() => {
  for (const fn of Object.values(mail)) fn.mockReset().mockResolvedValue(undefined);
  for (const fn of Object.values(db)) fn.mockReset().mockResolvedValue(undefined);
  db.fundraisingIsOn.mockResolvedValue(true);
});

// Jaimie, 2026-10-03: "Hi The," for a pub. A funeral director's business name, or no name, is the same.
// Jaimie, 2026-10-04: every in memory email opens "Dear [first name],", and "Hello," with no name.
describe("email 19's greeting", () => {
  const hi = (f: { name: string; firstName?: string | null }) => buildInMemoryApprovedEmail({ ...f, memoryName: "Jean" }, { pageUrl: "p" }).text.split(String.fromCharCode(10))[0];

  it("never says Dear The, or Dear with no name", () => {
    expect(hi({ name: "The Example Funeral Home" })).toBe("Hello,");
    expect(hi({ name: "" })).toBe("Hello,");
  });

  it("uses the first name they gave on the form", () => {
    expect(hi({ name: "S Example", firstName: "Sam" })).toBe("Dear Sam,");
  });
});

describe("email 19, when staff approve an in memory page", () => {
  const mailOut = buildInMemoryApprovedEmail({ name: "Sam Example", memoryName: "Jean" }, { pageUrl: "https://nbcc.test/fundraise/ime" });

  it("is in the words Jaimie approved", () => {
    expect(mailOut.subject).toBe("Your page in memory of Jean");
    expect(mailOut.text).toContain("Dear Sam,");
    expect(mailOut.text).toContain(
      "Thank you for choosing to remember Jean by raising money for NBCC. We're honoured to be part of it, and we're so sorry for your loss.",
    );
    expect(mailOut.text).toContain(
      "Your page is now live. It's a quiet place where family and friends can give and leave a message in Jean's memory.",
    );
    expect(mailOut.text).toContain("If there's anything you'd like changed, or anything we can do, please just let us know. There's no rush at all.");
    expect(mailOut.text).toContain("With warmest thoughts,");
    expect(mailOut.html).toContain("In memory of Jean");
    expect(mailOut.html).toContain("See the page");
    expect(mailOut.html).toContain('href="https://nbcc.test/fundraise/ime"');
  });

  it("has nothing upbeat in it", () => {
    for (const word of ["!", "Brilliant", "cheer", "Cheering", "meter", "share"]) expect(mailOut.text).not.toContain(word);
  });

  it("escapes the name they gave", () => {
    const m = buildInMemoryApprovedEmail({ name: "Sam Example", memoryName: "<b>Jean</b>" }, { pageUrl: "https://nbcc.test/fundraise/ime" });
    expect(m.html).not.toContain("<b>Jean</b>");
    expect(m.html).toContain("&lt;b&gt;Jean&lt;/b&gt;");
  });
});

describe("the emails an in memory page gets", () => {
  it("sends no thank you for signing up (it is upbeat), but still tells the team", async () => {
    await sendSignUpEmails(record({ status: "new" }));
    expect(mail.sendFundraiseThanks).not.toHaveBeenCalled();
    const staff = mail.sendFundraiseStaff.mock.calls[0][1];
    expect(staff.text).toContain("In memory of: Margaret Exampleton (1948 to 2026)");
    expect(staff.text).toContain("Set up by: A funeral director, with the family's permission");
    expect(staff.text).toContain("Show the target on the page: No, keep it hidden");
  });

  it("sends email 19 when it is approved with a page", async () => {
    expect(await sendApprovedEmail(record())).toBe(true);
    const sent = mail.sendFundraiseApproved.mock.calls[0][1];
    expect(sent.subject).toBe("Your page in memory of Margaret Exampleton");
    expect(sent.email).toBe("sam@example.com");
  });

  it("sends nothing on approval when it has no page: staff write personally", async () => {
    expect(await sendApprovedEmail(record({ public: false }))).toBe(false);
    expect(mail.sendFundraiseApproved).not.toHaveBeenCalled();
  });

  it("sends no emails about a change or a news update", async () => {
    await sendEditDecisionEmail(record(), true, true);
    await sendEditDecisionEmail(record(), false, true);
    await sendNewsDecisionEmail(record(), true, true);
    await sendNewsDecisionEmail(record(), false, true);
    expect(mail.sendFundraiseEditApproved).not.toHaveBeenCalled();
    expect(mail.sendFundraiseEditRejected).not.toHaveBeenCalled();
    expect(mail.sendFundraiseNewsApproved).not.toHaveBeenCalled();
    expect(mail.sendFundraiseNewsRejected).not.toHaveBeenCalled();
  });

  // Jaimie, 2026-10-04: a family or a funeral director gets the gentle sign in code email.
  it("still sends the sign in code they ask for, in the gentle version", async () => {
    await sendSignInCodeEmail("sam@example.com", "Sam Example", "123456", { gentle: true });
    const sent = mail.sendFundraiseCode.mock.calls[0][1];
    expect(sent.text).toContain("Dear Sam,");
    expect(sent.text).toContain("Your code: 123456");
    expect(sent.text).toContain("With warmest thoughts,\nNBCC Team");
    expect(sent.text).not.toContain("!");
  });

  it("sends the short receipt when they sign up, greeting them by first name", async () => {
    await sendSignUpEmails(record({ status: "new", firstName: "Sam" }));
    const sent = mail.sendFundraiseMemoryReceipt.mock.calls[0][1];
    expect(sent.email).toBe("sam@example.com");
    expect(sent.text.split("\n")[0]).toBe("Dear Sam,");
    expect(sent.text).toContain("We have your details for the page.");
  });

  it("leaves every other page's emails as they were", async () => {
    await sendSignUpEmails(record({ inMemory: false, memoryName: null, status: "new" }));
    expect(mail.sendFundraiseThanks).toHaveBeenCalled();
    await sendApprovedEmail(record({ inMemory: false, memoryName: null, title: "Sam's Walk" }));
    expect(mail.sendFundraiseApproved.mock.calls[0][1].subject).toBe("Your fundraising page is live: Sam's Walk");
  });
});

describe("the summary to the events inbox", () => {
  it("shows the target choice only when there is a target", () => {
    const f = { ...record({ targetPence: null, memoryShowTarget: null }), id: 9 };
    const mailOut = buildSignUpStaffEmail(f as never, { adminUrl: "https://nbcc.test/admin" });
    expect(mailOut.text).toContain("In memory of: Margaret Exampleton (1948 to 2026)");
    expect(mailOut.text).not.toContain("Show the target on the page");
  });

  it("says nothing about memory for any other sign up", () => {
    const f = { ...record({ inMemory: false, memoryName: null }), id: 9 };
    expect(buildSignUpStaffEmail(f as never, { adminUrl: "https://nbcc.test/admin" }).text).not.toContain("In memory of:");
  });
});

describe("review: the thank you to a giver on an in memory page", () => {
  it("is gentle: In memory, and With warmest thoughts, as every in memory email signs off", async () => {
    const { buildSupporterThanksEmail } = await import("../../src/fundraising/thanks-email");
    const m = buildSupporterThanksEmail({ organiserName: "Sam Example", title: "In memory of Jean", message: "Thank you.", inMemory: true });
    expect(m.text).toContain("In memory");
    expect(m.text).not.toContain("Fundraising for NBCC");
    expect(m.text).toContain("With warmest thoughts,");
    expect(m.text).not.toContain("Thanks so much,");
    const other = buildSupporterThanksEmail({ organiserName: "Sam Example", title: "Sam's Walk", message: "Thank you." });
    expect(other.text).toContain("Fundraising for NBCC");
    expect(other.text).toContain("Thanks so much,");
  });
});

describe("email 19 for a funeral director (Jaimie, A2)", () => {
  it("is professional: no sorry for your loss, and thanks them for setting it up for the family", () => {
    const m = buildInMemoryApprovedEmail(
      { name: "Sam Example", memoryName: "Jean", setupBy: "funeral_director" },
      { pageUrl: "https://nbcc.test/fundraise/ime" },
    );
    expect(m.subject).toBe("Your page in memory of Jean");
    expect(m.text).not.toContain("sorry for your loss");
    expect(m.text).toContain(
      "Thank you for setting up this page for the family of Jean. It is now live on our website, ready to share with everyone who would like to give in their memory.",
    );
    expect(m.text).toContain("See the page: https://nbcc.test/fundraise/ime");
    expect(m.text).toContain("collection envelopes");
    expect(m.text).toContain("Our team reads every message before it shows on the page.");
    expect(m.text).toContain("With warmest thoughts,");
  });

  it("leaves the family and friends version as Jaimie approved it", () => {
    for (const setupBy of ["family", "friend", undefined] as const) {
      const m = buildInMemoryApprovedEmail({ name: "Sam Example", memoryName: "Jean", setupBy }, { pageUrl: "https://nbcc.test/fundraise/ime" });
      expect(m.text).toContain("we're so sorry for your loss");
      expect(m.text).not.toContain("for the family of Jean");
    }
  });

  it("goes when a funeral director's page is approved", async () => {
    await sendApprovedEmail(record({ memorySetupBy: "funeral_director" }));
    expect(mail.sendFundraiseApproved.mock.calls[0][1].text).toContain("for the family of Margaret Exampleton");
  });
});
