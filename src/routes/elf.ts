import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config";
import { readCookie } from "../ball/gate";
import { sendElfSignInCode } from "../clients/email";
import { captchaEnabled, captchaSiteKey, verifyCaptcha } from "../clients/turnstile";
import { createRateLimiter } from "../portal/request-limiter";
import {
  activeFamilyByEmail,
  attachStripeSession,
  countElfCodeTry,
  createElfSession,
  createPendingJoin,
  deleteElfSession,
  deleteElfSignInCode,
  findElfSession,
  getElfSettings,
  orderForWelcome,
  saveElfSignInCode,
  type ElfSettings,
} from "../db/elf";
import { buildElfSignInCodeEmail } from "../elf/emails";
import { buildElfSessionParams, feeCoverPence, joinBodyFromForm, parseJoin } from "../elf/join";
import { FESTIVE_SURNAMES } from "../elf/names";
import { renderJoinPage } from "../elf/pages/join";
import { renderSignInPage, renderWelcomePage } from "../elf/pages/sign-in";
import {
  ELF_PENDING_COOKIE,
  ELF_SESSION_COOKIE,
  ELF_SESSION_DAYS,
  elfPendingCookieOptions,
  elfSessionCookieOptions,
  hashElfToken,
  newElfToken,
} from "../elf/session";
import {
  MAX_CODE_ATTEMPTS,
  SIGN_IN_CODE_TTL_MS,
  codeVerdict,
  hashSessionId,
  hashSignInCode,
  newSessionId,
  newSignInCode,
  readCode,
  sentFromOurOwnPage,
} from "../fundraising/sign-in";
import { currentCardFee } from "./api";

// NBCC Elf Detective School: the public pages and the family's API (wave 1 plan,
// docs/superpowers/plans/2026-11-03-elf-detective-wave1-sign-up.md). Every route here answers 404
// while the school is switched off in the admin (elf_settings.school_on), so it ships dark.
//
//   GET  /elf/join        the enrol page
//   POST /api/elf/join    enrol and go to Stripe (a JSON call from the page's script, or the plain
//                         form): trap field, a limit per address, Turnstile when on, the rules in
//                         src/elf/join.ts, then a pending order and a Stripe Checkout Session.

export const elfRouter = Router();

const production = () => config.NODE_ENV === "production";

/** Only a request made on the box itself (local development, the pr.yml BDD suite) skips the limits,
 *  exactly as the fundraisers' sign up does. */
function isLoopbackRequest(req: Request): boolean {
  const ip = req.ip ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

const wantsJson = (req: Request) => (req.headers["content-type"] ?? "").includes("application/json");

/** The switch: everything here is 404 while the school is off. The settings ride along. */
async function schoolOn(req: Request, res: Response, next: NextFunction): Promise<void> {
  const settings = await getElfSettings();
  if (!settings.schoolOn) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  res.locals.elfSettings = settings;
  next();
}

const settingsOf = (res: Response): ElfSettings => res.locals.elfSettings as ElfSettings;

function sendJoinPage(res: Response, status: number, extra: { errors?: string[]; values?: Record<string, string> } = {}): void {
  res.status(status).setHeader("Cache-Control", "no-store");
  res.type("html").send(
    renderJoinPage({
      settings: settingsOf(res),
      captchaSiteKey: captchaEnabled() ? captchaSiteKey() : null,
      surnames: FESTIVE_SURNAMES,
      ...extra,
    }),
  );
}

/** What was typed, to put back on the page after a refusal. Never the Gift Aid address fields'
 *  tick boxes or the trap field: just the words. */
function typedValues(form: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(form)) if (typeof v === "string" && k !== "website" && v.length <= 200) out[k] = v;
  return out;
}

elfRouter.get("/elf/join", schoolOn, (_req, res) => sendJoinPage(res, 200));

const joinLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60_000 });

