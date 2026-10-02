import { Router, type Request, type Response } from "express";
import { z, type ZodIssue } from "zod";
import { createRateLimiter } from "../portal/request-limiter";
import { captchaEnabled, captchaSiteKey, verifyCaptcha } from "../clients/turnstile";
import { londonToday } from "../events/model";
import {
  EDITABLE_FIELDS,
  editSchema,
  hasPage,
  isListed,
  publicCard,
  publicPage,
  signUpSchema,
  wallEntries,
  type FundraiserRecord,
} from "../fundraising/model";
import {
  hashManageToken,
  issueManageToken,
  newManageToken,
  verifyManageToken,
  ManageTokenError,
} from "../fundraising/manage-token";
import {
  createFundraiser,
  findApprovedByEmail,
  findManageToken,
  fundraisingIsOn,
  getBySlug,
  getFundraiser,
  listApprovedPublic,
  requestEdit,
  storeManageToken,
  waitingEditFor,
  wallRows,
  FundraiserError,
} from "../db/fundraisers";
import { sendManageLinkEmail, sendSignUpEmails, fundraiserPageUrl } from "../fundraising/send";
import { subscribeSelf } from "../newsletter/self-signup";

// TASK-493: the public side of community fundraising. Everything here is OFF while the fundraising
// switch is off (Admin > Fundraising, admins only): sign ups are refused and nothing is listed.
//
//   POST /api/fundraise                     sign up (honeypot, per IP limit, Turnstile like /api/contact)
//   GET  /api/fundraise/captcha             the Turnstile site key for the form, or null
//   GET  /api/fundraisers                   approved public fundraisers for Get involved, with meters
//   GET  /api/fundraisers/:slug             one fundraiser's page: meter, wall, what giving needs
//   POST /api/fundraise/manage/request      { email }: always the same answer; emails a 24 hour link
//   GET  /api/fundraise/manage/:token       what the organiser may change, and any change waiting
//   POST /api/fundraise/manage/:token       send a change; it waits for staff before it shows
//
// The request and response shapes are documented in README.md, "Community fundraising".

export const fundraiseRouter = Router();

type FieldErrors = Record<string, string>;

function fieldErrors(issues: ZodIssue[]): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

const NOT_OPEN = { error: "Fundraising is not open yet" };

// --- signing up ----------------------------------------------------------------------------------

const signUpLimiter = createRateLimiter({ max: 5, windowMs: 10 * 60_000 });

export async function postFundraise(req: Request, res: Response): Promise<Response> {
  // Honeypot: a real browser never fills the hidden `company` field. Pretend success, store nothing.
  if (typeof req.body?.company === "string" && req.body.company.trim() !== "") {
    return res.status(200).json({ status: "received" });
  }
  if (!signUpLimiter.allow(req.ip ?? "unknown", Date.now())) {
    return res.status(429).json({ error: "Too many sign ups. Please try again shortly." });
  }
  if (!(await fundraisingIsOn())) return res.status(404).json(NOT_OPEN);

  // Exactly as the contact form (TASK-490): a refused pass stores nothing; a check that cannot
  // answer keeps the sign up and logs why, so a real one is never lost to the checker.
  if (captchaEnabled()) {
    const verdict = await verifyCaptcha(req.body?.captchaToken, req.ip);
    if (verdict.outcome === "refused") return res.status(400).json({ error: "captcha" });
    if (verdict.outcome === "unavailable") console.error("fundraise captcha unavailable, sign up kept:", verdict.reason);
  }

  const parsed = signUpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Some of the form needs another look", fields: fieldErrors(parsed.error.issues) });
  }
  try {
    const record = await createFundraiser(parsed.data);
    await sendSignUpEmails(record);
    // The newsletter tick box (unticked by default): a ticked one subscribes the organiser exactly as
    // the footer form does. Best effort: the sign up stands either way. Unticked changes nothing.
    if (parsed.data.newsletterOk) {
      try {
        await subscribeSelf({ name: parsed.data.name, email: parsed.data.email, phone: parsed.data.phone });
      } catch (err) {
        console.error("fundraise newsletter subscribe failed:", err instanceof Error ? err.message : err);
      }
    }
    return res.status(200).json({ status: "received" });
  } catch (err) {
    console.error("fundraise sign up failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "We could not take your sign up right now. Please try again later." });
  }
}

export function getFundraiseCaptcha(_req: Request, res: Response): Response {
  return res.status(200).json({ siteKey: captchaSiteKey() });
}

// --- Get involved, and each fundraiser's page ------------------------------------------------------

export async function getFundraisers(_req: Request, res: Response): Promise<Response> {
  try {
    if (!(await fundraisingIsOn())) return res.status(200).json({ fundraisingOn: false, fundraisers: [] });
    const today = londonToday(new Date());
    const listed = (await listApprovedPublic()).filter((f) => isListed(f, today));
    return res.status(200).json({ fundraisingOn: true, fundraisers: listed.map((f) => publicCard(f, f.meter)) });
  } catch (err) {
    console.error("fundraisers list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Fundraisers are temporarily unavailable" });
  }
}

