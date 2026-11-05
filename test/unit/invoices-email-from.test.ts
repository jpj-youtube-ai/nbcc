import { describe, it, expect, vi, beforeEach } from "vitest";

// Jaimie, 2026-11-05: "make sure that the email comes from Giving rather than [no]reply". The invoice and
// a group's thank you when its invoice is paid come from the giving inbox, and replies go there too. The
// addresses in the config here stand in for the real ones; the payer's address is invented.

const { sendSes, record } = vi.hoisted(() => ({
  sendSes: vi.fn<(msg: unknown) => Promise<string>>(async () => "ses-message-1"),
  record: vi.fn<(row: unknown) => Promise<undefined>>(async () => undefined),
}));

vi.mock("../../src/config", () => ({
  config: {
    EMAIL_PROVIDER: "ses",
    NODE_ENV: "production",
    MAIL_FROM: "noreply@nbcc.scot",
    GIVING_FROM_EMAIL: "giving@nbcc.scot",
    SES_TRANSACTIONAL_CONFIGURATION_SET: "transactional",
    PORTAL_BASE_URL: "https://nbcc.scot",
    BALL_BASE_URL: "https://nbcc.scot",
  },
}));
vi.mock("../../src/clients/ses", () => ({ sendSesEmail: sendSes }));
vi.mock("../../src/db/email-log", () => ({ recordEmailSend: record }));

import { sendInvoiceEmail, sendInvoiceReceipt } from "../../src/clients/email";
import type { SesMessage } from "../../src/clients/ses-request";

const MAIL = { email: "accounts@example.com", name: "Example Joinery Ltd", subject: "Your invoice from NBCC: INV-0012", html: "<p>x</p>", text: "x" };

beforeEach(() => {
  sendSes.mockClear();
  record.mockClear();
});

describe("who an invoice email comes from", () => {
  it("sends the invoice from giving@, with replies to giving@", async () => {
    await sendInvoiceEmail(MAIL);
    const msg = sendSes.mock.calls[0][0] as SesMessage;
    expect(msg.from).toBe("giving@nbcc.scot");
    expect(msg.replyTo).toBe("giving@nbcc.scot");
    expect(msg.to).toBe("accounts@example.com");
  });

  it("sends a group's thank you from giving@ too", async () => {
    await sendInvoiceReceipt(MAIL);
    const msg = sendSes.mock.calls[0][0] as SesMessage;
    expect(msg.from).toBe("giving@nbcc.scot");
    expect(msg.replyTo).toBe("giving@nbcc.scot");
  });
});
