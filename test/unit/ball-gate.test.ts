import { describe, it, expect } from "vitest";
import {
  isGateOpen,
  signGateToken,
  verifyGateToken,
  passwordMatches,
  GATE_COOKIE,
  readCookie,
} from "../../src/ball/gate";

const SECRET = "test-secret-for-the-ball-gate";
const NOW = new Date("2026-09-02T10:00:00Z");

describe("isGateOpen", () => {
  it("is shut by default", () => {
    expect(isGateOpen({ gateOpen: false, gateOpensAt: null }, NOW)).toBe(false);
  });

  it("opens when staff flip the toggle", () => {
    expect(isGateOpen({ gateOpen: true, gateOpensAt: null }, NOW)).toBe(true);
  });

  it("opens once the scheduled time has passed, even if nobody flipped it", () => {
    expect(isGateOpen({ gateOpen: false, gateOpensAt: "2026-09-02T09:00:00Z" }, NOW)).toBe(true);
  });

  it("stays shut before the scheduled time", () => {
    expect(isGateOpen({ gateOpen: false, gateOpensAt: "2026-09-04T08:00:00Z" }, NOW)).toBe(false);
  });

  it("a schedule in the future cannot re-close a manually opened gate", () => {
    expect(isGateOpen({ gateOpen: true, gateOpensAt: "2027-01-01T00:00:00Z" }, NOW)).toBe(true);
  });

  it("ignores an unparseable schedule rather than throwing on a live page", () => {
    expect(isGateOpen({ gateOpen: false, gateOpensAt: "not-a-date" }, NOW)).toBe(false);
  });
});

describe("passwordMatches", () => {
  it("accepts the right password", () => {
    expect(passwordMatches("sleigh-bells", "sleigh-bells")).toBe(true);
  });
  it("rejects the wrong one", () => {
    expect(passwordMatches("sleigh-bells", "wrong")).toBe(false);
  });
  it("rejects an empty attempt even against an empty configured value", () => {
    expect(passwordMatches("", "")).toBe(false);
  });
  it("is not fooled by a length-prefix match", () => {
    expect(passwordMatches("sleigh-bells", "sleigh")).toBe(false);
  });
});

describe("gate token", () => {
  it("round-trips a token it signed", () => {
    const token = signGateToken(SECRET, NOW);
    expect(verifyGateToken(token, SECRET, NOW)).toBe(true);
  });

  it("rejects a tampered token", () => {
    const token = signGateToken(SECRET, NOW);
    expect(verifyGateToken(token.slice(0, -2) + "xx", SECRET, NOW)).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    expect(verifyGateToken(signGateToken("other", NOW), SECRET, NOW)).toBe(false);
  });

  it("rejects nonsense", () => {
    expect(verifyGateToken("", SECRET, NOW)).toBe(false);
    expect(verifyGateToken("no-dot", SECRET, NOW)).toBe(false);
  });

  it("expires so a shared laptop does not stay unlocked forever", () => {
    const token = signGateToken(SECRET, NOW);
    const muchLater = new Date(NOW.getTime() + 15 * 24 * 60 * 60 * 1000);
    expect(verifyGateToken(token, SECRET, muchLater)).toBe(false);
  });
});

describe("readCookie", () => {
  it("finds the gate cookie among others", () => {
    expect(readCookie("a=1; " + GATE_COOKIE + "=abc; b=2", GATE_COOKIE)).toBe("abc");
  });
  it("returns null when absent or when there is no cookie header", () => {
    expect(readCookie("a=1", GATE_COOKIE)).toBeNull();
    expect(readCookie(undefined, GATE_COOKIE)).toBeNull();
  });
  it("does not match a cookie whose name merely ends with the target", () => {
    expect(readCookie("not_" + GATE_COOKIE + "=nope", GATE_COOKIE)).toBeNull();
  });
});
