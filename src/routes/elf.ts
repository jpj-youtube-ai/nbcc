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
  endOtherElfSessions,
  findElfSession,
  familyWithDetectives,
  getElfSettings,
  orderForWelcome,
  saveElfSignInCode,
  saveLook,
  type ElfSettings,
} from "../db/elf";
import { calendarStatus, renderCalendarPage } from "../elf/pages/calendar";
import { doorDetail, doorTile, doorVersion } from "../elf/pages/door";
import { renderHqPage } from "../elf/pages/hq";
import { renderRulesPage } from "../elf/pages/rules";
import { renderWardrobePage } from "../elf/pages/wardrobe";
import { calendarViewFor, hqViewFor, lookFromForm, wardrobeStateNow, wardrobeViewFor, type FamilyRow } from "../elf/views";
import { elfPng, elfPngKey } from "../elf/elf-png";
import { buildElfSignInCodeEmail } from "../elf/emails";
import { buildElfSessionParams, feeCoverPence, joinBodyFromForm, parseJoin } from "../elf/join";
import { FESTIVE_SURNAMES } from "../elf/names";
import { renderJoinPage } from "../elf/pages/join";
import { renderSignInPage, renderWelcomePage } from "../elf/pages/sign-in";
import {
  ELF_PENDING_COOKIE,
  ELF_PREVIEW_COOKIE,
  elfPreviewCookieOptions,
  previewAllowed,
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
  const cookie = req.headers.cookie;
  const preview = !settings.schoolOn && previewAllowed(settings, readCookie(Array.isArray(cookie) ? cookie[0] : cookie, ELF_PREVIEW_COOKIE));
  if (!settings.schoolOn && !preview) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  res.locals.elfSettings = settings;
  if (preview) {
    res.locals.elfPreview = true;
    // A private preview: never listed, never cached, and every page says so across the top.
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "private, no-store");
    const send = res.send.bind(res);
    res.send = ((body?: unknown) =>
      send(typeof body === "string" && body.startsWith("<!doctype html>") ? body.replace("<main", PREVIEW_STRIP + "<main") : body)) as Response["send"];
  }
  next();
}

const PREVIEW_STRIP =
  '<p class="elf-preview-strip" role="status">Private preview: Elf Detective School is switched off, and only people with the preview link can see this. Payments here are real.</p>';

// The private preview link (Jaimie, 3 November 2026): made in the admin, it puts its code in a
// cookie and opens the calendar. A wrong or old code is simply not found.
elfRouter.get("/elf/preview/:token", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  const token = String(req.params.token);
  if (!previewAllowed(await getElfSettings(), token)) return res.status(404).type("text/plain").send("Not found");
  res.cookie(ELF_PREVIEW_COOKIE, token, elfPreviewCookieOptions(production()));
  return res.redirect(303, "/elf");
});

const settingsOf = (res: Response): ElfSettings => res.locals.elfSettings as ElfSettings;

function sendJoinPage(
  res: Response,
  status: number,
  extra: { errors?: string[]; values?: Record<string, string>; signedIn?: { grownUpName: string; email: string } } = {},
): void {
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

/** The signed in family, if any, for the enrol page: it then adds detectives to itself. */
async function joiningFamily(req: Request): Promise<FamilyRow | null> {
  const s = await signedInFamily(req);
  return s ? await familyWithDetectives(s.familyId) : null;
}

elfRouter.get("/elf/join", schoolOn, async (req, res) => {
  const family = await joiningFamily(req);
  sendJoinPage(res, 200, family ? { signedIn: { grownUpName: family.grownUpName, email: family.email } } : {});
});

const joinLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60_000 });

