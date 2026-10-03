import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-484: POST /api/ball/bank-transfer, the public route for booking to pay by bank transfer. The
// database and the email are mocked; features/ball-bank-transfer.feature runs it against Postgres.

const {
  getAvailabilityMock,
  getCapacityStateMock,
  getTransferSettingsMock,
  createTransferBookingMock,
  sendTransferDetailsMock,
  sendTransferStaffNoticeMock,
} = vi.hoisted(() => ({
  getAvailabilityMock: vi.fn(),
  getCapacityStateMock: vi.fn(),
  getTransferSettingsMock: vi.fn(),
  createTransferBookingMock: vi.fn(),
  sendTransferDetailsMock: vi.fn(),
  sendTransferStaffNoticeMock: vi.fn(),
}));
vi.mock("../../src/db/ball", () => ({ getAvailability: getAvailabilityMock, getCapacityState: getCapacityStateMock }));
vi.mock("../../src/db/ball-transfer", () => ({
  getTransferSettings: getTransferSettingsMock,
  createTransferBooking: createTransferBookingMock,
}));
vi.mock("../../src/ball/transfer-send", () => ({
  sendTransferDetails: sendTransferDetailsMock,
  sendTransferStaffNotice: sendTransferStaffNoticeMock,
  invoiceUrl: (id: number) => `https://nbcc.scot/ball/invoice/${id}.sig`,
}));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", BALL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot" },
}));

import { postBankTransfer } from "../../src/routes/ball-transfer";
import { londonDate } from "../../src/ball/sales-report";
import { transferPayBy, TRANSFER_DAYS_INVOICE } from "../../src/ball/transfer";

// Invented, like every fixture in this public repo.
const BANK = { on: true, accountName: "Night Before Christmas Campaign", sortCode: "12-34-56", accountNumber: "12345678" };
const order = {
  kind: "table",
  quantity: 1,
  buyerFirstName: "Ada",
  buyerSurname: "Test",
  buyerEmail: "ada@example.com",
  buyerPhone: "07700 900123",
  donationPence: 2000,
  coverFee: true, // a transfer has no card fee, whatever is sent
  giftAid: true,
  newsletterOptIn: false,
  termsAccepted: true,
};

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
// The limiter remembers connections for an hour, so each test books from an address of its own.
let testIp = "";
let ipSeq = 0;
const post = async (body: unknown, ip = testIp) => {
  const res = mockRes();
  await postBankTransfer({ body, ip, headers: {} } as never, res as never);
  return res;
};
const body = (res: MockRes) => res.body as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  testIp = `203.0.113.${(ipSeq += 1)}`;
  getTransferSettingsMock.mockResolvedValue(BANK);
  getAvailabilityMock.mockResolvedValue({ salesOpen: true, soldOut: false, cardFee: { percentBp: 120, fixedPence: 20 } });
  getCapacityStateMock.mockResolvedValue({ seatsPerTable: 10 });
  createTransferBookingMock.mockResolvedValue({ id: 1 });
});

