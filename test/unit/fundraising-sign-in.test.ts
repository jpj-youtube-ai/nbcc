import { describe, it, expect } from "vitest";
import {
  SIGN_IN_CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  SESSION_TTL_MS,
  SESSION_COOKIE,
  SESSION_COOKIE_PATH,
  newSignInCode,
  readCode,
  spacedCode,
  hashSignInCode,
  signInCodeMatches,
  codeVerdict,
  newSessionId,
  hashSessionId,
  sessionCookieOptions,
  sentFromOurOwnPage,
} from "../../src/fundraising/sign-in";

// TASK-501: the sign in code and the signed in session for the fundraising private area. Pure: the
// clock and the secret are passed in. Every address here is invented.

const SECRET = "a-test-secret";

describe("the sign in code", () => {
  it("is six digits, zero padded, and differs from one to the next", () => {
    const codes = new Set(Array.from({ length: 50 }, () => newSignInCode()));
    for (const c of codes) expect(c).toMatch(/^\d{6}$/);
    expect(codes.size).toBeGreaterThan(40);
  });

  it("works for 10 minutes and allows 5 tries", () => {
    expect(SIGN_IN_CODE_TTL_MS).toBe(10 * 60 * 1000);
    expect(MAX_CODE_ATTEMPTS).toBe(5);
  });

  it("is read from what was typed, spaces and all, and nothing else counts", () => {
    expect(readCode("482 915")).toBe("482915");
    expect(readCode(" 482915 ")).toBe("482915");
    expect(readCode("482-915")).toBe("482915");
    expect(readCode("48291")).toBeNull();
    expect(readCode("4829155")).toBeNull();
    expect(readCode("abcdef")).toBeNull();
    expect(readCode(482915)).toBeNull();
    expect(readCode(undefined)).toBeNull();
  });

  it("is written with a space in the middle for the subject line", () => {
    expect(spacedCode("482915")).toBe("482 915");
  });

  it("is stored as a keyed hash, never as itself, bound to the email it was sent to", () => {
    const h = hashSignInCode("sam@example.com", "482915", SECRET);
    expect(h).not.toContain("482915");
    expect(h).toBe(hashSignInCode("SAM@example.com", "482915", SECRET));
    expect(h).not.toBe(hashSignInCode("kim@example.com", "482915", SECRET));
    expect(h).not.toBe(hashSignInCode("sam@example.com", "482915", "another-secret"));
  });

  it("matches only the right code for the right email under the same secret", () => {
    const h = hashSignInCode("sam@example.com", "482915", SECRET);
    expect(signInCodeMatches("sam@example.com", "482915", h, SECRET)).toBe(true);
    expect(signInCodeMatches("sam@example.com", "482916", h, SECRET)).toBe(false);
    expect(signInCodeMatches("kim@example.com", "482915", h, SECRET)).toBe(false);
    expect(signInCodeMatches("sam@example.com", "482915", "short", SECRET)).toBe(false);
    expect(signInCodeMatches("sam@example.com", "482915", "", SECRET)).toBe(false);
  });
});

describe("whether a try at a code gets in", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const row = (over: Partial<{ codeHash: string; expiresAt: Date; attempts: number }> = {}) => ({
    codeHash: hashSignInCode("sam@example.com", "482915", SECRET),
    expiresAt: new Date(now.getTime() + 60_000),
    attempts: 1,
    ...over,
  });

  it("lets in the right code inside its time", () => {
    expect(codeVerdict(row(), "sam@example.com", "482915", SECRET, now)).toBe("ok");
  });

  it("refuses a wrong code", () => {
    expect(codeVerdict(row(), "sam@example.com", "111111", SECRET, now)).toBe("wrong");
  });

  it("refuses with no code waiting", () => {
    expect(codeVerdict(null, "sam@example.com", "482915", SECRET, now)).toBe("none");
  });

  it("refuses the right code once its 10 minutes are up", () => {
    expect(codeVerdict(row({ expiresAt: now }), "sam@example.com", "482915", SECRET, now)).toBe("expired");
  });

  it("counts every try, the right one too, and after five the code is dead", () => {
    expect(codeVerdict(row({ attempts: 5 }), "sam@example.com", "482915", SECRET, now)).toBe("ok");
    expect(codeVerdict(row({ attempts: 6 }), "sam@example.com", "482915", SECRET, now)).toBe("dead");
  });
});

describe("the signed in session", () => {
  it("is a long random id, kept only as its sha256", () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashSessionId(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionId(a)).not.toBe(hashSessionId(b));
  });

  it("lasts two hours", () => {
    expect(SESSION_TTL_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("rides in an http only, SameSite Lax cookie, Secure in production, for the private area's API only", () => {
    expect(SESSION_COOKIE).toBe("nbcc_fr_session");
    expect(SESSION_COOKIE_PATH).toBe("/api/fundraise/manage");
    expect(sessionCookieOptions(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/fundraise/manage",
      maxAge: SESSION_TTL_MS,
    });
    expect(sessionCookieOptions(false).secure).toBe(false);
  });
});

describe("a change sent to the private area", () => {
  const host = "nbcc.scot";
  it("is taken from our own page", () => {
    expect(sentFromOurOwnPage({ secFetchSite: "same-origin" }, host)).toBe(true);
    expect(sentFromOurOwnPage({ origin: "https://nbcc.scot" }, host)).toBe(true);
    expect(sentFromOurOwnPage({ origin: "https://www.nbcc.scot" }, host)).toBe(true);
    expect(sentFromOurOwnPage({ origin: "http://localhost:3000" }, "localhost:3000")).toBe(true);
  });

  it("is refused from another website, whatever else it says", () => {
    expect(sentFromOurOwnPage({ secFetchSite: "cross-site" }, host)).toBe(false);
    expect(sentFromOurOwnPage({ secFetchSite: "same-site" }, host)).toBe(false);
    expect(sentFromOurOwnPage({ secFetchSite: "cross-site", origin: "https://nbcc.scot" }, host)).toBe(false);
    expect(sentFromOurOwnPage({ origin: "https://evil.example" }, host)).toBe(false);
    expect(sentFromOurOwnPage({ origin: "null" }, host)).toBe(false);
  });

  it("is taken from something that is not a browser, which sends neither (a browser always does)", () => {
    expect(sentFromOurOwnPage({}, host)).toBe(true);
  });
});
