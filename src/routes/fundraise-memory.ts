import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, authorizeSectionAsAdmin } from "./admin-authz";
import type { AdminSessionClaims } from "../admin/session";
import { fundraisingIsOn, getFundraiser } from "../db/fundraisers";
import { findSession } from "../db/fundraiser-sign-in";
import { approveMemoryMessage, heldMessageCounts, markMemoryYearOnDone, MemoryError, setFundraiserMemory } from "../db/fundraiser-memory";
import { readCookie } from "../ball/gate";
import { SESSION_COOKIE, hashSessionId } from "../fundraising/sign-in";
import { fundraiserPageUrl } from "../fundraising/send";
import { isInMemory, memoryEditSchema } from "../fundraising/in-memory";
import { envelopeFacts, renderEnvelope } from "../fundraising/envelope";
import { materialAssets, materialsMessagePage } from "../fundraising/materials";
import type { FundraiserRecord } from "../fundraising/model";

// In memory pages (Jaimie, 2026-10-03; the rules in src/fundraising/in-memory.ts).
//
// The organiser, from their private area (their session cookie is scoped to /api/fundraise/manage):
//   GET  /api/fundraise/manage/fundraisers/:id/materials/envelopes   the collection envelopes to print
//
// Staff, Admin > Fundraising (section "fundraising": view to look, edit to change):
//   GET  /api/admin/fundraisers/:id/materials/envelopes             the same envelopes          view
//   GET  /api/admin/fundraising/memory-waiting                       messages to check, per page  view
//   POST /api/admin/fundraisers/:id/wall/:donationId/approve         a message goes on the page   edit
//   POST /api/admin/fundraisers/:id/memory/year-on-done  { note? }   the year on reminder is done edit
//   PUT  /api/admin/fundraisers/:id/memory  { memoryName, memoryDates, memorySetupBy, memoryShowTarget }
//                                     correct the in memory details (never the permission)   an admin
//
// Mounted before src/routes/fundraise-materials.ts, whose /materials/:piece would otherwise read
// "envelopes" as a piece it does not know. Envelopes are only for an in memory page that is approved
// or finished, as every printed piece is drawn from approved details. Never kept, never indexed.

export const fundraiseMemoryRouter = Router();

// Who did it, in the audit log, exactly as actorOf in ./admin writes it (not imported from there, as
// that module loads the Stripe client and all the admin routes with it).
const actorOf = (claims: AdminSessionClaims): string => `admin:${claims.email}`;

function idOf(raw: unknown): number | null {
  const s = String(raw ?? "");
  if (!/^[1-9]\d{0,9}$/.test(s)) return null;
  const id = Number(s);
  return id <= 2147483647 ? id : null;
}

function privatePage(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
}

const html = (res: Response, status: number, body: string): Response => res.status(status).type("html").send(body);

const notThere = (res: Response) =>
  html(res, 404, materialsMessagePage("Not found", "We could not find that. It may not be ready yet.", { href: "/fundraise/manage", text: "Go to your fundraising area" }));

const printable = (f: FundraiserRecord | null): f is FundraiserRecord =>
  !!f && isInMemory(f) && (f.status === "approved" || f.status === "finished");

function envelopes(f: FundraiserRecord): string {
  return renderEnvelope(envelopeFacts(f, { pageUrl: fundraiserPageUrl(f.slug) }), materialAssets());
}

/** The signed in organiser's email, from their session cookie, or null. */
async function organiserEmail(req: Request): Promise<string | null> {
  const raw = readCookie(req.headers.cookie, SESSION_COOKIE);
  const sessionId = raw && raw.length <= 100 && /^[A-Za-z0-9_-]+$/.test(raw) ? raw : null;
  const session = sessionId ? await findSession(hashSessionId(sessionId)) : null;
  return session ? session.email.trim().toLowerCase() : null;
}

