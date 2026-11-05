import { describe, it, expect, vi, beforeEach } from "vitest";

// Invoices for donations: the admin routes (Donations view to see, edit to send, mark paid, cancel and
// change the bank details) and the private invoice page. The database, the email sender and Stripe are
// mocked. Invented names only.

const m = vi.hoisted(() => ({
  getUserAuthRow: vi.fn(),
  listInvoices: vi.fn(),
  getInvoice: vi.fn(),
  createInvoice: vi.fn(),
  markSent: vi.fn(),
  cancelInvoice: vi.fn(),
  saveGiftAid: vi.fn(),
  getInvoiceSettings: vi.fn(),
  saveInvoiceSettings: vi.fn(),
  markInvoicePaidByTransfer: vi.fn(),
  sendInvoiceEmail: vi.fn(),
  sessionsCreate: vi.fn(),
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: m.getUserAuthRow }));
vi.mock("../../src/db/invoices", () => ({
  listInvoices: m.listInvoices,
  getInvoice: m.getInvoice,
  createInvoice: m.createInvoice,
  markSent: m.markSent,
  cancelInvoice: m.cancelInvoice,
  saveGiftAid: m.saveGiftAid,
  getInvoiceSettings: m.getInvoiceSettings,
  saveInvoiceSettings: m.saveInvoiceSettings,
  markInvoicePaidByTransfer: m.markInvoicePaidByTransfer,
  linkFor: (id: number) => `https://nbcc.scot/invoice/${id}.sig`,
}));
vi.mock("../../src/clients/email", () => ({ sendInvoiceEmail: m.sendInvoiceEmail }));
vi.mock("../../src/clients/stripe", () => ({ stripe: { checkout: { sessions: { create: m.sessionsCreate } } } }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", ADMIN_SESSION_SECRET: "test-admin-secret", PORTAL_BASE_URL: "https://nbcc.scot" },
}));

import {
  getAdminInvoices,
  postAdminInvoice,
  postResendInvoice,
  postMarkInvoicePaid,
  postCancelInvoice,
  putInvoiceBank,
  getInvoicePage,
  postInvoicePay,
  postInvoiceGiftAid,
} from "../../src/routes/invoices";
import { signAdminSession } from "../../src/admin/session";
import { signDonationInvoiceToken } from "../../src/invoices/token";
import { signInvoiceToken } from "../../src/ball/invoice-token";

const SECRET = "test-admin-secret";
const tokenFor = (role: "admin" | "viewer", permissions: Record<string, string> = {}) => {
  m.getUserAuthRow.mockResolvedValue({ id: 4, email: "staff@example.com", status: "active", role, permissions });
  return signAdminSession({ sub: 4, email: "staff@example.com", role, now: new Date(), secret: SECRET }).token;
};

type MockRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  redirectedTo?: string;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
  setHeader: (k: string, v: string) => MockRes;
  type: (t: string) => MockRes;
  send: (b: unknown) => MockRes;
  redirect: (c: number, u: string) => void;
};
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string> } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.type = (t) => { res.headers["content-type"] = t; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.redirect = (c, u) => { res.statusCode = c; res.redirectedTo = u; };
  return res;
}
type Req = { token?: string | null; query?: Record<string, string>; params?: Record<string, string>; body?: unknown; ip?: string };
const call = async (handler: (rq: never, rs: never) => Promise<unknown>, r: Req = {}) => {
  const res = mockRes();
  const headers = r.token ? { authorization: `Bearer ${r.token}` } : {};
  await handler({ headers, query: r.query ?? {}, params: r.params ?? {}, body: r.body ?? {}, ip: r.ip ?? "203.0.113.9" } as never, res as never);
  return res;
};

const INV = {
  id: 12,
  payerKind: "person",
  contactName: "Sam Example",
  orgName: null,
  email: "sam@example.com",
  address: null,
  postcode: null,
  considerationGiven: null,
  description: "Donation to NBCC",
  note: null,
  amountPence: 2500,
  issuedOn: "2026-11-05",
  dueOn: "2099-12-05",
  status: "waiting",
  paidOn: null,
  paidBy: null,
  donationId: null,
  cancelledAt: null,
  paidTwiceAt: null,
  giftAid: null,
  giftAidAt: null,
  sendCount: 1,
  lastSentAt: "2026-11-05T10:00:00Z",
  createdBy: "admin:staff@example.com",
  createdAt: "2026-11-05T10:00:00Z",
};
const BUSINESS = { ...INV, id: 13, payerKind: "business", orgName: "Example Joinery Ltd", address: "1 Made Up Street", postcode: "KA1 1AA", considerationGiven: false };
const SEND = { payerKind: "person", contactName: "Sam Example", email: "sam@example.com", amount: "25", description: "Donation to NBCC", dueOn: "2099-12-05" };
const pageToken = (id = 12) => signDonationInvoiceToken(id, SECRET);

