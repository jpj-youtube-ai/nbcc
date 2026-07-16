import { createHmac, timingSafeEqual } from "node:crypto";

// TASK-255: verification + parsing for the Resend delivery webhook (Phase 1 of the email stats
// dashboard — see docs/superpowers/specs/2026-07-16-newsletter-email-stats-design.md).
//
// The webhook URL is public and it is the ONLY writer of delivery facts, so the Svix signature check
// below is the entire trust boundary — the same role Stripe's constructEvent plays for donations.
// Both functions are PURE (no config, no clock of their own, no DB) so every accept/reject path is
// unit-tested without HTTP.

// Svix scheme (what Resend signs with): secret `whsec_<base64 key>`; signed content
// `${svix-id}.${svix-timestamp}.${raw body}`; HMAC-SHA256, base64; the svix-signature header offers
// space-separated `v1,<sig>` candidates (several during key rotation — any one matching passes).
// The timestamp bounds replay: a capture older than 5 minutes is not a fresh report.
const TOLERANCE_MS = 5 * 60 * 1000;

export function verifySvixSignature(
  secret: string,
  headers: Record<string, string | undefined>,
  rawBody: string,
  nowMs: number,
): boolean {
  const id = headers["svix-id"];
  const timestamp = headers["svix-timestamp"];
  const signatureHeader = headers["svix-signature"];
  if (!secret.startsWith("whsec_") || !id || !timestamp || !signatureHeader) return false;

  const tsMs = Number(timestamp) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(nowMs - tsMs) > TOLERANCE_MS) return false;

  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();

  return signatureHeader.split(" ").some((candidate) => {
    const [version, sig] = candidate.split(",");
    if (version !== "v1" || !sig) return false;
    const offered = Buffer.from(sig, "base64");
    return offered.length === expected.length && timingSafeEqual(offered, expected);
  });
}

export type NewsletterEmailEventType = "delivered" | "bounced" | "complained" | "opened" | "clicked";

export interface ParsedResendEvent {
  eventType: NewsletterEmailEventType;
  email: string; // first recipient, lowercased — our sends have exactly one
  occurredAt: Date;
  detail: Record<string, unknown> | null; // the bounce reason and nothing else — never a whole payload
  // TASK-257: the DESTINATION a clicked event was for (per-link counts are the point of clicks).
  // Null on every other type — and on a click Resend reported without a usable link, which still
  // counts as a click, just not against a link.
  linkUrl: string | null;
}

const EVENT_MAP: Record<string, NewsletterEmailEventType> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  // TASK-257 (Phase 2): engagement. These only ever arrive once tracking is enabled on the
  // newsletter-only sending subdomain — the parser being ready is dormant capacity, not tracking.
  "email.opened": "opened",
  "email.clicked": "clicked",
};

// Null means "acknowledge and drop": an unconsumed type (email.sent/opened/…), a malformed body, or a
// payload with no recipient. The route 200s those — a webhook that 500s on surprises just gets
// hammered by Svix retries for data we never wanted.
export function parseResendEvent(rawBody: string): ParsedResendEvent | null {
  let payload: {
    type?: unknown;
    created_at?: unknown;
    data?: { to?: unknown; bounce?: unknown; click?: { link?: unknown }; link?: unknown };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const eventType = EVENT_MAP[String(payload?.type ?? "")];
  if (!eventType) return null;

  const to = payload?.data?.to;
  const first = Array.isArray(to) ? to[0] : to;
  if (typeof first !== "string" || !first.includes("@")) return null;

  const occurredAt = new Date(String(payload?.created_at ?? ""));
  if (Number.isNaN(occurredAt.getTime())) return null;

  const bounce = payload?.data?.bounce;
  const detail = eventType === "bounced" && bounce && typeof bounce === "object" ? (bounce as Record<string, unknown>) : null;

  // The clicked link: Resend nests it under data.click.link; accept a flat data.link too, because a
  // provider payload shape is theirs to evolve and a click without a link must degrade, not drop.
  let linkUrl: string | null = null;
  if (eventType === "clicked") {
    const candidate = payload?.data?.click?.link ?? payload?.data?.link;
    if (typeof candidate === "string" && candidate.trim()) linkUrl = candidate.trim();
  }

  return { eventType, email: first.trim().toLowerCase(), occurredAt, detail, linkUrl };
}
