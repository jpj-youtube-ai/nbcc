import { describe, it, expect } from "vitest";
import {
  MAX_DETECTIVES,
  buildElfSessionParams,
  entryLimits,
  feeCoverPence,
  joinBodySchema,
  parseJoin,
  type JoinBody,
} from "../../src/elf/join";
import { ELF_DEFAULTS } from "../../src/elf/settings";
import { DEFAULT_CARD_FEE } from "../../src/ball/pricing";

// NBCC Elf Detective School: enrolling and paying. Every family here is invented.

const SETTINGS = { ...ELF_DEFAULTS, schoolOn: true };
const DECLARATION = { firstName: "Sam", lastName: "Example", houseNameNumber: "12", address: "Holly Lane, Troon", postcode: "KA10 6AA" };

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    grownUpName: "Sam Example",
    email: "sam@example.com",
    mobile: "07700 900 123",
    detectives: [
      { firstName: "Ruby", surname: "Tinselfoot" },
      { firstName: "Leo", surname: "Frostwhistle" },
    ],
    entryPence: 1000,
    donationPence: 0,
    giftAid: false,
    coverFee: false,
    newsletter: false,
    agreed: true,
    ...over,
  };
}

function refusal(over: Record<string, unknown>): string {
  const r = parseJoin(SETTINGS, body(over));
  if (r.ok) throw new Error("expected a refusal");
  return r.errors.join(" | ");
}

describe("who can be enrolled", () => {
  it("takes a grown up and two detectives at £5 each", () => {
    const r = parseJoin(SETTINGS, body());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.email).toBe("sam@example.com");
      expect(r.body.detectives).toEqual([
        { firstName: "Ruby", surname: "Tinselfoot" },
        { firstName: "Leo", surname: "Frostwhistle" },
      ]);
    }
  });

  it("keeps the email lower case and trimmed", () => {
    const r = parseJoin(SETTINGS, body({ email: "  Sam@Example.COM " }));
    expect(r.ok && r.body.email).toBe("sam@example.com");
  });

  it("needs at least one detective, and no more than 8", () => {
    expect(MAX_DETECTIVES).toBe(8);
    expect(refusal({ detectives: [] })).toContain("at least one detective");
    const nine = Array.from({ length: 9 }, () => ({ firstName: "Ruby", surname: "Tinselfoot" }));
    expect(refusal({ detectives: nine, entryPence: 4500 })).toContain("up to 8 detectives");
  });

  it("refuses a surname typed into the first name, before any payment", () => {
    expect(refusal({ detectives: [{ firstName: "Ruby Smith", surname: "Tinselfoot" }], entryPence: 500 })).toContain(
      "just one first name",
    );
  });

  it("refuses a rude name however it is dressed up", () => {
    expect(refusal({ detectives: [{ firstName: "Shite", surname: "Tinselfoot" }], entryPence: 500 })).toContain(
      "choose a different first name",
    );
    // A look alike Cyrillic letter, and a number standing in for a letter.
    expect(refusal({ detectives: [{ firstName: "Prіck", surname: "Tinselfoot" }], entryPence: 500 })).toContain("letters");
    expect(refusal({ detectives: [{ firstName: "Pr1ck", surname: "Tinselfoot" }], entryPence: 500 })).toContain("letters");
  });

  it("refuses a surname that is not on the festive list", () => {
    expect(refusal({ detectives: [{ firstName: "Ruby", surname: "Smith" }], entryPence: 500 })).toContain(
      "pick a surname from the list",
    );
  });

  it("needs the rules agreed, and refuses a filled in trap field", () => {
    expect(refusal({ agreed: false })).toContain("agree to the rules");
    expect(refusal({ website: "http://spam.example" })).toBeTruthy();
  });

  it("never asks for an age, a school or a real surname", () => {
    const keys = Object.keys(joinBodySchema().shape);
    for (const k of keys) expect(k.toLowerCase()).not.toMatch(/age|school|lastname|realsurname|birth/);
  });
});

