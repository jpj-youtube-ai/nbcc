import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-484: cancelling a Festive Ball booking from the admin. Staff cancelling an UNPAID bank transfer
// booking emails the buyer, so nobody is left thinking their seats are still held. A cancelled card
// booking sends nothing, as before.

const { cancelBookingMock, getUserAuthRowMock, sendTransferCancelledMock } = vi.hoisted(() => ({
  cancelBookingMock: vi.fn(),
  getUserAuthRowMock: vi.fn(),
  sendTransferCancelledMock: vi.fn(),
}));
vi.mock("../../src/db/ball", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/ball")>()),
  cancelBooking: cancelBookingMock,
}));
vi.mock("../../src/ball/transfer-send", () => ({ sendTransferCancelled: sendTransferCancelledMock }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { postAdminBallCancelBooking } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

const token = () => {
  getUserAuthRowMock.mockResolvedValue({ id: 2, email: "staff@example.com", status: "active", role: "admin", permissions: {} });
  return signAdminSession({ sub: 2, email: "staff@example.com", role: "admin", now: new Date(), secret: "test-admin-secret" }).token;
};

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const cancel = async () => {
  const res = mockRes();
  await postAdminBallCancelBooking(
    { headers: { authorization: `Bearer ${token()}` }, params: { reference: "BALL-7KQ2MZ" }, body: {}, query: {} } as never,
    res as never,
  );
  return res;
};

// Invented.
const booking = {
  reference: "BALL-7KQ2MZ", kind: "table", quantity: 1, seats: 10, buyerName: "Ada Test", buyerEmail: "ada@example.com",
  ticketsPence: 100_000, donationPence: 0, totalPence: 100_000, giftAid: false,
};

beforeEach(() => vi.clearAllMocks());

describe("cancelling a booking", () => {
  it("emails the buyer when it was an unpaid bank transfer", async () => {
    cancelBookingMock.mockResolvedValue({ ok: true, seats: 10, wasStatus: "pending", paymentMethod: "transfer", booking, invoice: null });
    const res = await cancel();
    expect(res.statusCode).toBe(200);
    expect(sendTransferCancelledMock).toHaveBeenCalledWith({ ...booking, invoice: null });
  });

  // TASK-486: the cancelled email links the invoice, which now shows it cancelled.
  it("passes an invoiced booking's invoice on to the cancelled email", async () => {
    const invoice = { bookingId: 42, accountsEmail: "accounts@example.com" };
    cancelBookingMock.mockResolvedValue({ ok: true, seats: 10, wasStatus: "pending", paymentMethod: "transfer", booking, invoice });
    await cancel();
    expect(sendTransferCancelledMock).toHaveBeenCalledWith({ ...booking, invoice });
  });

  it("sends nothing for a card booking", async () => {
    cancelBookingMock.mockResolvedValue({ ok: true, seats: 10, wasStatus: "paid", paymentMethod: "card", booking });
    await cancel();
    expect(sendTransferCancelledMock).not.toHaveBeenCalled();
  });

  // Paid by transfer and then cancelled is a refund conversation, not "we hadn't received payment".
  it("sends nothing when the transfer booking had already been paid", async () => {
    cancelBookingMock.mockResolvedValue({ ok: true, seats: 10, wasStatus: "paid", paymentMethod: "transfer", booking });
    await cancel();
    expect(sendTransferCancelledMock).not.toHaveBeenCalled();
  });
});