export async function getFundraiserPage(req: Request, res: Response): Promise<Response> {
  try {
    if (!(await fundraisingIsOn())) return res.status(404).json({ error: "Not found" });
    const f = await getBySlug(String(req.params.slug ?? ""));
    if (!f || !hasPage(f)) return res.status(404).json({ error: "Not found" });
    const wall = wallEntries(await wallRows(f.id));
    return res.status(200).json(publicPage(f, f.meter, wall));
  } catch (err) {
    console.error("fundraiser page failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "This page is temporarily unavailable" });
  }
}

// --- managing a page by emailed link ---------------------------------------------------------------

const requestSchema = z.object({ email: z.string().trim().email() });
const emailLimiter = createRateLimiter({ max: 3, windowMs: 15 * 60_000 });
const ipLimiter = createRateLimiter({ max: 20, windowMs: 15 * 60_000 });
const tokenLimiter = createRateLimiter({ max: 60, windowMs: 15 * 60_000 });

export const MANAGE_REQUEST_MESSAGE =
  "If that email belongs to an approved fundraiser, we have sent a link to change it. It works for 24 hours.";

export async function postManageRequest(req: Request, res: Response): Promise<Response> {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please give a valid email address" });
  const email = parsed.data.email.toLowerCase();
  const now = Date.now();
  // Both limits are counted every time, so a limited email still uses up its IP's allowance.
  const emailOk = emailLimiter.allow(email, now);
  const ipOk = ipLimiter.allow(req.ip ?? "unknown", now);
  if (emailOk && ipOk) {
    try {
      if (await fundraisingIsOn()) {
        for (const f of await findApprovedByEmail(email)) {
          const token = newManageToken();
          await storeManageToken(issueManageToken({ token, fundraiserId: f.id, now: new Date() }));
          await sendManageLinkEmail(f, token);
        }
      }
    } catch (err) {
      console.error("fundraise manage request failed:", err instanceof Error ? err.message : err);
    }
  }
  // Always the same answer: match or not, limited or not, so it never tells anyone who is signed up.
  return res.status(200).json({ message: MANAGE_REQUEST_MESSAGE });
}

type Opened = { fundraiser: FundraiserRecord; tokenHash: string };

// Open a manage link, or answer for it: 404 unknown, 410 expired or no longer changeable.
async function openLink(req: Request, res: Response): Promise<Opened | null> {
  if (!tokenLimiter.allow(req.ip ?? "unknown", Date.now())) {
    res.status(429).json({ error: "Too many tries. Please try again shortly." });
    return null;
  }
  if (!(await fundraisingIsOn())) {
    res.status(404).json({ error: "This link is not valid" });
    return null;
  }
  const token = String(req.params.token ?? "");
  const tokenHash = hashManageToken(token);
  try {
    const { fundraiserId } = verifyManageToken(token.length > 0 && token.length <= 100 ? await findManageToken(tokenHash) : null, new Date());
    const f = await getFundraiser(fundraiserId);
    if (!f) {
      res.status(404).json({ error: "This link is not valid" });
      return null;
    }
    if (f.status !== "approved") {
      res.status(410).json({ error: "This fundraiser can no longer be changed online. Please email events@nbcc.scot." });
      return null;
    }
    return { fundraiser: f, tokenHash };
  } catch (err) {
    if (err instanceof ManageTokenError) {
      if (err.reason === "expired") {
        res.status(410).json({ error: "This link has run out. Ask for a new one: links work for 24 hours." });
      } else {
        res.status(404).json({ error: "This link is not valid" });
      }
      return null;
    }
    throw err;
  }
}

function editableOf(f: FundraiserRecord) {
  const out: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) out[field] = f[field];
  return out;
}

export async function getManage(req: Request, res: Response): Promise<Response | void> {
  try {
    const opened = await openLink(req, res);
    if (!opened) return;
    const f = opened.fundraiser;
    const waiting = await waitingEditFor(f.id);
    return res.status(200).json({
      fundraiser: {
        id: f.id,
        slug: f.slug,
        title: f.title,
        path: f.path,
        pageUrl: hasPage(f) ? fundraiserPageUrl(f.slug) : null,
        editable: editableOf(f),
      },
      waitingEdit: waiting ? { id: waiting.id, changes: waiting.changes, createdAt: waiting.createdAt } : null,
    });
  } catch (err) {
    console.error("fundraise manage read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "This page is temporarily unavailable" });
  }
}

export async function postManage(req: Request, res: Response): Promise<Response | void> {
  try {
    const opened = await openLink(req, res);
    if (!opened) return;
    const parsed = editSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Some of your changes need another look", fields: fieldErrors(parsed.error.issues) });
    }
    const edit = await requestEdit(opened.fundraiser.id, parsed.data, opened.tokenHash);
    return res.status(202).json({ status: "waiting", edit: { id: edit.id, changes: edit.changes, createdAt: edit.createdAt } });
  } catch (err) {
    if (err instanceof FundraiserError && err.reason === "bad_status") {
      return res.status(410).json({ error: "This fundraiser can no longer be changed online. Please email events@nbcc.scot." });
    }
    console.error("fundraise manage save failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "We could not save your changes right now. Please try again later." });
  }
}

fundraiseRouter.post("/api/fundraise", postFundraise);
fundraiseRouter.get("/api/fundraise/captcha", getFundraiseCaptcha);
fundraiseRouter.get("/api/fundraisers", getFundraisers);
fundraiseRouter.get("/api/fundraisers/:slug", getFundraiserPage);
// Registered before /:token so "request" is never read as a token.
fundraiseRouter.post("/api/fundraise/manage/request", postManageRequest);
fundraiseRouter.get("/api/fundraise/manage/:token", getManage);
fundraiseRouter.post("/api/fundraise/manage/:token", postManage);
