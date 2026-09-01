import { describe, it, expect } from "vitest";
import {
  outreachCreateSchema,
  outreachOutcomeSchema,
  outreachNoteSchema,
} from "../../src/outreach/model";

// TASK-352: what the outreach form is allowed to send.

const base = { businessName: "Ayr Joinery Ltd" };

describe("adding a business", () => {
  it("needs a name worth calling a name", () => {
    expect(outreachCreateSchema.safeParse({ businessName: "A" }).success).toBe(false);
    expect(outreachCreateSchema.safeParse(base).success).toBe(true);
  });

  // A volunteer often has a name and a phone number from a conversation before they have an
  // address. Making the email mandatory would mean that business never gets recorded at all.
  it("does not insist on an email address", () => {
    const parsed = outreachCreateSchema.parse(base);
    expect(parsed.contactEmail ?? null).toBeNull();
  });

  it("treats an empty box as absent, not as an empty string", () => {
    const parsed = outreachCreateSchema.parse({
      ...base,
      contactName: "   ",
      contactPhone: "",
      note: "  ",
    });
    expect(parsed.contactName).toBeNull();
    expect(parsed.contactPhone).toBeNull();
    expect(parsed.note).toBeNull();
  });

  it("lowercases the email, so the matcher compares like with like", () => {
    const parsed = outreachCreateSchema.parse({ ...base, contactEmail: "Jane@AyrJoinery.CO.UK" });
    expect(parsed.contactEmail).toBe("jane@ayrjoinery.co.uk");
  });

  it("rejects something that is not an email at all", () => {
    expect(outreachCreateSchema.safeParse({ ...base, contactEmail: "not-an-email" }).success).toBe(
      false,
    );
  });

  // Company is both the common case and the safe default: a sole trader wrongly marked as a
  // company gets a warning nobody needed, while the reverse suppresses one somebody did.
  it("defaults to company", () => {
    expect(outreachCreateSchema.parse(base).businessType).toBe("company");
  });

  it("accepts sole trader, and nothing else", () => {
    expect(outreachCreateSchema.parse({ ...base, businessType: "sole_trader" }).businessType).toBe(
      "sole_trader",
    );
    expect(outreachCreateSchema.safeParse({ ...base, businessType: "charity" }).success).toBe(false);
  });

  // The volunteer is asserting "I looked, it is a different business" - not overriding a rule.
  it("carries the acknowledgement separately from the data", () => {
    expect(outreachCreateSchema.parse({ ...base, acknowledgedMatches: true }).acknowledgedMatches).toBe(
      true,
    );
    expect(outreachCreateSchema.parse(base).acknowledgedMatches).toBeUndefined();
  });

  it("caps the note, so this cannot become a filing cabinet", () => {
    expect(outreachCreateSchema.safeParse({ ...base, note: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("recording what happened", () => {
  it("accepts only the outcomes that exist", () => {
    expect(outreachOutcomeSchema.safeParse({ outcome: "interested" }).success).toBe(true);
    expect(outreachOutcomeSchema.safeParse({ outcome: "maybe_later" }).success).toBe(false);
  });

  it("takes an ask-again date in a shape a date input produces", () => {
    expect(outreachOutcomeSchema.parse({ outcome: "not_this_year", askAgainOn: "2027-03-01" }).askAgainOn).toBe(
      "2027-03-01",
    );
  });

  it("refuses a date it cannot read, rather than storing a guess", () => {
    expect(
      outreachOutcomeSchema.safeParse({ outcome: "not_this_year", askAgainOn: "next March" }).success,
    ).toBe(false);
  });

  it("is fine with no date at all", () => {
    expect(outreachOutcomeSchema.parse({ outcome: "declined" }).askAgainOn).toBeNull();
  });
});

describe("notes", () => {
  it("needs something in it", () => {
    expect(outreachNoteSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(outreachNoteSchema.parse({ body: "  Rang, spoke to Jim.  " }).body).toBe(
      "Rang, spoke to Jim.",
    );
  });
});
