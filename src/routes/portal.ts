import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { PortalTokenError } from "../portal/tokens";
import {
  authenticatePortalToken,
  getDonorPortalSnapshot,
  updateDonorPortal,
} from "../db/portal";

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

portalRouter.get("/api/portal/:token", getPortal);
portalRouter.patch("/api/portal/:token", patchPortal);
