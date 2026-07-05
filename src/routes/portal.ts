import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config";
import { PortalTokenError, portalMagicLink } from "../portal/tokens";
import {
  authenticatePortalToken,
  getDonorPortalSnapshot,
  updateDonorPortal,
  issuePortalAccessToken,
  findDonorBySubscriptionIds,
} from "../db/portal";
import { cancelSubscription, findSubscriptionIdsByEmail } from "../clients/stripe";
import { sendPortalMagicLink } from "../clients/email";
import { createRateLimiter } from "../portal/request-limiter";
import {
  cancelDeclaration,
  findActiveDeclarationIdForDonor,
  DeclarationCancellationError,
} from "../db/declarations";

// The self-serve donor portal API (REQ-061 · TASK-101). A donor reaches it via a one-time, expiring
// magic-link token (TASK-100); EVERY route authenticates that token with verifyPortalToken and
// rejects an invalid/expired/used one with 401. GET returns the donor's details + read-only status
// (subscription plan, Gift Aid); PATCH updates the donor's editable fields, appending a
// `donor.updated` audit row in the same transaction. Mounted in src/app.ts (after express.json).
export const portalRouter = Router();

// Authenticate the token in the path; returns the donor id, or null after sending a 401 response.
async function authOrReject(req: Request, res: Response): Promise<number | null> {
  try {
    const { donorId } = await authenticatePortalToken(req.params.token);
    return donorId;
  } catch (err) {
    if (err instanceof PortalTokenError) {
      res.status(401).json({ error: "Invalid or expired portal link" });
      return null;
    }
    console.error("portal auth failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Portal is temporarily unavailable" });
    return null;
  }
}

export async function getPortal(req: Request, res: Response): Promise<Response | void> {
  const donorId = await authOrReject(req, res);
  if (donorId == null) return;
  try {
    const snapshot = await getDonorPortalSnapshot(donorId);
    if (!snapshot) return res.status(404).json({ error: "Donor not found" });
    return res.status(200).json(snapshot);
  } catch (err) {
    console.error("portal read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Portal is temporarily unavailable" });
  }
}

// The editable fields. All optional (PATCH), but at least one must be present. fullName non-empty;
// email a valid address; the two flags booleans. Mirrors the zod-first validation in api.ts.
const patchBodySchema = z
  .object({
    fullName: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    emailConsent: z.boolean().optional(),
    anonymous: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "no fields to update" });

export async function patchPortal(req: Request, res: Response): Promise<Response | void> {
  const donorId = await authOrReject(req, res);
  if (donorId == null) return;

  const parsed = patchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid portal update", details: parsed.error.flatten() });
  }

  try {
    await updateDonorPortal(donorId, parsed.data);
    // Return the fresh snapshot so the caller sees the applied change.
    const snapshot = await getDonorPortalSnapshot(donorId);
    return res.status(200).json(snapshot);
  } catch (err) {
    console.error("portal update failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Portal update is temporarily unavailable" });
  }
}

// Cancel a monthly subscription (REQ-055 · TASK-102) — the "cancel" end of the
// reduce-instead-then-cancel flow. `accepted` is a REQUIRED acknowledgement that reduce-instead was
// offered: 'cancel' proceeds to the cancellation; 'reduce' means the donor took the reduce path
// (they should use change-plan) so cancellation is refused; a missing/invalid value is a 400 (the
// donor cannot cancel without being shown the reduce-instead option first). subscriptionId is
// validated like the change-plan endpoint.
const cancelBodySchema = z.object({
  subscriptionId: z.string().min(1),
  accepted: z.enum(["reduce", "cancel"]),
});

export async function postCancelSubscription(req: Request, res: Response): Promise<Response | void> {
  const donorId = await authOrReject(req, res);
  if (donorId == null) return;

  const parsed = cancelBodySchema.safeParse(req.body);
  if (!parsed.success) {
    // Missing/invalid `accepted` (the reduce-instead acknowledgement) or subscriptionId → 400.
    return res.status(400).json({ error: "Invalid cancel request", details: parsed.error.flatten() });
  }
  if (parsed.data.accepted !== "cancel") {
    // The donor chose to reduce instead — reducing is done via change-plan, not here.
    return res.status(400).json({ error: "reduce-instead was chosen; reduce the plan via change-plan" });
  }

  try {
    const subscription = await cancelSubscription(parsed.data.subscriptionId);
    return res.status(200).json(subscription);
  } catch (err) {
    // An upstream Stripe failure → 502, mirroring the change-plan endpoint's shape.
    console.error("subscription cancel failed:", err instanceof Error ? err.message : err);
    return res.status(502).json({ error: "Cancellation is temporarily unavailable" });
  }
}

