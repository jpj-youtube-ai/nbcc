import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESCRIPTION,
  defaultDueOn,
  displayState,
  invoiceNumber,
  parseAmountPence,
  parseInvoiceInput,
} from "../../src/invoices/model";
import { signDonationInvoiceToken, verifyDonationInvoiceToken } from "../../src/invoices/token";
import { signInvoiceToken } from "../../src/ball/invoice-token";
import { buildInvoiceSessionParams } from "../../src/invoices/checkout";

// Invoices for donations: the pure rules (docs/superpowers/specs/2026-11-05-donation-invoices-design.md).
// Every name and address here is invented.

const TODAY = "2026-11-05";

const person = {
  payerKind: "person",
  contactName: "Sam Example",
  email: "sam@example.com",
  amount: "50",
  description: "Donation to NBCC",
  dueOn: "2026-12-05",
};
const business = {
  payerKind: "business",
  contactName: "Alex Sample",
  orgName: "Example Joinery Ltd",
  email: "accounts@example.com",
  address: "1 Made Up Street\nExampletown",
  postcode: "KA1 1AA",
  considerationGiven: false,
  amount: "500",
  description: "Donation to NBCC",
  dueOn: "2026-12-05",
};

describe("invoice numbers", () => {
  it("pads to four figures and keeps longer numbers whole", () => {
    expect(invoiceNumber(12)).toBe("INV-0012");
    expect(invoiceNumber(1)).toBe("INV-0001");
    expect(invoiceNumber(12345)).toBe("INV-12345");
  });
});

describe("amounts typed in the admin", () => {
  it("reads pounds with commas, a pound sign or pence", () => {
    expect(parseAmountPence("£1,250.50")).toBe(125050);
    expect(parseAmountPence("1250.5")).toBe(125050);
    expect(parseAmountPence("50")).toBe(5000);
    expect(parseAmountPence(25)).toBe(2500);
  });
  it("refuses nothing, zero, words, three decimals and more than £50,000", () => {
    for (const bad of ["", "0", "abc", "10.505", "50000.01", "-5", null, undefined]) {
      expect(parseAmountPence(bad)).toBeNull();
    }
    expect(parseAmountPence("50000")).toBe(5_000_000);
    expect(parseAmountPence("0.99")).toBeNull();
  });
});

describe("the send form", () => {
  it("accepts a person with only the essentials", () => {
    const r = parseInvoiceInput(person, TODAY);
    expect(r).toEqual({
      ok: true,
      value: {
        payerKind: "person",
        contactName: "Sam Example",
        orgName: null,
        email: "sam@example.com",
        address: null,
        postcode: null,
        considerationGiven: null,
        description: "Donation to NBCC",
        note: null,
        amountPence: 5000,
        dueOn: "2026-12-05",
      },
    });
  });

  it("accepts a business with its name, address and the something in return answer", () => {
    const r = parseInvoiceInput(business, TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.orgName).toBe("Example Joinery Ltd");
      expect(r.value.considerationGiven).toBe(false);
      expect(r.value.postcode).toBe("KA1 1AA");
    }
  });

  it("names the field that is wrong", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...person, payerKind: "robot" }, "payerKind"],
      [{ ...person, contactName: " " }, "contactName"],
      [{ ...person, email: "not an email" }, "email"],
      [{ ...person, amount: "abc" }, "amount"],
      [{ ...person, description: "" }, "description"],
      [{ ...person, description: "x".repeat(121) }, "description"],
      [{ ...person, note: "x".repeat(501) }, "note"],
      [{ ...person, dueOn: "2026-11-04" }, "dueOn"],
      [{ ...person, dueOn: "2026-02-30" }, "dueOn"],
      [{ ...person, postcode: "NOT A CODE" }, "postcode"],
      [{ ...business, orgName: "" }, "orgName"],
      [{ ...business, address: "" }, "address"],
      [{ ...business, postcode: "" }, "postcode"],
      [{ ...business, considerationGiven: undefined }, "considerationGiven"],
      [{ ...business, payerKind: "group", orgName: "" }, "orgName"],
    ];
    for (const [body, field] of cases) {
      const r = parseInvoiceInput(body, TODAY);
      expect(r.ok, `${field} should be refused`).toBe(false);
      if (!r.ok) {
        expect(r.field).toBe(field);
        expect(r.error.length).toBeGreaterThan(5);
      }
    }
  });

  it("never keeps the something in return answer for a person or a group", () => {
    const r = parseInvoiceInput({ ...business, payerKind: "group", considerationGiven: true }, TODAY);
    expect(r.ok && r.value.considerationGiven).toBe(null);
    const p = parseInvoiceInput({ ...person, orgName: "Ignored Ltd", considerationGiven: true }, TODAY);
    expect(p.ok && p.value.considerationGiven).toBe(null);
    expect(p.ok && p.value.orgName).toBe(null);
  });

  it("starts with the usual line and a due date 30 days on", () => {
    expect(DEFAULT_DESCRIPTION).toBe("Donation to NBCC");
    expect(defaultDueOn("2026-11-05")).toBe("2026-12-05");
    expect(defaultDueOn("2026-12-15")).toBe("2027-01-14");
  });
});

