import { describe, it, expect } from "vitest";
import { waitingListSchema, checkboxValue } from "../../src/ball/waiting-list";

const valid = { name: "Jo Smith", email: "jo@example.com" };

describe("waitingListSchema", () => {
  it("accepts a name and an email, defaulting to one place", () => {
    const r = waitingListSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.seatsWanted).toBe(1);
      expect(r.data.newsletterOptIn).toBe(false);
      expect(r.data.note).toBeNull();
    }
  });

  it("lowercases the email so one person cannot join twice with different capitals", () => {
    const r = waitingListSchema.safeParse({ ...valid, email: "JO@Example.COM" });
    expect(r.success && r.data.email).toBe("jo@example.com");
  });

  it("rejects a missing name or a bad email", () => {
    expect(waitingListSchema.safeParse({ ...valid, name: "  " }).success).toBe(false);
    expect(waitingListSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });

  it("coerces the seats field, because an HTML form posts strings", () => {
    const r = waitingListSchema.safeParse({ ...valid, seatsWanted: "4" });
    expect(r.success && r.data.seatsWanted).toBe(4);
  });

  it("caps the places wanted at the same limit as buying", () => {
    expect(waitingListSchema.safeParse({ ...valid, seatsWanted: 9 }).success).toBe(true);
    expect(waitingListSchema.safeParse({ ...valid, seatsWanted: 10 }).success).toBe(false);
    expect(waitingListSchema.safeParse({ ...valid, seatsWanted: 0 }).success).toBe(false);
  });

  it("treats a blank note as nothing rather than an empty string", () => {
    const r = waitingListSchema.safeParse({ ...valid, note: "   " });
    expect(r.success && r.data.note).toBeNull();
  });

  it("caps the note", () => {
    expect(waitingListSchema.safeParse({ ...valid, note: "x".repeat(501) }).success).toBe(false);
  });
});

describe("checkboxValue", () => {
  it("is true only for a ticked checkbox", () => {
    expect(checkboxValue("on")).toBe(true);
    expect(checkboxValue("true")).toBe(true);
  });

  it("is false when the checkbox was not ticked", () => {
    // An unticked checkbox posts nothing at all.
    expect(checkboxValue(undefined)).toBe(false);
    expect(checkboxValue("")).toBe(false);
  });

  it("is false for a stray value, so consent is never inferred", () => {
    // z.coerce.boolean() would read "off" as TRUE, which would silently opt someone in.
    expect(checkboxValue("off")).toBe(false);
    expect(checkboxValue("no")).toBe(false);
  });
});