// Cancel Gift Aid (REQ-061 · TASK-103) — revoke the donor's active declaration, stopping future
// claims, WITHOUT a superseding replacement (unlike an edit, REQ-059). The token authenticates the
// donor; we resolve their currently-active declaration and cancel it in one audited transaction
// (cancelDeclaration → sets revoked_at + a `declaration.revoked` audit row, no new declaration). No
// active declaration → 404; a concurrent cancel that already revoked it → 409.
export async function postCancelGiftAid(req: Request, res: Response): Promise<Response | void> {
  const donorId = await authOrReject(req, res);
  if (donorId == null) return;

  try {
    const declarationId = await findActiveDeclarationIdForDonor(donorId);
    if (declarationId == null) {
      return res.status(404).json({ error: "No active Gift Aid declaration to cancel" });
    }
    const result = await cancelDeclaration(declarationId, "donor");
    return res.status(200).json({ cancelled: true, declarationId: result.declarationId });
  } catch (err) {
    // A concurrent cancel revoked it between the lookup and the FOR UPDATE lock → nothing to cancel.
    if (err instanceof DeclarationCancellationError) {
      return res.status(409).json({ error: "Gift Aid is already cancelled" });
    }
    console.error("gift-aid cancel failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Gift Aid cancellation is temporarily unavailable" });
  }
}

// The self-serve portal access request (REQ-061 · TASK-123). A donor enters their email; we reach
// subscription donors via their Stripe customer email (always held by Stripe) and email them a
// one-time magic link. The response is ALWAYS the same generic 200 — match, no-match, or a failed
// send — so the endpoint never reveals whether an email belongs to a supporter (no enumeration).
const requestBodySchema = z.object({ email: z.string().trim().email() });

// Abuse control: cap requests per email and per client IP. In-memory + per-task (documented follow-up
// for a distributed limiter). Module-scoped so the window persists across requests.
const emailLimiter = createRateLimiter({ max: 3, windowMs: 15 * 60 * 1000 });
const ipLimiter = createRateLimiter({ max: 20, windowMs: 15 * 60 * 1000 });

const GENERIC_REQUEST_MESSAGE = "If that email matches a supporter, we've sent a portal link.";

export async function postRequestAccess(req: Request, res: Response): Promise<Response | void> {
  const parsed = requestBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "A valid email is required" });
  }
  const email = parsed.data.email;
  const now = Date.now();

  // Over-limit is treated exactly like any other outcome: the generic 200, no work done.
  if (emailLimiter.allow(email, now) && ipLimiter.allow(req.ip ?? "unknown", now)) {
    try {
      const subIds = await findSubscriptionIdsByEmail(email);
      const donor = await findDonorBySubscriptionIds(subIds);
      if (donor) {
        const { token } = await issuePortalAccessToken(donor.donorId, { actor: "donor" });
        const link = portalMagicLink(config.PORTAL_BASE_URL, token);
        // Best-effort, mirroring the other sends: a provider failure is logged, never surfaced.
        await sendPortalMagicLink({ email, fullName: donor.fullName, link });
      }
    } catch (err) {
      console.error("portal access request failed:", err instanceof Error ? err.message : err);
    }
  }

  return res.status(200).json({ message: GENERIC_REQUEST_MESSAGE });
}

portalRouter.get("/api/portal/:token", getPortal);
portalRouter.patch("/api/portal/:token", patchPortal);
portalRouter.post("/api/portal/:token/subscription/cancel", postCancelSubscription);
portalRouter.post("/api/portal/:token/gift-aid/cancel", postCancelGiftAid);
portalRouter.post("/api/portal/request", postRequestAccess);
