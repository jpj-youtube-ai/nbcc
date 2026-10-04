import { describe, it, expect, vi, beforeEach } from "vitest";

// The invite from Admin > Fundraising copies in whoever it is signed by (Jaimie 2026-10-04).
// The route chooses who (src/fundraising/invite.ts, inviteCc); this checks the copy reaches SES on
// the Cc line, and that an invite with no copy goes with no Cc line at all. Every address here is
// invented.

const { sendSes, record } = vi.hoisted(() => ({
  sendSes: vi.fn<(msg: unknown) => Promise<string>>(async () => "ses-message-1"),
  record: vi.fn<(row: unknown) => Promise<undefined>>(async () => undefined),
}));

vi.mock("../../src/config", () => ({
  config: {
    EMAIL_PROVIDER: "ses",
    NODE_ENV: "production",
    MAIL_FROM: "noreply@nbcc.scot",
    SES_TRANSACTIONAL_CONFIGURATION_SET: "transactional",
    PORTAL_BASE_URL: "https://nbcc.scot",
    BALL_BASE_URL: "https://nbcc.scot",
  },
}));
vi.mock("../../src/clients/ses", () => ({ sendSesEmail: sendSes }));
vi.mock("../../src/db/email-log", () => ({ recordEmailSend: record }));

import { sendFundraiseInvite } from "../../src/clients/email";
import { buildSesSendRequest, type SesMessage } from "../../src/clients/ses-request";

const MAIL = { email: "morag@example.com", from: "events@nbcc.scot", replyTo: "events@nbcc.scot", subject: "Hello", html: "<p>x</p>", text: "x" };

beforeEach(() => {
  sendSes.mockClear();
  record.mockClear();
});

describe("the copy of an invite", () => {
  it("goes to the member of staff on the Cc line", async () => {
    await sendFundraiseInvite("Morag Fyfe", { ...MAIL, cc: "fern@example.com" });
    const msg = sendSes.mock.calls[0][0] as SesMessage;
    expect(msg.to).toBe("morag@example.com");
    expect(msg.cc).toBe("fern@example.com");
    expect(buildSesSendRequest(msg).Destination).toEqual({ ToAddresses: ["morag@example.com"], CcAddresses: ["fern@example.com"] });
  });

  it("is left off entirely when there is nobody to copy in", async () => {
    await sendFundraiseInvite("Morag Fyfe", MAIL);
    const msg = sendSes.mock.calls[0][0] as SesMessage;
    expect(msg.cc).toBeUndefined();
    expect(buildSesSendRequest(msg).Destination).toEqual({ ToAddresses: ["morag@example.com"] });
  });
});
