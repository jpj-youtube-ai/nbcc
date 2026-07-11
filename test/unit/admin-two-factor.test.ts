import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  generateLoginCode,
  hashLoginCode,
  verifyLoginCode,
  ADMIN_DEVICE_TTL_MS,
  issueDeviceToken,
  verifyDeviceToken,
} from "../../src/admin/two-factor";

// Phase 3 (TASK-188), Task 1: pure crypto for mandatory email 2FA on admin login + the 30-day
// trusted-device token. No DB, no Express — just the code hash/verify and the device-token
// sign/verify, mirroring the base64url(claims).base64url(hmac) shape of src/admin/session.ts and
// the domain-prefix pattern of src/admin/tokens.ts (ACTION_TOKEN_DOMAIN) so a device token can
// never validate as any other token type.

const secret = "test-secret";
const now = new Date("2026-07-11T12:00:00Z");

describe("generateLoginCode", () => {
  it("returns a 6-digit numeric string", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateLoginCode();
      expect(code).toMatch(/^[0-9]{6}$/);
    }
  });
});

describe("hashLoginCode / verifyLoginCode", () => {
  it("round-trips: verify succeeds for the code that produced the hash", () => {
    const hash = hashLoginCode("123456", secret);
    expect(verifyLoginCode("123456", hash, secret)).toBe(true);
  });

  it("hashes as base64url HMAC-SHA256 of the domain-prefixed code", () => {
    const hash = hashLoginCode("123456", secret);
    const expected = createHmac("sha256", secret).update("admincode.v1:123456").digest("base64url");
    expect(hash).toBe(expected);
  });

  it("rejects the wrong code", () => {
    const hash = hashLoginCode("123456", secret);
    expect(verifyLoginCode("654321", hash, secret)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const hash = hashLoginCode("123456", secret);
    expect(verifyLoginCode("123456", hash, "other-secret")).toBe(false);
  });

  it("rejects a malformed / differently-sized hash without throwing", () => {
    expect(verifyLoginCode("123456", "not-a-real-hash", secret)).toBe(false);
    expect(verifyLoginCode("123456", "", secret)).toBe(false);
  });
});

describe("device token TTL", () => {
  it("is 30 days in ms", () => {
    expect(ADMIN_DEVICE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("issueDeviceToken / verifyDeviceToken", () => {
  it("round-trips: verify returns the sub for a freshly issued token", () => {
    const token = issueDeviceToken({ sub: 7, now, secret });
    expect(verifyDeviceToken(token, secret, now)).toEqual({ sub: 7 });
  });

  it("defaults to the 30-day TTL", () => {
    const token = issueDeviceToken({ sub: 7, now, secret });
    const justBeforeExpiry = new Date(now.getTime() + ADMIN_DEVICE_TTL_MS - 1000);
    const justAfterExpiry = new Date(now.getTime() + ADMIN_DEVICE_TTL_MS + 1000);
    expect(verifyDeviceToken(token, secret, justBeforeExpiry)).toEqual({ sub: 7 });
    expect(verifyDeviceToken(token, secret, justAfterExpiry)).toBeNull();
  });

  it("returns null (not throw) for a tampered token", () => {
    const token = issueDeviceToken({ sub: 7, now, secret });
    expect(() => verifyDeviceToken(token + "x", secret, now)).not.toThrow();
    expect(verifyDeviceToken(token + "x", secret, now)).toBeNull();
  });

  it("returns null for a malformed token", () => {
    expect(verifyDeviceToken("not-a-token", secret, now)).toBeNull();
    expect(verifyDeviceToken("", secret, now)).toBeNull();
    expect(verifyDeviceToken("a.b.c", secret, now)).toBeNull();
  });

  it("returns null for the wrong secret", () => {
    const token = issueDeviceToken({ sub: 7, now, secret });
    expect(verifyDeviceToken(token, "other-secret", now)).toBeNull();
  });

  it("returns null for an explicitly expired token (custom ttlMs)", () => {
    const token = issueDeviceToken({ sub: 7, now, secret, ttlMs: 1000 });
    expect(verifyDeviceToken(token, secret, new Date(now.getTime() + 2000))).toBeNull();
  });

  it("signs the body with the admindevice.v1: domain prefix, not a bare HMAC over the body", () => {
    const token = issueDeviceToken({ sub: 7, now, secret });
    const [body, sig] = token.split(".");
    const bareSig = createHmac("sha256", secret).update(body).digest("base64url");
    expect(sig).not.toBe(bareSig);
    const domainSig = createHmac("sha256", secret).update(`admindevice.v1:${body}`).digest("base64url");
    expect(sig).toBe(domainSig);
  });

  it("does not verify a session-style token signed without the admindevice.v1: domain prefix", () => {
    // Same base64url(claims).base64url(hmac) shape, same claims content, same secret — but signed
    // as a bare HMAC over the body (the pre-domain-separation session.ts pattern) rather than with
    // the admindevice.v1: prefix. Must be rejected: domain separation means a signature computed
    // under a different domain can never validate here.
    const claims = { sub: 7, purpose: "device", iat: now.getTime(), exp: now.getTime() + ADMIN_DEVICE_TTL_MS };
    const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const bareSig = createHmac("sha256", secret).update(body).digest("base64url");
    const bareToken = `${body}.${bareSig}`;
    expect(verifyDeviceToken(bareToken, secret, now)).toBeNull();
  });
});
