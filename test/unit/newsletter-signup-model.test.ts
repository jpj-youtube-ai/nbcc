import { describe, it, expect } from "vitest";
import { hashSignupToken, looksLikeSignupToken, newSignupToken, signupSchema, WHO_WE_ARE, WHO_WE_ARE_SHORT } from "../../src/mailing-list/model";

// Joining the mailing list from /newsletter: what the form may send, and the link in the email.

describe("the link in the confirmation email", () => {
  it("is long, random and safe in an address", () => {
    const a = newSignupToken();
    const b = newSignupToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(looksLikeSignupToken(a)).toBe(true);
  });

  it("is kept only as a hash, which is never the link itself", () => {
    const t = newSignupToken();
    expect(hashSignupToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSignupToken(t)).toBe(hashSignupToken(t));
    expect(hashSignupToken(t)).not.toContain(t);
  });

  it("anything that is not one of ours is not looked up at all", () => {
    for (const bad of ["", "short", "a".repeat(44), "has space".padEnd(43, "a"), undefined, 12, ["x"]]) expect(looksLikeSignupToken(bad)).toBe(false);
  });
});

describe("what the form may send", () => {
  it("takes a first name and an email address, tidied", () => {
    const r = signupSchema.safeParse({ firstName: "  Sam ", email: " Sam@Example.com " });
    expect(r.success && r.data).toEqual({ firstName: "Sam", email: "sam@example.com" });
  });

  it("says plainly what is missing", () => {
    const r = signupSchema.safeParse({ firstName: " ", email: "not an address" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const byField = Object.fromEntries(r.error.issues.map((i) => [i.path[0], i.message]));
      expect(byField).toEqual({ firstName: "Please enter your first name.", email: "Please enter a valid email address." });
    }
  });

  it("says the same when nothing is sent at all", () => {
    const r = signupSchema.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) {
      const byField = Object.fromEntries(r.error.issues.map((i) => [i.path[0], i.message]));
      expect(byField).toEqual({ firstName: "Please enter your first name.", email: "Please enter a valid email address." });
    }
  });

  it("refuses a name or an address too long to be real", () => {
    expect(signupSchema.safeParse({ firstName: "a".repeat(61), email: "sam@example.com" }).success).toBe(false);
    expect(signupSchema.safeParse({ firstName: "Sam", email: `${"a".repeat(250)}@example.com` }).success).toBe(false);
  });
});

describe("who NBCC is, in the charity's own words", () => {
  it("is word for word as the charity gave it", () => {
    expect(WHO_WE_ARE).toBe(
      "NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland, with school clothing and crisis support whenever it is needed, and every December a full bag for those who would otherwise wake up on Christmas morning with nothing to open.",
    );
    expect(WHO_WE_ARE_SHORT).toBe("NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland.");
  });
});
