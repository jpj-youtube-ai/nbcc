import { describe, it, expect } from "vitest";
import { buildDonationConfirmation } from "../../src/donors/confirmation";
import { buildRefundConfirmation } from "../../src/donors/confirmation";
import { buildCorporationTaxReceipt } from "../../src/donors/receipt";
import { buildKindEmail } from "../../src/email/templates";
import { emailShell, CHARITY_REGISTRATION } from "../../src/email/brand";
import { CHARITY_NAME, FOOTER_TEXT, OSCR_NUMBER, POSTAL_ADDRESS, REGISTRATION_LINES } from "../../src/legal/registration";

// The readthrough (2026-10-04): a donation receipt carried the charity statement (the two
// registration lines and the postal address) as a paragraph in the BODY of the email. Every other
// email carries it in the maroon footer bar, so the receipt now does too. Section 52 of the
// Charities and Trustee Investment (Scotland) Act 2005 and OSCR's guidance for a SCIO ask for the
// name, "Scottish Charitable Incorporated Organisation" in full and the charity number, and
// TASK-126 pins the two mandated lines "verbatim, do not reword". The footer bar's usual sentence
// is shorter than those lines, so a receipt's footer carries the mandated lines themselves.
// Every name here is invented.

const LINE1 = "Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation.";
const LINE2 = "Scottish Charity Number SC047995. Regulated by the Scottish Charity Regulator, OSCR.";

const count = (s: string, needle: string) => s.split(needle).length - 1;
/** The maroon footer bar: everything from the last table cell on. */
const footerOf = (html: string) => html.slice(html.lastIndexOf("<tr><td style=\"background:#800000"));
const bodyOf = (html: string) => html.slice(0, html.lastIndexOf("<tr><td style=\"background:#800000"));

const base = { fullName: "Sam Example", amountPence: 5000, currency: "GBP", giftAid: false, mode: "once" } as const;
const receipts: Array<[string, Parameters<typeof buildDonationConfirmation>[0]]> = [
  ["an ordinary donation", base],
  ["a Gift Aid donation", { ...base, giftAid: true }],
  ["a monthly donation", { ...base, mode: "monthly" }],
  ["money a fundraiser paid in", { ...base, paidIn: true }],
  ["a paid pledge", { ...base, amountPence: 1000, reference: "NBCC-000123", donationDate: "2026-12-12T12:00:00Z" }],
];
const asSent = (input: Parameters<typeof buildDonationConfirmation>[0]) => {
  const c = buildDonationConfirmation(input);
  return buildKindEmail("donation", { html: c.html, text: c.text });
};

describe.each(receipts)("the receipt for %s", (_what, input) => {
  const mail = asSent(input);

  it("has the mandated lines, word for word, in the maroon footer bar", () => {
    const footer = footerOf(mail.html);
    expect(REGISTRATION_LINES).toEqual([LINE1, LINE2]);
    expect(footer).toContain(LINE1);
    expect(footer).toContain(LINE2);
    expect(footer).toContain(CHARITY_NAME);
    expect(footer).toContain("Scottish Charitable Incorporated Organisation");
    expect(footer).toContain(OSCR_NUMBER);
  });

  it("has the postal address in the footer bar, under the statement", () => {
    const footer = footerOf(mail.html);
    expect(footer).toContain("The Elves&#39; Workshop, Annbank Village Hall, Weston Avenue, Annbank, KA6 5EE");
    expect(footer.indexOf(LINE2)).toBeLessThan(footer.indexOf("KA6 5EE"));
  });

  it("no longer has the statement as a paragraph in the body", () => {
    const body = bodyOf(mail.html);
    expect(body).not.toContain("charity-registration");
    expect(body).not.toContain("Scottish Charitable Incorporated Organisation");
    expect(body).not.toContain(OSCR_NUMBER);
    expect(body).not.toContain("KA6 5EE");
  });

  it("says it once, not twice", () => {
    expect(count(mail.html, LINE1)).toBe(1);
    expect(count(mail.html, OSCR_NUMBER)).toBe(1);
    expect(count(mail.html, "KA6 5EE")).toBe(1);
    // Never the footer bar's shorter sentence as well.
    expect(mail.html).not.toContain(CHARITY_REGISTRATION);
  });

  it("keeps the statement and the address at the bottom of the plain text part", () => {
    expect(mail.text).toContain(FOOTER_TEXT);
    expect(FOOTER_TEXT).toBe(`${LINE1}\n${LINE2}\n${POSTAL_ADDRESS}`);
    expect(count(mail.text, OSCR_NUMBER)).toBe(1);
    // Only the contact line comes after it.
    expect(mail.text.endsWith(`${FOOTER_TEXT}\n\n01292 811 015 · giving@nbcc.scot · nbcc.scot`)).toBe(true);
  });

  it("keeps its subject and its contact", () => {
    expect(mail.subject).toBe("Thank you for your donation to NBCC");
    expect(footerOf(mail.html)).toContain("mailto:giving@nbcc.scot");
  });
});

describe("the shell's footer bar", () => {
  it("carries the mandated lines when asked, escaped, on two lines", () => {
    const html = emailShell("<p>x</p>", { registrationLines: ["One & two.", "Three."], postalAddress: "1 Example Road" });
    expect(html).toContain("One &amp; two.<br />Three.");
    expect(html).not.toContain(CHARITY_REGISTRATION);
  });

  it("is byte for byte as it was for every email that does not ask", () => {
    expect(emailShell("<p>x</p>", { registration: true, postalAddress: "1 Example Road" })).toContain(`${CHARITY_REGISTRATION}</div>`);
    expect(emailShell("<p>x</p>")).not.toContain("Scottish Charitable");
  });
});

// The other emails that carry the statement in their body are left as they are: they are not the
// donation receipt.
describe("the emails this did not change", () => {
  it("leaves the Corporation Tax receipt for a company with the statement in its body", () => {
    const c = buildCorporationTaxReceipt({ legalName: "Example Company Ltd", amountPence: 5000, currency: "GBP", donationDate: "2026-01-05T00:00:00Z" });
    const mail = buildKindEmail("receipt", { html: c.html, text: c.text });
    expect(bodyOf(mail.html)).toContain('class="charity-registration"');
    expect(footerOf(mail.html)).not.toContain(OSCR_NUMBER);
  });

  it("leaves the refund confirmation with the statement in its body", () => {
    const c = buildRefundConfirmation({ fullName: "Sam Example", refundedPence: 5000, currency: "GBP", refundDate: "2026-01-05T00:00:00Z", full: true });
    const mail = buildKindEmail("refund", { html: c.html, text: c.text });
    expect(bodyOf(mail.html)).toContain('class="charity-registration"');
    expect(footerOf(mail.html)).not.toContain(OSCR_NUMBER);
  });
});
