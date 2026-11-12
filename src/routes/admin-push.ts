import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeAny } from "./admin-authz";
import { config } from "../config";
import { pushIsConfigured } from "../config/schema";
import { deleteSubscription, getPrefs, saveSubscription, setPrefs, subscriptionsFor } from "../db/admin-push";
import { isArea } from "../admin/whats-new";

// Turning phone notifications on, and choosing what buzzes (TASK-NNN).
//
//   GET    /api/admin/push/key            { publicKey, configured } — what the browser subscribes with
//   GET    /api/admin/push/subscription   { phones: n } — whether THIS person has any phone on
//   POST   /api/admin/push/subscription   the browser's subscription, stored against this person
//   DELETE /api/admin/push/subscription   { endpoint } — this phone stops being buzzed
//   GET    /api/admin/push/prefs          their settings
//   PUT    /api/admin/push/prefs          change them
//
// Open to anyone signed in, like the New pills these follow: a person is only ever subscribing
// their OWN phone and setting their OWN preferences, and what they actually receive is filtered
// by their permissions at send time, read fresh on every sweep.

function failed(res: Response, what: string, err: unknown): Response {
  console.error(`admin push: ${what} failed:`, err instanceof Error ? err.message : err);
  return res.status(500).json({ error: "Admin is temporarily unavailable" });
}

const subscriptionSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

const prefsSchema = z.object({
  bundle: z.boolean(),
  // "HH:MM" from an <input type="time">, or null for no quiet hours.
  // A real time, not merely four digits: "99:99" passed the looser pattern, Postgres then
  // rejected it, and the person was told "Admin is temporarily unavailable" for their own typo.
  quietFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).nullable(),
  quietTo: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).nullable(),
  areasOff: z.array(z.string()).max(50),
});

export const adminPushRouter = Router();

// The public half of the VAPID pair, which the browser needs to create a subscription. Public by
// design — it travels to every subscriber — but still behind the admin session, because there is
// no reason for the world to know whether this charity sends staff notifications.
adminPushRouter.get("/api/admin/push/key", async (req: Request, res: Response) => {
  const claims = await authorizeAny(req, res);
  if (!claims) return;
  return res.status(200).json({
    publicKey: config.VAPID_PUBLIC_KEY,
    // The screen says "not set up yet" rather than offering a button that cannot work.
    configured: pushIsConfigured(config),
  });
});

adminPushRouter.get("/api/admin/push/subscription", async (req: Request, res: Response) => {
  const claims = await authorizeAny(req, res);
  if (!claims) return;
  try {
    const phones = await subscriptionsFor(claims.sub);
    // Only the count: an endpoint is a capability to buzz that phone, so there is no reason to
    // hand one back to a browser that did not create it.
    return res.status(200).json({ phones: phones.length });
  } catch (err) {
    return failed(res, "reading subscriptions", err);
  }
});

adminPushRouter.post("/api/admin/push/subscription", async (req: Request, res: Response) => {
  const claims = await authorizeAny(req, res);
  if (!claims) return;
  const parsed = subscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid subscription", details: parsed.error.flatten() });
  }
  try {
    await saveSubscription(claims.sub, parsed.data);
    return res.status(204).end();
  } catch (err) {
    // saveSubscription throws for a junk key or a non-https endpoint. That is the caller's fault,
    // not ours, and the message names the field.
    if (err instanceof Error && /endpoint|key|auth secret|https/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    return failed(res, "saving a subscription", err);
  }
});

adminPushRouter.delete("/api/admin/push/subscription", async (req: Request, res: Response) => {
  const claims = await authorizeAny(req, res);
  if (!claims) return;
  const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
  if (!endpoint) return res.status(400).json({ error: "Which phone?" });
  try {
    // Scoped to the signed-in person as well as the endpoint: knowing somebody else's endpoint
    // must not be enough to silence their phone.
    await deleteSubscription(endpoint, claims.sub);
    return res.status(204).end();
  } catch (err) {
    return failed(res, "removing a subscription", err);
  }
});

adminPushRouter.get("/api/admin/push/prefs", async (req: Request, res: Response) => {
  const claims = await authorizeAny(req, res);
  if (!claims) return;
  try {
    return res.status(200).json(await getPrefs(claims.sub));
  } catch (err) {
    return failed(res, "reading settings", err);
  }
});

adminPushRouter.put("/api/admin/push/prefs", async (req: Request, res: Response) => {
  const claims = await authorizeAny(req, res);
  if (!claims) return;
  const parsed = prefsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid settings", details: parsed.error.flatten() });
  }
  // Quiet hours only mean anything with both ends; half a setting is stored as none rather than
  // silently silencing a phone from 11pm to never.
  const bothEnds = parsed.data.quietFrom !== null && parsed.data.quietTo !== null;
  try {
    await setPrefs(claims.sub, {
      bundle: parsed.data.bundle,
      quietFrom: bothEnds ? parsed.data.quietFrom : null,
      quietTo: bothEnds ? parsed.data.quietTo : null,
      // An unknown area name would sit in the array for ever, switching off nothing.
      areasOff: parsed.data.areasOff.filter(isArea),
    });
    return res.status(204).end();
  } catch (err) {
    return failed(res, "saving settings", err);
  }
});
