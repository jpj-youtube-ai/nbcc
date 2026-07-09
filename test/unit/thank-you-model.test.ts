import { describe, it, expect } from "vitest";
import {
  giftAidUpliftPence,
  formatGiftAmount,
  giftSummary,
  thankYouInputSchema,
  deriveSendState,
  recipientName,
} from "../../src/thank-you/model";

// TASK-161 (REQ-069): the pure thank-you model. DB-free (no pool, no config),
// per CLAUDE.md's "unit tests test pure functions / schemas" rule — the write
// layer in src/db/thank-you.ts is exercised separately against a real DB.

describe("thank-you model (REQ-069)", () => {
  describe("giftAidUpliftPence", () => {
    it("adds 25% of a Gift-Aided donation", () => {
      expect(giftAidUpliftPence(150000)).toBe(37500); // £1,500 -> £375
      expect(giftAidUpliftPence(100000)).toBe(25000);
    });
    it("rounds to the nearest penny", () => {
      expect(giftAidUpliftPence(1)).toBe(0); // 0.25p -> 0
      expect(giftAidUpliftPence(2)).toBe(1); // 0.5p -> 1
      expect(giftAidUpliftPence(333)).toBe(83); // 83.25p -> 83
    });
  });

  describe("formatGiftAmount", () => {
    it("formats GBP pence with a £ sign", () => {
      expect(formatGiftAmount(150000)).toBe("£1500.00");
      expect(formatGiftAmount(5)).toBe("£0.05");
    });
    it("uses the currency code for non-GBP", () => {
      expect(formatGiftAmount(150000, "eur")).toBe("1500.00 EUR");
    });
  });

  describe("giftSummary", () => {
    it("summarises a Gift-Aided money gift", () => {
      expect(
        giftSummary({ giftType: "money", giftAmountPence: 150000, giftInKind: null, giftAided: true }),
      ).toBe("£1500.00 (Gift Aided)");
    });
    it("summarises a money gift without Gift Aid", () => {
      expect(
        giftSummary({ giftType: "money", giftAmountPence: 125000, giftInKind: null, giftAided: false }),
      ).toBe("£1250.00");
    });
    it("summarises an in-kind gift", () => {
      expect(
        giftSummary({
          giftType: "in_kind",
          giftAmountPence: null,
          giftInKind: "10 pairs of football boots",
          giftAided: false,
        }),
      ).toBe("Gift in kind: 10 pairs of football boots");
    });
  });

  describe("thankYouInputSchema", () => {
    const base = {
      donorId: 1,
      thankYouName: "Margaret",
      addressedTo: "Mrs Robertson",
      recipientEmail: "m.robertson@example.com",
      giftType: "money" as const,
      giftAmountPence: 150000,
      giftInKind: null,
      giftAided: true,
      personalMessage: null,
      signedByName: "Jodie McFarlane",
      sentBy: "jon@nbcc.scot",
    };

    it("accepts a valid money gift", () => {
      expect(thankYouInputSchema.safeParse(base).success).toBe(true);
    });
    it("accepts a null donorId (a non-donor giver)", () => {
      expect(thankYouInputSchema.safeParse({ ...base, donorId: null }).success).toBe(true);
    });
    it("rejects a money gift with no amount", () => {
      expect(thankYouInputSchema.safeParse({ ...base, giftAmountPence: null }).success).toBe(false);
    });
    it("accepts an in-kind gift with a description", () => {
      expect(
        thankYouInputSchema.safeParse({
          ...base,
          giftType: "in_kind",
          giftAmountPence: null,
          giftInKind: "boots and selection boxes",
        }).success,
      ).toBe(true);
    });
    it("rejects an in-kind gift with no description", () => {
      expect(
        thankYouInputSchema.safeParse({
          ...base,
          giftType: "in_kind",
          giftAmountPence: null,
          giftInKind: null,
        }).success,
      ).toBe(false);
    });
    it("rejects an invalid recipient email", () => {
      expect(thankYouInputSchema.safeParse({ ...base, recipientEmail: "not-an-email" }).success).toBe(false);
    });
    it("rejects a blank thank-you name", () => {
      expect(thankYouInputSchema.safeParse({ ...base, thankYouName: "   " }).success).toBe(false);
    });
  });

  describe("deriveSendState (REQ-069 · TASK-162)", () => {
    it("is ready when the donor has an email and consent", () => {
      expect(deriveSendState({ email: "a@b.com", emailConsent: true })).toBe("ready");
    });
    it("is no_email when the donor has no email", () => {
      expect(deriveSendState({ email: null, emailConsent: true })).toBe("no_email");
    });
    it("is opted_out when the donor has an email but no consent", () => {
      expect(deriveSendState({ email: "a@b.com", emailConsent: false })).toBe("opted_out");
    });
    it("treats a missing email as no_email even without consent", () => {
      expect(deriveSendState({ email: null, emailConsent: false })).toBe("no_email");
    });
  });

  describe("recipientName (REQ-069 · TASK-162)", () => {
    it("uses a company's business name when present", () => {
      expect(
        recipientName({ donorType: "company", fullName: "Jean Baxter", businessName: "Ayrshire Operatic Society" }),
      ).toBe("Ayrshire Operatic Society");
    });
    it("falls back to the full name for a company with no business name", () => {
      expect(recipientName({ donorType: "company", fullName: "Jean Baxter", businessName: null })).toBe("Jean Baxter");
    });
    it("uses the full name for an individual", () => {
      expect(
        recipientName({ donorType: "individual", fullName: "Margaret Robertson", businessName: null }),
      ).toBe("Margaret Robertson");
    });
  });
});