beforeEach(() => {
  vi.clearAllMocks();
  m.listInvoices.mockResolvedValue([INV]);
  m.getInvoice.mockImplementation(async (id: number) => (id === 12 ? INV : id === 13 ? BUSINESS : null));
  m.getInvoiceSettings.mockResolvedValue({ accountName: "Example Account", sortCode: "12-34-56", accountNumber: "12345678" });
  m.createInvoice.mockResolvedValue(INV);
  m.markSent.mockResolvedValue(undefined);
  m.sendInvoiceEmail.mockResolvedValue(undefined);
  m.sessionsCreate.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
});

describe("who can do what", () => {
  it("needs a session", async () => {
    expect((await call(getAdminInvoices)).statusCode).toBe(401);
  });
  it("lets anyone who can view Donations see the list, with the number, state and link", async () => {
    const res = await call(getAdminInvoices, { token: tokenFor("viewer") });
    expect(res.statusCode).toBe(200);
    const body = res.body as { invoices: Array<Record<string, unknown>>; bank: unknown };
    expect(body.invoices[0]).toMatchObject({ id: 12, number: "INV-0012", state: "waiting", link: "https://nbcc.scot/invoice/12.sig" });
    expect(body.bank).toMatchObject({ sortCode: "12-34-56" });
  });
  it("lets only Donations edit send, mark paid, cancel or change the bank details", async () => {
    const t = tokenFor("viewer");
    for (const [h, r] of [
      [postAdminInvoice, { body: SEND }],
      [postResendInvoice, { params: { id: "12" } }],
      [postMarkInvoicePaid, { params: { id: "12" }, body: { paidOn: "2026-11-05" } }],
      [postCancelInvoice, { params: { id: "12" } }],
      [putInvoiceBank, { body: { clear: true } }],
    ] as const) {
      expect((await call(h as never, { token: t, ...r })).statusCode).toBe(403);
    }
    expect(m.createInvoice).not.toHaveBeenCalled();
  });
});

describe("sending an invoice", () => {
  it("saves it, emails it and answers its number and link", async () => {
    const res = await call(postAdminInvoice, { token: tokenFor("admin"), body: SEND });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ id: 12, number: "INV-0012", link: "https://nbcc.scot/invoice/12.sig", sent: true });
    expect(m.createInvoice.mock.calls[0][0]).toMatchObject({ payerKind: "person", amountPence: 2500 });
    expect(m.createInvoice.mock.calls[0][2]).toBe("admin:staff@example.com");
    expect(m.sendInvoiceEmail).toHaveBeenCalledTimes(1);
    expect(m.sendInvoiceEmail.mock.calls[0][0]).toMatchObject({ email: "sam@example.com", subject: "Your invoice from NBCC: INV-0012" });
    expect(m.sendInvoiceEmail.mock.calls[0][0].html).toContain("bank transfer");
    expect(m.markSent).toHaveBeenCalledWith(12, "admin:staff@example.com");
  });
  it("names the field that is wrong", async () => {
    const res = await call(postAdminInvoice, { token: tokenFor("admin"), body: { ...SEND, amount: "abc" } });
    expect(res.statusCode).toBe(400);
    expect((res.body as { field: string }).field).toBe("amount");
    expect(m.createInvoice).not.toHaveBeenCalled();
  });
  it("still saves it when the email does not go, and says so", async () => {
    m.sendInvoiceEmail.mockRejectedValue(new Error("down"));
    const res = await call(postAdminInvoice, { token: tokenFor("admin"), body: SEND });
    expect(res.statusCode).toBe(201);
    expect((res.body as { sent: boolean }).sent).toBe(false);
    expect(m.markSent).not.toHaveBeenCalled();
  });
  it("emails it again, but never a cancelled or paid one", async () => {
    expect((await call(postResendInvoice, { token: tokenFor("admin"), params: { id: "12" } })).statusCode).toBe(200);
    expect(m.sendInvoiceEmail).toHaveBeenCalledTimes(1);
    m.getInvoice.mockResolvedValue({ ...INV, status: "cancelled" });
    expect((await call(postResendInvoice, { token: tokenFor("admin"), params: { id: "12" } })).statusCode).toBe(409);
    expect((await call(postResendInvoice, { token: tokenFor("admin"), params: { id: "99x" } })).statusCode).toBe(404);
  });
});

