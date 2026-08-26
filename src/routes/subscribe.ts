import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { addListSubscriber, getSubscriberListBySlug, getListMemberByEmail } from "../db/subscriber-lists";
import { buildWelcomeEmail, shouldSendWelcome } from "../newsletter/welcome";
import { newsletterSender } from "../newsletter/theme";
import { signSubscriberUnsubscribeToken } from "../donors/unsubscribe-token";
import { sendNewsletter } from "../clients/email";
import { recordAudit } from "../db/donations";
import { config } from "../config";

// TASK-261: the public footer signup — every page's footer carries a small "keep in touch" form
// (rendered by assets/js/main.js), and this is the endpoint it posts to. Joins the NEWSLETTER
// audience with consent_source 'footer'.
//
// The consent checkbox is not decoration: UK marketing rules (PECR) need a POSITIVE, unticked action,
// so the schema requires consent to be literally true — typing an email is not legally consent.
// The person acting for themselves may revive their own earlier opt-out (revive: true) — unlike an
// import, which never may.
//
// Abuse posture for a public unauthenticated endpoint:
//   - honeypot: the form carries a visually-hidden "website" field; bots fill it, people never see
//     it. A filled honeypot answers 200 {ok:true} and records NOTHING — never tip the bot off.
//   - rate limit: a small fixed window per IP, mirroring the business-route limiter.
export const subscribeRouter = Router();

export const subscribeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  phone: z.string().trim().max(30).optional(),
  consent: z.literal(true),
  website: z.string().max(0).optional(), // the honeypot — anything in it is a bot
});

// Fixed-window per-IP limiter (same shape as the business fulfilment routes): 10 attempts / 10 min.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, { count: number; windowStart: number }>();

function overLimit(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

subscribeRouter.post("/api/subscribe", async (req: Request, res: Response) => {
  if (overLimit(req.ip ?? "unknown")) {
    return res.status(429).json({ error: "Too many attempts. Please try again shortly." });
  }

  // The honeypot check runs BEFORE validation: a bot that filled it gets a cheerful 200 and no row.
  if (typeof req.body?.website === "string" && req.body.website.length > 0) {
    return res.status(200).json({ ok: true });
  }

  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    const consentIssue = parsed.error.issues.some((i) => i.path[0] === "consent");
    return res.status(400).json({
      error: consentIssue
        ? "Please tick the box to confirm you'd like to hear from us"
        : "Please give your name and a valid email address",
    });
  }

  const list = await getSubscriberListBySlug("newsletter");
  if (!list) {
    // Seeded by migration — missing means the deploy is broken, not the visitor's problem.
    console.error("footer signup: newsletter list missing");
    return res.status(500).json({ error: "Something went wrong — please try again later" });
  }

  const outcome = await addListSubscriber(
    list.id,
    { name: parsed.data.name, email: parsed.data.email, phone: parsed.data.phone ?? null },
    "footer",
    { revive: true }, // the person themselves is re-consenting
  );
  // TASK-276: the welcome email. This is the safeguard that makes one-step signup safe — joining is
  // immediate (no confirmation click, so nobody is lost to an unclicked email), and this arrives at
  // once to say so, carrying the same one-click unsubscribe as every other send. Someone added by
  // mistake therefore finds out immediately and can leave in one press.
  //
  // BEST-EFFORT and last: the person IS subscribed by the write above, and failing their signup
  // because an email did not go would be backwards. Guarded by shouldSendWelcome, so this can only
  // ever fire for a footer signup — never for a volunteer's spreadsheet import.
  if (shouldSendWelcome("footer")) {
    void sendWelcome(list.id, parsed.data.email).catch((err) =>
      console.error("welcome email failed:", err instanceof Error ? err.message : err),
    );
  }
  return res.status(outcome === "added" ? 201 : 200).json({ ok: true, outcome });
});

// Send one welcome, and record that we did. Separate from the request so a slow provider never holds
// up the visitor's "you're signed up" response.
async function sendWelcome(listId: number, email: string): Promise<void> {
  const member = await getListMemberByEmail(listId, email);
  if (!member) return; // vanished between write and send — nothing to address it to
  const token = signSubscriberUnsubscribeToken(member.id, 0, config.ADMIN_SESSION_SECRET);
  const built = buildWelcomeEmail(member.name, `${config.PORTAL_BASE_URL}/unsubscribe/${token}`);
  await sendNewsletter({
    email,
    from: newsletterSender(config.NEWSLETTER_FROM_EMAIL),
    replyTo: config.NEWSLETTER_REPLY_TO_EMAIL,
    subject: built.subject,
    html: built.html,
    text: built.text,
    unsubscribeUrl: `${config.PORTAL_BASE_URL}/unsubscribe/${token}`,
  });
  // Recorded like any other outbound message, so "what have we sent this person?" stays answerable.
  try {
    await recordAudit({
      actor: "signup",
      action: "welcome.sent",
      entity: "list_subscriber",
      entityId: member.id,
      data: { email, list: listId },
    });
  } catch (err) {
    console.error("welcome audit failed:", err instanceof Error ? err.message : err);
  }
}
