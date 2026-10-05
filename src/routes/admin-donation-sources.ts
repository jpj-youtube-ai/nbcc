import { Router, type Request, type Response } from "express";
import { authorizeSection } from "./admin-authz";
import { monthSoFar } from "../admin/overview-numbers";
import { RED_BAG_COUNTED_FROM_NOTE, sourceLines } from "../admin/gift-sources";
import { sumGiftsBySource } from "../db/overview-numbers";

// GET /api/admin/donations/source-totals: Fill a Red Bag against the Donate page, this UK month so
// far and all time, for the top of the Donations screen. Gated exactly as the donations list is
// (Donations: view), since it sums the same rows. One grouped read. A failure answers 500, which the
// screen shows as "could not load": never a zero.
export async function getAdminDonationSourceTotals(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "donations", "view"))) return;
  try {
    const totals = await sumGiftsBySource(monthSoFar(new Date()).current);
    return res.status(200).json({ totals, lines: sourceLines(totals), note: RED_BAG_COUNTED_FROM_NOTE });
  } catch (err) {
    console.error("admin donation source totals failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

export const adminDonationSourcesRouter = Router();
adminDonationSourcesRouter.get("/api/admin/donations/source-totals", getAdminDonationSourceTotals);
