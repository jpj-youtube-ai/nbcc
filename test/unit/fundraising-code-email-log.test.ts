import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-501: the sign in code is in email 8's subject line ("Your NBCC sign in code: 482 915"), but
// the email audit log keeps every subject. Codes are never logged, so this kind's log row carries
// the subject without it. Every address here is invented.

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

import { sendFundraiseCode, sendFundraiseThanks, FUNDRAISE_CODE_LOG_SUBJECT } from "../../src/clients/email";
import { buildSignInCodeEmail } from "../../src/fundraising/emails";

beforeEach(() => {
  sendSes.mockClear();
  record.mockClear();
});

describe("the sign in code in the email log", () => {
  it("sends the real subject, and logs it without the code", async () => {
    const mail = buildSignInCodeEmail("Sam Example", "482915");
    await sendFundraiseCode("Sam Example", { email: "sam@example.com", from: "events@nbcc.scot", replyTo: "events@nbcc.scot", ...mail });
    expect((sendSes.mock.calls[0][0] as { subject: string }).subject).toBe("Your NBCC sign in code: 482 915");
    const row = record.mock.calls[0][0] as { kind: string; subject: string };
    expect(row.kind).toBe("fundraiseCode");
    expect(row.subject).toBe(FUNDRAISE_CODE_LOG_SUBJECT);
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/482 ?915/);
  });

  it("leaves every other kind's logged subject as it was sent", async () => {
    await sendFundraiseThanks("Sam", { email: "sam@example.com", from: "events@nbcc.scot", replyTo: "events@nbcc.scot", subject: "Thanks", html: "<p>x</p>", text: "x" });
    expect((record.mock.calls[0][0] as { subject: string }).subject).toBe("Thanks");
  });
});
