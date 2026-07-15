import { describe, it, expect } from "vitest";

// TASK-205 (business-supporter fulfilment — DATA-MODEL FOUNDATION): the pure banding + perk model.
// DB-free per CLAUDE.md golden rule 5 — src/donors/fulfilment.ts imports nothing external (no
// pool/config/clock), so it is unit-tested in isolation. Mirrors the pure-model style of
// test/unit/donation-confirmation-email.test.ts.

import {
  SUPPORTER_BANDS,
  bandForMonthlyAmount,
  bandHasPlatinumPerks,
  fulfilmentBandFor,
  perksForBand,
  type SupporterBand,
} from "../../src/donors/fulfilment";

describe("SUPPORTER_BANDS", () => {
  it("lists the four bands in ascending order", () => {
    expect(SUPPORTER_BANDS).toEqual(["bronze", "silver", "gold", "platinum"]);
  });
});

describe("bandForMonthlyAmount — banding by MONTHLY gift in integer pence", () => {
  it("returns null below the £10 monthly minimum (not banded)", () => {
    expect(bandForMonthlyAmount(0)).toBeNull();
    expect(bandForMonthlyAmount(999)).toBeNull();
  });

  it("bands bronze from £10 up to just under £25", () => {
    expect(bandForMonthlyAmount(1000)).toBe("bronze");
    expect(bandForMonthlyAmount(2499)).toBe("bronze");
  });

  it("bands silver from £25 up to just under £50", () => {
    expect(bandForMonthlyAmount(2500)).toBe("silver");
    expect(bandForMonthlyAmount(4999)).toBe("silver");
  });

  it("bands gold from £50 up to just under £100", () => {
    expect(bandForMonthlyAmount(5000)).toBe("gold");
    expect(bandForMonthlyAmount(9999)).toBe("gold");
  });

  it("bands platinum from £100 and above", () => {
    expect(bandForMonthlyAmount(10000)).toBe("platinum");
    expect(bandForMonthlyAmount(1000000)).toBe("platinum");
  });
});

describe("bandHasPlatinumPerks", () => {
  it("is true only for platinum", () => {
    expect(bandHasPlatinumPerks("bronze")).toBe(false);
    expect(bandHasPlatinumPerks("silver")).toBe(false);
    expect(bandHasPlatinumPerks("gold")).toBe(false);
    expect(bandHasPlatinumPerks("platinum")).toBe(true);
  });
});

describe("perksForBand", () => {
  it("gives every band the supporters listing + newsletter, and NO platinum-only extras for a non-platinum band", () => {
    for (const band of ["bronze", "silver", "gold"] as const satisfies readonly SupporterBand[]) {
      expect(perksForBand(band)).toEqual({
        supportersListing: true,
        newsletter: true,
        socialThankYou: false,
        digitalBadge: false,
        certificate: false,
      });
    }
  });

  it("gives platinum every perk (listing + newsletter + the three recognition extras)", () => {
    expect(perksForBand("platinum")).toEqual({
      supportersListing: true,
      newsletter: true,
      socialThankYou: true,
      digitalBadge: true,
      certificate: true,
    });
  });
});

describe("fulfilmentBandFor — a fulfilment band ONLY for a BUSINESS MONTHLY gift", () => {
  it("returns null for a one-off business gift (not monthly)", () => {
    expect(
      fulfilmentBandFor({ mode: "once", donorType: "company", businessName: "Acme Ltd", amountPence: 10000 }),
    ).toBeNull();
  });

  it("returns null for an individual monthly gift with no business name", () => {
    expect(
      fulfilmentBandFor({ mode: "monthly", donorType: "individual", businessName: null, amountPence: 5000 }),
    ).toBeNull();
  });

  it("treats an empty-string business name on an individual as no business (null)", () => {
    expect(
      fulfilmentBandFor({ mode: "monthly", donorType: "individual", businessName: "   ", amountPence: 5000 }),
    ).toBeNull();
  });

  it("bands a company monthly gift at each band (business via donorType, no name needed)", () => {
    expect(fulfilmentBandFor({ mode: "monthly", donorType: "company", amountPence: 1000 })).toBe("bronze");
    expect(fulfilmentBandFor({ mode: "monthly", donorType: "company", amountPence: 2500 })).toBe("silver");
    expect(fulfilmentBandFor({ mode: "monthly", donorType: "company", amountPence: 5000 })).toBe("gold");
    expect(fulfilmentBandFor({ mode: "monthly", donorType: "company", amountPence: 10000 })).toBe("platinum");
  });

  it("bands a partnership: monthly, donorType individual but WITH a business name", () => {
    expect(
      fulfilmentBandFor({
        mode: "monthly",
        donorType: "individual",
        businessName: "Smith & Jones",
        amountPence: 2500,
      }),
    ).toBe("silver");
  });

  it("returns null for a business monthly gift below the £10 monthly minimum", () => {
    expect(
      fulfilmentBandFor({ mode: "monthly", donorType: "company", businessName: "Acme Ltd", amountPence: 999 }),
    ).toBeNull();
  });
});
