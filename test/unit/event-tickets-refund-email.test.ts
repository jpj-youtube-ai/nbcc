import { describe, it, expect, vi, beforeEach } from "vitest";

// Event tickets: the buyer's refund email. If it will not go when the refund is recorded, the order
// is marked with what it was to say, and the daily task sends it (three tries at most). And Stripe
// is asked for a payment's refunds with a short wait and no second try, as the order is locked
// while it is asked. The database, the email and Stripe are mocked; every name here is invented.

const db = vi.hoisted(() => ({
  getOrder: vi.fn(),
  noteRefundEmailUnsent: vi.fn(),
  claimUnsentRefundEmails: vi.fn(),
  markRefundEmailSent: vi.fn(),
  claimUnsentConfirmations: vi.fn(),
  deleteOldBuyerPhones: vi.fn(),
  markConfirmationSent: vi.fn(),
}));
const mail = vi.hoisted(() => ({ sendEventTickets: vi.fn() }));
const fr = vi.hoisted(() => ({ getFundraiser: vi.fn() }));
const stripeRefunds = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../../src/db/event-tickets", () => db);
vi.mock("../../src/clients/email", () => mail);
vi.mock("../../src/db/fundraisers", () => fr);
vi.mock("../../src/db/pool", () => ({ pool: {} }));
vi.mock("../../src/clients/stripe", () => ({ stripe: { refunds: stripeRefunds } }));
vi.mock("../../src/config", () => ({ config: { PORTAL_BASE_URL: "https://nbcc.test", BALL_FROM_EMAIL: "events@nbcc.test" } }));

import { resendUnsentRefundEmails, sendRefundRecordedEmail, tellAfterReconcile } from "../../src/tickets/send";
import { listStripeRefunds } from "../../src/tickets/refunds";

const order = (over: Record<string, unknown> = {}) => ({
  id: 70,
  fundraiserId: 12,
  reference: "TIX-ABCDEF",
  status: "paid",
  firstName: "Robin",
  surname: "Example",
  email: "robin@example.com",
  totalPence: 2000,
  refundedPence: 1000,
  lines: [{ id: 1, typeName: "Adult", unitPence: 1000, quantity: 2, refundedQuantity: 1 }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  db.getOrder.mockResolvedValue(order());
  fr.getFundraiser.mockResolvedValue({ id: 12, name: "Kim Example", title: "Example Quiz Night", slug: "example-quiz", eventDate: "2099-12-05", startTime: "19:00", venue: "Example Hall", town: "Exampleton" });
  mail.sendEventTickets.mockResolvedValue(undefined);
});

describe("the buyer's refund email", () => {
  it("goes when the refund is recorded, and marks nothing", async () => {
    await sendRefundRecordedEmail(70, 1000, false);
    expect(mail.sendEventTickets).toHaveBeenCalledWith("eventTicketsRefund", "Robin Example", expect.objectContaining({ email: "robin@example.com" }));
    expect(db.noteRefundEmailUnsent).not.toHaveBeenCalled();
  });

  it("that will not go marks the order with what it was to say, and never throws", async () => {
    mail.sendEventTickets.mockRejectedValue(new Error("mail down"));
    await expect(tellAfterReconcile(70, { refundedNowPence: 1000, full: false, failedWords: [] })).resolves.toBeUndefined();
    expect(db.noteRefundEmailUnsent).toHaveBeenCalledWith(70, 1000);
  });

  it("is sent by the daily task, and only what it said comes off the mark", async () => {
    db.claimUnsentRefundEmails.mockResolvedValue([{ orderId: 70, pence: 1000 }]);
    expect(await resendUnsentRefundEmails()).toEqual({ tried: 1, sent: 1 });
    expect(mail.sendEventTickets).toHaveBeenCalledTimes(1);
    expect(mail.sendEventTickets.mock.calls[0][0]).toBe("eventTicketsRefund");
    expect(db.markRefundEmailSent).toHaveBeenCalledWith(70, 1000);
  });

  it("that fails again on the daily task stays marked, for the next run", async () => {
    db.claimUnsentRefundEmails.mockResolvedValue([{ orderId: 70, pence: 1000 }, { orderId: 71, pence: 500 }]);
    mail.sendEventTickets.mockRejectedValueOnce(new Error("mail down")).mockResolvedValue(undefined);
    expect(await resendUnsentRefundEmails()).toEqual({ tried: 2, sent: 1 });
    expect(db.markRefundEmailSent).toHaveBeenCalledTimes(1);
    expect(db.markRefundEmailSent).toHaveBeenCalledWith(71, 500);
  });
});

describe("asking Stripe for a payment's refunds", () => {
  it("waits eight seconds at most and never tries twice, as the order is locked meanwhile", async () => {
    stripeRefunds.list.mockResolvedValue({ data: [{ id: "re_1", status: "succeeded", amount: 1000, metadata: { refundIntent: "31" } }, { id: "re_2", status: "failed", amount: 500, metadata: {} }] });
    expect(await listStripeRefunds("pi_1")).toEqual([
      { id: "re_1", status: "succeeded", amount: 1000, intentId: 31 },
      { id: "re_2", status: "failed", amount: 500, intentId: null },
    ]);
    expect(stripeRefunds.list).toHaveBeenCalledWith({ payment_intent: "pi_1", limit: 100 }, { timeout: 8000, maxNetworkRetries: 0 });
  });
});

// Jaimie, 2026-10-04: the notice to staff about a refund that failed at the bank must not say the
// buyer has their tickets email (the booking may be cancelled). A booking paid late still does.
describe("the staff notice about a failed refund", () => {
  it("says the buyer has not been told, not that they have their tickets email", async () => {
    await tellAfterReconcile(70, { refundedNowPence: 0, full: false, failedWords: ["Refund failed at the bank: the buyer has not been paid back. Refund again."] });
    const sent = mail.sendEventTickets.mock.calls.find((c) => c[0] === "eventTicketsToCheck");
    expect(sent).toBeTruthy();
    const text = (sent as unknown[])[2] as { text: string };
    expect(text.text).toContain("The refund did not go through, and the buyer has not been told. Please get in touch with them.");
    expect(text.text).not.toContain("has their tickets email");
  });
});
