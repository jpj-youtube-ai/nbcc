import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-486: GET /ball/invoice/:token, the private printable invoice for a bank transfer booking. The
// database is mocked; features/ball-bank-transfer.feature runs it against Postgres. Invented data.

const { getBookingForInvoiceMock, getTransferSettingsMock } = vi.hoisted(() => ({
  getBookingForInvoiceMock: vi.fn(),
  getTransferSettingsMock: vi.fn(),
}));
vi.mock("../../src/db/ball", () => ({ getAvailability: vi.fn(), getCapacityState: vi.fn() }));
vi.mock("../../src/db/ball-transfer", () => ({
  getTransferSettings: getTransferSettingsMock,
  createTransferBooking: vi.fn(),
  getBookingForInvoice: getBookingForInvoiceMock,
}));
vi.mock("../../src/ball/transfer-send", () => ({ sendTransferDetails: vi.fn(), invoiceUrl: vi.fn() }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", ADMIN_SESSION_SECRET: "test-secret-0123456789", BALL_BASE_URL: "https://nbcc.scot" },
}));

import { getInvoicePage } from "../../src/routes/ball-transfer";
import { signInvoiceToken } from "../../src/ball/invoice-token";

const BANK = { on: true, accountName: "Night Before Christmas Campaign", sortCode: "12-34-56", accountNumber: "12345678" };
const booking = {
  id: 42,
  reference: "BALL-7KQ2MZ",
  kind: "table" as const,
  quantity: 1,
  seats: 10,
  buyerName: "Ada Test",
  ticketsPence: 100_000,
  donationPence: 0,
  totalPence: 100_000,
  status: "pending",
  payBy: "2026-10-15",
  issuedOn: "2026-10-01",
  paidOn: null,
  company: "Example Widgets Ltd",
  address: "1 Test Street\nTestville",
  po: null,
};

type MockRes = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  status: (c: number) => MockRes;
  setHeader: (k: string, v: string) => MockRes;
  type: (t: string) => MockRes;
  send: (b: string) => MockRes;
};
function mockRes(): MockRes {
  const res = { statusCode: 200, headers: {}, body: "" } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.type = () => res;
  res.send = (b) => { res.body = b; return res; };
  return res;
}
const get = async (token: string) => {
  const res = mockRes();
  await getInvoicePage({ params: { token } } as never, res as never);
  return res;
};
const goodToken = signInvoiceToken(42, "test-secret-0123456789");

beforeEach(() => {
  vi.clearAllMocks();
  getTransferSettingsMock.mockResolvedValue(BANK);
  getBookingForInvoiceMock.mockResolvedValue(booking);
});

describe("GET /ball/invoice/:token", () => {
  it("shows the invoice, privately, and keeps it out of search engines", async () => {
    const res = await get(goodToken);
    expect(res.statusCode).toBe(200);
    expect(getBookingForInvoiceMock).toHaveBeenCalledWith(42);
    expect(res.body).toContain("BALL-7KQ2MZ");
    expect(res.body).toContain("Example Widgets Ltd");
    expect(res.body).toContain("12345678");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("is not found for a made-up or altered link, without looking anything up", async () => {
    expect((await get("42.forged")).statusCode).toBe(404);
    expect((await get(signInvoiceToken(43, "another-secret"))).statusCode).toBe(404);
    expect((await get("")).statusCode).toBe(404);
    expect(getBookingForInvoiceMock).not.toHaveBeenCalled();
  });

  it("is not found for a booking without an invoice", async () => {
    getBookingForInvoiceMock.mockResolvedValue(null);
    expect((await get(goodToken)).statusCode).toBe(404);
  });

  // A cancelled booking must not invite anyone to send money.
  it("gives no bank details once the booking is cancelled", async () => {
    getBookingForInvoiceMock.mockResolvedValue({ ...booking, status: "cancelled" });
    const res = await get(goodToken);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("12345678");
  });

  it("says it is paid once it is", async () => {
    getBookingForInvoiceMock.mockResolvedValue({ ...booking, status: "paid", paidOn: "2026-10-05" });
    expect((await get(goodToken)).body).toMatch(/Paid/);
  });

  it("answers 500, not a crash, when the database fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getBookingForInvoiceMock.mockRejectedValue(new Error("down"));
    expect((await get(goodToken)).statusCode).toBe(500);
  });
});
