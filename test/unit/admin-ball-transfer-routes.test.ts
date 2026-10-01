import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-484: the admin side of paying for the Ball by bank transfer. The client reserved two things to
// admins whatever the access matrix says: setting the bank details, and confirming money has arrived.
// Giving more time needs Festive Ball edit access. The database and emails are mocked; the real SQL
// runs in features/ball-bank-transfer.feature.

const m = vi.hoisted(() => ({
  getUserAuthRow: vi.fn(),
  getTransferSettings: vi.fn(),
  saveTransferSettings: vi.fn(),
  listAwaitingTransfers: vi.fn(),
  markTransferPaid: vi.fn(),
  extendPayBy: vi.fn(),
  sendTransferArrived: vi.fn(),
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: m.getUserAuthRow }));
vi.mock("../../src/db/ball-transfer", () => ({
  getTransferSettings: m.getTransferSettings,
  saveTransferSettings: m.saveTransferSettings,
  listAwaitingTransfers: m.listAwaitingTransfers,
  markTransferPaid: m.markTransferPaid,
  extendPayBy: m.extendPayBy,
}));
vi.mock("../../src/ball/transfer-send", () => ({ sendTransferArrived: m.sendTransferArrived }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", ADMIN_SESSION_SECRET: "test-admin-secret", BALL_BASE_URL: "https://nbcc.scot" },
}));

import {
  getAdminTransferSettings,
  putAdminTransferSettings,
  getAdminTransfers,
  postAdminMarkTransferPaid,
  postAdminTransferPayBy,
} from "../../src/routes/admin-ball-transfer";
import { signAdminSession } from "../../src/admin/session";

const SECRET = "test-admin-secret";
// The row read fresh on every request decides. An editor here has Festive Ball EDIT, granted on purpose.
const tokenFor = (role: "admin" | "editor" | "viewer", permissions: Record<string, string> = {}) => {
  m.getUserAuthRow.mockResolvedValue({ id: 4, email: "staff@example.com", status: "active", role, permissions });
  return signAdminSession({ sub: 4, email: "staff@example.com", role, now: new Date(), secret: SECRET }).token;
};
const editorWithBallEdit = () => tokenFor("editor", { ball: "edit" });

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const call = async (handler: (rq: never, rs: never) => Promise<unknown>, token: string, body: unknown = {}, params: Record<string, string> = {}) => {
  const res = mockRes();
  await handler({ headers: { authorization: `Bearer ${token}` }, body, params, query: {} } as never, res as never);
  return res;
};

const BANK = { on: false, accountName: "Night Before Christmas Campaign", sortCode: "12-34-56", accountNumber: "12345678" };
const booking = {
  reference: "BALL-7KQ2MZ", kind: "table", quantity: 1, seats: 10, buyerName: "Ada Test", buyerFirstName: "Ada",
  buyerSurname: "Test", buyerEmail: "ada@example.com", ticketsPence: 100_000, donationPence: 2_000,
  feeCoverPence: 0, totalPence: 102_000, giftAid: true, newsletterOptIn: false, stripeSessionId: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getTransferSettings.mockResolvedValue(BANK);
  m.saveTransferSettings.mockImplementation(async (u: { on?: boolean }) => ({ ...BANK, on: u.on ?? BANK.on }));
});

describe("the bank details and the switch", () => {
  it("can be read by anyone who can see the Festive Ball", async () => {
    const res = await call(getAdminTransferSettings, tokenFor("viewer"));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ...BANK, ready: false, offered: false });
  });

  it("can be changed by an admin only, not by an editor with Festive Ball edit", async () => {
    expect((await call(putAdminTransferSettings, editorWithBallEdit(), { on: true })).statusCode).toBe(403);
    expect(m.saveTransferSettings).not.toHaveBeenCalled();
    const res = await call(putAdminTransferSettings, tokenFor("admin"), { on: true });
    expect(res.statusCode).toBe(200);
    expect(m.saveTransferSettings).toHaveBeenCalledWith({ on: true }, "admin:staff@example.com");
  });

  it("refuses details that are not a sort code and account number", async () => {
    const res = await call(putAdminTransferSettings, tokenFor("admin"), {
      accountName: "NBCC", sortCode: "12345", accountNumber: "12345678",
    });
    expect(res.statusCode).toBe(400);
  });

  // Switched on with a detail missing would give buyers a booking they cannot pay.
  it("refuses to switch on while a detail is missing", async () => {
    m.getTransferSettings.mockResolvedValue({ ...BANK, accountNumber: null });
    const res = await call(putAdminTransferSettings, tokenFor("admin"), { on: true });
    expect(res.statusCode).toBe(400);
    expect(m.saveTransferSettings).not.toHaveBeenCalled();
  });

  it("saves new details, formatted", async () => {
    await call(putAdminTransferSettings, tokenFor("admin"), { accountName: "NBCC", sortCode: "654321", accountNumber: "87654321" });
    expect(m.saveTransferSettings).toHaveBeenCalledWith(
      { details: { accountName: "NBCC", sortCode: "65-43-21", accountNumber: "87654321" } },
      "admin:staff@example.com",
    );
  });
});

