import { describe, it, expect, vi, beforeEach } from "vitest";

// The Monday summary (email 11) goes as ONE email with everyone on the To line, so Reply all reaches
// the whole team, and the email log still lists each person it went to. A test from the admin has
// one person on it. Staff only, so its links are never tagged. Every address here is invented.

const { sendSes, record } = vi.hoisted(() => ({
  sendSes: vi.fn<(msg: unknown) => Promise<string>>(async () => "ses-message-1"),
  record: vi.fn<(row: unknown) => Promise<undefined>>(async () => undefined),
}));

vi.mock("../../src/config", () => ({
  config: {
    EMAIL_PROVIDER: "ses",
    NODE_ENV: "production",
    MAIL_FROM: "noreply@nbcc.test",
    SES_TRANSACTIONAL_CONFIGURATION_SET: "transactional",
    PORTAL_BASE_URL: "https://nbcc.test",
    BALL_BASE_URL: "https://nbcc.test",
  },
}));
vi.mock("../../src/clients/ses", () => ({ sendSesEmail: sendSes }));
vi.mock("../../src/db/email-log", () => ({ recordEmailSend: record }));

import { sendFundraiseSummary } from "../../src/clients/email";

const MESSAGE = {
  email: "fern@nbcc.scot",
  alsoTo: ["rowan@nbcc.scot", "skye@nbcc.scot"],
  from: "events@nbcc.test",
  replyTo: "events@nbcc.test",
  subject: "Fundraising this week: £0 raised, nothing waiting",
  html: '<p><a href="https://nbcc.test/admin">Open the admin</a></p>',
  text: "Open the admin: https://nbcc.test/admin",
};
const EVERYONE = ["fern@nbcc.scot", "rowan@nbcc.scot", "skye@nbcc.scot"];

beforeEach(() => {
  sendSes.mockReset().mockResolvedValue("ses-message-1");
  record.mockClear();
});

describe("sending the Monday summary", () => {
  it("sends one message with everyone on the To line, from and replying to the events inbox", async () => {
    await sendFundraiseSummary(MESSAGE);
    expect(sendSes).toHaveBeenCalledTimes(1);
    expect(sendSes.mock.calls[0][0]).toMatchObject({
      to: "fern@nbcc.scot",
      alsoTo: ["rowan@nbcc.scot", "skye@nbcc.scot"],
      from: "events@nbcc.test",
      replyTo: "events@nbcc.test",
      subject: MESSAGE.subject,
      configurationSet: "transactional",
    });
    expect((sendSes.mock.calls[0][0] as { cc?: string }).cc).toBeUndefined();
  });

  it("leaves its links alone, as a staff email", async () => {
    await sendFundraiseSummary(MESSAGE);
    expect(sendSes.mock.calls[0][0]).toMatchObject({ html: MESSAGE.html, text: MESSAGE.text });
  });

  it("logs a row for each person it went to, all under the one message", async () => {
    await sendFundraiseSummary(MESSAGE);
    expect(record.mock.calls.map((c) => (c[0] as { recipient: string }).recipient)).toEqual(EVERYONE);
    for (const [row] of record.mock.calls) {
      expect(row).toMatchObject({ kind: "fundraiseSummary", status: "sent", sesMessageId: "ses-message-1", subject: MESSAGE.subject });
    }
  });

  it("logs a failed row for each person when it does not go, and says why", async () => {
    sendSes.mockRejectedValue(new Error("SES said no"));
    await expect(sendFundraiseSummary(MESSAGE)).rejects.toThrow("SES said no");
    expect(record.mock.calls.map((c) => (c[0] as { recipient: string }).recipient)).toEqual(EVERYONE);
    for (const [row] of record.mock.calls) expect(row).toMatchObject({ status: "failed", error: "SES said no" });
  });

  it("sends a message with nobody else on it to one person alone (the test from the admin)", async () => {
    await sendFundraiseSummary({ ...MESSAGE, alsoTo: undefined });
    expect(sendSes.mock.calls[0][0]).toMatchObject({ to: "fern@nbcc.scot" });
    expect((sendSes.mock.calls[0][0] as { alsoTo?: string[] }).alsoTo ?? []).toEqual([]);
    expect(record).toHaveBeenCalledTimes(1);
  });
});
