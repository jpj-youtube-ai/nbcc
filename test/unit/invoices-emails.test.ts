import { describe, expect, it } from "vitest";
import { buildGroupReceiptEmail, buildInvoiceEmail, buildInvoicesPaidTwiceNote, invoiceLink } from "../../src/invoices/emails";
import { ABOUT_NBCC_SHORT } from "../../src/email/brand";

// The invoice emails (invented details throughout).

describe("the invoice email", () => {
  const email = buildInvoiceEmail({
    number: "INV-0012",
    contactName: "Sam Example",
    orgName: null,
    amountPence: 25000,
    description: "Donation to NBCC",
    note: "Thank you for your Christmas jumper day",
    dueOn: "2026-12-05",
    link: "https://nbcc.scot/invoice/12.sig",
  });

  it("has the subject, the amount, the due date and a button to the invoice", () => {
    expect(email.subject).toBe("Your invoice from NBCC: INV-0012");
    expect(email.html).toContain("Hello Sam Example,");
    expect(email.html).toContain("£250");
    expect(email.html).toContain("Donation to NBCC");
    expect(email.html).toContain("5<sup");
    expect(email.html).toContain('href="https://nbcc.scot/invoice/12.sig"');
    expect(email.html).toContain("View and pay your invoice");
    expect(email.text).toContain("https://nbcc.scot/invoice/12.sig");
    expect(email.text).toContain("5th December 2026");
  });

  it("says who NBCC is, carries the note, and the questions box", () => {
    expect(email.html).toContain(ABOUT_NBCC_SHORT);
    expect(email.text).toContain(ABOUT_NBCC_SHORT);
    expect(email.html).toContain("Thank you for your Christmas jumper day");
    expect(email.html).toContain("Got any questions?");
  });

  it("names the business when it is for one, and leaves out an empty note", () => {
    const biz = buildInvoiceEmail({
      number: "INV-0013",
      contactName: "Alex Sample",
      orgName: "Example Joinery Ltd",
      amountPence: 50000,
      description: "Donation to NBCC",
      note: null,
      dueOn: "2026-12-05",
      link: "https://nbcc.scot/invoice/13.sig",
    });
    expect(biz.html).toContain("Example Joinery Ltd");
    expect(biz.text).not.toContain("null");
  });

  it("escapes what staff typed", () => {
    const e = buildInvoiceEmail({
      number: "INV-0014",
      contactName: "<b>Sam</b>",
      orgName: null,
      amountPence: 100,
      description: "<i>x</i>",
      note: "<script>",
      dueOn: "2026-12-05",
      link: "https://nbcc.scot/invoice/14.sig",
    });
    expect(e.html).not.toContain("<b>Sam</b>");
    expect(e.html).not.toContain("<i>x</i>");
    expect(e.html).not.toContain("<script>");
  });
});

describe("the group receipt", () => {
  it("thanks the group, names the invoice and links to it, with no tax wording", () => {
    const r = buildGroupReceiptEmail({
      number: "INV-0012",
      orgName: "Example Primary School",
      contactName: "Sam Example",
      amountPence: 32050,
      paidOn: "2026-11-20",
      link: "https://nbcc.scot/invoice/12.sig",
      reference: "NBCC-000321",
    });
    expect(r.subject).toBe("Thank you: invoice INV-0012 is paid");
    expect(r.html).toContain("This pays invoice INV-0012. Thank you.");
    expect(r.html).toContain("Example Primary School");
    expect(r.html).toContain("£320.50");
    expect(r.html).toContain("NBCC-000321");
    expect(r.html).toContain('href="https://nbcc.scot/invoice/12.sig"');
    expect(r.html).not.toMatch(/Corporation Tax|Gift Aid/);
    expect(r.text).toContain("This pays invoice INV-0012. Thank you.");
  });
});

describe("the paid twice note to staff", () => {
  it("lists each invoice paid twice and asks staff to refund one", () => {
    const n = buildInvoicesPaidTwiceNote([
      { number: "INV-0012", orgOrName: "Example Joinery Ltd", amountPence: 50000 },
      { number: "INV-0015", orgOrName: "Sam Example", amountPence: 2500 },
    ]);
    expect(n.subject).toBe("2 invoices paid twice: check and refund");
    expect(n.lines.join("\n")).toContain("INV-0012");
    expect(n.lines.join("\n")).toContain("Example Joinery Ltd");
    expect(n.lines.join("\n")).toContain("£25");
    expect(buildInvoicesPaidTwiceNote([{ number: "INV-0001", orgOrName: "A", amountPence: 100 }]).subject).toBe(
      "1 invoice paid twice: check and refund",
    );
  });
});

describe("the link", () => {
  it("is the site address with the private token", () => {
    expect(invoiceLink("12.sig", "https://nbcc.scot/")).toBe("https://nbcc.scot/invoice/12.sig");
  });
});
