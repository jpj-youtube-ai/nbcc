import { Router, type Request, type Response } from "express";
import { z, type ZodIssue } from "zod";
import { createRateLimiter } from "../portal/request-limiter";
import { captchaEnabled, captchaSiteKey, verifyCaptcha } from "../clients/turnstile";
import { londonToday } from "../events/model";
import {
  EDITABLE_FIELDS,
  checkOrganiserEdit,
  editSchema,
  hasPage,
  isListed,
  publicCard,
  publicPage,
  signUpSchema,
  wallEntries,
  wallMessageSchema,
  type FundraiserRecord,
  type Meter,
} from "../fundraising/model";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SIGN_IN_CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  codeVerdict,
  hashSessionId,
  hashSignInCode,
  newSessionId,
  newSignInCode,
  readCode,
  sentFromOurOwnPage,
  sessionCookieOptions,
} from "../fundraising/sign-in";
import {
  addWallMessage,
  createFundraiser,
  fundraisingIsOn,
  getBySlug,
  getFundraiser,
  listApprovedPublic,
  listForOrganiser,
  markFinishedRequested,
  requestEdit,
  waitingEditFor,
  wallRows,
  FundraiserError,
} from "../db/fundraisers";
import { countCodeTry, createSession, deleteSession, deleteSignInCode, findSession, saveSignInCode } from "../db/fundraiser-sign-in";
import { sendFinishedStaffEmail, sendSignInCodeEmail, sendSignUpEmails, fundraiserPageUrl, manageUrl } from "../fundraising/send";
import { subscribeSelf } from "../newsletter/self-signup";
import { useInvite } from "./fundraise-invite";
import { readCookie } from "../ball/gate";
import { listRequestRowsFor } from "../db/fundraising-requests";
import { organiserRequestLines, parseWants, requestViews, type OrganiserRequestLine, type RequestRow } from "../fundraising/requests";
import { config } from "../config";
import { printStatusFor } from "./fundraise-materials";
import { loadCategories } from "../db/fundraising-categories";
import { KEY_PATTERN, isActiveCategory } from "../fundraising/categories";

// TASK-493: the public side of community fundraising. Everything here is OFF while the fundraising
// switch is off (Admin > Fundraising, admins only): sign ups are refused and nothing is listed.
//
//   POST /api/fundraise                     sign up (honeypot, per IP limit, Turnstile like /api/contact)
//   GET  /api/fundraise/captcha             the Turnstile site key for the form, or null
//   GET  /api/fundraisers                   approved public fundraisers for Get involved, with meters
//   GET  /api/fundraisers/:slug             one fundraiser's page: meter, wall, what giving needs
//   POST /api/fundraisers/:slug/wall-message  TASK-502: the giver's message and wall choices, added
//                                           from the thank you after paying, tied to the paid
//                                           Stripe checkout session, once
//
// TASK-501, the private area at /fundraise/manage, signed in with an emailed code:
//   POST /api/fundraise/manage/request      { email }: always the same answer; emails a 6 digit code
//   POST /api/fundraise/manage/sign-in      { email, code }: a right code starts a 2 hour session
//   GET  /api/fundraise/manage/me           the signed in organiser's fundraisers
//   POST /api/fundraise/manage/fundraisers/:id/edit      a change; it waits for staff
//   POST /api/fundraise/manage/fundraisers/:id/finished  "I've finished": tells staff
//   POST /api/fundraise/manage/fundraisers/:id/pay-in    { amountPence, coverFee }: a Stripe checkout
//   POST /api/fundraise/manage/sign-out     ends the session
//   GET|POST /api/fundraise/manage/:token   the retired 24 hour links: 410, ask for a code
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

// TASK-503: same-host requests (isLoopbackRequest, below, as for the admin sign in) are not
// limited: behind the load balancer req.ip is always the real client, so only the CI suite and
// local development arrive that way, and every real visitor stays limited.

