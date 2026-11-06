import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// A card payment on an invoice, as Stripe reports it, and what it records (invented details).

const h = vi.hoisted(() => ({
  insertDonorAndDonation: vi.fn(),
  insertAudit: vi.fn(),
  sends: [] as string[],
  payDetailsLater: vi.fn(),
}));

vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    PORTAL_BASE_URL: "https://nbcc.scot",
    MAIL_FROM: "noreply@example.com",
    GIVING_FROM_EMAIL: "giving@example.com",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/db/donations", () => ({
  insertDonorAndDonation: h.insertDonorAndDonation,
  insertAudit: h.insertAudit,
  writeWithAudit: vi.fn(),
}));
// The Donations gift log's "how they paid" look up (proved in donation-pay-details.test.ts).
vi.mock("../../src/db/donation-pay-details", () => ({ payDetailsLater: h.payDetailsLater }));
vi.mock("../../src/clients/email", () => ({
  sendDonationConfirmation: vi.fn(async (m: { html?: string }) => void h.sends.push(`donation:${m.html?.includes("This pays invoice") ? "invoice" : "plain"}`)),
  sendCompanyReceipt: vi.fn(async () => void h.sends.push("receipt")),
  sendInvoiceReceipt: vi.fn(async () => void h.sends.push("invoiceReceipt")),
  sendInvoiceStaff: vi.fn(async () => void h.sends.push("invoiceStaff")),
}));

import { settleInvoice } from "../../src/db/invoices";
import { handleInvoiceEvent } from "../../src/invoices/webhook";

const ga = { firstName: "Sam", lastName: "Example", houseNameNumber: "1", address: "Made Up Street, Exampletown", postcode: "KA1 1AA", nonUk: false };

function invoiceRow(over: Record<string, unknown> = {}) {
  return {
    id: 12,
    payer_kind: "person",
    contact_name: "Sam Example",
    org_name: null,
    email: "sam@example.com",
    address: null,
    postcode: null,
    consideration_given: null,
    description: "Donation to NBCC",
    note: null,
    amount_pence: 2500,
    issued_on: "2026-11-05",
    due_on: "2026-12-05",
    status: "waiting",
    paid_on: null,
    paid_by: null,
    donation_id: null,
    cancelled_at: null,
    paid_twice_at: null,
    gift_aid: null,
    gift_aid_at: null,
    send_count: 1,
    last_sent_at: null,
    created_by: "admin:staff@example.com",
    created_at: "2026-11-05T10:00:00Z",
    ...over,
  };
}