// TASK-485: the last day for transfers to arrive.
describe("the last day for transfers", () => {
  it("is saved by an admin, and can be cleared", async () => {
    await call(putAdminTransferSettings, tokenFor("admin"), { lastDay: "2026-10-31" });
    expect(m.saveTransferSettings).toHaveBeenLastCalledWith({ lastDay: "2026-10-31" }, "admin:staff@example.com");
    await call(putAdminTransferSettings, tokenFor("admin"), { lastDay: null });
    expect(m.saveTransferSettings).toHaveBeenLastCalledWith({ lastDay: null }, "admin:staff@example.com");
  });

  // Switched on is not the same as offered: after the last day the page offers card only.
  it("says whether the ticket page actually offers it", async () => {
    m.saveTransferSettings.mockResolvedValue({ ...BANK, on: true, lastDay: "2020-01-01" });
    const past = await call(putAdminTransferSettings, tokenFor("admin"), { lastDay: "2020-01-01" });
    expect((past.body as { offered: boolean }).offered).toBe(false);
    m.saveTransferSettings.mockResolvedValue({ ...BANK, on: true, lastDay: null });
    const open = await call(putAdminTransferSettings, tokenFor("admin"), { lastDay: null });
    expect((open.body as { offered: boolean }).offered).toBe(true);
  });

  it("must be a real date", async () => {
    expect((await call(putAdminTransferSettings, tokenFor("admin"), { lastDay: "2026-02-30" })).statusCode).toBe(400);
    expect(m.saveTransferSettings).not.toHaveBeenCalled();
  });

  it("is an admin's to set", async () => {
    expect((await call(putAdminTransferSettings, editorWithBallEdit(), { lastDay: "2026-10-31" })).statusCode).toBe(403);
  });
});

describe("the bookings awaiting a transfer", () => {
  it("are listed for anyone who can see the Festive Ball", async () => {
    m.listAwaitingTransfers.mockResolvedValue([{ reference: "BALL-7KQ2MZ", payBy: "2099-01-01" }]);
    const res = await call(getAdminTransfers, tokenFor("viewer"));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ results: [{ reference: "BALL-7KQ2MZ", payBy: "2099-01-01", overdue: false }] });
  });

  // TASK-485: past its date, flagged for staff, who decide what happens.
  it("say which are overdue", async () => {
    m.listAwaitingTransfers.mockResolvedValue([
      { reference: "BALL-OLDONE", payBy: "2020-01-01" },
      { reference: "BALL-NEWONE", payBy: "2099-01-01" },
    ]);
    const res = await call(getAdminTransfers, tokenFor("viewer"));
    const results = (res.body as { results: Array<{ reference: string; overdue: boolean }> }).results;
    expect(results.map((r) => r.overdue)).toEqual([true, false]);
  });
});

