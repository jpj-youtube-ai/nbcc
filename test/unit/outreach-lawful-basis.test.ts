import { describe, it, expect } from "vitest";
import {
  isIndividualSubscriber,
  emailBlockReason,
  needsConsentBasis,
  CONSENT_BASIS_PROMPT,
} from "../../src/outreach/lawful-basis";

// TASK-403: whether we are allowed to email THIS business, and why.
//
// PECR splits the world in two. A "corporate subscriber" - a limited company, an LLP, and (because
// Scots law gives partnerships their own legal personality) a Scottish partnership - may be sent
// unsolicited marketing. An "individual subscriber" - a sole trader, an English partnership - may
// not, and the ICO treats charity fundraising as direct marketing. The form already asked which
// kind of business it was; until now nothing acted on the answer.
//
// These tests are the rule. They are written around the send a volunteer must not be able to make.

describe("which side of PECR a business falls on", () => {
  it("treats a limited company as a corporate subscriber", () => {
    expect(isIndividualSubscriber("company")).toBe(false);
  });

  it("treats a sole trader as an individual", () => {
    expect(isIndividualSubscriber("sole_trader")).toBe(true);
  });

  // The safe default. An unknown value must not silently buy a business fewer protections than
  // the law gives it.
  it("treats anything it does not recognise as an individual", () => {
    expect(isIndividualSubscriber("something-else")).toBe(true);
  });
});

describe("may we email them?", () => {
  const company = { businessType: "company", consentBasis: null };
  const soleTrader = { businessType: "sole_trader", consentBasis: null };

  it("lets a company through with no basis recorded, because the law does not ask for one", () => {
    expect(emailBlockReason(company)).toBeNull();
  });

  it("stops a sole trader with nothing recorded", () => {
    expect(emailBlockReason(soleTrader)).toBeTruthy();
  });

  // The refusal has to teach, not just refuse: a volunteer who does not know why cannot fix it.
  it("says WHY, and what to do instead", () => {
    const reason = emailBlockReason(soleTrader)!;
    expect(reason).toMatch(/sole trader/i);
    expect(reason).toMatch(/agreed|consent/i);
    expect(reason).toMatch(/call|phone|post|letter/i);
  });

  it("lets a sole trader through once a basis is recorded", () => {
    expect(emailBlockReason({ ...soleTrader, consentBasis: "Gave me her card at the Chamber breakfast." })).toBeNull();
  });

  // A box someone typed a space into is not a lawful basis.
  it("does not accept whitespace as a basis", () => {
    expect(emailBlockReason({ ...soleTrader, consentBasis: "   " })).toBeTruthy();
  });

  // Neither is a shrug. This is the field somebody may one day have to stand behind.
  it("does not accept an answer too short to mean anything", () => {
    expect(emailBlockReason({ ...soleTrader, consentBasis: "yes" })).toBeTruthy();
    expect(emailBlockReason({ ...soleTrader, consentBasis: "ok" })).toBeTruthy();
  });
});

describe("when to ask for a basis", () => {
  it("asks a sole trader, not a company", () => {
    expect(needsConsentBasis("sole_trader")).toBe(true);
    expect(needsConsentBasis("company")).toBe(false);
  });

  // The prompt is the whole control. A vague one produces vague answers, and a vague answer is
  // worth nothing to the person who has to defend it.
  it("asks a question a volunteer can actually answer", () => {
    expect(CONSENT_BASIS_PROMPT).toMatch(/\?$/);
    expect(CONSENT_BASIS_PROMPT.length).toBeGreaterThan(20);
    expect(CONSENT_BASIS_PROMPT).not.toMatch(/consent|lawful basis|PECR|GDPR/i);
  });
});
