import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-493: what the fundraising emails actually send. Every name and address here is invented.

const mail = vi.hoisted(() => ({
  sendFundraiseThanks: vi.fn(),
  sendFundraiseStaff: vi.fn(),
  sendFundraiseApproved: vi.fn(),
  sendFundraiseManage: vi.fn(),
}));
vi.mock("../../src/clients/email", () => mail);
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.test", BALL_FROM_EMAIL: "events@nbcc.test" },
}));

import { sendSignUpEmails, sendApprovedEmail } from "../../src/fundraising/send";
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
});

describe("after a sign up", () => {
  it("sends the address they typed a fixed thank you, with none of their words in it", async () => {
    await sendSignUpEmails(record());
    const sent = mail.sendFundraiseThanks.mock.calls[0][1];
    expect(sent.email).toBe("victim@example.com");
    expect(sent.subject + sent.html + sent.text).not.toContain("spam.example");
  });

  it("sends the team everything they typed, to the events inbox only", async () => {
    await sendSignUpEmails(record());
    const sent = mail.sendFundraiseStaff.mock.calls[0][1];
    expect(sent.email).toBe("events@nbcc.test");
    expect(sent.text).toContain("spam.example");
  });
});

describe("after approval", () => {
  it("links the page when fundraising is on", async () => {
    await sendApprovedEmail(record({ title: "Sam's Walk", name: "Sam Sample" }), true);
    expect(mail.sendFundraiseApproved.mock.calls[0][1].text).toContain("https://nbcc.test/fundraise/sams-walk");
  });

  it("says the page will appear when the pages open, with no link that would 404, when fundraising is off", async () => {
    await sendApprovedEmail(record({ title: "Sam's Walk", name: "Sam Sample" }), false);
    const text = mail.sendFundraiseApproved.mock.calls[0][1].text;
    expect(text).not.toContain("/fundraise/sams-walk");
    expect(text).toMatch(/when our fundraising pages open/);
  });
});
