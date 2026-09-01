import { describe, it, expect } from "vitest";
import {
  normaliseBusinessName,
  emailDomain,
  isPublicDomain,
  similarity,
  findMatches,
  isDoNotContact,
  type Known,
} from "../../src/outreach/matching";

// TASK-351: the matcher exists so a busy volunteer does not ask the same company for money twice,
// eighteen months apart, having never seen the first email. These tests are written around the
// mistakes it is there to prevent.

describe("reducing a business name to what identifies it", () => {
  it("treats a legal form as no difference at all", () => {
    expect(normaliseBusinessName("The Designer Rooms Ltd.")).toBe(
      normaliseBusinessName("designer rooms limited"),
    );
  });

  it.each([
    ["Ayr Joinery Ltd", "ayr joinery"],
    ["THE ELVES WORKSHOP", "elves workshop"],
    ["Smith & Sons (Scotland) Limited", "smith sons"],
    ["Mac's Motors", "macs motors"],
  ])("%s becomes %s", (input, expected) => {
    expect(normaliseBusinessName(input)).toBe(expected);
  });

  // A curly apostrophe from a pasted spreadsheet must not make a different business.
  it("does not care which apostrophe was typed", () => {
    expect(normaliseBusinessName("Mac’s Motors")).toBe(normaliseBusinessName("Mac's Motors"));
  });
});

describe("email domains", () => {
  it("reads the domain, lowercased", () => {
    expect(emailDomain("Jane@AyrJoinery.co.uk")).toBe("ayrjoinery.co.uk");
  });

  it.each([["notanemail"], ["@nodomain"], ["trailing@"], [""]])("returns null for %s", (bad) => {
    expect(emailDomain(bad)).toBeNull();
  });

  // Two businesses sharing gmail.com tells you nothing; two sharing ayrjoinery.co.uk is almost
  // certainly one firm. Without this the list flags half of itself as duplicates.
  it("knows a free mailbox from a company one", () => {
    expect(isPublicDomain("gmail.com")).toBe(true);
    expect(isPublicDomain("btinternet.com")).toBe(true);
    expect(isPublicDomain("ayrjoinery.co.uk")).toBe(false);
  });
});

describe("how alike two names are", () => {
  it("scores a near-identical name high", () => {
    expect(similarity("ayr joinery", "ayr joinerys")).toBeGreaterThan(0.8);
  });

  // The failure that matters most: two different local firms that share a place name. Whole-word
  // overlap would call these a 50% match on the strength of "ayrshire".
  it("does not confuse two businesses that only share a town", () => {
    expect(similarity("ayrshire motors", "ayrshire roofing")).toBeLessThan(0.6);
  });

  it("is 1 for the same string and 0 against nothing", () => {
    expect(similarity("ayr joinery", "ayr joinery")).toBe(1);
    expect(similarity("ayr joinery", "")).toBe(0);
  });
});

describe("finding a business we already know", () => {
  const known: Known[] = [
    {
      id: 1,
      businessName: "Ayr Joinery Ltd",
      contactEmail: "jane@ayrjoinery.co.uk",
      source: "outreach",
      detail: "contacted 12 August by Sarah",
    },
    {
      id: 2,
      businessName: "Kyle Motors",
      contactEmail: "info@kylemotors.com",
      source: "donor",
      detail: "monthly donor since June",
    },
    {
      id: 3,
      businessName: "Troon Bakery",
      contactEmail: "hello@troonbakery.co.uk",
      source: "declined",
      detail: "said no in March",
    },
  ];

  it("catches the same business under a different legal form", () => {
    const [m] = findMatches({ businessName: "ayr joinery limited" }, known);
    expect(m.confidence).toBe("exact");
    expect(m.reason).toContain("Ayr Joinery Ltd");
    // The reason has to carry the WHY, or a volunteer cannot judge it.
    expect(m.reason).toContain("contacted 12 August by Sarah");
  });

  // Two people at one firm have different names on their cards and the same address after the @.
  it("catches a different person at a business we already emailed", () => {
    const [m] = findMatches(
      { businessName: "AJ Carpentry", contactEmail: "bob@ayrjoinery.co.uk" },
      known,
    );
    expect(m.confidence).toBe("domain");
    expect(m.id).toBe(1);
  });

  it("does not flag two strangers who both use gmail", () => {
    const withGmail: Known[] = [
      { id: 9, businessName: "Some Cafe", contactEmail: "a@gmail.com", source: "outreach" },
    ];
    expect(
      findMatches({ businessName: "Unrelated Garage", contactEmail: "b@gmail.com" }, withGmail),
    ).toEqual([]);
  });

  it("flags a business that already gives us money", () => {
    const [m] = findMatches({ businessName: "Kyle Motors Ltd" }, known);
    expect(m.source).toBe("donor");
    expect(m.reason).toMatch(/monthly donor since June/);
  });

  it("says nothing about a genuinely new business", () => {
    expect(findMatches({ businessName: "Prestwick Plumbing" }, known)).toEqual([]);
  });

  // A near-certain match must not sit below a maybe.
  it("puts the most certain match first", () => {
    const matches = findMatches(
      { businessName: "Ayr Joinery", contactEmail: "someone@troonbakery.co.uk" },
      known,
    );
    expect(matches[0].confidence).toBe("exact");
  });
});

describe("a decline is an instruction, not a suggestion", () => {
  const known: Known[] = [
    { id: 3, businessName: "Troon Bakery", contactEmail: null, source: "declined" },
  ];

  it("is recognised separately from an ordinary match", () => {
    expect(isDoNotContact(findMatches({ businessName: "troon bakery ltd" }, known))).toBe(true);
  });

  it("does not fire for a business that merely looks similar to a live one", () => {
    const live: Known[] = [
      { id: 1, businessName: "Troon Bakery", contactEmail: null, source: "outreach" },
    ];
    expect(isDoNotContact(findMatches({ businessName: "troon bakery" }, live))).toBe(false);
  });
});
