import { Router, type Request, type Response } from "express";
import { authorizeSection } from "./admin-authz";
import { actorOf } from "./admin";
import { createRateLimiter } from "../portal/request-limiter";
import { sentFromOurOwnPage } from "../fundraising/sign-in";
import {
  TSHIRT_SIZES,
  hashTshirtToken,
  newTshirtToken,
  readTshirtToken,
  tshirtChoiceSchema,
  tshirtLinkLive,
  welcomePackSchema,
} from "../fundraising/signup-tidy";

// The sign up tidy (Jaimie, 2026-10-03): sport and the T shirt, after the sign up.
//
//   PUT  /api/admin/fundraisers/:id/welcome-pack  { isSporting, tshirtSize }  Fundraising edit
//   POST /api/admin/fundraisers/:id/tshirt-ask    email the organiser a private link to choose
//                                                 their size. Staff press it; nothing sends itself.
//   POST /api/fundraise/tshirt/look               { token } -> their first name, the fundraiser's
//                                                 name and the sizes, while the link waits
//   POST /api/fundraise/tshirt                    { token, tshirtSize } -> saved, once
//
// The link is /fundraise/t-shirt#<token>: after the #, so it is never sent to a server or kept in a
// log as part of an address; the page posts it. Only its sha256 is kept (src/db/fundraiser-signup-
// tidy.ts). It works for 60 days, once, and only while the sign up is a sporting event still waiting
// for a size. An unknown, used or old link all get one plain answer. Tries are limited per address.

export const fundraiseSignupTidyRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };
const GONE = { error: "That link has expired or has already been used. Please email events@nbcc.scot or call 01292 811 015, and we'll sort your size." };
const NOT_OURS = { error: "Please use the form on our website." };

const LIMIT = { max: 30, windowMs: 15 * 60_000 };
let limiter = createRateLimiter(LIMIT);
/** Tests only: start the per address count again. */
export function tshirtLimiterReset(): void {
  limiter = createRateLimiter(LIMIT);
}

const header = (req: Request, name: string): string | undefined => {
  const v = req.headers?.[name];
  return Array.isArray(v) ? v[0] : v;
};

function fromOurOwnPage(req: Request, res: Response): boolean {
  const ok = sentFromOurOwnPage({ secFetchSite: header(req, "sec-fetch-site"), origin: header(req, "origin") }, header(req, "host") ?? "");
  if (!ok) res.status(403).json(NOT_OURS);
  return ok;
}

function idOf(req: Request): number | null {
  const raw = String(req.params.id ?? "");
  const id = /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
}

const reasonOf = (err: unknown): string | null =>
  typeof err === "object" && err !== null && typeof (err as { reason?: unknown }).reason === "string" ? (err as { reason: string }).reason : null;

// --- staff --------------------------------------------------------------------------------------

export async function putWelcomePack(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const id = idOf(req);
  if (id === null) return res.status(404).json({ error: "That sign up is not there" });
  const parsed = welcomePackSchema.safeParse(req.body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[i.path.join(".") || "isSporting"] ??= i.message;
    return res.status(400).json({ error: "Please check the answers", fields });
  }
  try {
    const { setWelcomePack } = await import("../db/fundraiser-signup-tidy");
    return res.status(200).json({ fundraiser: await setWelcomePack(id, parsed.data, actorOf(claims)) });
  } catch (err) {
    if (reasonOf(err) === "not_found") return res.status(404).json({ error: "That sign up is not there" });
    console.error("fundraiser welcome pack change failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function postTshirtAsk(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const id = idOf(req);
  if (id === null) return res.status(404).json({ error: "That sign up is not there" });
  const token = newTshirtToken();
  let saved;
  try {
    const { saveTshirtLink } = await import("../db/fundraiser-signup-tidy");
    saved = await saveTshirtLink(id, hashTshirtToken(token), actorOf(claims));
  } catch (err) {
    const reason = reasonOf(err);
    if (reason === "not_found") return res.status(404).json({ error: "That sign up is not there" });
    if (reason === "not_sporting") return res.status(409).json({ error: "Set Sporting event to Yes first, and save." });
    if (reason === "has_size") return res.status(409).json({ error: "They already have a T shirt size." });
    console.error("fundraiser T shirt ask failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
  try {
    const { sendTshirtAsk } = await import("../fundraising/send");
    await sendTshirtAsk(saved, token);
  } catch (err) {
    console.error("fundraiser T shirt ask email failed:", err instanceof Error ? err.message : err);
    return res.status(502).json({ error: "The email could not be sent just now. Please try again in a few minutes." });
  }
  return res.status(200).json({ fundraiser: saved });
}

// --- the organiser's private link --------------------------------------------------------------------

function limited(req: Request, res: Response): boolean {
  if (limiter.allow(req.ip ?? "unknown", Date.now())) return false;
  res.status(429).json({ error: "Too many tries. Please wait a few minutes and try again." });
  return true;
}

export async function postTshirtLook(req: Request, res: Response): Promise<Response | void> {
  if (limited(req, res)) return;
  const token = readTshirtToken(req.body?.token);
  if (!token) return res.status(404).json(GONE);
  try {
    const { readTshirtLink } = await import("../db/fundraiser-signup-tidy");
    const f = await readTshirtLink(hashTshirtToken(token));
    if (!f || !tshirtLinkLive(f.tshirtAskedAt ?? null, new Date())) return res.status(404).json(GONE);
    const first = String(f.firstName ?? f.name ?? "").trim().split(/\s+/)[0] ?? "";
    return res.status(200).json({ firstName: first, title: f.title, sizes: TSHIRT_SIZES });
  } catch (err) {
    console.error("fundraiser T shirt link read failed:", err instanceof Error ? err.message : err);
    return res.status(503).json({ error: "We could not open this just now. Please try again in a few minutes." });
  }
}

export async function postTshirtChoose(req: Request, res: Response): Promise<Response | void> {
  if (!fromOurOwnPage(req, res)) return;
  if (limited(req, res)) return;
  const token = readTshirtToken(req.body?.token);
  if (!token) return res.status(404).json(GONE);
  const parsed = tshirtChoiceSchema.safeParse({ token, tshirtSize: req.body?.tshirtSize });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[i.path.join(".") || "tshirtSize"] ??= i.message;
    return res.status(400).json({ error: "Please choose a size", fields });
  }
  try {
    const { chooseTshirtSize } = await import("../db/fundraiser-signup-tidy");
    if (!(await chooseTshirtSize(hashTshirtToken(token), parsed.data.tshirtSize, new Date()))) return res.status(404).json(GONE);
    return res.status(200).json({ status: "saved" });
  } catch (err) {
    console.error("fundraiser T shirt choice failed:", err instanceof Error ? err.message : err);
    return res.status(503).json({ error: "We could not save that just now. Please try again in a few minutes." });
  }
}

fundraiseSignupTidyRouter.put("/api/admin/fundraisers/:id/welcome-pack", putWelcomePack);
fundraiseSignupTidyRouter.post("/api/admin/fundraisers/:id/tshirt-ask", postTshirtAsk);
fundraiseSignupTidyRouter.post("/api/fundraise/tshirt/look", postTshirtLook);
fundraiseSignupTidyRouter.post("/api/fundraise/tshirt", postTshirtChoose);