describe("POST /api/ball/bank-transfer", () => {
  it("books the seats and answers with everything needed to pay", async () => {
    const res = await post(order);
    expect(res.statusCode).toBe(201);
    const b = body(res);
    expect(b.reference).toMatch(/^BALL-[A-Z2-9]{6}$/);
    expect(b).toMatchObject({
      totalPence: 102_000, // £1,000 table + £20 donation, and no card fee
      accountName: BANK.accountName,
      sortCode: "12-34-56",
      accountNumber: "12345678",
    });
    expect(b.payBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(createTransferBookingMock).toHaveBeenCalledTimes(1);
    const [write] = createTransferBookingMock.mock.calls[0];
    expect(write).toMatchObject({ kind: "table", seats: 10, feeCoverPence: 0, totalPence: 102_000, giftAid: true });
    expect(sendTransferDetailsMock).toHaveBeenCalledTimes(1);
  });

  it("is not offered until an admin has switched it on with every detail", async () => {
    getTransferSettingsMock.mockResolvedValue({ ...BANK, on: false });
    expect((await post(order)).statusCode).toBe(409);
    getTransferSettingsMock.mockResolvedValue({ ...BANK, accountNumber: null });
    const res = await post(order);
    expect(res.statusCode).toBe(409);
    expect(body(res).error).toBe("Bank transfer isn't available");
    expect(createTransferBookingMock).not.toHaveBeenCalled();
  });

  it("is refused when ticket sales are closed", async () => {
    getAvailabilityMock.mockResolvedValue({ salesOpen: false, soldOut: true, cardFee: { percentBp: 120, fixedPence: 20 } });
    expect((await post(order)).statusCode).toBe(409);
    expect(createTransferBookingMock).not.toHaveBeenCalled();
  });

  it("refuses a booking without the terms agreed", async () => {
    expect((await post({ ...order, termsAccepted: false })).statusCode).toBe(400);
  });

  it("says so when the seats went while they were deciding", async () => {
    createTransferBookingMock.mockResolvedValue(null);
    const res = await post(order);
    expect(res.statusCode).toBe(409);
    expect(body(res).error).toBe("There are not enough whole tables left for that booking");
    expect(sendTransferDetailsMock).not.toHaveBeenCalled();
  });

  // Jaimie 2026-10-03: the booker's phone number, required, stored and given to the team.
  it("refuses a booking with no phone number, naming it", async () => {
    const without = { ...order, buyerPhone: undefined };
    const res = await post(without);
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toBe("Please give your phone number, so we can contact you about menu choices for your table.");
    expect(JSON.stringify(body(res).details)).toContain("buyerPhone");
    expect(createTransferBookingMock).not.toHaveBeenCalled();
  });

  it("stores the phone number with the booking and gives it to the team", async () => {
    await post(order);
    expect(createTransferBookingMock.mock.calls[0][0]).toMatchObject({ buyerPhone: "07700 900123" });
    expect(sendTransferStaffNoticeMock.mock.calls[0][0]).toMatchObject({ buyerPhone: "07700 900123" });
  });

  // TASK-487: the team hears of each booking at events@.
  it("tells the team about the booking, and not about a refused one", async () => {
    const res = await post(order);
    expect(sendTransferStaffNoticeMock).toHaveBeenCalledTimes(1);
    const [write, payBy] = sendTransferStaffNoticeMock.mock.calls[0];
    expect(write).toMatchObject({ reference: body(res).reference, buyerEmail: "ada@example.com", invoice: null });
    expect(payBy).toBe(body(res).payBy);
    createTransferBookingMock.mockResolvedValue(null);
    await post(order);
    expect(sendTransferStaffNoticeMock).toHaveBeenCalledTimes(1);
  });

  // The client wants a buyer who decides they want more to be able to book more.
  it("lets the same buyer book again before paying", async () => {
    expect((await post(order)).statusCode).toBe(201);
    expect((await post({ ...order, kind: "seat", quantity: 2 })).statusCode).toBe(201);
  });

  // TASK-485: after the last day for transfers, card only.
  it("is refused after the last day for transfers", async () => {
    getTransferSettingsMock.mockResolvedValue({ ...BANK, lastDay: "2020-01-01" });
    const res = await post(order);
    expect(res.statusCode).toBe(409);
    expect(body(res).error).toBe("Bank transfer has closed. Please pay by card.");
    expect(createTransferBookingMock).not.toHaveBeenCalled();
  });

  it("shortens the pay-by date to the last day when that comes first", async () => {
    const tomorrow = londonDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
    getTransferSettingsMock.mockResolvedValue({ ...BANK, lastDay: tomorrow });
    const res = await post(order);
    expect(res.statusCode).toBe(201);
    expect(body(res).payBy).toBe(tomorrow);
    expect(createTransferBookingMock.mock.calls[0][1]).toBe(tomorrow);
  });

  // A transfer booking holds seats for a week, so a bot must not be able to hold the room.
  it("allows five from one connection in an hour, and refuses the sixth", async () => {
    for (let i = 0; i < 5; i++) expect((await post(order)).statusCode).toBe(201);
    expect((await post(order)).statusCode).toBe(429);
    expect((await post(order, "198.51.100.9")).statusCode).toBe(201);
  });

  // TASK-486: a company paying an invoice gets 14 days, a private link to the invoice, and no Gift
  // Aid (a company cannot make a Gift Aid declaration).
  describe("with an invoice", () => {
    const invoice = {
      company: "Example Widgets Ltd",
      address: "1 Test Street\nTestville\nTE1 1ST",
      po: "PO-0001",
      accountsEmail: "accounts@example.com",
      phone: "",
    };

    it("books it with 14 days to pay, no Gift Aid, and answers with the invoice link", async () => {
      const res = await post({ ...order, invoice });
      expect(res.statusCode).toBe(201);
      const [write, payBy, details] = createTransferBookingMock.mock.calls[0];
      expect(write.giftAid).toBe(false);
      expect(payBy).toBe(transferPayBy(new Date(), null, TRANSFER_DAYS_INVOICE));
      expect(details).toEqual({
        company: "Example Widgets Ltd",
        address: "1 Test Street\nTestville\nTE1 1ST",
        po: "PO-0001",
        accountsEmail: "accounts@example.com",
        phone: undefined,
      });
      expect(body(res).invoiceUrl).toBe("https://nbcc.scot/ball/invoice/1.sig");
      expect(sendTransferDetailsMock.mock.calls[0][0].invoice).toEqual({ bookingId: 1, accountsEmail: "accounts@example.com" });
    });

    it("still stops at the last day for transfers", async () => {
      const tomorrow = londonDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
      getTransferSettingsMock.mockResolvedValue({ ...BANK, lastDay: tomorrow });
      expect(body(await post({ ...order, invoice })).payBy).toBe(tomorrow);
    });

    // Gift Aid is dropped for an invoice, so a request ticking it without a donation is not refused for it.
    it("drops Gift Aid before checking it needs a donation", async () => {
      const res = await post({ ...order, donationPence: 0, giftAid: true, invoice });
      expect(res.statusCode).toBe(201);
      expect(createTransferBookingMock.mock.calls[0][0].giftAid).toBe(false);
    });

    it("refuses an invoice without the company name or address", async () => {
      expect((await post({ ...order, invoice: { ...invoice, company: "" } })).statusCode).toBe(400);
      expect((await post({ ...order, invoice: { ...invoice, address: " " } })).statusCode).toBe(400);
      expect(createTransferBookingMock).not.toHaveBeenCalled();
    });

    it("has no invoice, and keeps the Gift Aid, when none was asked for", async () => {
      const res = await post(order);
      expect(createTransferBookingMock.mock.calls[0][0].giftAid).toBe(true);
      expect(createTransferBookingMock.mock.calls[0][2]).toBeNull();
      expect(body(res).invoiceUrl).toBeUndefined();
      expect(sendTransferDetailsMock.mock.calls[0][0].invoice).toBeNull();
    });
  });
});