/** A pretend transaction: answers the invoice row and the "already recorded" check, and remembers every statement. */
function fakeClient(row: Record<string, unknown> | null, alreadyRecorded = false) {
  const sql: string[] = [];
  let current = row;
  const client = {
    sql,
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      sql.push(text);
      if (/FROM donation_invoices WHERE id = \$1 FOR UPDATE/.test(text)) return { rows: current ? [current] : [] };
      if (/FROM donations WHERE invoice_id/.test(text)) return { rows: alreadyRecorded ? [{ id: 77 }] : [] };
      if (/UPDATE donation_invoices SET status = 'paid'/.test(text)) {
        current = { ...current, status: "paid", paid_on: params[1], paid_by: params[2], donation_id: params[3] };
        return { rows: [current] };
      }
      if (/UPDATE donation_invoices SET paid_twice_at/.test(text)) {
        current = { ...current, paid_twice_at: "2026-11-21T10:00:00Z" };
        return { rows: [current] };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
  return client;
}

const card = { by: "card" as const, paidOn: "2026-11-20", sessionId: "cs_test_1", paymentIntentId: "pi_test_1", actor: "stripe" };

beforeEach(() => {
  h.insertDonorAndDonation.mockReset().mockResolvedValue({ donorId: 5, donationId: 321, declarationId: null, partnerShareIds: [] });
  h.insertAudit.mockReset().mockResolvedValue(undefined);
  h.sends.length = 0;
  h.payDetailsLater.mockReset();
});

describe("settling an invoice", () => {
  it("records one donation, labelled with its invoice, and marks the invoice paid", async () => {
    const c = fakeClient(invoiceRow());
    const out = await settleInvoice(c as never, 12, card);
    expect(out?.outcome).toBe("paid");
    expect(out?.donationId).toBe(321);
    expect(h.insertDonorAndDonation).toHaveBeenCalledTimes(1);
    expect(c.sql.some((s) => /UPDATE donations SET source = 'invoice', invoice_id = \$2/.test(s))).toBe(true);
    expect(out?.invoice.status).toBe("paid");
    expect(out?.invoice.paidBy).toBe("card");
    expect(h.insertAudit.mock.calls.map((a) => a[1].action)).toContain("invoice.paid");
  });

  it("records nothing for a Stripe session already recorded against the invoice", async () => {
    const c = fakeClient(invoiceRow({ status: "paid" }), true);
    const out = await settleInvoice(c as never, 12, card);
    expect(out?.outcome).toBe("already-recorded");
    expect(h.insertDonorAndDonation).not.toHaveBeenCalled();
  });

  it("records a second real payment as its own donation and flags the invoice", async () => {
    const c = fakeClient(invoiceRow({ status: "paid", paid_by: "transfer", donation_id: 300 }));
    const out = await settleInvoice(c as never, 12, card);
    expect(out?.outcome).toBe("paid-twice");
    expect(h.insertDonorAndDonation).toHaveBeenCalledTimes(1);
    expect(out?.invoice.paidTwiceAt).not.toBeNull();
    expect(h.insertAudit.mock.calls.map((a) => a[1].action)).toContain("invoice.paid_twice");
  });

  it("records a payment that came in after cancelling", async () => {
    const c = fakeClient(invoiceRow({ status: "cancelled", cancelled_at: "2026-11-19T10:00:00Z" }));
    const out = await settleInvoice(c as never, 12, card);
    expect(out?.outcome).toBe("paid-after-cancel");
    expect(out?.invoice.status).toBe("paid");
  });

  it("passes a person's saved Gift Aid declaration with the gift", async () => {
    const c = fakeClient(invoiceRow({ gift_aid: ga }));
    await settleInvoice(c as never, 12, card);
    const [, , donation, declaration] = h.insertDonorAndDonation.mock.calls[0];
    expect(donation.giftAid).toBe(true);
    expect(declaration.fields).toEqual(ga);
  });

  it("never passes Gift Aid for a business, even if some was stored", async () => {
    const c = fakeClient(
      invoiceRow({ payer_kind: "business", org_name: "Example Joinery Ltd", address: "1 Made Up Street", postcode: "KA1 1AA", consideration_given: false, gift_aid: ga }),
    );
    await settleInvoice(c as never, 12, card);
    const [, , donation, declaration] = h.insertDonorAndDonation.mock.calls[0];
    expect(donation.donorType).toBe("company");
    expect(donation.giftAid).toBe(false);
    expect(declaration).toBeUndefined();
  });

  it("is null for an invoice that is not there", async () => {
    expect(await settleInvoice(fakeClient(null) as never, 99, card)).toBeNull();
  });
});

describe("which receipt goes once it is paid", () => {
  it("a person gets the usual donation receipt with the invoice line", async () => {
    const out = await settleInvoice(fakeClient(invoiceRow()) as never, 12, card);
    await out?.receipt();
    expect(h.sends).toEqual(["donation:invoice"]);
  });
  it("a business gets the Corporation Tax receipt", async () => {
    const out = await settleInvoice(
      fakeClient(invoiceRow({ payer_kind: "business", org_name: "Example Joinery Ltd", consideration_given: false })) as never,
      12,
      card,
    );
    await out?.receipt();
    expect(h.sends).toEqual(["receipt"]);
  });
  it("a business we give something to gets no receipt and is flagged for the trustees", async () => {
    const out = await settleInvoice(
      fakeClient(invoiceRow({ payer_kind: "business", org_name: "Example Joinery Ltd", consideration_given: true })) as never,
      12,
      card,
    );
    await out?.receipt();
    expect(h.sends).toEqual([]);
    expect(h.insertAudit.mock.calls.map((a) => a[1].action)).toContain("donation.flagged_for_trustees");
  });
  it("a group gets the plain receipt", async () => {
    const out = await settleInvoice(fakeClient(invoiceRow({ payer_kind: "group", org_name: "Example Primary School" })) as never, 12, card);
    await out?.receipt();
    expect(h.sends).toEqual(["invoiceReceipt"]);
  });
});

function completed(metadata: Record<string, string>, over: Partial<Stripe.Checkout.Session> = {}): Stripe.Event {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        payment_status: "paid",
        payment_intent: "pi_test_1",
        created: Math.floor(new Date("2026-11-20T10:00:00Z").getTime() / 1000),
        metadata,
        ...over,
      },
    },
  } as unknown as Stripe.Event;
}

describe("the Stripe webhook's invoice step", () => {
  it("leaves every other payment alone", async () => {
    const c = fakeClient(invoiceRow());
    expect(await handleInvoiceEvent(c as never, completed({ product: "elf_school" }))).toBeNull();
    expect(await handleInvoiceEvent(c as never, completed({}))).toBeNull();
    expect(await handleInvoiceEvent(c as never, { ...completed({ product: "donation_invoice", invoiceId: "12" }), type: "charge.refunded" } as Stripe.Event)).toBeNull();
    expect(c.query).not.toHaveBeenCalled();
  });

  it("settles a paid invoice session by card on the UK day it was paid, and sends the receipt after", async () => {
    const c = fakeClient(invoiceRow());
    const r = await handleInvoiceEvent(c as never, completed({ product: "donation_invoice", invoiceId: "12" }));
    expect(r?.action).toBe("invoice.paid");
    expect(h.sends).toEqual([]);
    await r?.afterCommit?.();
    expect(h.sends).toContain("donation:invoice");
    const paid = c.sql.find((s) => /SET status = 'paid'/.test(s));
    expect(paid).toBeDefined();
  });

  it("does nothing for a session that is not paid, or an invoice that is not there", async () => {
    expect((await handleInvoiceEvent(fakeClient(invoiceRow()) as never, completed({ product: "donation_invoice", invoiceId: "12" }, { payment_status: "unpaid" })))?.action).toBe(
      "invoice.not_paid",
    );
    expect((await handleInvoiceEvent(fakeClient(null) as never, completed({ product: "donation_invoice", invoiceId: "12" })))?.action).toBe("invoice.unknown");
    expect((await handleInvoiceEvent(fakeClient(null) as never, completed({ product: "donation_invoice", invoiceId: "x" })))?.action).toBe("invoice.unknown");
  });

  it("tells the giving inbox after a second payment", async () => {
    const r = await handleInvoiceEvent(fakeClient(invoiceRow({ status: "paid", donation_id: 300 })) as never, completed({ product: "donation_invoice", invoiceId: "12" }));
    expect(r?.action).toBe("invoice.paid_twice");
  });
});