export async function postFundraise(req: Request, res: Response): Promise<Response> {
  // Honeypot: a real browser never fills the hidden `company` field. Pretend success, store nothing.
  if (typeof req.body?.company === "string" && req.body.company.trim() !== "") {
    return res.status(200).json({ status: "received" });
  }
  if (!isLoopbackRequest(req) && !signUpLimiter.allow(req.ip ?? "unknown", Date.now())) {
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

  // The categories on offer, as the database has them (kept for a minute). One this server has not
  // seen yet (an admin may have just added it, on another server) is looked for afresh before the
  // sign up is refused for it.
  await loadCategories();
  const kind = req.body?.kind;
  if (typeof kind === "string" && KEY_PATTERN.test(kind) && !isActiveCategory(kind)) await loadCategories({ fresh: true });
  const parsed = signUpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Some of the form needs another look", fields: fieldErrors(parsed.error.issues) });
  }
  try {
    const record = await createFundraiser(parsed.data);
    // TASK-503: made from a staff invite's link? Mark the invite used and linked. Best effort.
    await useInvite(req.body?.invite, record.id);
    await sendSignUpEmails(record);
    // The newsletter tick box (unticked by default): a ticked one subscribes the organiser exactly as
    // the footer form does, recorded as joining from the fundraising form. Best effort: the sign up stands either way. Unticked changes nothing.
    if (parsed.data.newsletterOk) {
      try {
        await subscribeSelf({ name: parsed.data.name, email: parsed.data.email, phone: parsed.data.phone }, "fundraise");
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

// --- the message after paying (TASK-502) ---------------------------------------------------------
//
// The give form no longer asks for a message or the wall choices. After paying, the giver comes back
// to the page with Stripe's checkout session id in the address (?session_id=, which Stripe fills in;
// src/routes/api.ts), and the thank you offers an optional step. What makes it safe:
//   - the session id is the only key. It is opaque (Stripe's own), and only the giver's browser has
//     it: the page takes it out of the address bar as soon as it loads;
//   - the gift the webhook recorded for that session must be on THIS fundraiser, gone through (or a
//     Direct Debit settling), not money the organiser paid in, and never added to before
//     (wallStepVerdict, under the row's lock in addWallMessage). One message per gift: it cannot be
//     changed afterwards by the giver, and staff can still hide it as before;
//   - before the webhook lands Stripe is asked, so a real giver hears "try again in a moment", and a
//     session that is unpaid, for another fundraiser, or a pay in is refused like an unknown one;
//   - the words go through the same rude words check as the give form's did;
//   - limited per address and per session, and refused when another website's page sends it.
// Nothing about the giver is ever returned except what the wall itself now shows for their gift.

// Adding to the wall: 10 in 15 minutes from one address, 10 for one session (room to retry while a
// slow payment is still being confirmed).
const wallIpLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60_000 });
const wallSessionLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60_000 });

const GIFT_NOT_FOUND = { error: "We could not find that gift. If you have just paid, please try again in a moment." };
const CONFIRMING = { error: "Your payment is still being confirmed. Please try again in a moment.", code: "confirming" };
const ALREADY = { error: "You have already added to the wall for this gift. Thank you!", code: "already" };
const UNPAID = { error: "That payment has not gone through, so there is nothing to add to the wall.", code: "unpaid" };
const WALL_TRY_LATER = { error: "We could not save that just now. Please try again in a moment." };

/**
 * The webhook has not recorded this session's gift yet. Stripe's word on it decides the answer: a
 * completed session for this fundraiser's page (not a pay in) is a real giver who is a moment early;
 * anything else reads as not found. Stripe out of reach: try again.
 */
async function answerForUnrecorded(res: Response, sessionId: string, fundraiserId: number): Promise<Response> {
  try {
    const { stripe } = await import("../clients/stripe");
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const md = session.metadata ?? {};
    const ours = md.fundraiserId === String(fundraiserId) && md.paidInByOrganiser !== "true";
    if (ours && session.status === "complete") return res.status(409).json(CONFIRMING);
    return res.status(404).json(GIFT_NOT_FOUND);
  } catch (err) {
    const missing = typeof err === "object" && err !== null && (err as { code?: string }).code === "resource_missing";
    if (missing) return res.status(404).json(GIFT_NOT_FOUND);
    console.error("fundraiser wall message stripe check failed:", err instanceof Error ? err.message : err);
    return res.status(503).json(WALL_TRY_LATER);
  }
}