describe("what state an invoice is in", () => {
  const base = { status: "waiting" as const, dueOn: "2026-11-10", cancelledAt: null };
  it("is overdue only while waiting and after its due date", () => {
    expect(displayState(base, "2026-11-10")).toBe("waiting");
    expect(displayState(base, "2026-11-11")).toBe("overdue");
    expect(displayState({ ...base, status: "paid" }, "2026-12-01")).toBe("paid");
    expect(displayState({ ...base, status: "cancelled", cancelledAt: "2026-11-06T10:00:00Z" }, "2026-12-01")).toBe("cancelled");
  });
  it("says when it was paid after it was cancelled", () => {
    expect(displayState({ ...base, status: "paid", cancelledAt: "2026-11-06T10:00:00Z" }, "2026-11-07")).toBe("paid-after-cancel");
  });
});

describe("the private link", () => {
  const secret = "test-secret";
  it("opens its own invoice only", () => {
    const t = signDonationInvoiceToken(7, secret);
    expect(verifyDonationInvoiceToken(t, secret)).toBe(7);
    const [, sig] = t.split(".");
    expect(() => verifyDonationInvoiceToken(`8.${sig}`, secret)).toThrow();
    expect(() => verifyDonationInvoiceToken(t, "another-secret")).toThrow();
    expect(() => verifyDonationInvoiceToken("rubbish", secret)).toThrow();
  });
  it("never accepts a Festive Ball invoice link", () => {
    expect(() => verifyDonationInvoiceToken(signInvoiceToken(7, secret), secret)).toThrow();
  });
});

describe("the card payment", () => {
  it("asks Stripe for exactly this invoice, by card, and comes back to the invoice", () => {
    const p = buildInvoiceSessionParams({
      invoiceId: 12,
      number: "INV-0012",
      amountPence: 50000,
      description: "Donation to NBCC",
      email: "accounts@example.com",
      baseUrl: "https://nbcc.scot/",
      token: "12.abc",
      now: new Date("2026-11-05T12:00:00Z"),
    });
    expect(p.mode).toBe("payment");
    expect(p.payment_method_types).toEqual(["card"]);
    expect(p.line_items).toEqual([
      { quantity: 1, price_data: { currency: "gbp", unit_amount: 50000, product_data: { name: "Invoice INV-0012: Donation to NBCC" } } },
    ]);
    expect(p.customer_email).toBe("accounts@example.com");
    expect(p.metadata).toEqual({ product: "donation_invoice", invoiceId: "12" });
    expect(p.payment_intent_data?.metadata).toEqual({ product: "donation_invoice", invoiceId: "12" });
    expect(p.success_url).toBe("https://nbcc.scot/invoice/12.abc?paid=1");
    expect(p.cancel_url).toBe("https://nbcc.scot/invoice/12.abc");
    expect(p.expires_at).toBe(Math.floor(new Date("2026-11-05T12:31:00Z").getTime() / 1000));
  });
});