export async function getOrganiserEnvelopes(req: Request, res: Response): Promise<Response> {
  privatePage(res);
  try {
    if (!(await fundraisingIsOn())) return notThere(res);
    const id = idOf(req.params.id);
    if (!id) return notThere(res);
    const email = await organiserEmail(req);
    if (!email) {
      return html(
        res,
        401,
        materialsMessagePage("Please sign in again", "For your privacy, your fundraising area signs you out after a while. Sign in again with a code we email you, then open this from there.", {
          href: "/fundraise/manage",
          text: "Sign in to your fundraising area",
        }),
      );
    }
    const f = await getFundraiser(id);
    if (!f || f.email.trim().toLowerCase() !== email || !printable(f)) return notThere(res);
    return html(res, 200, envelopes(f));
  } catch (err) {
    console.error("in memory envelopes failed:", err instanceof Error ? err.message : err);
    return html(res, 500, materialsMessagePage("Sorry, something went wrong", "We could not make that just now. Please try again in a few minutes."));
  }
}

export async function getStaffEnvelopes(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  privatePage(res);
  try {
    const id = idOf(req.params.id);
    const f = id ? await getFundraiser(id) : null;
    if (!printable(f)) return notThere(res);
    return html(res, 200, envelopes(f));
  } catch (err) {
    console.error("admin in memory envelopes failed:", err instanceof Error ? err.message : err);
    return html(res, 500, materialsMessagePage("Sorry, something went wrong", "That could not be made just now. Please try again."));
  }
}

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };

export async function getMemoryWaiting(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  try {
    return res.status(200).json({ counts: await heldMessageCounts() });
  } catch (err) {
    console.error("admin in memory messages count failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function postApproveMemoryMessage(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const id = idOf(req.params.id);
  const donationId = idOf(req.params.donationId);
  if (!id || !donationId) return res.status(400).json({ error: "Invalid id" });
  try {
    await approveMemoryMessage(id, donationId, actorOf(claims));
    return res.status(200).json({ donationId, approved: true });
  } catch (err) {
    if (err instanceof MemoryError) return res.status(404).json({ error: "That message no longer exists" });
    console.error("admin in memory message approve failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

const yearOnSchema = z.object({ note: z.string().trim().max(500, "Keep the note to 500 characters or fewer.").optional() });

export async function postMemoryYearOnDone(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const parsed = yearOnSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Keep the note to 500 characters or fewer." });
  try {
    await markMemoryYearOnDone(id, actorOf(claims), parsed.data.note ?? "");
    return res.status(200).json({ done: true });
  } catch (err) {
    if (err instanceof MemoryError) return res.status(409).json({ error: "That has already been dealt with. Look again." });
    console.error("admin in memory year on failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function putMemoryDetails(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const parsed = memoryEditSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "form"] ??= issue.message;
    return res.status(400).json({ error: "Some of it needs another look", fields });
  }
  try {
    await setFundraiserMemory(id, parsed.data, actorOf(claims));
    return res.status(200).json({ fundraiser: await getFundraiser(id) });
  } catch (err) {
    if (err instanceof MemoryError) return res.status(404).json({ error: "That is not an in memory page" });
    console.error("admin in memory details failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

fundraiseMemoryRouter.get("/api/fundraise/manage/fundraisers/:id/materials/envelopes", getOrganiserEnvelopes);
fundraiseMemoryRouter.get("/api/admin/fundraisers/:id/materials/envelopes", getStaffEnvelopes);
fundraiseMemoryRouter.get("/api/admin/fundraising/memory-waiting", getMemoryWaiting);
fundraiseMemoryRouter.post("/api/admin/fundraisers/:id/wall/:donationId/approve", postApproveMemoryMessage);
fundraiseMemoryRouter.post("/api/admin/fundraisers/:id/memory/year-on-done", postMemoryYearOnDone);
fundraiseMemoryRouter.put("/api/admin/fundraisers/:id/memory", putMemoryDetails);
