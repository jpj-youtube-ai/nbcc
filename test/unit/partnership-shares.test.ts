import { describe, it, expect } from "vitest";
import {
  partnerShareSchema,
  validatePartnerShares,
  PartnerShareError,
} from "../../src/declarations/partnership";

// TASK-079 (REQ-051): the pure, DB-free partnership Gift Aid share model — a partnership
// donation collects ONE Gift Aid declaration per partner (each a full declaration plus that
// partner's sharePence of the gift), and the partners' shares must sum EXACTLY to the
// donation total. Pure like src/declarations/fields.ts (no pool/config/clock), so it is
// unit-tested here without a DB. partnerShareSchema is a declaration + sharePence;
// validatePartnerShares accepts only when the shares sum exactly to the donation amount and
// otherwise throws a typed PartnerShareError (both over- and under-sums).

const partner = (firstName: string, sharePence: number) => ({
  firstName,
  lastName: "Partner",
  houseNameNumber: "1",
  address: "Partnership House, London",
  postcode: "SW1A 1AA",
  nonUk: false,
  sharePence,
});

describe("partnerShareSchema (REQ-051)", () => {
  it("accepts a declaration plus a positive integer sharePence", () => {
    const parsed = partnerShareSchema.parse(partner("Ada", 5000));
    expect(parsed.firstName).toBe("Ada");
    expect(parsed.sharePence).toBe(5000);
  });

  it("still enforces the underlying declaration rules (bad postcode rejected)", () => {
    expect(partnerShareSchema.safeParse({ ...partner("Ada", 5000), postcode: "NOPE" }).success).toBe(
      false,
    );
  });

  it("rejects a non-positive or non-integer sharePence", () => {
    expect(partnerShareSchema.safeParse(partner("Ada", 0)).success).toBe(false);
    expect(partnerShareSchema.safeParse(partner("Ada", -100)).success).toBe(false);
    expect(partnerShareSchema.safeParse(partner("Ada", 12.5)).success).toBe(false);
  });
});

describe("validatePartnerShares (REQ-051)", () => {
  it("accepts shares that sum EXACTLY to the donation total", () => {
    const partners = [partner("Ada", 6000), partner("Grace", 4000)];
    const result = validatePartnerShares(partners, 10000);
    expect(result.map((p) => p.sharePence)).toEqual([6000, 4000]);
  });

  it("rejects an over-sum with a typed error", () => {
    const partners = [partner("Ada", 6000), partner("Grace", 5000)];
    expect(() => validatePartnerShares(partners, 10000)).toThrow(PartnerShareError);
  });

  it("rejects an under-sum with a typed error", () => {
    const partners = [partner("Ada", 6000), partner("Grace", 3000)];
    expect(() => validatePartnerShares(partners, 10000)).toThrow(PartnerShareError);
  });

  it("rejects an empty partner list with a typed error", () => {
    expect(() => validatePartnerShares([], 10000)).toThrow(PartnerShareError);
  });

  it("rejects a partner whose declaration fields are invalid with a typed error", () => {
    const partners = [{ ...partner("Ada", 6000), postcode: "NOPE" }, partner("Grace", 4000)];
    expect(() => validatePartnerShares(partners, 10000)).toThrow(PartnerShareError);
  });
});
