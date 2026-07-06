import { describe, it, expect } from "vitest";
import { resolveInputs } from "../../scripts/lib/admin-password-input.mjs";
import { hashPassword, verifyPassword } from "../../src/admin/password";

// The script's DB write is integration-only (needs a live pool), but its input resolution is pure and
// is where the safety rules live: password comes from the env (never argv), email is required, and a
// short password is rejected. We also assert the hash it would store round-trips through the app's own
// verifyPassword — i.e. a password set by this script actually satisfies the admin login check.
describe("set-admin-password resolveInputs", () => {
  const argv = (email?: string) => ["node", "script", ...(email ? ["--email", email] : [])];

  it("returns email + password from argv/env", () => {
    expect(resolveInputs(argv("a@b.com"), { ADMIN_PASSWORD: "correct horse battery" })).toEqual({
      email: "a@b.com",
      password: "correct horse battery",
    });
  });

  it("requires --email", () => {
    expect(() => resolveInputs(argv(), { ADMIN_PASSWORD: "correct horse battery" })).toThrow(/email/i);
  });

  it("rejects an email without @", () => {
    expect(() => resolveInputs(argv("nope"), { ADMIN_PASSWORD: "correct horse battery" })).toThrow(/email/i);
  });

  it("requires ADMIN_PASSWORD from the env, not the command line", () => {
    expect(() => resolveInputs(argv("a@b.com"), {})).toThrow(/ADMIN_PASSWORD/);
  });

  it("rejects a too-short password", () => {
    expect(() => resolveInputs(argv("a@b.com"), { ADMIN_PASSWORD: "short" })).toThrow(/12 characters/);
  });
});

describe("set-admin-password hash is accepted by admin login", () => {
  it("hashes a password that verifyPassword then accepts (and rejects a wrong one)", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong password entirely", hash)).toBe(false);
  });
});
