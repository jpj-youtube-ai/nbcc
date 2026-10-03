import { describe, it, expect } from "vitest";
import { signPledgeToken, verifyPledgeToken, newPledgeNonce } from "../../src/pledges/token";
import { signInvoiceToken } from "../../src/ball/invoice-token";

// Sponsor pledges: the secure link in the pay email. Stateless and signed, like the Ball's invoice
// link: "<pledge id>.<signature>". The signature covers the pledge's own nonce, so a link dies when
// the nonce is changed, and a token signed for anything else never opens a pledge.

const SECRET = "a-test-secret-that-is-not-real";

describe("the pledge pay link token", () => {
  it("round trips to the pledge id", () => {
    const token = signPledgeToken(42, "nonce-a", SECRET);
    expect(token).toMatch(/^42\.[A-Za-z0-9_-]{43}$/);
    expect(verifyPledgeToken(token, (id) => (id === 42 ? "nonce-a" : null), SECRET)).toBe(42);
  });

  it("gives the id to look the nonce up by, before anything is trusted", () => {
    const seen: number[] = [];
    verifyPledgeToken(signPledgeToken(7, "n", SECRET), (id) => (seen.push(id), "n"), SECRET);
    expect(seen).toEqual([7]);
  });

  it.each([
    ["a changed signature", (t: string) => t.slice(0, -2) + (t.endsWith("AA") ? "BB" : "AA")],
    ["another pledge's id", (t: string) => t.replace(/^42\./, "43.")],
    ["no signature", () => "42."],
    ["not a token at all", () => "hello"],
    ["nothing", () => ""],
  ])("refuses %s", (_what, change) => {
    const token = change(signPledgeToken(42, "nonce-a", SECRET));
    expect(verifyPledgeToken(token, () => "nonce-a", SECRET)).toBeNull();
  });

  it("refuses once the pledge's nonce has changed, or the pledge is gone", () => {
    const token = signPledgeToken(42, "nonce-a", SECRET);
    expect(verifyPledgeToken(token, () => "nonce-b", SECRET)).toBeNull();
    expect(verifyPledgeToken(token, () => null, SECRET)).toBeNull();
  });

  it("refuses a token signed with another secret, or for another purpose", () => {
    expect(verifyPledgeToken(signPledgeToken(42, "nonce-a", "other"), () => "nonce-a", SECRET)).toBeNull();
    expect(verifyPledgeToken(signInvoiceToken(42, SECRET), () => "nonce-a", SECRET)).toBeNull();
  });

  it("makes a long random nonce, different every time", () => {
    const a = newPledgeNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    expect(newPledgeNonce()).not.toBe(a);
  });
});
