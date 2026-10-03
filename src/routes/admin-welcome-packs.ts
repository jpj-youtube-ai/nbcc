import { Router, type Request, type Response } from "express";
import type { ZodIssue } from "zod";
import { authorizeSection } from "./admin-authz";
import { actorOf } from "./admin";
import { getFundraiser, listAllFundraisers } from "../db/fundraisers";
import { PackError, changePack, getPack, lastSignerFor, listPacks, listPosterSizes, posterSizesFor } from "../db/welcome-packs";
import { dateParts } from "../events/render";
import { londonToday } from "../events/model";
import { materialAssets, materialFacts, materialsMessagePage } from "../fundraising/materials";
import { pageUrlFor } from "../fundraising/page-url";
import { siteUrl } from "../fundraising/send";
import { packActionSchema, packToSend, packView, type PackView, type Signer } from "../fundraising/welcome-pack";
import { renderWelcomePack } from "../fundraising/welcome-pack-print";

// Welcome packs (Jaimie, 2026-10-03): the tick list in each approved sign up in Admin > Fundraising
// (src/fundraising/welcome-pack.ts has the rules). Section "fundraising": viewers look and print,
// editors and admins tick, leave out, mark sent and undo. Its own router, beside the Requests one.
//
//   GET  /api/admin/fundraising/packs          every page's pack, which are still to send, and   view
//                                              who this staff member last chose to sign a letter
//   POST /api/admin/fundraisers/:id/pack       { action: tick | untick | skip | send | undo |    edit
//                                              signer, ... }
//   GET  /api/admin/fundraisers/:id/pack/print the pack's one print view, a whole HTML page       view
//                                              (?part=letter for the letter on its own)
//
// Every change writes audit_log in the same transaction (src/db/welcome-packs.ts). The print view is
// drawn from the stored (approved) record only, never kept, never indexed.

export const adminWelcomePacksRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };
const LOOK_AGAIN = "Some of it needs another look";
/** When nobody has been chosen to sign, on this pack or by this staff member before. */
const NO_SIGNER: Signer = { name: "The NBCC team", role: null };

function fieldErrors(issues: ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

function idOf(raw: unknown): number | null {
  const s = String(raw ?? "");
  if (!/^[1-9]\d{0,9}$/.test(s)) return null;
  const id = Number(s);
  return id <= 2147483647 ? id : null;
}

export async function getPacks(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "view");
  if (!claims) return;
  try {
    const [fundraisers, stored, sizes, mySigner] = await Promise.all([listAllFundraisers(), listPacks(), listPosterSizes(), lastSignerFor(actorOf(claims))]);
    const sent = new Set([...stored].filter(([, p]) => p.sentAt).map(([id]) => id));
    const packs: Record<string, PackView> = {};
    const toSend: Record<string, true> = {};
    for (const f of fundraisers) {
      const view = packView(f, stored.get(f.id) ?? null, sizes.get(f.id) ?? null);
      if (!view) continue;
      packs[String(f.id)] = view;
      if (packToSend(f, sent)) toSend[String(f.id)] = true;
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ packs, toSend, mySigner });
  } catch (err) {
    console.error("admin welcome packs read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function postPack(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const id = idOf(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const parsed = packActionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: LOOK_AGAIN, fields: fieldErrors(parsed.error.issues) });
  try {
    const out = await changePack(id, parsed.data, actorOf(claims));
    return res.status(200).json({ pack: out.view, words: out.words });
  } catch (err) {
    if (err instanceof PackError) return res.status(err.reason === "conflict" ? 409 : 404).json({ error: err.message });
    console.error("admin welcome pack change failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

function html(res: Response, status: number, body: string): Response {
  return res.status(status).type("html").send(body);
}

export async function getPackPrint(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "view");
  if (!claims) return;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  const notThere = () => html(res, 404, materialsMessagePage("Not found", "There is no pack to print for this one. It may not be approved yet."));
  try {
    const id = idOf(req.params.id);
    const f = id ? await getFundraiser(id) : null;
    if (!id || !f) return notThere();
    const [stored, sizes] = await Promise.all([getPack(id), posterSizesFor(id)]);
    const view = packView(f, stored, sizes);
    if (!view) return notThere();
    const signer: Signer = view.signer ? { name: view.signer, role: view.signerRole } : ((await lastSignerFor(actorOf(claims))) ?? NO_SIGNER);
    const facts = materialFacts(f, f.meter, { pageUrl: pageUrlFor(f), getInvolvedUrl: siteUrl("/get-involved") });
    const p = dateParts(londonToday(new Date()));
    const page = renderWelcomePack({
      subject: f,
      view,
      facts,
      assets: materialAssets(),
      signer,
      date: `${p.day} ${p.month} ${p.year}`,
      part: req.query?.part === "letter" ? "letter" : "all",
    });
    return html(res, 200, page);
  } catch (err) {
    console.error("admin welcome pack print failed:", err instanceof Error ? err.message : err);
    return html(res, 500, materialsMessagePage("Sorry, something went wrong", "That could not be made just now. Please try again."));
  }
}

adminWelcomePacksRouter.get("/api/admin/fundraising/packs", getPacks);
adminWelcomePacksRouter.post("/api/admin/fundraisers/:id/pack", postPack);
adminWelcomePacksRouter.get("/api/admin/fundraisers/:id/pack/print", getPackPrint);
