import { describe, it, expect } from "vitest";
import { issueAdminActionToken, verifyAdminActionToken, AdminActionTokenError, adminActionLink } from "../../src/admin/tokens";

const secret = "test-secret";
const now = new Date("2026-07-10T12:00:00Z");

describe("admin action tokens", () => {
  it("round-trips an invite token", () => {
    const t = issueAdminActionToken({ sub: 7, purpose: "invite", bind: "", now, secret });
    expect(verifyAdminActionToken(t, secret, now)).toEqual({ sub: 7, purpose: "invite", bind: "" });
  });
  it("rejects a tampered token", () => {
    const t = issueAdminActionToken({ sub: 7, purpose: "reset", bind: "h", now, secret });
    expect(() => verifyAdminActionToken(t + "x", secret, now)).toThrow(AdminActionTokenError);
  });
  it("rejects the wrong secret", () => {
    const t = issueAdminActionToken({ sub: 7, purpose: "reset", bind: "h", now, secret });
    expect(() => verifyAdminActionToken(t, "other", now)).toThrow(/bad_signature/);
  });
  it("expires", () => {
    const t = issueAdminActionToken({ sub: 7, purpose: "reset", bind: "h", now, ttlMs: 1000, secret });
    expect(() => verifyAdminActionToken(t, secret, new Date(now.getTime() + 2000))).toThrow(/expired/);
  });
  it("builds a link", () => {
    expect(adminActionLink("https://nbcc.scot", "/invite", "TOK")).toBe("https://nbcc.scot/invite?token=TOK");
  });
});