export async function postJoin(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const json = wantsJson(req);
  const sent: Record<string, unknown> = json ? (req.body ?? {}) : joinBodyFromForm(req.body ?? {});
  const refuse = (status: number, errors: string[]) =>
    json ? res.status(status).json({ errors }) : sendJoinPage(res, status, { errors, values: typedValues(req.body ?? {}) });

  if (typeof sent.website === "string" && sent.website !== "") return refuse(400, ["Something went wrong. Please try again."]);
  if (!isLoopbackRequest(req) && !joinLimiter.allow(req.ip ?? "unknown", Date.now())) {
    return refuse(429, ["Too many tries just now. Please wait a few minutes and try again."]);
  }
  if (captchaEnabled()) {
    const verdict = await verifyCaptcha(sent.captchaToken, req.ip);
    if (verdict.outcome === "refused") return refuse(400, ["Please tick the box to show you are not a robot, then try again."]);
    if (verdict.outcome === "unavailable") console.error("elf join captcha unavailable, enrolment kept:", verdict.reason);
  }

  const settings = settingsOf(res);
  const parsed = parseJoin(settings, sent);
  if (!parsed.ok) return refuse(400, parsed.errors);

  const fee = feeCoverPence(parsed.body, await currentCardFee());
  const token = newElfToken();
  const pending = await createPendingJoin({ body: parsed.body, browserTokenHash: hashElfToken(token), feeCoverPence: fee });
  if (pending === "sign-in-first") {
    return refuse(409, ["This email already has detectives enrolled. Please sign in to add more."]);
  }

  try {
    const { stripe } = await import("../clients/stripe");
    const params = buildElfSessionParams({ reference: pending.reference, body: parsed.body, feeCoverPence: fee, baseUrl: config.PORTAL_BASE_URL, familyId: pending.familyId });
    const session = await stripe.checkout.sessions.create(params, { idempotencyKey: `elf-${pending.reference}` });
    await attachStripeSession(pending.orderId, session.id);
    res.cookie(ELF_PENDING_COOKIE, token, elfPendingCookieOptions(production()));
    if (json) {
      // Outside production the offline Stripe stub is in use: hand back the session, so the BDD
      // suite can replay its metadata into the webhook, as the donate checkout does.
      const stub = production() ? {} : { session: { id: session.id, metadata: session.metadata } };
      return res.status(200).json({ url: session.url, ...stub });
    }
    return res.redirect(303, session.url ?? "/elf/join");
  } catch (err) {
    console.error("elf join checkout failed:", err instanceof Error ? err.message : err);
    return refuse(502, ["Card payments are not working just now. Please try again in a few minutes."]);
  }
}

elfRouter.post("/api/elf/join", express.urlencoded({ extended: false, limit: "32kb" }), schoolOn, postJoin);

// --- signing in ----------------------------------------------------------------------------------------
//
//   GET  /elf/sign-in               the email box, then the code box
//   POST /api/elf/sign-in/request   send a code (the same answer whoever asks, given before looking)
//   POST /api/elf/sign-in           the code: a new session, any old one ended
//   POST /api/elf/sign-out
//   GET  /elf/welcome               where Stripe sends people back: the paying browser is signed in
//                                   only when its token matches and this payment opened the account
//
// Copies the fundraisers' private area (src/routes/fundraise.ts): codes kept as keyed hashes, tries
// counted before comparing, every refusal the same words, and POSTs only from our own pages.

export const ELF_REQUEST_MESSAGE =
  "If that email has detectives enrolled, we have sent a sign in code to it. It works for 10 minutes.";
export const ELF_WRONG_CODE = "That code does not work. Check it, or ask for a new one.";
const ELF_TOO_MANY = "Too many tries. Please wait a few minutes and try again.";
const ELF_NOT_OURS = "Please use the form on our website.";

const codeEmailLimiter = createRateLimiter({ max: 3, windowMs: 15 * 60_000 });
const codeEmailDayLimiter = createRateLimiter({ max: 10, windowMs: 24 * 60 * 60_000 });
const codeIpLimiter = createRateLimiter({ max: 20, windowMs: 15 * 60_000 });
const signInEmailLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60_000 });
const signInIpLimiter = createRateLimiter({ max: 30, windowMs: 15 * 60_000 });