export async function postWallMessage(req: Request, res: Response): Promise<Response | void> {
  if (!fromOurOwnPage(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  const now = Date.now();
  const sessionKey = typeof req.body?.sessionId === "string" ? req.body.sessionId.slice(0, 260) : "";
  if (!isLoopbackRequest(req)) {
    const ipOk = wallIpLimiter.allow(req.ip ?? "unknown", now);
    const sessionOk = !sessionKey || wallSessionLimiter.allow(sessionKey, now);
    if (!ipOk || !sessionOk) return res.status(429).json(TOO_MANY);
  }
  const parsed = wallMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Please check your message and try again", fields: fieldErrors(parsed.error.issues) });
  }
  try {
    if (!(await fundraisingIsOn())) return res.status(404).json(NOT_FOUND);
    const f = await getBySlug(String(req.params.slug ?? ""));
    if (!f || !hasPage(f)) return res.status(404).json(NOT_FOUND);
    const { sessionId, message, showName, showAmount } = parsed.data;
    const { verdict, entry } = await addWallMessage(sessionId, f.id, { message, showName, showAmount });
    switch (verdict) {
      case "ok":
        return res.status(200).json({ status: "added", entry });
      case "already":
        return res.status(409).json(ALREADY);
      case "unpaid":
        return res.status(409).json(UNPAID);
      case "not_recorded":
        return answerForUnrecorded(res, sessionId, f.id);
      default:
        // Another fundraiser's gift, or money paid in: the answer never says which, or whose.
        return res.status(404).json(GIFT_NOT_FOUND);
    }
  } catch (err) {
    console.error("fundraiser wall message failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(WALL_TRY_LATER);
  }
}

// --- the private area (TASK-501) ------------------------------------------------------------------
//
// Security, in short (src/fundraising/sign-in.ts has the detail):
//   - asking for a code always gets the same answer, sent before any work is done, so neither the
//     words nor the time taken say whether an email is signed up;
//   - a code is 6 random digits, kept as a keyed hash, works for 10 minutes and allows 5 tries,
//     counted in the database before the compare; requests are limited per email and per address,
//     and so are tries;
//   - a right code starts a NEW random session (any session the browser had is ended), in an http
//     only, SameSite Lax cookie, Secure in production, scoped to /api/fundraise/manage, for 2 hours;
//   - every change is a POST, refused unless it comes from our own page (Sec-Fetch-Site or Origin);
//   - an organiser only ever reaches fundraisers whose organiser email is the signed in one, and
//     anyone else's reads as not there;
//   - codes and session ids are never logged.

const requestSchema = z.object({ email: z.string().trim().email().max(254) });
const signInSchema = z.object({ email: z.string().trim().email().max(254), code: z.unknown() });

// Asking for a code: 3 in 15 minutes and 10 a day for one email; 20 in 15 minutes from one address.
const emailLimiter = createRateLimiter({ max: 3, windowMs: 15 * 60_000 });
const emailDayLimiter = createRateLimiter({ max: 10, windowMs: 24 * 60 * 60_000 });
const ipLimiter = createRateLimiter({ max: 20, windowMs: 15 * 60_000 });
// Trying a code: 10 in 15 minutes for one email, 30 from one address. With 5 tries a code and the
// limits on asking, a run of guesses at one email's codes has about a one in twenty thousand chance
// a day, at most.
const signInEmailLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60_000 });
const signInIpLimiter = createRateLimiter({ max: 30, windowMs: 15 * 60_000 });
// Opening a Stripe checkout to pay in: 10 in 15 minutes for one signed in organiser.
const payInLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60_000 });

export const MANAGE_REQUEST_MESSAGE =
  "If that email belongs to an approved fundraiser, we have sent a sign in code to it. It works for 10 minutes.";
export const WRONG_CODE_MESSAGE = "That code does not work. Check it, or ask for a new one.";
const TOO_MANY = { error: "Too many tries. Please wait a few minutes and try again." };
const NOT_OURS = { error: "Please use the form on our website." };
const SIGN_IN_AGAIN = { error: "Please sign in again." };
const FINISHED_NO_CHANGES = { error: "Your fundraiser is finished. To change anything, get in touch." };
const NOT_FOUND = { error: "Not found" };
const NO_LONGER = { error: "This fundraiser can no longer be changed online. Please email events@nbcc.scot." };