export async function postJoin(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const json = wantsJson(req);
  const sent: Record<string, unknown> = { ...(json ? (req.body ?? {}) : joinBodyFromForm(req.body ?? {})) };
  // A signed in family adds detectives to itself: its own name and email are used, and whatever
  // email was sent is ignored.
  const family = await joiningFamily(req);
  if (family) {
    sent.email = family.email;
    sent.grownUpName = family.grownUpName;
    sent.newsletter = false;
  }
  const signedIn = family ? { grownUpName: family.grownUpName, email: family.email } : undefined;
  const refuse = (status: number, errors: string[]) =>
    json ? res.status(status).json({ errors }) : sendJoinPage(res, status, { errors, values: typedValues(req.body ?? {}), signedIn });

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
  const pending = await createPendingJoin({
    body: parsed.body,
    browserTokenHash: hashElfToken(token),
    feeCoverPence: fee,
    ...(family ? { familyId: family.id } : {}),
  });
  if (pending === "sign-in-first") {
    // Never say whether an email has detectives enrolled (the sign in page does not either): the
    // family is sent a code, as if they had asked to sign in, and asked to check their email.
    const email = String(sent.email ?? "").trim().toLowerCase();
    if (isLoopbackRequest(req) || codeEmailLimiter.allow(email, Date.now())) await sendSignInCodeTo(email);
    if (json) return res.status(200).json({ status: "check-email", message: JOIN_CHECK_EMAIL });
    return sendSignInPage(res, 200, { stage: "code", email, message: JOIN_CHECK_EMAIL });
  }

  try {
    const { stripe } = await import("../clients/stripe");
    const params = buildElfSessionParams({ reference: pending.reference, body: parsed.body, feeCoverPence: fee, baseUrl: config.PORTAL_BASE_URL, familyId: pending.familyId });
    const session = await stripe.checkout.sessions.create(params, { idempotencyKey: `elf-${pending.reference}` });
    await attachStripeSession(pending.orderId, session.id);
    res.cookie(ELF_PENDING_COOKIE, token, elfPendingCookieOptions(production()));
    if (json) {
      // Outside production the offline Stripe stub is in use: hand back the session, so the BDD
      // suite can replay its metadata into the webhook, as the donate checkout does. The metadata
      // is what was sent: the stub's session does not carry it back.
      const stub = production() ? {} : { session: { id: session.id, metadata: params.metadata } };
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
export const JOIN_CHECK_EMAIL =
  "Check your email to carry on. If you have enrolled with us before, we have sent you a code: sign in with it, then add your detectives from Detective HQ.";
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

async function startSession(req: Request, res: Response, familyId: number): Promise<string> {
  // A NEW session, always: one the browser already holds (perhaps planted by someone else) is ended.
  const old = sessionIdOf(req);
  if (old) await deleteElfSession(hashSessionId(old));
  const id = newSessionId();
  const hash = hashSessionId(id);
  await createElfSession(hash, familyId, new Date(Date.now() + ELF_SESSION_DAYS * 24 * 60 * 60_000));
  res.cookie(ELF_SESSION_COOKIE, id, elfSessionCookieOptions(production()));
  return hash;
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
  if (!(await getElfSettings()).schoolOn) return;
  await sendSignInCodeTo(email);
}

/** Email a sign in code, but only to a family that has paid for detectives. Never throws. */
async function sendSignInCodeTo(email: string): Promise<void> {
  try {
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
    // The email is proven now: any session made by a browser that only paid ends here.
    await endOtherElfSessions(family.id, await startSession(req, res, family.id));
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

// --- Detective HQ and the wardrobe ---------------------------------------------------------------------
//
//   GET  /elf/hq                       the family's page (signed in; otherwise to the sign in page)
//   GET  /elf/hq/wardrobe/:detective   dress a detective's elf
//   GET  /elf/hq/elf/:detective.png    a detective's elf, as a picture, for their own family only
//   POST /api/elf/look                 save a look: JSON { detectiveId, look, tried } from the page's
//                                      script, or the plain form (detective, skin, hair, hairStyle,
//                                      outfit, piece-<slot>="style:colour")

const detectiveIdOf = (raw: unknown): number | null => {
  const s = typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : "";
  return /^[1-9]\d{0,9}$/.test(s) && Number(s) <= 2147483647 ? Number(s) : null;
};

async function familyOr(req: Request, res: Response): Promise<FamilyRow | null> {
  const s = await signedInFamily(req);
  const family = s ? await familyWithDetectives(s.familyId) : null;
  if (!family) {
    res.redirect(303, "/elf/sign-in");
    return null;
  }
  return family;
}

elfRouter.get("/elf/hq", schoolOn, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const family = await familyOr(req, res);
  if (!family) return;
  res.type("html").send(renderHqPage(hqViewFor({ family, settings: settingsOf(res), now: new Date() })));
});

elfRouter.get("/elf/hq/wardrobe/:detective", schoolOn, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const family = await familyOr(req, res);
  if (!family) return;
  const id = detectiveIdOf(req.params.detective);
  const detective = family.detectives.find((d) => d.id === id);
  if (!detective) return res.status(404).type("text/plain").send("Not found");
  res.type("html").send(renderWardrobePage(wardrobeViewFor({ detective, settings: settingsOf(res), now: new Date() })));
});

elfRouter.get("/elf/hq/elf/:file", schoolOn, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const m = /^(\d{1,10})\.png$/.exec(String(req.params.file));
  const s = await signedInFamily(req);
  const family = s ? await familyWithDetectives(s.familyId) : null;
  const detective = m && family ? family.detectives.find((d) => d.id === Number(m[1])) : undefined;
  if (!detective) return res.status(404).type("text/plain").send("Not found");
  // The elf on its stage, stacked from the paper pictures (src/elf/elf-png.ts). The browser keeps it
  // but asks first (its ETag names the look), so a new look shows at once and an unchanged one is
  // never made again.
  res.setHeader("Cache-Control", "private, no-cache");
  const etag = `"${elfPngKey(detective.look, wardrobeStateNow(), 240)}"`;
  res.setHeader("ETag", etag);
  if (String(req.headers["if-none-match"] ?? "") === etag) return res.status(304).send();
  let picture: Buffer | null;
  try {
    picture = await elfPng(detective.look, wardrobeStateNow(), 240);
  } catch (err) {
    console.error("elf hq picture failed:", err instanceof Error ? err.message : err);
    return res.status(500).type("text/plain").send("The picture could not be made.");
  }
  if (!picture) {
    res.setHeader("Retry-After", "2");
    return res.status(503).type("text/plain").send("Busy. Please try again in a moment.");
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.type("image/png").send(picture);
});

export async function postLook(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const json = wantsJson(req);
  if (!ourOwnPage(req)) return res.status(403).json({ error: ELF_NOT_OURS });
  const s = await signedInFamily(req);
  if (!s) return json ? res.status(401).json({ error: "Please sign in again." }) : res.redirect(303, "/elf/sign-in");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const detectiveId = detectiveIdOf(json ? body.detectiveId : body.detective);
  const look = json ? body.look : lookFromForm(body);
  const tried = json && Array.isArray(body.tried) ? body.tried.slice(0, 200) : [];
  // Favourite looks come only from the script, and only as a list; anything else leaves them as they are.
  const favourites = json && Array.isArray(body.favourites) ? (body.favourites as unknown[]) : undefined;
  const kept = detectiveId === null ? "not-found" : await saveLook({ detectiveId, familyId: s.familyId, look, tried, favourites });
  if (kept === "not-found") return json ? res.status(404).json({ error: "Not found" }) : res.status(404).type("text/plain").send("Not found");
  return json ? res.status(200).json({ ok: true, look: kept.look, favourites: kept.favourites }) : res.redirect(303, `/elf/hq/wardrobe/${detectiveId}`);
}

elfRouter.post("/api/elf/look", express.urlencoded({ extended: false, limit: "16kb" }), schoolOn, postLook);

// --- the public calendar and the rules -----------------------------------------------------------------
//
//   GET /elf                 the calendar: 24 doors, counting down to the first clue
//   GET /elf/rules           the rules a grown up agrees to when enrolling
//   GET /api/elf/calendar    the small feed the calendar's script polls: { now, found, status, doors: [{ door, v }] }
//   GET /api/elf/door/:n     one door's tile and detail, drawn by the same functions as the page
//   GET /api/elf/me          the signed in family's marks on the calendar, or 401
//
// The calendar is the same for every visitor, so it is cached briefly; nothing on it is private.

const PUBLIC_SHORT_CACHE = "public, max-age=15";

/** Cache a public page briefly, but never a private preview of it (a shared cache would hand the
 *  hidden page to someone without the link). */
function publicCache(res: Response): void {
  res.setHeader("Cache-Control", res.locals.elfPreview ? "private, no-store" : PUBLIC_SHORT_CACHE);
}

elfRouter.get("/elf", schoolOn, (_req, res) => {
  publicCache(res);
  res.type("html").send(renderCalendarPage(calendarViewFor({ settings: settingsOf(res), now: new Date() })));
});

elfRouter.get("/elf/rules", schoolOn, (_req, res) => {
  publicCache(res);
  res.type("html").send(renderRulesPage({ settings: settingsOf(res) }));
});

elfRouter.get("/api/elf/calendar", schoolOn, (_req, res) => {
  publicCache(res);
  const view = calendarViewFor({ settings: settingsOf(res), now: new Date() });
  res.json({
    now: view.now.toISOString(),
    found: view.doors.filter((d) => d.state === "found").length,
    status: calendarStatus(view),
    doors: view.doors.map((d) => ({ door: d.door, v: doorVersion(d, view.now) })),
  });
});

elfRouter.get("/api/elf/door/:n", schoolOn, (req, res) => {
  publicCache(res);
  const view = calendarViewFor({ settings: settingsOf(res), now: new Date() });
  const raw = String(req.params.n);
  const door = /^\d{1,2}$/.test(raw) ? view.doors.find((d) => d.door === Number(raw)) : undefined;
  if (!door) return res.status(404).json({ error: "Not found" });
  const ctx = { now: view.now, joinUrl: view.joinUrl, hqUrl: view.hqUrl };
  return res.json({ tile: doorTile(door, view.now), detail: doorDetail(door, ctx) });
});

elfRouter.get("/api/elf/me", schoolOn, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const s = await signedInFamily(req);
  if (!s) return res.status(401).json({ error: "Not signed in" });
  // Wave 1: no door has opened, so there are no marks yet.
  return res.json({ doors: [] });
});