const header = (req: Request, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

function ourOwnPage(req: Request): boolean {
  return sentFromOurOwnPage({ secFetchSite: header(req, "sec-fetch-site"), origin: header(req, "origin") }, header(req, "host") ?? "");
}

const emailSchema = z.string().trim().toLowerCase().email().max(200);

function sessionIdOf(req: Request): string | null {
  const id = readCookie(header(req, "cookie"), ELF_SESSION_COOKIE);
  return id && id.length <= 100 && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

/** The signed in family, or null. */
export async function signedInFamily(req: Request): Promise<{ familyId: number; sessionHash: string } | null> {
  const id = sessionIdOf(req);
  if (!id) return null;
  const sessionHash = hashSessionId(id);
  const found = await findElfSession(sessionHash);
  return found ? { familyId: found.familyId, sessionHash } : null;
}

async function startSession(req: Request, res: Response, familyId: number): Promise<void> {
  // A NEW session, always: one the browser already holds (perhaps planted by someone else) is ended.
  const old = sessionIdOf(req);
  if (old) await deleteElfSession(hashSessionId(old));
  const id = newSessionId();
  await createElfSession(hashSessionId(id), familyId, new Date(Date.now() + ELF_SESSION_DAYS * 24 * 60 * 60_000));
  res.cookie(ELF_SESSION_COOKIE, id, elfSessionCookieOptions(production()));
}

function sendSignInPage(res: Response, status: number, view: Parameters<typeof renderSignInPage>[0]): void {
  res.status(status).setHeader("Cache-Control", "no-store");
  res.type("html").send(renderSignInPage(view));
}

elfRouter.get("/elf/sign-in", schoolOn, (_req, res) => sendSignInPage(res, 200, { stage: "email" }));

export async function postSignInRequest(req: Request, res: Response): Promise<Response | void> {
  const json = wantsJson(req);
  if (!ourOwnPage(req)) {
    if (json) return res.status(403).json({ error: ELF_NOT_OURS });
    return sendSignInPage(res, 403, { stage: "email", message: ELF_NOT_OURS, error: true });
  }
  const parsed = emailSchema.safeParse(req.body?.email);
  if (!parsed.success) {
    const words = "Please give a valid email address.";
    if (json) return res.status(400).json({ error: words });
    return sendSignInPage(res, 400, { stage: "email", message: words, error: true });
  }
  const email = parsed.data;
  const now = Date.now();
  // Every limit is counted every time, so a limited email still uses up its address's allowance.
  const allowed =
    isLoopbackRequest(req) ||
    [codeEmailLimiter.allow(email, now), codeEmailDayLimiter.allow(email, now), codeIpLimiter.allow(req.ip ?? "unknown", now)].every(Boolean);
  // Always the same answer, and given BEFORE looking, so neither the words nor the time it takes
  // tell anyone who has detectives enrolled.
  if (json) res.status(200).json({ message: ELF_REQUEST_MESSAGE });
  else sendSignInPage(res, 200, { stage: "code", email, message: ELF_REQUEST_MESSAGE });
  if (!allowed) return;
  try {
    if (!(await getElfSettings()).schoolOn) return;
    const family = await activeFamilyByEmail(email);
    if (!family) return;
    const code = newSignInCode();
    await saveElfSignInCode(email, hashSignInCode(email, code, config.ADMIN_SESSION_SECRET), new Date(Date.now() + SIGN_IN_CODE_TTL_MS));
    const mail = buildElfSignInCodeEmail(code);
    await sendElfSignInCode(family.grownUpName, { email, from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL, ...mail });
  } catch (err) {
    console.error("elf sign in code request failed:", err instanceof Error ? err.message : err);
  }
}

export async function postSignIn(req: Request, res: Response): Promise<Response | void> {
  const json = wantsJson(req);
  const email = emailSchema.safeParse(req.body?.email);
  const back = (status: number, words: string) => {
    if (json) return res.status(status).json({ error: words });
    return sendSignInPage(res, status, { stage: "code", email: email.success ? email.data : "", message: words, error: true });
  };
  if (!ourOwnPage(req)) return back(403, ELF_NOT_OURS);
  const code = readCode(req.body?.code);
  if (!email.success || !code) return back(400, "Please put in your email address and the 6 digit code.");
  const now = Date.now();
  if (!isLoopbackRequest(req)) {
    const emailOk = signInEmailLimiter.allow(email.data, now);
    const ipOk = signInIpLimiter.allow(req.ip ?? "unknown", now);
    if (!emailOk || !ipOk) return back(429, ELF_TOO_MANY);
  }
  try {
    const row = await countElfCodeTry(email.data);
    const verdict = codeVerdict(row, email.data, code, config.ADMIN_SESSION_SECRET, new Date());
    if (verdict !== "ok") {
      if (verdict === "dead" || verdict === "expired" || (row && row.attempts >= MAX_CODE_ATTEMPTS)) await deleteElfSignInCode(email.data);
      return back(401, ELF_WRONG_CODE);
    }
    await deleteElfSignInCode(email.data); // one use only
    const family = await activeFamilyByEmail(email.data);
    if (!family) return back(401, ELF_WRONG_CODE);
    await startSession(req, res, family.id);
    return json ? res.status(200).json({ status: "signed_in" }) : res.redirect(303, "/elf/hq");
  } catch (err) {
    console.error("elf sign in failed:", err instanceof Error ? err.message : err);
    return back(500, "We could not sign you in just now. Please try again in a few minutes.");
  }
}

export async function postSignOut(req: Request, res: Response): Promise<Response | void> {
  if (!ourOwnPage(req)) return res.status(403).json({ error: ELF_NOT_OURS });
  const id = sessionIdOf(req);
  if (id) await deleteElfSession(hashSessionId(id));
  res.clearCookie(ELF_SESSION_COOKIE, { path: "/" });
  return wantsJson(req) ? res.status(200).json({ status: "signed_out" }) : res.redirect(303, "/elf");
}

export async function getWelcome(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const raw = req.query.elf_session;
  const sessionId = typeof raw === "string" && /^cs_[A-Za-z0-9_]{1,200}$/.test(raw) ? raw : null;
  const order = sessionId ? await orderForWelcome(sessionId) : null;
  const token = readCookie(header(req, "cookie"), ELF_PENDING_COOKIE);
  const ours = order !== null && token !== null && /^[0-9a-f]{64}$/.test(token) && order.browserTokenHash === hashElfToken(token);
  if (ours && order.status === "pending") return res.status(200).type("html").send(renderWelcomePage({ state: "checking" }));
  if (ours && order.status === "paid" && order.openedFamily) {
    await startSession(req, res, order.familyId);
    res.clearCookie(ELF_PENDING_COOKIE, { path: "/" });
    return res.redirect(303, "/elf/hq");
  }
  return res.status(200).type("html").send(renderWelcomePage({ state: "done" }));
}

const forms = express.urlencoded({ extended: false, limit: "8kb" });
elfRouter.post("/api/elf/sign-in/request", forms, schoolOn, postSignInRequest);
elfRouter.post("/api/elf/sign-in", forms, schoolOn, postSignIn);
elfRouter.post("/api/elf/sign-out", forms, schoolOn, postSignOut);
elfRouter.get("/elf/welcome", schoolOn, getWelcome);
