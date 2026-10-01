import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-489: when an admin marks an invoiced transfer paid, the buyer gets their confirmation (with
// the private link to add their guests) and nobody is copied on it; the company's accounts team gets
// a separate "payment received" email with the invoice instead. Email and database are mocked.
// Every address is invented.

const m = vi.hoisted(() => ({
  sendBallConfirmation: vi.fn(),
  sendBallTransfer: vi.fn(),
  sendBallTransferStaff: vi.fn(),
  getSettings: vi.fn(),
}));
vi.mock("../../src/clients/email", () => ({
  sendBallConfirmation: m.sendBallConfirmation,
  sendBallTransfer: m.sendBallTransfer,
  sendBallTransferStaff: m.sendBallTransferStaff,
}));
vi.mock("../../src/db/ball", () => ({ getSettings: m.getSettings }));
vi.mock("../../src/config", () => ({
  config: { BALL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot", ADMIN_SESSION_SECRET: "test-secret" },
}));

import { sendTransferArrived } from "../../src/ball/transfer-send";

const booking = {
  reference: "BALL-7KQ2MZ",
  kind: "table" as const,
  quantity: 1,
  seats: 10,
  buyerName: "Ada Test",
  buyerFirstName: "Ada",
  buyerSurname: "Test",
  buyerEmail: "ada@example.com",
  ticketsPence: 100_000,
  donationPence: 2_000,
  feeCoverPence: 0,
  totalPence: 102_000,
  giftAid: false,
  newsletterOptIn: false,
  stripeSessionId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getSettings.mockResolvedValue({ arrivalTime: null, includedNote: null });
});

describe("telling everyone a transfer has arrived", () => {
  it("sends the buyer their confirmation, copied to nobody, and the accounts team its own email", async () => {
    await sendTransferArrived(booking as never, "tok123", { bookingId: 42, accountsEmail: "accounts@example.com" });

    expect(m.sendBallConfirmation).toHaveBeenCalledTimes(1);
    const confirmation = m.sendBallConfirmation.mock.calls[0][0];
    expect(confirmation.email).toBe("ada@example.com");
    expect(confirmation.cc).toBeUndefined();
    expect(confirmation.text).toContain("/ball/guests/tok123");

    expect(m.sendBallTransfer).toHaveBeenCalledTimes(1);
    const accounts = m.sendBallTransfer.mock.calls[0][0];
    expect(accounts.email).toBe("accounts@example.com");
    expect(accounts.cc).toBeUndefined();
    expect(accounts.subject).toBe("Payment received: Festive Ball invoice BALL-7KQ2MZ");
    expect(accounts.text).toContain("https://nbcc.scot/ball/invoice/42.");
    expect(accounts.text).not.toContain("tok123");
  });

  it("sends only the confirmation without an invoice, or without an accounts email", async () => {
    await sendTransferArrived(booking as never, "tok123", null);
    await sendTransferArrived(booking as never, "tok123", { bookingId: 42, accountsEmail: null });
    expect(m.sendBallConfirmation).toHaveBeenCalledTimes(2);
    expect(m.sendBallTransfer).not.toHaveBeenCalled();
  });

  it("does not send the buyer a second email when the accounts email is their own", async () => {
    await sendTransferArrived(booking as never, "tok123", { bookingId: 42, accountsEmail: "ADA@example.com" });
    expect(m.sendBallConfirmation).toHaveBeenCalledTimes(1);
    expect(m.sendBallTransfer).not.toHaveBeenCalled();
  });

  it("still tells the accounts team when the confirmation fails to send", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.sendBallConfirmation.mockRejectedValueOnce(new Error("down"));
    await sendTransferArrived(booking as never, "tok123", { bookingId: 42, accountsEmail: "accounts@example.com" });
    expect(m.sendBallTransfer).toHaveBeenCalledTimes(1);
  });
});
