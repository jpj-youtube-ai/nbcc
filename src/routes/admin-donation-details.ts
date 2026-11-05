import { Router, type Request, type Response } from "express";
import { authorizeSection } from "./admin-authz";
import { getDonationDetails } from "../db/donation-details";

// GET /api/admin/donations/:kind/:id/details: everything we know of one gift (kind "donation") or one
// Elf Detective School payment (kind "elf"), for the click down in the Donations gift log. The shape
// is documented at the top of src/db/donation-details.ts. Gated as the list is (Donations: view), and
// the check comes first, so nobody else can set off a look up at Stripe. Personal details, so never
// kept in a cache. An unknown kind or id is 404; a failure is 500, which the screen shows as such.

const KINDS = new Set(["donation", "elf"]);
const ID = /^[1-9]\d{0,9}$/;
const INT_MAX = 2147483647;

export async function getAdminDonationDetails(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "donations", "view"))) return;
  res.set("Cache-Control", "no-store");
  const kind = String(req.params.kind ?? "");
  const raw = String(req.params.id ?? "");
  const id = ID.test(raw) ? Number(raw) : NaN;
  if (!KINDS.has(kind) || !Number.isInteger(id) || id > INT_MAX) return res.status(404).json({ error: "Not found" });
  try {
    const details = await getDonationDetails(kind, id);
    if (!details) return res.status(404).json({ error: "Not found" });
    return res.status(200).json(details);
  } catch (err) {
    console.error("admin donation details failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

export const adminDonationDetailsRouter = Router();
adminDonationDetailsRouter.get("/api/admin/donations/:kind/:id/details", getAdminDonationDetails);
