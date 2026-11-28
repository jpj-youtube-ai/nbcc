import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { insertDropOff } from "../db/workshop-dropoffs";
import { subscribeSelf } from "../newsletter/self-signup";
import { sendWorkshopThanks } from "../clients/email";
import { buildWorkshopThanksEmail } from "../drop-offs/emails";
import { safeFirstName } from "../fundraising/emails";

// Workshop drop-offs (docs/superpowers/specs/2026-11-28-workshop-dropoffs-design.md): the tablet page
// at /workshop (workshop.html) posts each drop-off here. The row is saved first; the newsletter and
// the thank you email follow, and neither failing ever shows the person an error, because their
// details are already safe and staff send the proper letter from the list.
//
// Abuse posture, as the footer sign up (src/routes/subscribe.ts): a hidden "website" honeypot (filled:
// a cheerful 200 and nothing saved) and a fixed window per address. The window is wider than the
// footer's because one tablet in the workshop sends every drop-off of the day from one address.
export const workshopRouter = Router();

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(200),
  brought: z.string().trim().min(1).max(500),
  groupName: optional(100),
  phone: optional(30),
  // Consent is a positive act (PECR): only a literal true joins the newsletter.
  newsletter: z.unknown().optional().transform((v) => v === true),
});

const MESSAGES: Record<string, string> = {
  name: "Please tell us your name.",
  email: "Please check your email address.",
  brought: "Please tell us what you brought in.",
};

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 60;
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

/** For tests: forget every address's count. */
export function resetWorkshopRateLimit(): void {
  hits.clear();
}

const logError = (what: string) => (err: unknown) => console.error(`workshop ${what} failed:`, err instanceof Error ? err.message : err);

workshopRouter.post("/api/workshop", async (req: Request, res: Response) => {
  if (overLimit(req.ip ?? "unknown")) {
    return res.status(429).json({ error: "Too many at once. Please wait a moment and try again." });
  }
  if (typeof req.body?.website === "string" && req.body.website.length > 0) {
    return res.status(200).json({ ok: true });
  }

  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const field = ["name", "email", "brought"].find((f) => parsed.error.issues.some((i) => i.path[0] === f)) ?? "name";
    return res.status(400).json({ error: MESSAGES[field], field });
  }
  const d = parsed.data;

  try {
    await insertDropOff({ name: d.name, email: d.email, brought: d.brought, groupName: d.groupName, phone: d.phone, newsletter: d.newsletter });
  } catch (err) {
    logError("save")(err);
    return res.status(500).json({ error: "Something went wrong. Please try again, or let one of the elves know." });
  }

  if (d.newsletter) {
    try {
      await subscribeSelf({ name: d.name, email: d.email, phone: d.phone }, "workshop");
    } catch (err) {
      logError("newsletter")(err);
    }
  }

  const built = buildWorkshopThanksEmail({ name: d.name, brought: d.brought, joinedNewsletter: d.newsletter });
  void sendWorkshopThanks({ email: d.email, name: d.name, ...built }).catch(logError("thank you email"));

  return res.status(201).json({ ok: true, firstName: safeFirstName(d.name) });
});
