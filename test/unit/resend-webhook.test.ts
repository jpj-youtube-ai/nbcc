import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifySvixSignature, parseResendEvent } from "../../src/newsletter/resend-events";

// TASK-255: the Resend webhook is the ONLY writer of delivery facts, and it is a public URL — the
// signature check is the entire trust boundary, exactly as constructEvent is for Stripe. Resend signs
// with Svix: secret `whsec_<base64key>`, signed content `${id}.${timestamp}.${body}`, HMAC-SHA256,
// base64, offered in the svix-signature header as space-separated `v1,<sig>` candidates.
//
// Verification is PURE (secret, headers, raw body, now) so every rejection path is unit-tested
// without HTTP — the same discipline as the unsubscribe token.

const KEY = Buffer.from("test-webhook-key-32-bytes-long!!").toString("base64");
const SECRET = `whsec_${KEY}`;

function sig(id: string, ts: number, body: string, secret = SECRET): string {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  return createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
}

const NOW = 1_752_672_000_000; // fixed clock: 2025-07-16T12:00:00Z-ish; only relative offsets matter
const BODY = JSON.stringify({ type: "email.delivered", created_at: "2026-07-16T12:00:00.000Z", data: { to: ["dora@example.com"] } });

function headers(overrides: Partial<Record<"id" | "ts" | "sig", string>> = {}) {
  const ts = overrides.ts ?? String(Math.floor(NOW / 1000));
  return {
    "svix-id": overrides.id ?? "msg_1",
    "svix-timestamp": ts,
    "svix-signature": overrides.sig ?? `v1,${sig(overrides.id ?? "msg_1", Number(ts), BODY)}`,
  };
}

describe("verifySvixSignature (TASK-255)", () => {
  it("accepts a genuinely signed payload", () => {
    expect(verifySvixSignature(SECRET, headers(), BODY, NOW)).toBe(true);
  });

  it("rejects a tampered body — the signature covers every byte", () => {
    expect(verifySvixSignature(SECRET, headers(), BODY.replace("delivered", "bounced"), NOW)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const wrong = `whsec_${Buffer.from("a-completely-different-key-here!").toString("base64")}`;
    expect(verifySvixSignature(wrong, headers(), BODY, NOW)).toBe(false);
  });

  it("rejects a stale timestamp — a replayed capture is not a fresh report", () => {
    const oldTs = String(Math.floor(NOW / 1000) - 6 * 60); // 6 min old, past the 5-min window
    const h = { "svix-id": "msg_1", "svix-timestamp": oldTs, "svix-signature": `v1,${sig("msg_1", Number(oldTs), BODY)}` };
    expect(verifySvixSignature(SECRET, h, BODY, NOW)).toBe(false);
  });

  it("accepts when ANY of the space-separated candidate signatures matches (key rotation)", () => {
    const good = sig("msg_1", Math.floor(NOW / 1000), BODY);
    const h = headers({ sig: `v1,notthisone v1,${good}` });
    expect(verifySvixSignature(SECRET, h, BODY, NOW)).toBe(true);
  });

  it("rejects when headers are missing entirely", () => {
    expect(verifySvixSignature(SECRET, {}, BODY, NOW)).toBe(false);
  });
});

describe("parseResendEvent (TASK-255)", () => {
  it("maps the three event types we consume, lowercasing the address", () => {
    for (const [type, want] of [
      ["email.delivered", "delivered"],
      ["email.bounced", "bounced"],
      ["email.complained", "complained"],
    ] as const) {
      const p = parseResendEvent(JSON.stringify({ type, created_at: "2026-07-16T12:00:00.000Z", data: { to: ["Dora@Example.com"] } }));
      expect(p).toMatchObject({ eventType: want, email: "dora@example.com" });
      expect(p?.occurredAt instanceof Date).toBe(true);
    }
  });

  it("takes the first recipient whether `to` is an array or a bare string", () => {
    expect(parseResendEvent(JSON.stringify({ type: "email.delivered", created_at: "2026-07-16T12:00:00.000Z", data: { to: "solo@example.com" } }))?.email).toBe("solo@example.com");
  });

  it("returns null for event types we do not consume — acknowledged, never stored", () => {
    expect(parseResendEvent(JSON.stringify({ type: "email.opened", created_at: "2026-07-16T12:00:00.000Z", data: { to: ["a@b.c"] } }))).toBeNull();
    expect(parseResendEvent(JSON.stringify({ type: "email.sent", created_at: "2026-07-16T12:00:00.000Z", data: { to: ["a@b.c"] } }))).toBeNull();
  });

  it("returns null rather than throwing on garbage — a malformed body must not 500 the endpoint", () => {
    expect(parseResendEvent("not json")).toBeNull();
    expect(parseResendEvent(JSON.stringify({ type: "email.delivered" }))).toBeNull(); // no recipient
    expect(parseResendEvent(JSON.stringify({ type: "email.delivered", created_at: "garbage", data: { to: ["a@b.c"] } }))).toBeNull();
  });

  it("carries the bounce reason through as detail, and nothing else", () => {
    const p = parseResendEvent(JSON.stringify({
      type: "email.bounced",
      created_at: "2026-07-16T12:00:00.000Z",
      data: { to: ["gone@example.com"], bounce: { message: "550 no such user" }, subject: "private" },
    }));
    expect(p?.detail).toEqual({ message: "550 no such user" });
  });
});