type Headers = Record<string, string | string[] | undefined>;
const header = (req: Request, name: string): string | undefined => {
  const v = (req.headers as Headers)[name];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * Exempt from the limits below exactly as admin login is (src/routes/admin.ts, isLoopbackRequest,
 * approved in TASK-200): only a request made on the box itself, local development or the pr.yml BDD
 * suite. Behind the ALB the app trusts one proxy, so req.ip is always the real client address and
 * no outside request can present as loopback.
 */
function isLoopbackRequest(req: Request): boolean {
  const ip = req.ip ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/** Refuse a POST that another website's page sent (the second lock after SameSite). */
export function fromOurOwnPage(req: Request, res: Response): boolean {
  const ok = sentFromOurOwnPage({ secFetchSite: header(req, "sec-fetch-site"), origin: header(req, "origin") }, header(req, "host") ?? "");
  if (!ok) res.status(403).json(NOT_OURS);
  return ok;
}

/** The session id from the cookie, if it looks like one of ours. */
function sessionIdOf(req: Request): string | null {
  const id = readCookie(header(req, "cookie"), SESSION_COOKIE);
  return id && id.length <= 100 && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

export type Session = { email: string; sessionHash: string };

/** The signed in organiser, or an answer for why not (404 while fundraising is off, 401). */
export async function signedIn(req: Request, res: Response): Promise<Session | null> {
  if (!(await fundraisingIsOn())) {
    res.status(404).json(NOT_FOUND);
    return null;
  }
  const id = sessionIdOf(req);
  const sessionHash = id ? hashSessionId(id) : null;
  const found = sessionHash ? await findSession(sessionHash) : null;
  if (!found || !sessionHash) {
    res.status(401).json(SIGN_IN_AGAIN);
    return null;
  }
  return { email: found.email.toLowerCase(), sessionHash };
}

type Owned = FundraiserRecord & { meter: Meter };

/**
 * The organiser's own fundraiser, approved or finished (a finished one stays theirs: TASK-501
 * review), or an answer: someone else's reads as not there, and one new or declined is a 410.
 */
export async function ownFundraiser(req: Request, res: Response, s: Session): Promise<Owned | null> {
  const raw = String(req.params.id ?? "");
  const id = /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : NaN;
  const f = Number.isSafeInteger(id) && id <= 2147483647 ? await getFundraiser(id) : null;
  if (!f || f.email.trim().toLowerCase() !== s.email) {
    res.status(404).json(NOT_FOUND);
    return null;
  }
  if (f.status !== "approved" && f.status !== "finished") {
    res.status(410).json(NO_LONGER);
    return null;
  }
  return f;
}

export async function postManageRequest(req: Request, res: Response): Promise<Response | void> {
  if (!fromOurOwnPage(req, res)) return;
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please give a valid email address" });
  const email = parsed.data.email.toLowerCase();
  const now = Date.now();
  // Every limit is counted every time, so a limited email still uses up its address's allowance.
  const allowed =
    isLoopbackRequest(req) ||
    [emailLimiter.allow(email, now), emailDayLimiter.allow(email, now), ipLimiter.allow(req.ip ?? "unknown", now)].every(Boolean);
  // Always the same answer, and given BEFORE looking: match or not, limited or not, switched on or
  // not, so neither the words nor the time it takes tell anyone who is signed up.
  res.status(200).json({ message: MANAGE_REQUEST_MESSAGE });
  if (!allowed) return;
  try {
    if (!(await fundraisingIsOn())) return;
    const mine = await listForOrganiser(email);
    if (mine.length === 0) return;
    const code = newSignInCode();
    await saveSignInCode(email, hashSignInCode(email, code, config.ADMIN_SESSION_SECRET), new Date(Date.now() + SIGN_IN_CODE_TTL_MS));
    // One code for the email, whichever of their fundraisers; greeted by the newest one's name.
    await sendSignInCodeEmail(email, mine[0].name, code);
  } catch (err) {
    console.error("fundraise sign in code request failed:", err instanceof Error ? err.message : err);
  }
}

export async function postManageSignIn(req: Request, res: Response): Promise<Response | void> {
  if (!fromOurOwnPage(req, res)) return;
  const parsed = signInSchema.safeParse(req.body);
  const code = parsed.success ? readCode(parsed.data.code) : null;
  if (!parsed.success || !code) return res.status(400).json({ error: "Please put in your email address and the 6 digit code." });
  const email = parsed.data.email.toLowerCase();
  const now = Date.now();
  if (!isLoopbackRequest(req)) {
    const emailOk = signInEmailLimiter.allow(email, now);
    const ipOk = signInIpLimiter.allow(req.ip ?? "unknown", now);
    if (!emailOk || !ipOk) return res.status(429).json(TOO_MANY);
  }
  try {
    if (!(await fundraisingIsOn())) return res.status(404).json(NOT_FOUND);
    // The try is counted before the code is compared (countCodeTry), so tries sent at once each use
    // one up. Every refusal is the same answer. A code whose tries are all used is forgotten.
    const row = await countCodeTry(email);
    const verdict = codeVerdict(row, email, code, config.ADMIN_SESSION_SECRET, new Date());
    if (verdict !== "ok") {
      if (verdict === "dead" || verdict === "expired" || (row && row.attempts >= MAX_CODE_ATTEMPTS)) await deleteSignInCode(email);
      return res.status(401).json({ error: WRONG_CODE_MESSAGE });
    }
    await deleteSignInCode(email); // one use only
    if ((await listForOrganiser(email)).length === 0) return res.status(401).json({ error: WRONG_CODE_MESSAGE });
    // A NEW session, always: one the browser already holds (perhaps planted by someone else) is ended.
    const old = sessionIdOf(req);
    if (old) await deleteSession(hashSessionId(old));
    const id = newSessionId();
    await createSession(hashSessionId(id), email, new Date(Date.now() + SESSION_TTL_MS));
    res.cookie(SESSION_COOKIE, id, sessionCookieOptions(config.NODE_ENV === "production"));
    return res.status(200).json({ status: "signed_in" });
  } catch (err) {
    console.error("fundraise sign in failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "We could not sign you in just now. Please try again in a few minutes." });
  }
}

function editableOf(f: FundraiserRecord) {
  const out: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) out[field] = f[field] === undefined ? null : f[field];
  return out;
}

/**
 * TASK-511 review: which link boxes their form shows. A sign up made since the form's second round
 * (it has the name in two parts, or a link of its own) changes Instagram and Facebook, each in a box
 * of its own; one from before keeps its one link box.
 */
function linkBoxesOf(f: FundraiserRecord): "one" | "two" {
  return f.firstName || f.instagram || f.facebook ? "two" : "one";
}

// TASK-505: one of their own fundraisers' requests, as the organiser reads them. Best effort: a
// failure here leaves the rest of their private area working.
async function theirRequests(
  f: Pick<Parameters<typeof requestViews>[0], "socialOk" | "eventDate" | "status"> & { id: number; wants?: unknown },
  today: string,
  read: Promise<RequestRow[]> = listRequestRowsFor(f.id),
): Promise<OrganiserRequestLine[] | null> {
  try {
    const rows = await read;
    return organiserRequestLines(requestViews({ ...f, wants: parseWants(f.wants) }, rows, today), today, f);
  } catch (err) {
    console.error("fundraise private area requests read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function getManageSession(req: Request, res: Response): Promise<Response | void> {
  try {
    const s = await signedIn(req, res);
    if (!s) return;
    const mine = await listForOrganiser(s.email);
    const today = londonToday(new Date());
    const fundraisers = await Promise.all(
      mine.map(async (f) => {
        // Their requests are read once, for both "What you asked for" and "Ask us to print these".
        const requestRows = listRequestRowsFor(f.id);
        requestRows.catch(() => undefined); // each reader below reports its own failure
        const [waiting, rows, requests, print] = await Promise.all([
          waitingEditFor(f.id),
          wallRows(f.id),
          theirRequests(f, today, requestRows),
          printStatusFor(f, today, requestRows),
        ]);
        // TASK-502: a finished one keeps its public page (and so its QR code) for good.
        const page = hasPage(f);
        return {
          id: f.id,
          slug: f.slug,
          title: f.title,
          path: f.path,
          status: f.status,
          public: f.public,
          pageUrl: page ? fundraiserPageUrl(f.slug) : null,
          // The QR code is the page's, so only a page has one (it is no longer on the page itself).
          qrUrl: page ? `/fundraise/${f.slug}/qr.svg` : null,
          meter: f.meter,
          editable: editableOf(f),
          linkBoxes: linkBoxesOf(f),
          waitingEdit: waiting ? { id: waiting.id, changes: waiting.changes, createdAt: waiting.createdAt } : null,
          // As the wall shows them: a name or Anonymous, the amount unless hidden, the message unless
          // staff hid it. Never a giver's email, full name or anything else about them.
          gifts: wallEntries(rows),
          finishedRequestedAt: f.finishedRequestedAt ?? null,
          // TASK-505: where each thing they asked for is up to, in words only (never a staff note
          // or name); null when it could not be read, so the rest still shows.
          requests,
          // TASK-504: "Your materials" (src/routes/fundraise-materials.ts). The certificate once it
          // is finished; the print size QR code only where there is a page, like the SVG.
          materials: {
            poster: `/api/fundraise/manage/fundraisers/${f.id}/materials/poster`,
            // TASK-512: the same poster on A3, and as an A5 leaflet.
            posterA3: `/api/fundraise/manage/fundraisers/${f.id}/materials/poster-a3`,
            leaflet: `/api/fundraise/manage/fundraisers/${f.id}/materials/leaflet`,
            social: `/api/fundraise/manage/fundraisers/${f.id}/materials/social`,
            sponsorForm: `/api/fundraise/manage/fundraisers/${f.id}/materials/sponsor-form`,
            certificate: f.status === "finished" ? `/api/fundraise/manage/fundraisers/${f.id}/materials/certificate` : null,
            qrPng: page ? `/fundraise/${f.slug}/qr.png` : null,
          },
          // TASK-512: "Ask us to print these": whether they can, and where their posters and
          // leaflets are up to (POST .../print-request, src/routes/fundraise-materials.ts); null when
          // it could not be read, so the rest still shows.
          print,
        };
      }),
    );
    // Private: never kept by a browser or anything in between.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ fundraisers });
  } catch (err) {
    console.error("fundraise private area read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "This page is temporarily unavailable" });
  }
}

export async function postManageEdit(req: Request, res: Response): Promise<Response | void> {
  try {
    if (!fromOurOwnPage(req, res)) return;
    const s = await signedIn(req, res);
    if (!s) return;
    const f = await ownFundraiser(req, res, s);
    if (!f) return;
    if (f.status === "finished") return res.status(410).json(FINISHED_NO_CHANGES);
    const parsed = editSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Some of your changes need another look", fields: fieldErrors(parsed.error.issues) });
    }
    // Checked as it would land: what is stored with the change on top (finish after start, the
    // ticket link, what an event card needs). Approving it checks the times again, against the row
    // as it is then.
    const checked = checkOrganiserEdit(f, parsed.data);
    if (Object.keys(checked.fields).length > 0) {
      return res.status(400).json({ error: "Some of your changes need another look", fields: checked.fields });
    }
    const edit = await requestEdit(f.id, checked.change, s.email);
    return res.status(202).json({ status: "waiting", edit: { id: edit.id, changes: edit.changes, createdAt: edit.createdAt } });
  } catch (err) {
    if (err instanceof FundraiserError && err.reason === "bad_status") return res.status(410).json(NO_LONGER);
    if (err instanceof FundraiserError && err.reason === "not_found") return res.status(404).json(NOT_FOUND);
    console.error("fundraise private area change failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "We could not send your changes right now. Please try again later." });
  }
}

export async function postManageFinished(req: Request, res: Response): Promise<Response | void> {
  try {
    if (!fromOurOwnPage(req, res)) return;
    const s = await signedIn(req, res);
    if (!s) return;
    const f = await ownFundraiser(req, res, s);
    if (!f) return;
    const { record, first } = await markFinishedRequested(f.id, s.email);
    // Staff hear once, however many times it is pressed. Best effort: it is recorded either way.
    if (first) await sendFinishedStaffEmail(record, f.meter.raisedPence);
    return res.status(200).json({ status: "thanks", finishedRequestedAt: record.finishedRequestedAt ?? null });
  } catch (err) {
    if (err instanceof FundraiserError && err.reason === "bad_status") return res.status(410).json(NO_LONGER);
    if (err instanceof FundraiserError && err.reason === "not_found") return res.status(404).json(NOT_FOUND);
    console.error("fundraise finished request failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "We could not send that just now. Please try again in a few minutes." });
  }
}

export async function postManagePayIn(req: Request, res: Response): Promise<Response | void> {
  if (!fromOurOwnPage(req, res)) return;
  let s: Session | null;
  let f: Owned | null;
  try {
    s = await signedIn(req, res);
    if (!s) return;
    f = await ownFundraiser(req, res, s);
    if (!f) return;
  } catch (err) {
    console.error("fundraise pay in read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "We could not start your payment just now. Please try again in a few minutes." });
  }
  // Loaded here, not at the top, so this router stays import safe for tests that never touch Stripe.
  const { buildPayInSessionParams, currentCardFee, payInSchema } = await import("./api");
  const parsed = payInSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please check the amount", fields: fieldErrors(parsed.error.issues) });
  if (!isLoopbackRequest(req) && !payInLimiter.allow(s.email, Date.now())) return res.status(429).json(TOO_MANY);
  try {
    const { stripe } = await import("../clients/stripe");
    const params = buildPayInSessionParams(
      {
        fundraiserId: f.id,
        amountPence: parsed.data.amountPence,
        coverFee: parsed.data.coverFee === true,
        name: f.name,
        email: f.email,
        manageUrl: manageUrl(),
      },
      await currentCardFee(),
    );
    const session = await stripe.checkout.sessions.create(params);
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("fundraise pay in checkout failed:", err instanceof Error ? err.message : err);
    return res.status(502).json({ error: "Card payments are not working just now. Please try again in a few minutes." });
  }
}

export async function postManageSignOut(req: Request, res: Response): Promise<Response | void> {
  if (!fromOurOwnPage(req, res)) return;
  try {
    const id = sessionIdOf(req);
    if (id) await deleteSession(hashSessionId(id));
  } catch (err) {
    console.error("fundraise sign out failed:", err instanceof Error ? err.message : err);
  }
  const { httpOnly, secure, sameSite, path } = sessionCookieOptions(config.NODE_ENV === "production");
  res.clearCookie(SESSION_COOKIE, { httpOnly, secure, sameSite, path });
  return res.status(200).json({ status: "signed_out" });
}

/**
 * The 24 hour links (TASK-494) are retired: no new ones are sent, and one already in an inbox no
 * longer opens anything. The page tells them to ask for a sign in code instead.
 */
export function retiredManageLink(_req: Request, res: Response): Response {
  return res.status(410).json({ error: "Links are no longer used. Put in your email address and we will send you a sign in code." });
}

fundraiseRouter.post("/api/fundraise", postFundraise);
fundraiseRouter.get("/api/fundraise/captcha", getFundraiseCaptcha);
fundraiseRouter.get("/api/fundraisers", getFundraisers);
fundraiseRouter.get("/api/fundraisers/:slug", getFundraiserPage);
fundraiseRouter.post("/api/fundraisers/:slug/wall-message", postWallMessage);
// The named routes go before /:token, so "request", "me" and the rest are never read as a link.
fundraiseRouter.post("/api/fundraise/manage/request", postManageRequest);
fundraiseRouter.post("/api/fundraise/manage/sign-in", postManageSignIn);
fundraiseRouter.get("/api/fundraise/manage/me", getManageSession);
fundraiseRouter.post("/api/fundraise/manage/sign-out", postManageSignOut);
fundraiseRouter.post("/api/fundraise/manage/fundraisers/:id/edit", postManageEdit);
fundraiseRouter.post("/api/fundraise/manage/fundraisers/:id/finished", postManageFinished);
fundraiseRouter.post("/api/fundraise/manage/fundraisers/:id/pay-in", postManagePayIn);
fundraiseRouter.get("/api/fundraise/manage/:token", retiredManageLink);
fundraiseRouter.post("/api/fundraise/manage/:token", retiredManageLink);