describe("marking a transfer paid", () => {
  const params = { reference: "BALL-7KQ2MZ" };

  it("is for admins only", async () => {
    const res = await call(postAdminMarkTransferPaid, editorWithBallEdit(), { confirmTotalPence: 102_000 }, params);
    expect(res.statusCode).toBe(403);
    expect(m.markTransferPaid).not.toHaveBeenCalled();
  });

  it("needs the amount the admin confirmed", async () => {
    expect((await call(postAdminMarkTransferPaid, tokenFor("admin"), {}, params)).statusCode).toBe(400);
  });

  it("marks it paid and sends the confirmation with its guest link", async () => {
    m.markTransferPaid.mockResolvedValue({ ok: true, reinstated: false, booking, guestToken: "tok123" });
    const res = await call(postAdminMarkTransferPaid, tokenFor("admin"), { confirmTotalPence: 102_000 }, params);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ reference: "BALL-7KQ2MZ", reinstated: false });
    expect(m.markTransferPaid).toHaveBeenCalledWith("BALL-7KQ2MZ", 102_000, "admin:staff@example.com", expect.any(String));
    expect(m.sendTransferArrived).toHaveBeenCalledWith(booking, "tok123");
  });

  it.each([
    ["not_found", 404],
    ["not_transfer", 409],
    ["already_paid", 409],
    ["amount_mismatch", 409],
    ["seats_gone", 409],
  ])("answers %s with %i and sends nothing", async (reason, status) => {
    m.markTransferPaid.mockResolvedValue({ ok: false, reason });
    const res = await call(postAdminMarkTransferPaid, tokenFor("admin"), { confirmTotalPence: 102_000 }, params);
    expect(res.statusCode).toBe(status);
    expect((res.body as { error: string }).error).toBeTruthy();
    expect(m.sendTransferArrived).not.toHaveBeenCalled();
  });

  // Paid, then cancelled and refunded by hand: bringing it back would send a confirmation for money
  // the charity has returned.
  it("refuses a booking that had been paid before it was cancelled", async () => {
    m.markTransferPaid.mockResolvedValue({ ok: false, reason: "was_paid" });
    const res = await call(postAdminMarkTransferPaid, tokenFor("admin"), { confirmTotalPence: 102_000 }, params);
    expect(res.statusCode).toBe(409);
    expect((res.body as { error: string }).error).toBe(
      "That booking had been paid before it was cancelled, so it can't be brought back. Make a new booking instead.",
    );
    expect(m.sendTransferArrived).not.toHaveBeenCalled();
  });

  it("says plainly when the seats have gone since it was cancelled", async () => {
    m.markTransferPaid.mockResolvedValue({ ok: false, reason: "seats_gone" });
    const res = await call(postAdminMarkTransferPaid, tokenFor("admin"), { confirmTotalPence: 102_000 }, params);
    expect((res.body as { error: string }).error).toBe(
      "Its seats have been sold since it was cancelled. Refund the transfer by hand.",
    );
  });
});

describe("giving more time", () => {
  const params = { reference: "BALL-7KQ2MZ" };

  it("is for anyone with Festive Ball edit", async () => {
    m.extendPayBy.mockResolvedValue("ok");
    const res = await call(postAdminTransferPayBy, editorWithBallEdit(), { payBy: "2099-01-31" }, params);
    expect(res.statusCode).toBe(200);
    expect(m.extendPayBy).toHaveBeenCalledWith("BALL-7KQ2MZ", "2099-01-31", "admin:staff@example.com");
  });

  it("is refused to someone who can only see the Festive Ball", async () => {
    expect((await call(postAdminTransferPayBy, tokenFor("viewer"), { payBy: "2099-01-31" }, params)).statusCode).toBe(403);
  });

  it("refuses a date in the past, or one that is not a date", async () => {
    expect((await call(postAdminTransferPayBy, editorWithBallEdit(), { payBy: "2020-01-01" }, params)).statusCode).toBe(400);
    expect((await call(postAdminTransferPayBy, editorWithBallEdit(), { payBy: "next week" }, params)).statusCode).toBe(400);
    // Shaped like a date but not one: the database would refuse it, and staff would see a 500.
    expect((await call(postAdminTransferPayBy, editorWithBallEdit(), { payBy: "2099-02-30" }, params)).statusCode).toBe(400);
    expect((await call(postAdminTransferPayBy, editorWithBallEdit(), { payBy: "2099-13-01" }, params)).statusCode).toBe(400);
    expect(m.extendPayBy).not.toHaveBeenCalled();
  });

  it("says so when the booking is no longer waiting for a transfer", async () => {
    m.extendPayBy.mockResolvedValue("not_open");
    expect((await call(postAdminTransferPayBy, editorWithBallEdit(), { payBy: "2099-01-31" }, params)).statusCode).toBe(409);
  });
});