// TASK-613 (Jaimie, 11 November 2026): a mobile number, so NBCC can ring the grand prize winner's grown
// up on Christmas Eve. Kept as +447 and nine digits, exactly as a head elf's mobile is kept.
describe("the grown up's mobile number", () => {
  const MOBILE_WORDS = "Please type a UK mobile number, like 07700 900 123.";
  const kept = (mobile: unknown) => {
    const r = parseJoin(SETTINGS, body({ mobile }));
    if (!r.ok) throw new Error(r.errors.join());
    return r.body.mobile;
  };

  it("takes 07 and nine more digits, spaces and all, and keeps it as +447 and nine digits", () => {
    expect(kept("07700 900 123")).toBe("+447700900123");
    expect(kept("07700900045")).toBe("+447700900045");
    expect(kept(" 07700 900045 ")).toBe("+447700900045");
  });

  it("takes +44 7 and nine more digits", () => {
    expect(kept("+44 7700 900 123")).toBe("+447700900123");
    expect(kept("+447700900045")).toBe("+447700900045");
  });

  it("refuses an enrolment with no mobile, in plain words", () => {
    const without = body();
    delete without.mobile;
    const r = parseJoin(SETTINGS, without);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual([MOBILE_WORDS]);
    expect(refusal({ mobile: "" })).toBe(MOBILE_WORDS);
    expect(refusal({ mobile: "   " })).toBe(MOBILE_WORDS);
  });

  it("refuses a number that is not a UK mobile, in the same words", () => {
    for (const mobile of ["01632 960 123", "07700 900 12", "07700 900 1234", "+1 202 555 0123", "seven seven", 7700900123, null]) {
      expect(refusal({ mobile }), String(mobile)).toBe(MOBILE_WORDS);
    }
  });

  it("says it alongside any other refusal, once", () => {
    const words = refusal({ mobile: "nope", agreed: false });
    expect(words).toContain(MOBILE_WORDS);
    expect(words).toContain("agree to the rules");
    expect(words.split(MOBILE_WORDS)).toHaveLength(2);
  });
});

describe("what a family pays", () => {
  it("is at least £1 for each detective, in whole pence, and no more than £1,000", () => {
    expect(refusal({ entryPence: 199 })).toContain("at least £2 for 2 detectives");
    expect(refusal({ entryPence: 100001 })).toContain("£1,000");
    expect(refusal({ entryPence: 250.5 })).toBeTruthy();
    expect(parseJoin(SETTINGS, body({ entryPence: 200 })).ok).toBe(true);
  });

  it("suggests £5 for each detective and starts at £1, as the admin set", () => {
    expect(entryLimits(SETTINGS, 2)).toEqual({ fromPence: 200, suggestedPence: 1000, maxPence: 100000 });
    expect(entryLimits({ ...SETTINGS, entryFromPence: 200, entrySuggestedPence: 600 }, 3)).toEqual({
      fromPence: 600,
      suggestedPence: 1800,
      maxPence: 100000,
    });
  });

  it("only lets the separate gift carry Gift Aid, with its declaration", () => {
    expect(refusal({ giftAid: true, donationPence: 0 })).toContain("Gift Aid");
    expect(refusal({ giftAid: true, donationPence: 500 })).toContain("declaration");
    const ok = parseJoin(SETTINGS, body({ giftAid: true, donationPence: 500, declaration: DECLARATION }));
    expect(ok.ok).toBe(true);
  });

  it("refuses a gift below nothing or not in whole pence", () => {
    expect(refusal({ donationPence: -100 })).toBeTruthy();
    expect(refusal({ donationPence: 12.5 })).toBeTruthy();
  });

  it("covers the card fee on the entry and the gift together, only when ticked", () => {
    const parsed = (over: Record<string, unknown>) => {
      const r = parseJoin(SETTINGS, body(over));
      if (!r.ok) throw new Error(r.errors.join());
      return r.body;
    };
    expect(feeCoverPence(parsed({ coverFee: false, donationPence: 500 }), DEFAULT_CARD_FEE)).toBe(0);
    // £10 entry and £5 gift: £15 grossed up at 1.2% + 20p.
    expect(feeCoverPence(parsed({ coverFee: true, donationPence: 500 }), DEFAULT_CARD_FEE)).toBe(39);
  });
});

