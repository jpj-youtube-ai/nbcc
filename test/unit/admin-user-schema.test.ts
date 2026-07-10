import { describe, it, expect } from "vitest";
import { inviteSchema, userPatchSchema, setPasswordSchema, forgotSchema } from "../../src/admin/user-schema";

const validInvite = { email: "ada@example.com", fullName: "Ada Lovelace", role: "editor" };

describe("inviteSchema", () => {
  it("accepts a valid invite", () => {
    expect(inviteSchema.parse(validInvite)).toEqual(validInvite);
  });

  it("rejects an invalid email", () => {
    expect(inviteSchema.safeParse({ ...validInvite, email: "nope" }).success).toBe(false);
  });

  it("rejects an email longer than 254 chars", () => {
    const long = "a".repeat(250) + "@x.com"; // > 254 chars
    expect(inviteSchema.safeParse({ ...validInvite, email: long }).success).toBe(false);
  });

  it("rejects an empty fullName", () => {
    expect(inviteSchema.safeParse({ ...validInvite, fullName: "" }).success).toBe(false);
  });

  it("rejects a fullName longer than 120 chars", () => {
    expect(inviteSchema.safeParse({ ...validInvite, fullName: "x".repeat(121) }).success).toBe(false);
  });

  it("rejects an invalid role", () => {
    expect(inviteSchema.safeParse({ ...validInvite, role: "superadmin" }).success).toBe(false);
  });

  it("accepts each valid role", () => {
    for (const role of ["viewer", "editor", "admin"]) {
      expect(inviteSchema.safeParse({ ...validInvite, role }).success).toBe(true);
    }
  });
});

describe("userPatchSchema", () => {
  it("accepts a role-only patch", () => {
    expect(userPatchSchema.parse({ role: "admin" })).toEqual({ role: "admin" });
  });

  it("accepts a status-only patch", () => {
    expect(userPatchSchema.parse({ status: "disabled" })).toEqual({ status: "disabled" });
  });

  it("accepts both fields", () => {
    expect(userPatchSchema.parse({ role: "viewer", status: "active" })).toEqual({
      role: "viewer",
      status: "active",
    });
  });

  it("rejects an empty patch (no fields present)", () => {
    expect(userPatchSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an invalid role", () => {
    expect(userPatchSchema.safeParse({ role: "owner" }).success).toBe(false);
  });

  it("rejects an invalid status", () => {
    expect(userPatchSchema.safeParse({ status: "invited" }).success).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    expect(userPatchSchema.safeParse({ role: "admin", extra: "nope" }).success).toBe(false);
  });
});

describe("setPasswordSchema", () => {
  const valid = { token: "abc123", password: "supersecret1" };

  it("accepts a valid token + password", () => {
    expect(setPasswordSchema.parse(valid)).toEqual(valid);
  });

  it("rejects an empty token", () => {
    expect(setPasswordSchema.safeParse({ ...valid, token: "" }).success).toBe(false);
  });

  it("rejects a password shorter than 10 chars", () => {
    expect(setPasswordSchema.safeParse({ ...valid, password: "short1" }).success).toBe(false);
  });

  it("rejects a password longer than 200 chars", () => {
    expect(setPasswordSchema.safeParse({ ...valid, password: "x".repeat(201) }).success).toBe(false);
  });

  it("accepts a password at the 200-char boundary", () => {
    expect(setPasswordSchema.safeParse({ ...valid, password: "x".repeat(200) }).success).toBe(true);
  });
});

describe("forgotSchema", () => {
  it("accepts a valid email", () => {
    expect(forgotSchema.parse({ email: "ada@example.com" })).toEqual({ email: "ada@example.com" });
  });

  it("rejects an invalid email", () => {
    expect(forgotSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});
