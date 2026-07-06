import { describe, it, expect } from "vitest";
import {
  buildCorporationTaxReceipt,
  buildCompanyRefundNotice,
  classifyCompanyGift,
  OSCR_NUMBER,
  GENUINE_DONATION_STATEMENT,
  NO_GIFT_AID_STATEMENT,
} from "../../src/donors/receipt";

// TASK-086 (REQ-038/REQ-053): the pure, DB-free Corporation Tax receipt content builder for a
// company donation. A company gift is never Gift Aided; instead the company claims Corporation
// Tax relief on a qualifying charitable donation, which needs a receipt carrying NBCC's identity
// (name + OSCR number), the amount/date, a genuine-donation (nothing given in return) statement
// and a no-Gift-Aid statement. The companion guard classifyCompanyGift flags a gift with
// consideration for the trustees instead of issuing a receipt. Pure like src/donors/company.ts.

// Reuses the company fixture legal name from company-donation.test.ts.
const input = {
  legalName: "Acme Ltd",
  amountPence: 100000,
  currency: "GBP",
  donationDate: "2025-12-24T10:00:00.000Z",
};

describe("buildCorporationTaxReceipt (REQ-053)", () => {
  it("returns text and HTML", () => {
    const receipt = buildCorporationTaxReceipt(input);
    expect(typeof receipt.text).toBe("string");
    expect(typeof receipt.html).toBe("string");
    expect(receipt.text.length).toBeGreaterThan(0);
    expect(receipt.html).toContain("<");
  });

  it("names NBCC and carries the OSCR registration SC047995", () => {
    const receipt = buildCorporationTaxReceipt(input);
    for (const content of [receipt.text, receipt.html]) {
      expect(content).toContain("NBCC");
      expect(content).toContain("SC047995");
      expect(content).toContain(OSCR_NUMBER);
    }
  });

  it("states it is a genuine donation with nothing of value given in return", () => {
    const receipt = buildCorporationTaxReceipt(input);
    expect(receipt.text).toContain(GENUINE_DONATION_STATEMENT);
    expect(receipt.text.toLowerCase()).toContain("nothing of value in return");
    expect(receipt.html).toContain("nothing of value in return");
  });

  it("states NBCC has not and will not claim Gift Aid on the donation", () => {
    const receipt = buildCorporationTaxReceipt(input);
    expect(receipt.text).toContain(NO_GIFT_AID_STATEMENT);
    expect(receipt.text.toLowerCase()).toContain("not claimed and will not claim gift aid");
  });

  it("carries the canonical charity-registration line (text + html)", () => {
    const receipt = buildCorporationTaxReceipt(input);
    expect(receipt.text).toContain(
      "known as NBCC, is a Scottish Charitable Incorporated Organisation.",
    );
    expect(receipt.text).toContain("Regulated by the Scottish Charity Regulator, OSCR.");
    expect(receipt.html).toContain('class="charity-registration"');
  });

  it("includes the donor legal name, the amount and the donation date (DD/MM/YYYY)", () => {
    const receipt = buildCorporationTaxReceipt(input);
    expect(receipt.text).toContain("Acme Ltd");
    expect(receipt.text).toContain("£1000.00");
    expect(receipt.text).toContain("24/12/2025");
  });

  it("formats a non-GBP amount with its currency code", () => {
    const receipt = buildCorporationTaxReceipt({ ...input, currency: "USD", amountPence: 2500 });
    expect(receipt.text).toContain("25.00 USD");
  });

  it("accepts a Date instance for the donation date", () => {
    const receipt = buildCorporationTaxReceipt({ ...input, donationDate: new Date("2026-01-05T00:00:00Z") });
    expect(receipt.text).toContain("05/01/2026");
  });

  it("rejects an invalid amount or blank legal name", () => {
    expect(() => buildCorporationTaxReceipt({ ...input, amountPence: 0 })).toThrow();
    expect(() => buildCorporationTaxReceipt({ ...input, legalName: "" })).toThrow();
  });

  it("throws on an invalid donation date", () => {
    expect(() => buildCorporationTaxReceipt({ ...input, donationDate: "not-a-date" })).toThrow();
  });
});

describe("buildCompanyRefundNotice (REQ-063 · TASK-095)", () => {
  const base = {
    legalName: "Acme Ltd",
    originalAmountPence: 100000,
    currency: "GBP",
    donationDate: "2025-12-24T00:00:00Z",
  } as const;

  it("builds a VOID notice for a full refund, naming NBCC + OSCR and the original amount", () => {
    const notice = buildCompanyRefundNotice({ ...base, action: "void", refundedPence: 100000 });
    for (const content of [notice.text, notice.html]) {
      expect(content).toContain("NBCC");
      expect(content).toContain(OSCR_NUMBER);
      expect(content).toContain("Acme Ltd");
    }
    expect(notice.text.toUpperCase()).toContain("VOID");
    expect(notice.text).toContain("£1000.00");
  });

  it("carries the canonical charity-registration line", () => {
    const notice = buildCompanyRefundNotice({ ...base, action: "void", refundedPence: 100000 });
    expect(notice.text).toContain("Regulated by the Scottish Charity Regulator, OSCR.");
    expect(notice.html).toContain('class="charity-registration"');
  });

  it("builds a CORRECT notice for a partial refund, stating the retained amount", () => {
    const notice = buildCompanyRefundNotice({ ...base, action: "correct", refundedPence: 40000 });
    expect(notice.text.toUpperCase()).toContain("CORRECT");
    expect(notice.text).toContain("£400.00"); // refunded £400
    expect(notice.text).toContain("£600.00"); // retained £600
  });
});

describe("classifyCompanyGift (REQ-053 guard)", () => {
  it("returns 'receipt' for a clean gift with nothing given in return", () => {
    expect(classifyCompanyGift({ considerationGiven: false })).toBe("receipt");
  });

  it("returns the distinct 'flag_for_trustees' when consideration was given (no receipt)", () => {
    expect(classifyCompanyGift({ considerationGiven: true })).toBe("flag_for_trustees");
    // It is distinct from the receipt outcome, so a caller never issues a receipt in that case.
    expect(classifyCompanyGift({ considerationGiven: true })).not.toBe(
      classifyCompanyGift({ considerationGiven: false }),
    );
  });
});