describe("the Stripe checkout", () => {
  function params(over: Record<string, unknown> = {}, fee = 0) {
    const r = parseJoin(SETTINGS, body(over));
    if (!r.ok) throw new Error(r.errors.join());
    return buildElfSessionParams({ reference: "EDS-K4F9Q2", body: r.body as JoinBody, feeCoverPence: fee, baseUrl: "https://nbcc.scot", familyId: 7 });
  }

  it("is tagged as the school, with the reference and family", () => {
    const p = params();
    expect(p.mode).toBe("payment");
    expect(p.metadata).toMatchObject({ product: "elf_school", reference: "EDS-K4F9Q2", familyId: "7", giftAid: "false", feeCoverPence: "0" });
    expect(p.payment_intent_data?.metadata).toMatchObject({ product: "elf_school", reference: "EDS-K4F9Q2" });
    expect(p.customer_email).toBe("sam@example.com");
  });

  it("charges the entry on its own line, adding the gift and the fee only when there are any", () => {
    const names = (p: ReturnType<typeof params>) => (p.line_items ?? []).map((l) => l.price_data?.product_data?.name);
    expect(names(params())).toEqual(["Elf Detective School entry"]);
    const full = params({ donationPence: 500, giftAid: true, declaration: DECLARATION }, 39);
    expect(names(full)).toEqual(["Elf Detective School entry", "A gift to NBCC", "Covering the card fee"]);
    expect(full.line_items?.map((l) => l.price_data?.unit_amount)).toEqual([1000, 500, 39]);
    expect(full.metadata).toMatchObject({ giftAid: "true", feeCoverPence: "39" });
  });

  it("sends people back to this site's own pages, never to an address from the form", () => {
    const p = params({ successUrl: "https://evil.example" });
    expect(p.success_url).toBe("https://nbcc.scot/elf/welcome?elf_session={CHECKOUT_SESSION_ID}");
    expect(p.cancel_url).toBe("https://nbcc.scot/elf/join");
  });

  it("expires in about half an hour", () => {
    const before = Math.floor(Date.now() / 1000);
    const p = params();
    expect(p.expires_at! - before).toBeGreaterThanOrEqual(31 * 60 - 2);
    expect(p.expires_at! - before).toBeLessThanOrEqual(31 * 60 + 2);
  });
});

describe("the review's findings: plain words for every refusal", () => {
  it("says how to type an amount, never a field's name", () => {
    for (const entryPence of [Number.NaN, null]) {
      const words = refusal({ entryPence });
      expect(words).toContain("in pounds and pence, like 5 or 5.50");
      expect(words).not.toMatch(/entryPence|Please check/);
    }
    expect(refusal({ donationPence: Number.NaN })).toContain("in pounds and pence");
  });

  it("says which part of the Gift Aid declaration needs another look", () => {
    const decl = { firstName: "Sam", lastName: "Example", houseNameNumber: "12", address: "Holly Lane, Troon", postcode: "KA10 6AA" };
    expect(refusal({ giftAid: true, donationPence: 500, declaration: { ...decl, postcode: "NOT A CODE" } })).toContain("postcode");
    expect(refusal({ giftAid: true, donationPence: 500, declaration: { ...decl, houseNameNumber: undefined } })).toContain("house name or number");
    expect(refusal({ giftAid: true, donationPence: 500, declaration: { ...decl, firstName: "" } })).toContain("first and last name");
    for (const words of [refusal({ giftAid: true, donationPence: 500, declaration: { ...decl, postcode: "X" } })]) expect(words).not.toMatch(/declaration\b.*check|Please check/);
  });
});