describe("marking an invoice paid by bank transfer", () => {
  it("records it on the day the money arrived", async () => {
    m.markInvoicePaidByTransfer.mockResolvedValue({ outcome: "paid", donationId: 321, invoice: { ...INV, status: "paid" } });
    const res = await call(postMarkInvoicePaid, { token: tokenFor("admin"), params: { id: "12" }, body: { paidOn: "2026-11-05" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ outcome: "paid", donationId: 321 });
    expect(m.markInvoicePaidByTransfer).toHaveBeenCalledWith(12, "2026-11-05", "admin:staff@example.com");
  });
  it("refuses a date in the future or a date that is not one", async () => {
    for (const paidOn of ["2099-01-01", "2026-02-30", "soon", ""]) {
      const res = await call(postMarkInvoicePaid, { token: tokenFor("admin"), params: { id: "12" }, body: { paidOn } });
      expect(res.statusCode).toBe(400);
    }
    expect(m.markInvoicePaidByTransfer).not.toHaveBeenCalled();
  });
  it("refuses an invoice already paid, so one transfer is never recorded twice by a double press", async () => {
    m.getInvoice.mockResolvedValue({ ...INV, status: "paid" });
    const res = await call(postMarkInvoicePaid, { token: tokenFor("admin"), params: { id: "12" }, body: { paidOn: "2026-11-05" } });
    expect(res.statusCode).toBe(409);
    expect(m.markInvoicePaidByTransfer).not.toHaveBeenCalled();
  });
  // Final review, Critical 1: two presses at once both pass the first look; the second is refused in the lock.
  it("answers 409 when the invoice was paid between the first look and the lock", async () => {
    m.markInvoicePaidByTransfer.mockResolvedValue({ outcome: "refused", donationId: null, invoice: { ...INV, status: "paid" } });
    const res = await call(postMarkInvoicePaid, { token: tokenFor("admin"), params: { id: "12" }, body: { paidOn: "2026-11-05" } });
    expect(res.statusCode).toBe(409);
  });
  it("refuses a date before the invoice was sent, so a typo cannot move a gift into an earlier tax year", async () => {
    m.getInvoice.mockResolvedValue({ ...INV, issuedOn: "2026-11-05" });
    const res = await call(postMarkInvoicePaid, { token: tokenFor("admin"), params: { id: "12" }, body: { paidOn: "2025-11-05" } });
    expect(res.statusCode).toBe(400);
    expect(m.markInvoicePaidByTransfer).not.toHaveBeenCalled();
  });
  it("allows a cancelled invoice, when a transfer turns up anyway", async () => {
    m.getInvoice.mockResolvedValue({ ...INV, status: "cancelled", cancelledAt: "2026-11-04T10:00:00Z" });
    m.markInvoicePaidByTransfer.mockResolvedValue({ outcome: "paid-after-cancel", donationId: 322, invoice: INV });
    const res = await call(postMarkInvoicePaid, { token: tokenFor("admin"), params: { id: "12" }, body: { paidOn: "2026-11-05" } });
    expect(res.statusCode).toBe(200);
  });
});

describe("cancelling", () => {
  it("cancels a waiting invoice and refuses anything else", async () => {
    m.cancelInvoice.mockResolvedValueOnce({ ...INV, status: "cancelled" });
    expect((await call(postCancelInvoice, { token: tokenFor("admin"), params: { id: "12" } })).statusCode).toBe(200);
    m.cancelInvoice.mockResolvedValueOnce(null);
    expect((await call(postCancelInvoice, { token: tokenFor("admin"), params: { id: "12" } })).statusCode).toBe(409);
  });
});

describe("the bank details on invoices", () => {
  it("saves good details and clears them", async () => {
    const t = tokenFor("admin");
    const ok = await call(putInvoiceBank, { token: t, body: { accountName: "Example Account", sortCode: "123456", accountNumber: "12345678" } });
    expect(ok.statusCode).toBe(200);
    expect(m.saveInvoiceSettings).toHaveBeenCalledWith({ accountName: "Example Account", sortCode: "12-34-56", accountNumber: "12345678" }, "admin:staff@example.com");
    expect((await call(putInvoiceBank, { token: t, body: { clear: true } })).statusCode).toBe(200);
    expect(m.saveInvoiceSettings).toHaveBeenLastCalledWith(null, "admin:staff@example.com");
  });
  it("refuses a sort code that is not six digits", async () => {
    const res = await call(putInvoiceBank, { token: tokenFor("admin"), body: { accountName: "X", sortCode: "12", accountNumber: "12345678" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("the private invoice page", () => {
  it("shows the invoice by its link, never cached or listed", async () => {
    const res = await call(getInvoicePage, { params: { token: pageToken() } });
    expect(res.statusCode).toBe(200);
    expect(String(res.body)).toContain("Invoice INV-0012");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });
  it("is not found for a bad link, another invoice's signature, or a Festive Ball invoice link", async () => {
    const [, sig] = pageToken(12).split(".");
    for (const token of ["rubbish", `13.${sig}`, signInvoiceToken(12, SECRET)]) {
      expect((await call(getInvoicePage, { params: { token } })).statusCode).toBe(404);
    }
    expect((await call(getInvoicePage, { params: { token: pageToken(99) } })).statusCode).toBe(404);
  });
  it("thanks someone just back from paying", async () => {
    const res = await call(getInvoicePage, { params: { token: pageToken() }, query: { paid: "1" } });
    expect(String(res.body)).toContain("Your payment is being confirmed");
  });
});

describe("paying by card", () => {
  it("sends the person to Stripe for exactly this invoice", async () => {
    const res = await call(postInvoicePay, { params: { token: pageToken() }, body: {} });
    expect(res.statusCode).toBe(303);
    expect(res.redirectedTo).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
    const params = m.sessionsCreate.mock.calls[0][0];
    expect(params.metadata).toEqual({ product: "donation_invoice", invoiceId: "12" });
    expect(params.line_items[0].price_data.unit_amount).toBe(2500);
  });
  it("saves a person's Gift Aid declaration on the way, and clears it when the box is unticked", async () => {
    const ga = { giftAid: "yes", firstName: "Sam", lastName: "Example", houseNameNumber: "1", address: "Made Up Street", postcode: "KA1 1AA" };
    await call(postInvoicePay, { params: { token: pageToken() }, body: ga });
    expect(m.saveGiftAid.mock.calls[0][0]).toBe(12);
    expect(m.saveGiftAid.mock.calls[0][1]).toMatchObject({ firstName: "Sam", postcode: "KA1 1AA", nonUk: false });
    await call(postInvoicePay, { params: { token: pageToken() }, body: {} });
    expect(m.saveGiftAid).toHaveBeenLastCalledWith(12, null);
  });
  it("shows the page again, with what to fix, when the Gift Aid details are not complete", async () => {
    const res = await call(postInvoicePay, { params: { token: pageToken() }, body: { giftAid: "yes", firstName: "Sam" } });
    expect(res.statusCode).toBe(400);
    expect(String(res.body)).toContain("To add Gift Aid");
    expect(m.sessionsCreate).not.toHaveBeenCalled();
  });
  it("never makes a payment for a paid or cancelled invoice", async () => {
    for (const status of ["paid", "cancelled"]) {
      m.getInvoice.mockResolvedValue({ ...INV, status, paidOn: status === "paid" ? "2026-11-06" : null });
      const res = await call(postInvoicePay, { params: { token: pageToken() }, body: {} });
      expect(res.statusCode).toBe(409);
      expect(String(res.body)).toContain("Invoice INV-0012");
    }
    expect(m.sessionsCreate).not.toHaveBeenCalled();
  });
  it("never takes Gift Aid for a business, whatever is posted", async () => {
    const ga = { giftAid: "yes", firstName: "Sam", lastName: "Example", houseNameNumber: "1", address: "Made Up Street", postcode: "KA1 1AA" };
    const res = await call(postInvoicePay, { params: { token: pageToken(13) }, body: ga });
    expect(res.statusCode).toBe(303);
    expect(m.saveGiftAid).not.toHaveBeenCalled();
    const g = await call(postInvoiceGiftAid, { params: { token: pageToken(13) }, body: ga });
    expect(g.statusCode).toBe(409);
    expect(m.saveGiftAid).not.toHaveBeenCalled();
  });
  it("says card payments are not working when Stripe fails", async () => {
    m.sessionsCreate.mockRejectedValue(new Error("down"));
    const res = await call(postInvoicePay, { params: { token: pageToken() }, body: {} });
    expect(res.statusCode).toBe(502);
    expect(String(res.body)).toContain("Card payments are not working just now");
  });
});

describe("saving a Gift Aid declaration before a bank transfer", () => {
  it("saves it and shows the page saying so", async () => {
    m.saveGiftAid.mockResolvedValue("saved");
    const ga = { giftAid: "yes", firstName: "Sam", lastName: "Example", houseNameNumber: "1", address: "Made Up Street", postcode: "KA1 1AA" };
    const res = await call(postInvoiceGiftAid, { params: { token: pageToken() }, body: ga });
    expect(res.statusCode).toBe(303);
    expect(res.redirectedTo).toBe(`/invoice/${pageToken()}#pay-h`);
  });
});
