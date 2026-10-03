import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-488: staff add a bank transfer booking in the admin, for a phone or email order. It needs
// Festive Ball edit, works before the ticket page offers bank transfer (once the bank details are
// in), takes no Gift Aid and no newsletter sign-up, and needs the buyer's agreement to the terms.
// The database and the emails are mocked; features/ball-bank-transfer.feature runs it on Postgres.
// Every name and number is invented.

const m = vi.hoisted(() => ({
  getUserAuthRow: vi.fn(),
  getTransferSettings: vi.fn(),
  createTransferBooking: vi.fn(),
  getAvailability: vi.fn(),
  getCapacityState: vi.fn(),
  sendTransferDetails: vi.fn(),
  sendTransferStaffNotice: vi.fn(),
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: m.getUserAuthRow }));
vi.mock("../../src/db/ball-transfer", () => ({
  getTransferSettings: m.getTransferSettings,
  createTransferBooking: m.createTransferBooking,
}));
vi.mock("../../src/db/ball", () => ({ getAvailability: m.getAvailability, getCapacityState: m.getCapacityState }));
vi.mock("../../src/ball/transfer-send", () => ({
  sendTransferDetails: m.sendTransferDetails,
  sendTransferStaffNotice: m.sendTransferStaffNotice,
  sendTransferArrived: vi.fn(),
  invoiceUrl: (id: number) => `https://nbcc.scot/ball/invoice/${id}.sig`,
}));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", ADMIN_SESSION_SECRET: "test-admin-secret", BALL_BASE_URL: "https://nbcc.scot" },
}));

import { postAdminAddTransferBooking } from "../../src/routes/admin-ball-transfer";
import { signAdminSession } from "../../src/admin/session";

const SECRET = "test-admin-secret";
const tokenFor = (role: "admin" | "editor" | "viewer", permissions: Record<string, string> = {}) => {
  m.getUserAuthRow.mockResolvedValue({ id: 4, email: "sam@example.com", status: "active", role, permissions });
  return signAdminSession({ sub: 4, email: "sam@example.com", role, now: new Date(), secret: SECRET }).token;
};

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const add = async (token: string | null, body: unknown) => {
  const res = mockRes();
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  await postAdminAddTransferBooking({ headers, body, params: {}, query: {} } as never, res as never);
  return res;
};
const answer = (res: MockRes) => res.body as Record<string, unknown>;

// Switched OFF on the ticket page, with the bank details in.
const BANK = { on: false, accountName: "Night Before Christmas Campaign", sortCode: "12-34-56", accountNumber: "12345678" };
const order = {
  kind: "table",
  quantity: 1,
  buyerFirstName: "Ada",
  buyerSurname: "Test",
  buyerEmail: "ada@example.com",
  buyerPhone: "01632 960123",
  donationPence: 2000,
  giftAid: true,
  newsletterOptIn: true,
  termsAccepted: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getTransferSettings.mockResolvedValue(BANK);
  m.getAvailability.mockResolvedValue({ salesOpen: false, soldOut: false, cardFee: { percentBp: 120, fixedPence: 20 } });
  m.getCapacityState.mockResolvedValue({ seatsPerTable: 10 });
  m.createTransferBooking.mockResolvedValue({ id: 7 });
});

