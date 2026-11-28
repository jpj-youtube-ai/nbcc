import { Router, type Request, type Response } from "express";
import { authorizeSection, loadEffectivePermissions } from "./admin-authz";
import { can } from "../admin/permissions";
import { listDropOffs, removeDropOff } from "../db/workshop-dropoffs";
import { recordAudit } from "../db/donations";

// Admin > Giving > Workshop drop-offs (docs/superpowers/specs/2026-11-28-workshop-dropoffs-design.md).
// No permission of its own, like Invoices: view of Donations sees the list, edit of Donations removes
// a test or nonsense entry. The proper thank-you letter is sent from Admin > Thank you, which the
// screen opens already filled in.

function idOf(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function getAdminDropOffs(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "view");
  if (!claims) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const [dropOffs, perms] = await Promise.all([listDropOffs(), loadEffectivePermissions(claims.sub)]);
    // What the screen offers: Remove to editors of Donations, and the letter button to those who
    // can send thank-you letters. The server checks each again when it is used.
    return res.status(200).json({
      dropOffs,
      mayRemove: !!perms && can(perms, "donations", "edit"),
      mayWriteLetter: !!perms && can(perms, "thank-you", "edit"),
    });
  } catch (err) {
    console.error("admin drop-offs: listing failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "The workshop drop-offs could not load. Please try again." });
  }
}

export async function deleteAdminDropOff(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "edit");
  if (!claims) return;
  res.setHeader("Cache-Control", "no-store");
  const id = idOf(req.params.id);
  if (!id || !(await removeDropOff(id))) return res.status(404).json({ error: "That drop-off is not there any more." });
  try {
    await recordAudit({ actor: `admin:${claims.email}`, action: "workshop_dropoff.removed", entity: "workshop_dropoff", entityId: id, data: {} });
  } catch (err) {
    console.error("admin drop-offs: audit failed:", err instanceof Error ? err.message : err);
  }
  return res.status(200).json({ ok: true });
}

export const adminDropOffsRouter = Router();
adminDropOffsRouter.get("/api/admin/drop-offs", getAdminDropOffs);
adminDropOffsRouter.delete("/api/admin/drop-offs/:id", deleteAdminDropOff);