// The Donations gift log: how an invoice was paid.
describe("how an invoice was paid, for the gift log", () => {
  const donationUpdate = (c: ReturnType<typeof fakeClient>) =>
    c.query.mock.calls.find(([text]) => /UPDATE donations SET source = 'invoice'/.test(text));

  it("a bank transfer is noted as one on its donation, in the same statement that labels it, and marked as checked", async () => {
    const c = fakeClient(invoiceRow());
    await settleInvoice(c as never, 12, { ...card, by: "transfer", sessionId: null, paymentIntentId: null });
    const [text, params] = donationUpdate(c) ?? [];
    const flat = String(text).replace(/\s+/g, " ");
    expect(flat).toContain("pay_method = CASE WHEN $3 = 'transfer' THEN 'bank_transfer' ELSE pay_method END");
    expect(flat).toContain("pay_checked_at = CASE WHEN $3 = 'transfer' THEN now() ELSE pay_checked_at END");
    expect(params).toEqual([321, 12, "transfer", "2026-11-20"]);
  });

  it("a card payment is left for Stripe to tell, after the commit and without waiting", async () => {
    const c = fakeClient(invoiceRow());
    const r = await handleInvoiceEvent(c as never, completed({ product: "donation_invoice", invoiceId: "12" }));
    expect(h.payDetailsLater).not.toHaveBeenCalled();
    await r?.afterCommit?.();
    expect(h.payDetailsLater.mock.calls).toEqual([[321]]);
    const [, params] = donationUpdate(c) ?? [];
    expect((params as unknown[])[2]).toBe("card");
  });

  it("a second card payment is looked up too, and a redelivery is not", async () => {
    const twice = await handleInvoiceEvent(fakeClient(invoiceRow({ status: "paid", donation_id: 300 })) as never, completed({ product: "donation_invoice", invoiceId: "12" }));
    await twice?.afterCommit?.();
    expect(h.payDetailsLater.mock.calls).toEqual([[321]]);
    h.payDetailsLater.mockReset();
    const again = await handleInvoiceEvent(fakeClient(invoiceRow({ status: "paid" }), true) as never, completed({ product: "donation_invoice", invoiceId: "12" }));
    expect(again?.afterCommit).toBeNull();
    expect(h.payDetailsLater).not.toHaveBeenCalled();
  });

  it("the receipt still goes when the look up cannot even start", async () => {
    h.payDetailsLater.mockImplementation(() => {
      throw new Error("could not start");
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await handleInvoiceEvent(fakeClient(invoiceRow()) as never, completed({ product: "donation_invoice", invoiceId: "12" }));
    await expect(r?.afterCommit?.()).resolves.toBeUndefined();
    expect(h.sends).toContain("donation:invoice");
    expect(errorLog).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
  });
});

// Final review, Critical 1: Mark paid pressed twice must never record one transfer twice.
describe("Mark paid pressed twice", () => {
  it("refuses, inside the lock, an invoice that is already paid when asked to", async () => {
    const c = fakeClient(invoiceRow({ status: "paid", paid_by: "transfer", donation_id: 300 }));
    const out = await settleInvoice(c as never, 12, { ...card, by: "transfer", sessionId: null, paymentIntentId: null, refuseIfPaid: true });
    expect(out?.outcome).toBe("refused");
    expect(h.insertDonorAndDonation).not.toHaveBeenCalled();
  });
});

// Final review, Important 3: a second payment is usually a mistake to refund, so it is never Gift Aided.
describe("a second payment and Gift Aid", () => {
  it("records a second payment without Gift Aid, even for a person who saved a declaration", async () => {
    const c = fakeClient(invoiceRow({ status: "paid", donation_id: 300, gift_aid: ga }));
    await settleInvoice(c as never, 12, card);
    const [, , donation, declaration] = h.insertDonorAndDonation.mock.calls[0];
    expect(donation.giftAid).toBe(false);
    expect(declaration).toBeUndefined();
  });
});
