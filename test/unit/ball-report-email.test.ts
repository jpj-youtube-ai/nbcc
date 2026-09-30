import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-464: the Festive Ball ticket report goes as ONE email to everyone on its list (they all work
// together and reply to all), and the email log still lists each person it went to. Every address
// here is invented.

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
  },
}));
vi.mock("../../src/clients/ses", () => ({ sendSesEmail: sendSes }));
vi.mock("../../src/db/email-log", () => ({ recordEmailSend: record }));

import { sendBallReport } from "../../src/clients/email";

const MESSAGE = {
  to: ["alex@example.com", "bea@planner.example", "cal@sponsor.example"],
  from: "events@nbcc.scot",
  replyTo: "events@nbcc.scot",
  subject: "Festive Ball tickets: Tuesday 6 October update",
  html: "<p>numbers</p>",
  text: "numbers",
};

beforeEach(() => {
  sendSes.mockClear();
  record.mockClear();
});

describe("sending the ticket report", () => {
  it("sends one message with everyone on the To line, from the Ball's inbox", async () => {
    await sendBallReport(MESSAGE);
    expect(sendSes).toHaveBeenCalledTimes(1);
    expect(sendSes.mock.calls[0][0]).toMatchObject({
      to: "alex@example.com",
      alsoTo: ["bea@planner.example", "cal@sponsor.example"],
      from: "events@nbcc.scot",
      replyTo: "events@nbcc.scot",
      subject: MESSAGE.subject,
      configurationSet: "transactional",
    });
  });

  it("logs a row for each person it went to", async () => {
    await sendBallReport(MESSAGE);
    expect(record.mock.calls.map((c) => (c[0] as { recipient: string }).recipient)).toEqual(MESSAGE.to);
    for (const [row] of record.mock.calls) {
      expect(row).toMatchObject({ kind: "ballReport", status: "sent", sesMessageId: "ses-message-1" });
    }
  });

  it("logs each person as failed, and says why, when the send fails", async () => {
    sendSes.mockRejectedValueOnce(new Error("SES is down"));
    await expect(sendBallReport(MESSAGE)).rejects.toThrow("SES is down");
    expect(record).toHaveBeenCalledTimes(3);
    for (const [row] of record.mock.calls) expect(row).toMatchObject({ status: "failed", error: "SES is down" });
  });

  it("refuses to send to nobody", async () => {
    await expect(sendBallReport({ ...MESSAGE, to: [] })).rejects.toThrow(/nobody/);
    expect(sendSes).not.toHaveBeenCalled();
  });
});
