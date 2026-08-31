// Verification-boundary parsing for the SES delivery webhook (Resend→SES migration; the role
// src/newsletter/resend-events.ts played for the Svix-signed Resend webhook).
//
// SES publishes events to an SNS topic, and SNS POSTs them to /api/webhooks/ses/<token>. The
// token in the path is the trust boundary (a shared secret, the role the Svix signing key
// played); these functions are the SHAPE boundary. Both are PURE (no config, no clock, no DB)
// so every accept/reject path is unit-tested without HTTP.

export type NewsletterEmailEventType = "delivered" | "bounced" | "complained" | "opened" | "clicked";

export interface ParsedEmailEvent {
  eventType: NewsletterEmailEventType;
  email: string; // first recipient, lowercased — our sends have exactly one
  occurredAt: Date;
  detail: Record<string, unknown> | null; // the bounce object and nothing else — never a whole payload
  // The DESTINATION a clicked event was for (per-link counts are the point of clicks). Null on
  // every other type — and on a click SES reported without a usable link, which still counts as
  // a click, just not against a link.
  linkUrl: string | null;
}

// The SNS envelope around every POST. Only two types matter: the one-time SubscriptionConfirmation
// handshake, and Notification (whose Message string is the SES event JSON). Anything else —
// UnsubscribeConfirmation, malformed JSON — returns null and the route acknowledges + drops.
export type SnsEnvelope =
  | { type: "SubscriptionConfirmation"; subscribeUrl: string }
  | { type: "Notification"; messageId: string; message: string };

export function parseSnsEnvelope(rawBody: string): SnsEnvelope | null {
  let payload: { Type?: unknown; MessageId?: unknown; Message?: unknown; SubscribeURL?: unknown };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (payload?.Type === "SubscriptionConfirmation") {
    const url = String(payload?.SubscribeURL ?? "");
    // Only ever fetch a confirmation URL that is genuinely SNS's: https, on an
    // sns.<region>.amazonaws.com host. Anything else is someone pointing us at their server.
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || !/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(parsed.hostname)) {
        return null;
      }
    } catch {
      return null;
    }
    return { type: "SubscriptionConfirmation", subscribeUrl: url };
  }
  if (payload?.Type === "Notification") {
    const messageId = String(payload?.MessageId ?? "");
    const message = payload?.Message;
    if (!messageId || typeof message !== "string") return null;
    return { type: "Notification", messageId, message };
  }
  return null;
}

const EVENT_MAP: Record<string, NewsletterEmailEventType> = {
  Delivery: "delivered",
  Bounce: "bounced",
  Complaint: "complained",
  // Engagement (TASK-257 lineage): clicks arrive once the newsletter configuration set includes
  // the CLICK event type. Opens are deliberately NOT subscribed (unreliable + invasive), but the
  // parser stays ready — dormant capacity, not tracking.
  Open: "opened",
  Click: "clicked",
};

// Null means "acknowledge and drop": an unconsumed type (Send/Rendering Failure/…), a malformed
// message, or a payload with no recipient. The route 200s those — a webhook that errors on
// surprises just gets hammered by SNS retries for data we never wanted.
export function parseSesEvent(message: string): ParsedEmailEvent | null {
  let payload: {
    eventType?: unknown;
    mail?: { timestamp?: unknown; destination?: unknown };
    delivery?: { timestamp?: unknown };
    bounce?: { timestamp?: unknown; bounceType?: unknown };
    complaint?: { timestamp?: unknown };
    click?: { timestamp?: unknown; link?: unknown };
    open?: { timestamp?: unknown };
  };
  try {
    payload = JSON.parse(message);
  } catch {
    return null;
  }
  const eventType = EVENT_MAP[String(payload?.eventType ?? "")];
  if (!eventType) return null;

  const destination = payload?.mail?.destination;
  const first = Array.isArray(destination) ? destination[0] : destination;
  if (typeof first !== "string" || !first.includes("@")) return null;

  // The per-event timestamp is when the thing HAPPENED; mail.timestamp (when we sent it) is the
  // fallback so a missing field degrades to a slightly-early time rather than a dropped event.
  const specific =
    payload?.delivery?.timestamp ??
    payload?.bounce?.timestamp ??
    payload?.complaint?.timestamp ??
    payload?.click?.timestamp ??
    payload?.open?.timestamp ??
    payload?.mail?.timestamp;
  const occurredAt = new Date(String(specific ?? ""));
  if (Number.isNaN(occurredAt.getTime())) return null;

  const bounce = payload?.bounce;
  const detail = eventType === "bounced" && bounce && typeof bounce === "object" ? (bounce as Record<string, unknown>) : null;

  let linkUrl: string | null = null;
  if (eventType === "clicked") {
    const candidate = payload?.click?.link;
    if (typeof candidate === "string" && candidate.trim()) linkUrl = candidate.trim();
  }

  return { eventType, email: first.trim().toLowerCase(), occurredAt, detail, linkUrl };
}

// TASK-272 lineage: which events take an address off every future send. Pure, so the rule is
// testable without a webhook or a database.
//   complained — ALWAYS. They pressed "report spam"; mailing them again is both against their
//                wishes and the fastest way to get the whole sending domain junked.
//   bounced    — only when SES calls it Permanent (the mailbox does not exist). A Transient
//                bounce is a full inbox or a server having a moment; suppressing on one of those
//                would silently lose a real supporter. Suppressing after N repeated soft bounces
//                is a deliberate follow-up in the route, not an oversight.
// Anything else returns null — recorded for the stats, never suppressed.
export function suppressionFor(
  event: ParsedEmailEvent,
): { reason: "bounced" | "complained"; detail: string | null } | null {
  if (event.eventType === "complained") return { reason: "complained", detail: null };
  if (event.eventType !== "bounced") return null;
  if (String(event.detail?.bounceType ?? "").toLowerCase() !== "permanent") return null;
  const recipients = event.detail?.bouncedRecipients;
  const diagnostic =
    Array.isArray(recipients) && recipients[0] && typeof recipients[0] === "object"
      ? (recipients[0] as Record<string, unknown>).diagnosticCode
      : null;
  const words = diagnostic ?? event.detail?.bounceSubType ?? null;
  return { reason: "bounced", detail: typeof words === "string" ? words : null };
}
