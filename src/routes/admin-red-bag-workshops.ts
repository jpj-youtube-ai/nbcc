import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, loadEffectivePermissions } from "./admin-authz";
import { actorOf } from "./admin";
import { can } from "../admin/permissions";
import { drawQr, qrLink } from "../site/qr";
import { RED_BAG_PATH } from "../red-bag/switch";
import { WORKSHOP_SIZES, workshopView } from "../red-bag/workshop";
import {
  WORKSHOP_NAME_MAX,
  createRedBagWorkshop,
  listRedBagWorkshops,
  readRedBagWorkshopTotalsNow,
  setRedBagWorkshopArchived,
} from "../db/red-bag-workshops";

// Admin > Fill a Red Bag > Company Workshops (6 November 2026): a company's own link to Fill a Red
// Bag (nbcc.scot/fill/<slug>), whose gifts fill that company's Workshop shelves. The screen is
// assets/js/admin/red-bag-workshops.js, under the list editor on the same view.
//
//   GET  /api/admin/red-bag-workshops                       every company, its link, bags, total and code   red-bag view
//   POST /api/admin/red-bag-workshops                       { name, size, slug? }                           red-bag edit
//   POST /api/admin/red-bag-workshops/:id/archive           { archived }                                    red-bag edit
//   GET  /api/admin/red-bag-workshops/:id/qr?format=png     one company's code to download, PNG or SVG       red-bag view
//
// Adding and archiving are each in audit_log with the change (src/db/red-bag-workshops.ts).

export const adminRedBagWorkshopsRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };
export const WORKSHOP_MESSAGES = {
  name: `Give the company's name (up to ${WORKSHOP_NAME_MAX} letters).`,
  slug: "The link can only have small letters, numbers and single hyphens, and cannot be one the page already uses.",
  size: "Choose roughly how many people will see the link.",
  taken: "That link is already taken. Change it a little (for example add the town) and try again.",
  missing: "That company's Workshop is not there any more. Reload the page.",
} as const;

/** The link a company's printed QR code and its emails carry. */
export const workshopPath = (slug: string): string => `${RED_BAG_PATH}/${slug}`;

const createBody = z.object({
  name: z.string().max(200),
  size: z.enum(WORKSHOP_SIZES),
  slug: z.string().max(200).optional(),
});
const archiveBody = z.object({ archived: z.boolean() });

async function state(sub: number): Promise<Record<string, unknown>> {
  const [workshops, totals, perms] = await Promise.all([listRedBagWorkshops(), readRedBagWorkshopTotalsNow(), loadEffectivePermissions(sub)]);
  const rows = await Promise.all(
    workshops.map(async (w) => {
      const pence = totals.byWorkshopPence.get(w.id) ?? 0;
      return {
        id: w.id,
        name: w.name,
        slug: w.slug,
        size: w.size,
        link: `https://nbcc.scot${workshopPath(w.slug)}`,
        pence,
        bags: workshopView(pence, w.size).bags,
        archived: w.archivedAt !== null,
        createdAt: w.createdAt,
        qrSvg: w.archivedAt === null ? ((await drawQr(qrLink(workshopPath(w.slug)), "svg")) as string) : null,
      };
    }),
  );
  return {
    mayEdit: !!perms && can(perms, "red-bag", "edit"),
    everyone: { pence: totals.everyonePence, bags: workshopView(totals.everyonePence, "everyone").bags },
    workshops: rows,
  };
}

export async function getRedBagWorkshops(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "red-bag", "view");
  if (!claims) return;
  try {
    return res.status(200).json(await state(claims.sub));
  } catch (err) {
    console.error("admin red bag workshops: listing failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function postRedBagWorkshop(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "red-bag", "edit");
  if (!claims) return;
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.some((i) => i.path[0] === "size") ? WORKSHOP_MESSAGES.size : WORKSHOP_MESSAGES.name });
  try {
    const made = await createRedBagWorkshop({ ...parsed.data, by: actorOf(claims) });
    if (!made.ok) return res.status(made.reason === "taken" ? 409 : 400).json({ error: WORKSHOP_MESSAGES[made.reason], code: made.reason });
    return res.status(201).json(await state(claims.sub));
  } catch (err) {
    console.error("admin red bag workshops: adding failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function postRedBagWorkshopArchive(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "red-bag", "edit");
  if (!claims) return;
  const id = Number(req.params.id);
  const parsed = archiveBody.safeParse(req.body);
  if (!Number.isInteger(id) || id <= 0 || !parsed.success) return res.status(400).json({ error: WORKSHOP_MESSAGES.missing });
  try {
    const done = await setRedBagWorkshopArchived(id, parsed.data.archived, actorOf(claims));
    if (!done) return res.status(404).json({ error: WORKSHOP_MESSAGES.missing, code: "missing" });
    return res.status(200).json(await state(claims.sub));
  } catch (err) {
    console.error("admin red bag workshops: archiving failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function getRedBagWorkshopQr(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "red-bag", "view"))) return;
  const id = Number(req.params.id);
  const format = req.query.format;
  if (!Number.isInteger(id) || id <= 0 || (format !== "svg" && format !== "png")) return res.status(400).json({ error: WORKSHOP_MESSAGES.missing });
  try {
    const found = (await listRedBagWorkshops()).find((w) => w.id === id && w.archivedAt === null);
    if (!found) return res.status(404).json({ error: WORKSHOP_MESSAGES.missing, code: "missing" });
    const image = await drawQr(qrLink(workshopPath(found.slug)), format);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename="nbcc-fill-a-red-bag-${found.slug}.${format}"`);
    res.type(format === "svg" ? "image/svg+xml" : "image/png");
    return res.send(image);
  } catch (err) {
    console.error("admin red bag workshops: drawing a code failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

adminRedBagWorkshopsRouter.get("/api/admin/red-bag-workshops", getRedBagWorkshops);
adminRedBagWorkshopsRouter.post("/api/admin/red-bag-workshops", postRedBagWorkshop);
adminRedBagWorkshopsRouter.post("/api/admin/red-bag-workshops/:id/archive", postRedBagWorkshopArchive);
adminRedBagWorkshopsRouter.get("/api/admin/red-bag-workshops/:id/qr", getRedBagWorkshopQr);
