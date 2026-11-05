import { describe, expect, it } from "vitest";
import { renderDonationInvoicePage, type InvoicePageData } from "../../src/invoices/page";

// The invoice page a person opens from their email (invented details throughout).

const bank = { accountName: "Example Charity Account", sortCode: "12-34-56", accountNumber: "12345678" };

const waitingPerson: InvoicePageData = {
  number: "INV-0012",
  token: "12.sig",
  issuedOn: "2026-11-05",
  dueOn: "2026-12-05",
  state: "waiting",
  paidOn: null,
  paidBy: null,
  payerKind: "person",
  contactName: "Sam Example",
  orgName: null,
  address: "1 Made Up Street\nExampletown",
  postcode: "KA1 1AA",
  description: "Donation to NBCC",
  note: "Thank you for your Christmas jumper day",
  amountPence: 25000,
  bank,
  giftAid: null,
  justPaid: false,
  message: null,
};

describe("the invoice page", () => {
  it("shows the number, dates, who it is for, the line, the total and the no VAT line", () => {
    const html = renderDonationInvoicePage(waitingPerson);
    expect(html).toContain("<title>Invoice INV-0012 | NBCC</title>");
    expect(html).toContain("Invoice INV-0012");
    expect(html).toContain("5 November 2026");
    expect(html).toContain("5 December 2026");
    expect(html).toContain("Sam Example");
    expect(html).toContain("1 Made Up Street<br>Exampletown");
    expect(html).toContain("Donation to NBCC");
    expect(html).toContain("£250.00");
    expect(html).toContain("Thank you for your Christmas jumper day");
    expect(html).toContain("NBCC is not registered for VAT. This is a donation, so no VAT is due.");
    expect(html).toContain("SC047995");
  });

  it("offers card payment and bank transfer with the invoice number as the reference", () => {
    const html = renderDonationInvoicePage(waitingPerson);
    expect(html).toContain('action="/invoice/12.sig/pay"');
    expect(html).toContain("Pay by card");
    expect(html).toContain("12-34-56");
    expect(html).toContain("12345678");
    expect(html).toMatch(/reference[^<]*<b>INV-0012<\/b>/i);
  });

  it("offers card only when there are no bank details", () => {
    const html = renderDonationInvoicePage({ ...waitingPerson, bank: null });
    expect(html).toContain("Pay by card");
    expect(html).not.toContain("bank transfer");
  });

  it("offers a person Gift Aid with the HMRC words, and a business never", () => {
    const html = renderDonationInvoicePage(waitingPerson);
    expect(html).toContain('name="giftAid"');
    expect(html).toContain("I am a UK taxpayer");
    expect(html).toContain('action="/invoice/12.sig/gift-aid"');
    const biz = renderDonationInvoicePage({ ...waitingPerson, payerKind: "business", orgName: "Example Joinery Ltd" });
    expect(biz).not.toContain('name="giftAid"');
    expect(biz).not.toContain("/gift-aid");
    expect(biz).toContain("Example Joinery Ltd");
    const group = renderDonationInvoicePage({ ...waitingPerson, payerKind: "group", orgName: "Example Primary School" });
    expect(group).not.toContain('name="giftAid"');
  });

  it("says a saved Gift Aid declaration is saved, and fills in its details", () => {
    const html = renderDonationInvoicePage({
      ...waitingPerson,
      giftAid: { firstName: "Sam", lastName: "Example", houseNameNumber: "1", address: "Made Up Street, Exampletown", postcode: "KA1 1AA", nonUk: false },
    });
    expect(html).toContain("Your Gift Aid declaration is saved");
    expect(html).toContain('value="Made Up Street, Exampletown"');
    expect(html).toMatch(/name="giftAid"[^>]*checked/);
  });

  it("once paid, shows a Paid stamp and no way to pay", () => {
    const html = renderDonationInvoicePage({ ...waitingPerson, state: "paid", paidOn: "2026-11-20", paidBy: "card" });
    expect(html).toContain("Paid on 20 November 2026");
    expect(html).not.toContain("/pay");
    expect(html).not.toContain('name="giftAid"');
    expect(html).not.toContain("12345678");
  });

  it("once cancelled, says so and shows no payment details", () => {
    const html = renderDonationInvoicePage({ ...waitingPerson, state: "cancelled" });
    expect(html).toContain("This invoice has been cancelled");
    expect(html).not.toContain("/pay");
    expect(html).not.toContain("12345678");
  });

  it("thanks someone just back from paying while the payment is confirmed", () => {
    const html = renderDonationInvoicePage({ ...waitingPerson, justPaid: true });
    expect(html).toContain("Thank you. Your payment is being confirmed and this page will say Paid shortly.");
    expect(html).not.toContain("Pay by card");
  });

  it("shows overdue invoices as still payable, and a message when there is one", () => {
    const html = renderDonationInvoicePage({ ...waitingPerson, state: "overdue", message: "Please check the Gift Aid details." });
    expect(html).toContain("Pay by card");
    expect(html).toContain("Please check the Gift Aid details.");
  });

  it("escapes everything staff or the payer typed", () => {
    const html = renderDonationInvoicePage({
      ...waitingPerson,
      contactName: "<script>x</script>",
      note: '"><img src=x>',
      description: "<b>bold</b>",
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;script&gt;");
  });
});