describe("POST /api/admin/ball/transfer-bookings", () => {
  it("needs a session", async () => {
    expect((await add(null, order)).statusCode).toBe(401);
    expect(m.createTransferBooking).not.toHaveBeenCalled();
  });

  it("needs Festive Ball edit, not just view", async () => {
    expect((await add(tokenFor("viewer"), order)).statusCode).toBe(403);
    expect(m.createTransferBooking).not.toHaveBeenCalled();
  });

  it("books it for someone with Festive Ball edit, before the ticket page offers it and with sales closed", async () => {
    const res = await add(tokenFor("editor", { ball: "edit" }), order);
    expect(res.statusCode).toBe(201);
    expect(answer(res)).toMatchObject({ totalPence: 102_000, sortCode: "12-34-56" });
    expect(answer(res).reference).toMatch(/^BALL-[A-Z2-9]{6}$/);
    const [write, , invoice, addedBy] = m.createTransferBooking.mock.calls[0];
    expect(write).toMatchObject({ kind: "table", seats: 10, totalPence: 102_000, feeCoverPence: 0 });
    expect(invoice).toBeNull();
    expect(addedBy).toBe("admin:sam@example.com");
  });

  // A Gift Aid declaration over the phone needs its own written record; a newsletter sign-up records
  // the buyer's own consent.
  it("takes no Gift Aid and no newsletter sign-up", async () => {
    await add(tokenFor("admin"), order);
    const [write] = m.createTransferBooking.mock.calls[0];
    expect(write.giftAid).toBe(false);
    expect(write.newsletterOptIn).toBe(false);
  });

  it("needs the buyer's phone number, and stores it", async () => {
    const without = { ...order, buyerPhone: undefined };
    expect((await add(tokenFor("admin"), without)).statusCode).toBe(400);
    expect(m.createTransferBooking).not.toHaveBeenCalled();
    await add(tokenFor("admin"), order);
    expect(m.createTransferBooking.mock.calls[0][0]).toMatchObject({ buyerPhone: "01632 960123" });
  });

  it("needs the buyer's agreement to the terms", async () => {
    expect((await add(tokenFor("admin"), { ...order, termsAccepted: false })).statusCode).toBe(400);
    expect(m.createTransferBooking).not.toHaveBeenCalled();
  });

  it("needs the bank details first", async () => {
    m.getTransferSettings.mockResolvedValue({ ...BANK, accountNumber: null });
    const res = await add(tokenFor("admin"), order);
    expect(res.statusCode).toBe(409);
    expect(answer(res).error).toBe("Enter the bank details under Set up first.");
  });

  it("stops at the last day for transfers", async () => {
    m.getTransferSettings.mockResolvedValue({ ...BANK, lastDay: "2020-01-01" });
    const res = await add(tokenFor("admin"), order);
    expect(res.statusCode).toBe(409);
    expect(answer(res).error).toBe("The last day for transfers has passed.");
  });

  // "Close sales now" is a pause staff can book past, as they can hold seats; the closing date is not.
  it("stops once ticket sales have closed by date", async () => {
    m.getAvailability.mockResolvedValue({ salesOpen: false, closedByDate: true, soldOut: false, cardFee: { percentBp: 120, fixedPence: 20 } });
    const res = await add(tokenFor("admin"), order);
    expect(res.statusCode).toBe(409);
    expect(answer(res).error).toBe("Ticket sales have closed for the Ball.");
    expect(m.createTransferBooking).not.toHaveBeenCalled();
  });

  it("says so when there is no room", async () => {
    m.createTransferBooking.mockResolvedValue(null);
    const res = await add(tokenFor("admin"), order);
    expect(res.statusCode).toBe(409);
    expect(answer(res).error).toBe("There are not enough whole tables left for that booking");
  });

  it("emails the buyer the bank details, and tells events@ who added it", async () => {
    await add(tokenFor("admin"), order);
    expect(m.sendTransferDetails).toHaveBeenCalledTimes(1);
    expect(m.sendTransferStaffNotice).toHaveBeenCalledTimes(1);
    expect(m.sendTransferStaffNotice.mock.calls[0][2]).toBe("sam@example.com");
  });

  it("takes an invoice like the public form, and links it", async () => {
    const res = await add(tokenFor("admin"), {
      ...order,
      invoice: { company: "Example Widgets Ltd", address: "1 Test Street", po: "", accountsEmail: "", phone: "" },
    });
    expect(res.statusCode).toBe(201);
    expect(answer(res).invoiceUrl).toBe("https://nbcc.scot/ball/invoice/7.sig");
  });
});
