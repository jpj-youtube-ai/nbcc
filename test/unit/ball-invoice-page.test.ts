import { describe, it, expect } from "vitest";
import { renderInvoicePage, type InvoicePageData } from "../../src/ball/invoice-page";

// TASK-486: the printable invoice for a Festive Ball booking paid by bank transfer. Every name,
// address and number here is invented: this repository is public.

const invoice: InvoicePageData = {
  reference: "BALL-7KQ2MZ",
  issuedOn: "2026-10-01",
  payBy: "2026-10-15",
  status: "pending",
  paidOn: null,
  company: "Ayrshire Example Ltd",
  address: "1 Example Street\nKilmarnock\nKA1 1AA",
  po: "PO-123",
  buyerName: "Ada Test",
  kind: "table",
  quantity: 1,
  seats: 10,
  ticketsPence: 100_000,
  donationPence: 2_500,
  totalPence: 102_500,
  bank: { accountName: "Night Before Christmas Campaign", sortCode: "12-34-56", accountNumber: "12345678" },
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the invoice", () => {
  const html = renderInvoicePage(invoice);
  const t = text(html);

  it("is numbered with the booking reference and dated the day it was booked", () => {
    expect(t).toContain("Invoice BALL-7KQ2MZ");
    expect(t).toContain("1 October 2026");
  });

  it("comes from the charity, with its number and registered address", () => {
    expect(t).toContain("Night Before Christmas Campaign");
    expect(t).toContain("SC047995");
    expect(t).toContain("Annbank");
  });

  it("is made out to the company, at its address, with its purchase order", () => {
    expect(t).toContain("Ayrshire Example Ltd");
    expect(html).toContain("1 Example Street<br />Kilmarnock<br />KA1 1AA");
    expect(t).toContain("PO-123");
    expect(t).toContain("Ada Test");
  });

  it("lists the tickets and the donation separately, then the total", () => {
    expect(t).toContain("Festive Ball 2026");
    expect(t).toContain("a table of 10");
    expect(t).toContain("£1,000.00");
    expect(t).toContain("Donation to NBCC");
    expect(t).toContain("£25.00");
    expect(t).toContain("£1,025.00");
  });

  it("says the charity is not registered for VAT", () => {
    expect(t).toContain("Not registered for VAT");
  });

  it("says how to pay and by when", () => {
    for (const part of ["15 October 2026", "12-34-56", "12345678", "Night Before Christmas Campaign", "BALL-7KQ2MZ"]) {
      expect(t, part).toContain(part);
    }
  });

  it("can be printed, and is kept out of search engines", () => {
    expect(html).toContain("window.print()");
    expect(html).toContain("@media print");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"');
  });

  it("leaves out what was not given", () => {
    const plain = text(renderInvoicePage({ ...invoice, po: null, donationPence: 0, totalPence: 100_000 }));
    expect(plain).not.toContain("Purchase order");
    expect(plain).not.toContain("Donation to NBCC");
  });

  it("escapes what the buyer typed", () => {
    const html2 = renderInvoicePage({ ...invoice, company: "<script>x</script>", address: "<b>1</b>" });
    expect(html2).not.toContain("<script>x</script>");
    expect(html2).not.toContain("<b>1</b>");
  });
});

describe("the invoice once it is settled", () => {
  it("says Paid, and on which day, and no longer asks for payment", () => {
    const t = text(renderInvoicePage({ ...invoice, status: "paid", paidOn: "2026-10-09" }));
    expect(t).toContain("Paid");
    expect(t).toContain("9 October 2026");
    expect(t).not.toContain("Please pay by");
  });

  it("says Cancelled, and gives no bank details", () => {
    const t = text(renderInvoicePage({ ...invoice, status: "cancelled" }));
    expect(t).toContain("This invoice has been cancelled");
    expect(t).not.toContain("12345678");
  });
});

describe("the invoice's wording", () => {
  it("uses no long dashes", () => {
    expect(renderInvoicePage(invoice)).not.toMatch(/—|–|&mdash;|&ndash;/);
  });
});
