import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config";
import { readCookie } from "../ball/gate";
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
  saveLook,
  type ElfSettings,
} from "../db/elf";
import {
  approvedPhoto,
  cluePicture,
  detectiveDoorsDone,
  doorCounts,
  doorScrapbook,
  familyDoorsDone,
  familyGuesses,
  familyHasWon,
  familyPhoto,
  familyVisits,
  finderParts,
  giveBackWordTry,
  loadDoorRun,
  loadDoorRunByPosterCode,
  loadPractice,
  markAutomaticSnowDays,
  recordWord,
  runsFor,
  saveGuess,
  sendElfPhoto,
  takeDownOwnPhoto,
  takeWordTry,
  visitElf,
  type DoorRun,
  type FamilyRuns,
} from "../db/elf-game";
import { DOOR_COUNT, isDoor, type Door } from "../elf/calendar";
import { MAX_WRONG_WORDS, decideWord } from "../elf/claim";
import { canGuess, cluesOut, doorState, isOpen, shownAt } from "../elf/doors";
import { badgeWords } from "../elf/emails";
import { decideGuess, type GuessRefusal, type SavedGuess } from "../elf/guess";
import { calendarStatus, renderCalendarPage } from "../elf/pages/calendar";
import { doorDetail, doorTile, doorVersion } from "../elf/pages/door";
import { renderHqPage } from "../elf/pages/hq";
import { claimWinHtml, renderPosterPage, visitWinHtml, wordRefusalWords } from "../elf/pages/poster";
import { renderRulesPage } from "../elf/pages/rules";
import type { CalendarView, ClaimWin, FamilyMarks, HqView, PosterOutcome, PosterView, VisitWin } from "../elf/pages/types";
import { renderWardrobePage } from "../elf/pages/wardrobe";
import { progressOf, promotionsBetween, type DoorsDone, type Rank } from "../elf/progress";
import { makePublicCalendar } from "../elf/public-calendar";
import type { Scrapbook } from "../elf/scrapbook";
import { COSTUMES, costumeUnlocked, normaliseLook, wardrobeState } from "../elf/wardrobe";
import { calendarViewFor, hqViewFor, lookFromForm, marksOf, posterViewFor, todayRunOf, wardrobeViewFor, type DetectiveRow, type FamilyRow } from "../elf/views";
import { elfPng, elfPngKey } from "../elf/elf-png";
import { sendSignInCodeTo } from "../elf/sign-in-code";
import { buildElfSessionParams, feeCoverPence, joinBodyFromForm, parseJoin } from "../elf/join";
import { FESTIVE_SURNAMES, familyDetectiveName, type DetectiveNameParts } from "../elf/names";
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
  codeVerdict,
  hashSessionId,
  newSessionId,
  readCode,
  sentFromOurOwnPage,
} from "../fundraising/sign-in";
import {
  checkPictureUpload,
  decodeBase64,
  PICTURE_BUSY_WORDS,
  PICTURE_LOOK_AGAIN,
  PICTURE_READ_WORDS,
  PICTURE_SIZE_WORDS,
  PICTURE_TYPE_WORDS,
} from "../fundraising/pictures";
import { processPicture } from "../fundraising/picture-process";
import { currentCardFee } from "./api";

// NBCC Elf Detective School: the public pages and the family's API (wave 1 plan,
// docs/superpowers/plans/2026-11-03-elf-detective-wave1-sign-up.md, and the doors in December,
// docs/superpowers/plans/2026-11-10-elf-wave-2-game-1.md). Every route here answers 404 while the
// school is switched off in the admin (elf_settings.school_on), so it ships dark; every game route
// (the poster page, the word, the guess, photos and pictures) also answers 404 while December's doors
// are switched off (elf_settings.doors_on), except the practice door to a browser with the preview link.
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

/** The switch: everything here is 404 while the school is off. The settings ride along, and so does
 *  whether this browser holds the preview link, which is also how head elves play the practice door. */
async function schoolOn(req: Request, res: Response, next: NextFunction): Promise<void> {
  const settings = await getElfSettings();
  const cookie = req.headers.cookie;
  const practice = previewAllowed(settings, readCookie(Array.isArray(cookie) ? cookie[0] : cookie, ELF_PREVIEW_COOKIE));
  // The cookie lets a browser see a switched off school only as a private preview, as it always has.
  const preview = !settings.schoolOn && practice;
  if (!settings.schoolOn && !preview) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  res.locals.elfSettings = settings;
  // The practice door is played with the preview link, whether or not the school is switched on.
  res.locals.elfPractice = practice;
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

/** December's doors' switch (C3), after schoolOn on every game route: the poster page, the word, the
 *  guess, photos and pictures. While it is off they are not found, except to a browser holding the
 *  preview link, which plays the practice door: each route then still refuses a real door's code or
 *  number (see gameDoor and runByCode), so the pass opens door 0 only. */
export async function doorsOn(_req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!settingsOf(res).doorsOn && !res.locals.elfPractice) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  next();
}

/** The doors as a family's routes see them, all read through runsFor: the real doors while December's
 *  doors are on, wave 1's shut doors while they are off, and the practice door only for a browser with
 *  the preview link. */
function familyRuns(res: Response, now: Date): Promise<FamilyRuns> {
  return runsFor({ settings: settingsOf(res), now, practice: !!res.locals.elfPractice });
}

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

/** Enrolments each address may make: loose enough for a family enrolling its children one at a time,
 *  or a busy shared connection on the evening the school opens. */
export const JOIN_LIMIT = { max: 10, windowMs: 10 * 60_000 } as const;
const joinLimiter = createRateLimiter(JOIN_LIMIT);

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

/** Something went wrong reading or writing the game: said plainly, never cached, and logged with the
 *  error's own message only (a place, a clue or a tag word never goes in a log or an answer). */
function gameFailed(res: Response, what: string, err: unknown, json: boolean): Response {
  console.error(`elf ${what} failed:`, err instanceof Error ? err.message : err);
  res.setHeader("Cache-Control", "no-store");
  const words = "Something went wrong just now. Please try again in a few minutes.";
  return json ? res.status(500).json({ error: words }) : res.status(500).type("text/plain").send(words);
}

/** The family's guesses by door: this year's while December's doors are on, and the practice door's
 *  (door 0) while a practice evening runs for this browser. */
async function guessesFor(res: Response, runs: FamilyRuns, familyId: number): Promise<Map<number, SavedGuess>> {
  const settings = settingsOf(res);
  const guesses = new Map(settings.doorsOn ? await familyGuesses(settings.year, familyId) : []);
  if (runs.practice) {
    const practice = (await familyGuesses(0, familyId)).get(0);
    if (practice) guesses.set(0, practice);
  }
  return guesses;
}

/** Detective HQ's view for a family, all read through runsFor: the family's guesses, each detective's
 *  doors done and, once today's door is found and its place shown, who found it (read for that one door
 *  only). `known` is the doors when the caller has just read them. */
async function hqViewOf(res: Response, family: FamilyRow, now: Date, known?: FamilyRuns): Promise<HqView> {
  const settings = settingsOf(res);
  const runs = known ?? (await familyRuns(res, now));
  const todayRun = todayRunOf({ settings, now, runs });
  const findersOfToday = async (): Promise<Map<Door, DetectiveNameParts[]>> => {
    if (!todayRun || todayRun.door === 0 || doorState(todayRun.facts, now) !== "found") return new Map();
    return new Map([[todayRun.door, await finderParts(todayRun.year, todayRun.door)]]);
  };
  const [guesses, doorsDone, finders] = await Promise.all([
    guessesFor(res, runs, family.id),
    familyDoorsDone(settings.year, family.id, runs.runs, now),
    findersOfToday(),
  ]);
  // HQ draws no photos: the calendar's script reads the family's own from /api/elf/me.
  return hqViewFor({ family, settings, now, runs, guesses, doorsDone, finders, photos: [] });
}

export async function getHq(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const now = new Date();
  try {
    const family = await familyOr(req, res);
    if (!family) return;
    return res.type("html").send(renderHqPage(await hqViewOf(res, family, now)));
  } catch (err) {
    return gameFailed(res, "detective hq", err, false);
  }
}

export async function getWardrobe(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const settings = settingsOf(res);
  const now = new Date();
  try {
    const family = await familyOr(req, res);
    if (!family) return;
    const id = detectiveIdOf(req.params.detective);
    const detective = family.detectives.find((d) => d.id === id);
    if (!detective) return res.status(404).type("text/plain").send("Not found");
    const doorsDone = await detectiveDoorsDone(settings.year, detective.id, (await familyRuns(res, now)).runs, now);
    return res.type("html").send(renderWardrobePage(wardrobeViewFor({ detective, settings, now, doorsDone })));
  } catch (err) {
    return gameFailed(res, "wardrobe", err, false);
  }
}

export async function getHqElf(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "private, no-store");
  const m = /^(\d{1,10})\.png$/.exec(String(req.params.file));
  const now = new Date();
  try {
    const s = await signedInFamily(req);
    const family = s ? await familyWithDetectives(s.familyId) : null;
    const detective = m && family ? family.detectives.find((d) => d.id === Number(m[1])) : undefined;
    if (!detective) return res.status(404).type("text/plain").send("Not found");
    // Drawn in the wardrobe the detective has earned, worked out here, never taken from the browser.
    const state = wardrobeState(await detectiveDoorsDone(settingsOf(res).year, detective.id, (await familyRuns(res, now)).runs, now));
    // The elf on its stage, stacked from the paper pictures (src/elf/elf-png.ts). The browser keeps it
    // but asks first (its ETag names the look), so a new look shows at once and an unchanged one is
    // never made again.
    res.setHeader("Cache-Control", "private, no-cache");
    const etag = `"${elfPngKey(detective.look, state, 240)}"`;
    res.setHeader("ETag", etag);
    if (String(req.headers["if-none-match"] ?? "") === etag) return res.status(304).send();
    const picture = await elfPng(detective.look, state, 240);
    if (!picture) {
      res.setHeader("Retry-After", "2");
      return res.status(503).type("text/plain").send("Busy. Please try again in a moment.");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.type("image/png").send(picture);
  } catch (err) {
    console.error("elf hq picture failed:", err instanceof Error ? err.message : err);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(500).type("text/plain").send("The picture could not be made.");
  }
}

elfRouter.get("/elf/hq", schoolOn, getHq);
elfRouter.get("/elf/hq/wardrobe/:detective", schoolOn, getWardrobe);
elfRouter.get("/elf/hq/elf/:file", schoolOn, getHqElf);

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
  let kept: Awaited<ReturnType<typeof saveLook>> = "not-found";
  if (detectiveId !== null) {
    const now = new Date();
    try {
      // Read from the signed in family's own detectives, so another family's detective is refused before
      // anything of its doors is read or anything is saved. The doors done are worked out here, from the
      // doors every family route reads, never taken from the page.
      const doors = (await familyDoorsDone(settingsOf(res).year, s.familyId, (await familyRuns(res, now)).runs, now)).get(detectiveId);
      if (doors) kept = await saveLook({ detectiveId, familyId: s.familyId, look, tried, favourites, doors });
    } catch (err) {
      return gameFailed(res, "look", err, json);
    }
  }
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
//   GET /api/elf/me          the signed in family's marks on the calendar and its own photos, or 401:
//                            { doors: [{ door, cracked, visited, snow }], photos: [{ door, token, status }] }
//
// The calendar is the same for every visitor, so it is built at most once every 15 seconds and shared
// (src/elf/public-calendar.ts), and cached briefly; nothing on it is private, and the practice door is
// never on it.

const PUBLIC_SHORT_CACHE = "public, max-age=15";

/** Cache a public page briefly, but never a private preview of it (a shared cache would hand the
 *  hidden page to someone without the link). */
function publicCache(res: Response): void {
  res.setHeader("Cache-Control", res.locals.elfPreview ? "private, no-store" : PUBLIC_SHORT_CACHE);
}

/** How the public calendar is built: snow in what cannot run (only once December's doors are on), read
 *  the doors through runsFor without the practice door, then who found each found door (its place shown
 *  or not) and the counts and scrapbook of each open one. A door neither found nor open shows nothing
 *  more, so nothing more is read for it. */
async function loadPublicCalendar(now: Date): Promise<CalendarView> {
  const settings = await getElfSettings();
  if (settings.doorsOn) await markAutomaticSnowDays(settings.year, now);
  const { runs } = await runsFor({ settings, now, practice: false });
  const finders = new Map<Door, DetectiveNameParts[]>();
  const counts = new Map<Door, { cracked: number; visited: number }>();
  const scrapbooks = new Map<Door, Scrapbook>();
  for (const run of runs) {
    if (run.door === 0) continue;
    const door = run.door;
    const state = doorState(run.facts, now);
    const found = state === "found-hidden" || state === "found";
    const open = isOpen(state);
    if (!found && !open) continue;
    const [parts, counted, book] = await Promise.all([
      found ? finderParts(run.year, door) : null,
      open ? doorCounts(run.year, door, now, run) : null,
      open ? doorScrapbook(run.year, door, now) : null,
    ]);
    if (parts) finders.set(door, parts);
    if (counted) counts.set(door, counted);
    if (book) scrapbooks.set(door, book);
  }
  return calendarViewFor({ settings, now, runs, finders, counts, scrapbooks });
}

let publicCalendar = makePublicCalendar({ load: loadPublicCalendar });

/** For tests: a fresh calendar, with nothing kept from before. */
export function resetPublicCalendar(): void {
  publicCalendar = makePublicCalendar({ load: loadPublicCalendar });
}

export async function getCalendarPage(_req: Request, res: Response): Promise<Response | void> {
  try {
    const view = await publicCalendar.get(new Date());
    publicCache(res);
    return res.type("html").send(renderCalendarPage(view));
  } catch (err) {
    return gameFailed(res, "calendar", err, false);
  }
}

export async function getCalendarFeed(_req: Request, res: Response): Promise<Response | void> {
  try {
    const view = await publicCalendar.get(new Date());
    publicCache(res);
    return res.json({
      now: view.now.toISOString(),
      // An elf found while its place is still hidden is found, as the page's tally counts it: counted
      // any other way, the calendar's script would set the tally back on its next poll.
      found: view.doors.filter((d) => d.state === "found" || d.state === "found-hidden").length,
      status: calendarStatus(view),
      doors: view.doors.map((d) => ({ door: d.door, v: doorVersion(d, view.now) })),
    });
  } catch (err) {
    return gameFailed(res, "calendar feed", err, true);
  }
}

export async function getDoorFeed(req: Request, res: Response): Promise<Response | void> {
  try {
    const view = await publicCalendar.get(new Date());
    publicCache(res);
    const raw = String(req.params.n);
    const door = /^\d{1,2}$/.test(raw) ? view.doors.find((d) => d.door === Number(raw)) : undefined;
    if (!door) return res.status(404).json({ error: "Not found" });
    const ctx = { now: view.now, joinUrl: view.joinUrl, hqUrl: view.hqUrl };
    return res.json({ tile: doorTile(door, view.now), detail: doorDetail(door, ctx) });
  } catch (err) {
    return gameFailed(res, "door feed", err, true);
  }
}

export async function getMe(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "private, no-store");
  const settings = settingsOf(res);
  const now = new Date();
  try {
    const s = await signedInFamily(req);
    const family = s ? await familyWithDetectives(s.familyId) : null;
    if (!family) return res.status(401).json({ error: "Not signed in" });
    const runs = await familyRuns(res, now);
    // This year's doors only: the practice door never counts towards anything.
    const doorsDone = await familyDoorsDone(settings.year, family.id, runs.runs, now);
    const { doors } = marksOf(runs.runs, family, doorsDone, [], now);
    // The family's own photo at each door it has visited, so it can take one down from the calendar. An
    // approved photo reads as waiting while its door's place is still hidden.
    const visited = doors.filter((m) => m.visited);
    const shown = (door: number): boolean => runs.runs.some((r) => r.door === door && isOpen(doorState(r.facts, now)));
    const found = await Promise.all(visited.map((m) => familyPhoto(settings.year, m.door, family.id, shown(m.door))));
    const photos: FamilyMarks["photos"] = visited.flatMap((m, i) => {
      const photo = found[i];
      return photo ? [{ door: m.door, token: photo.token, status: photo.status }] : [];
    });
    return res.json({ doors, photos });
  } catch (err) {
    return gameFailed(res, "marks", err, true);
  }
}

elfRouter.get("/elf", schoolOn, getCalendarPage);

elfRouter.get("/elf/rules", schoolOn, (_req, res) => {
  publicCache(res);
  res.type("html").send(renderRulesPage({ settings: settingsOf(res) }));
});

elfRouter.get("/api/elf/calendar", schoolOn, getCalendarFeed);
elfRouter.get("/api/elf/door/:n", schoolOn, getDoorFeed);
elfRouter.get("/api/elf/me", schoolOn, getMe);

// --- the doors in December: the poster page, the word, the guess, the family's photo, the pictures ------
//
//   GET    /elf/p/:code                    the page a poster's QR code opens (private, never cached)
//   POST   /elf/p/:code/word               the word on the elf's tag from the plain form: the page drawn
//                                          again with the answer in it
//   POST   /api/elf/word                   the same from the page's script, JSON { code, detectiveIds, word }:
//                                          { outcome: "won" | "visited", html }, or { reason, message,
//                                          triesLeft? } with 400 (409 for too early and gone home)
//   POST   /api/elf/guess                  a typed guess, JSON { door, text } or the plain form:
//                                          { ok: true, text }, or 400 { reason, message, door? }
//   POST   /api/elf/p/:code/photo          the family's photo for the door, JSON { mime, dataBase64,
//                                          consent: true } (the bigger body parser is in src/app.ts):
//                                          202 { status: "waiting", token }
//   DELETE /api/elf/p/:code/photo          the family takes its photo down, from the poster page
//   DELETE /api/elf/door/:n/photo          the same, from the door on the calendar
//   GET    /elf/door/:n/photo/:token.jpg   an approved photo, only while its door is open
//   GET    /elf/door/:n/elf/:visitId.png   a visiting detective's elf, only once the visit counts
//   GET    /elf/hq/clue/:door/:n.jpg       a clue's picture, signed in, only once the clue is out
//
// Every one sits behind schoolOn and doorsOn. While December's doors are off the preview link opens
// the practice door (door 0 of year 0) and nothing else. A family must be signed in for everything but
// the poster page and the door's pictures, and every post must come from our own pages. Nothing here
// writes a place, a clue or a tag word into a log, an error or a cache.

/** A poster's code, and a photo's address: twelve characters of the poster alphabet (no l, o, 0 or 1). */
const CODE_SHAPE = /^[a-km-np-z2-9]{12}$/;

const notFound = (res: Response, json = false): Response =>
  json ? res.status(404).json({ error: "Not found" }) : res.status(404).type("text/plain").send("Not found");

/** A door's number from a path or a form: 0 to 24, or null. */
function doorNumberOf(raw: unknown): number | null {
  const s = typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : "";
  return /^\d{1,2}$/.test(s) && Number(s) <= DOOR_COUNT ? Number(s) : null;
}

/** Which door a game route may act on, by number: door 0, the practice door (year 0), only for a
 *  browser with the preview link; a real door only while December's doors are on. Null otherwise. */
function gameDoor(res: Response, n: number | null): { year: number; door: Door | 0 } | null {
  if (n === 0) return res.locals.elfPractice ? { year: 0, door: 0 } : null;
  const settings = settingsOf(res);
  return isDoor(n) && settings.doorsOn ? { year: settings.year, door: n } : null;
}

/** The run of the door a game route may act on, from the doors as the family's routes read them. */
function gameRun(res: Response, runs: FamilyRuns, n: number | null): DoorRun | null {
  const where = gameDoor(res, n);
  if (!where) return null;
  return where.door === 0 ? runs.practice : (runs.runs.find((r) => r.door === where.door) ?? null);
}

/** The same door read on its own, for a public route that needs only that one door. */
async function oneGameRun(res: Response, n: number | null, now: Date): Promise<DoorRun | null> {
  const where = gameDoor(res, n);
  if (!where) return null;
  return where.door === 0 ? await loadPractice(now) : await loadDoorRun(where.year, where.door, now);
}

/** The door a poster's code opens: the practice door's for a browser with the preview link (never
 *  through the real doors' table), otherwise this year's door with that code while December's doors
 *  are on. Null for anything else, another year's door included. */
async function runByCode(res: Response, code: string, now: Date): Promise<DoorRun | null> {
  if (!CODE_SHAPE.test(code)) return null;
  if (res.locals.elfPractice) {
    const practice = await loadPractice(now);
    if (practice && practice.posterCode === code) return practice;
  }
  const settings = settingsOf(res);
  return settings.doorsOn ? await loadDoorRunByPosterCode(code, settings.year, now) : null;
}

/** How long a door's picture may be kept: as asked, by anyone, except one seen through the preview
 *  link or of the practice door, which nobody else should ever be handed. */
function pictureCache(res: Response, door: Door | 0, cache: string): string {
  return res.locals.elfPreview || door === 0 ? "private, no-store" : cache;
}

function sendPicture(res: Response, picture: { mime: string; bytes: Buffer }, cache: string): Response {
  res.setHeader("Content-Type", picture.mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", cache);
  return res.send(picture.bytes);
}

/** The poster page's view, with what a signed in family has done at this door. */
async function posterViewOf(run: DoorRun, family: FamilyRow | null, now: Date): Promise<PosterView> {
  if (!family) return posterViewFor({ run, now, family: null, stamped: new Set(), yourPhoto: null });
  const [visits, yourPhoto] = await Promise.all([
    familyVisits(run.year, family.id),
    // An approved photo reads as waiting while the place is still hidden.
    familyPhoto(run.year, run.door, family.id, isOpen(doorState(run.facts, now))),
  ]);
  const stamped = new Set(visits.filter((v) => v.door === run.door).map((v) => v.detectiveId));
  return posterViewFor({ run, now, family, stamped, yourPhoto });
}

export async function getPoster(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "private, no-store");
  const now = new Date();
  try {
    const run = await runByCode(res, String(req.params.code), now);
    if (!run) return notFound(res);
    const s = await signedInFamily(req);
    const family = s ? await familyWithDetectives(s.familyId) : null;
    return res.status(200).type("html").send(renderPosterPage(await posterViewOf(run, family, now)));
  } catch (err) {
    return gameFailed(res, "poster page", err, false);
  }
}

/** Words each family may type in 15 minutes, at every place together: plenty for a family going round
 *  the doors, and far too few to guess a tag's word from home (each place also allows six wrong words). */
export const WORD_LIMIT = { max: 30, windowMs: 15 * 60_000 } as const;
/** Words from one address in 15 minutes, whoever types them: loose enough for families sharing a mobile
 *  network's address at a busy door, tight enough to stop a script. */
export const WORD_ADDRESS_LIMIT = { max: 300, windowMs: 15 * 60_000 } as const;
/** Photos a family may try to send in a day, counted before any picture is opened, as the fundraisers'
 *  are: the database's limit of five a day applies only once a picture has been made, so these keep
 *  anyone from keeping the one picture maker busy. An address gets more, for a shared connection. */
export const PHOTO_TRIES = { max: 20, windowMs: 24 * 60 * 60_000 } as const;
const PHOTO_ADDRESS_TRIES = { max: 60, windowMs: PHOTO_TRIES.windowMs } as const;

const gameLimits = () => ({
  wordFamily: createRateLimiter(WORD_LIMIT),
  wordAddress: createRateLimiter(WORD_ADDRESS_LIMIT),
  photoFamily: createRateLimiter(PHOTO_TRIES),
  photoAddress: createRateLimiter(PHOTO_ADDRESS_TRIES),
});
let limits = gameLimits();

/** For tests: fresh counts for the game's limits. */
export function resetElfLimits(): void {
  limits = gameLimits();
}

/** May this family, from this address, try once more? The family's own limit comes first, and an
 *  address's allowance is spent only on tries the family's limit lets through. A request made on the box
 *  itself (local development, the pr.yml BDD suite) is never limited, as everywhere in this file. */
function allowedOnce(req: Request, familyId: number, family: ReturnType<typeof createRateLimiter>, address: ReturnType<typeof createRateLimiter>): boolean {
  if (isLoopbackRequest(req)) return true;
  const t = Date.now();
  return family.allow(String(familyId), t) && address.allow(req.ip ?? "unknown", t);
}

const NO_DOORS: DoorsDone = { cracked: [], visited: [] };

/** How long after a family's own find its second tap of the same word still shows the gold card: long
 *  enough for a double tap, too short for an old card to be shown again to claim twice. */
const DOUBLE_TAP_MS = 2 * 60_000;

/** What a word that counted at `door` gives a detective: the doors done with it, the rank, the rank it
 *  has just reached (if it reached one) and how many costumes it unlocks. The practice door counts for
 *  nothing, so it gives nothing. */
function earnedBy(before: DoorsDone, door: Door | 0): { doorsDone: number; rank: Rank; promotedTo: Rank | null; newThings: number } {
  const after: DoorsDone = { ...before, visited: [...(before.visited ?? []), door] };
  const was = progressOf(before);
  const got = progressOf(after);
  const promotions = promotionsBetween(was.doorsDone, got.doorsDone);
  const had = wardrobeState(before);
  const has = wardrobeState(after);
  return {
    doorsDone: got.doorsDone,
    rank: got.rank,
    promotedTo: promotions[promotions.length - 1] ?? null,
    newThings: COSTUMES.filter((c) => !costumeUnlocked(c.id, had) && costumeUnlocked(c.id, has)).length,
  };
}

/** The word on the elf's tag, which claims the elf and stamps a visit (src/elf/claim.ts). JSON for the
 *  page's script, or the poster page drawn again for the plain form. Every answer is awaited inside the
 *  try, so a failure while drawing one is a 500, never a promise that nothing handles. */
export async function postWord(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const json = wantsJson(req);
  if (!ourOwnPage(req)) return res.status(403).json({ error: ELF_NOT_OURS });
  const signIn = (): Response | void => (json ? res.status(401).json({ error: "Please sign in again." }) : res.redirect(303, "/elf/sign-in"));
  const body = (req.body ?? {}) as Record<string, unknown>;
  const now = new Date();
  // A try taken at a door that is neither kept (a wrong word keeps it) nor given back yet: if anything
  // fails before the word is decided, the finally below gives it back, so a failure never costs a try.
  let held: { year: number; door: Door | 0; familyId: number } | null = null;
  try {
    const s = await signedInFamily(req);
    if (!s) return signIn();
    const limited = !allowedOnce(req, s.familyId, limits.wordFamily, limits.wordAddress);
    if (limited && json) return res.status(429).json({ reason: "too-many-requests", message: ELF_TOO_MANY });
    const family = await familyWithDetectives(s.familyId);
    if (!family) return signIn();
    const run = await runByCode(res, String(req.params.code ?? body.code ?? ""), now);
    if (!run) return notFound(res, json);
    // The plain form is told on its own page, in the form's status line.
    if (limited) return res.status(429).type("html").send(renderPosterPage({ ...(await posterViewOf(run, family, now)), wordError: ELF_TOO_MANY }));
    const { year, door } = run;
    // The try is taken before the word is looked at, in one step, so a burst of words cannot all read
    // the same count.
    const wrong = await takeWordTry(year, door, family.id);
    held = { year, door, familyId: family.id };
    const [visits, hasWon] = await Promise.all([familyVisits(year, family.id), door === 0 ? false : familyHasWon(year, family.id)]);
    const state = doorState(run.facts, now);
    const decision = decideWord(
      {
        doorState: state,
        goneHome: run.facts.goneHome,
        // A snowed in door has no word: any word reads as a wrong one, as it does at every place.
        secretWord: state === "snow" ? "" : (run.tagWord ?? ""),
        familyDetectiveIds: family.detectives.map((d) => d.id),
        familyHasWon: hasWon,
        // The wrong words before this one, which is already counted.
        wrongTries: wrong - 1,
        alreadyStamped: visits.filter((v) => v.door === door).map((v) => v.detectiveId),
      },
      { detectiveIds: json ? body.detectiveIds : body.detective, word: typeof body.word === "string" ? body.word : "" },
    );

    const answer = async (status: number, outcome: PosterOutcome): Promise<Response> => {
      if (!json) return res.status(status).type("html").send(renderPosterPage(await posterViewOf(run, family, now), outcome));
      if (!outcome.ok) {
        const left = outcome.triesLeft === undefined ? {} : { triesLeft: outcome.triesLeft };
        return res.status(status).json({ reason: outcome.reason, message: wordRefusalWords(outcome.reason, outcome.triesLeft), ...left });
      }
      return res.status(status).json(outcome.outcome === "won" ? { outcome: "won", html: claimWinHtml(outcome.win) } : { outcome: "visited", html: visitWinHtml(outcome.visit) });
    };

    // The family's own screen: each detective's name in full, as the family typed it.
    const nameOf = (d: DetectiveRow): string => familyDetectiveName({ firstName: d.firstName, surname: d.surname, approved: true });
    const doorsDoneNow = async (): Promise<Map<number, DoorsDone>> => familyDoorsDone(settingsOf(res).year, family.id, (await familyRuns(res, now)).runs, now);
    /** The gold card for the staff: who found the elf, with the time of the find. */
    const goldCard = (detectives: readonly DetectiveRow[], before: Map<number, DoorsDone>, at: Date): PosterOutcome => {
      const win: ClaimWin = {
        door,
        elfName: run.elfName,
        placeName: run.placeName ?? "",
        at,
        now,
        detectives: detectives.map((d) => ({
          name: nameOf(d),
          badgeNumber: d.badgeNumber === null ? "" : badgeWords(d.badgeNumber),
          rank: earnedBy(before.get(d.id) ?? NO_DOORS, door).rank,
          elfUrl: `/elf/hq/elf/${d.id}.png`,
        })),
        calendarUrl: "/elf",
        hqUrl: "/elf/hq",
      };
      return { form: "word", ok: true, outcome: "won", win };
    };

    // Only a wrong word uses up one of the family's tries at this place.
    if (!decision.ok && decision.reason === "wrong-word") {
      held = null;
      return await answer(400, { form: "word", ok: false, reason: "wrong-word", triesLeft: MAX_WRONG_WORDS - wrong });
    }
    held = null;
    await giveBackWordTry(year, door, family.id);
    if (!decision.ok) {
      // A double tap that arrives once the family's own first tap has won: the elf is theirs and every
      // detective ticked has the stamp. That is the gold card again, with the find's own time, but only
      // just after the find, so an old card can never be shown again to claim a second prize.
      const foundAt = run.facts.foundAt;
      const sinceFind = foundAt ? now.getTime() - foundAt.getTime() : Number.NaN;
      if (decision.reason === "nothing-new" && foundAt && run.foundFamilyId === family.id && sinceFind >= 0 && sinceFind <= DOUBLE_TAP_MS) {
        const finders = family.detectives.filter((d) => visits.some((v) => v.door === door && v.found && v.detectiveId === d.id));
        return await answer(200, goldCard(finders, await doorsDoneNow(), foundAt));
      }
      return await answer(decision.reason === "too-early" || decision.reason === "gone-home" ? 409 : 400, { form: "word", ok: false, reason: decision.reason });
    }

    // The ticks arrive as text; the family's detectives are numbers.
    const chosen = decision.detectiveIds.map((id) => family.detectives.find((d) => String(d.id) === id)).filter((d): d is DetectiveRow => d !== undefined);
    const before = await doorsDoneNow();
    // Each elf goes on the door in its look at this moment, made safe against what its detective has done.
    const looks: Record<number, unknown> = {};
    for (const d of chosen) looks[d.id] = normaliseLook(d.look, wardrobeState(before.get(d.id) ?? NO_DOORS));
    const won = decision.outcome === "won";
    // When the place is shown. A family winning now shows it at the reveal (or now, once that has
    // passed); if another family's word got there in the same moment, that is still when the place is
    // shown, so the family that loses the race counts from then.
    const shown = shownAt(won ? { ...run.facts, foundAt: now } : run.facts);
    const result = await recordWord({ year, door, familyId: family.id, detectiveIds: chosen.map((d) => d.id), won, shownAt: shown, at: now, looks });
    let winnerAt: Date | null = result.won ? now : null;
    if (won && !result.won) {
      // Another word was first, in the same moment. If it was this family's own (a double tap), this is
      // still the family's win.
      const fresh = door === 0 ? await loadPractice(now) : await loadDoorRun(year, door, now);
      if (fresh && fresh.foundFamilyId === family.id) winnerAt = fresh.facts.foundAt ?? now;
    }
    if (winnerAt) return await answer(200, goldCard(chosen, before, winnerAt));

    // A visit that counts only from later (its place still hidden) promises nothing that unlocks only
    // then, no promotion and no new things: the "It counts from" line says when it counts.
    const later = result.countsFrom.getTime() > now.getTime();
    const visit: VisitWin = {
      door,
      placeName: run.placeName ?? "",
      countsFrom: later ? result.countsFrom : null,
      detectives: chosen.map((d) => {
        const got = earnedBy(before.get(d.id) ?? NO_DOORS, door);
        return {
          name: nameOf(d),
          doorsDone: got.doorsDone,
          promotedTo: later ? null : got.promotedTo,
          newThings: later ? 0 : got.newThings,
          wardrobeUrl: `/elf/hq/wardrobe/${d.id}`,
        };
      }),
      photo: { door, sendUrl: `/api/elf/p/${run.posterCode}/photo` },
      calendarUrl: "/elf",
      hqUrl: "/elf/hq",
    };
    return await answer(200, { form: "word", ok: true, outcome: "visited", visit });
  } catch (err) {
    return gameFailed(res, "word", err, json);
  } finally {
    if (held) {
      const { year, door, familyId } = held;
      // Never throws from here: the answer has gone, and a failure must not become a promise nothing handles.
      try {
        await giveBackWordTry(year, door, familyId);
      } catch (err) {
        console.error("elf word try give back failed:", err instanceof Error ? err.message : err);
      }
    }
  }
}

/** What to tell a family whose guess was refused. `elf` names the door's elf; `door` is the open door
 *  whose place was typed. */
export function wordsForGuessRefusal(reason: GuessRefusal, elf: string, door?: number): string {
  switch (reason) {
    case "not-hunting":
      return "Too late: the hiding place is shown now. Have a look at the calendar.";
    case "empty":
      return `Type where you think ${elf} is hiding.`;
    case "too-long":
      return "That is a bit long. Up to 80 letters is plenty.";
    case "place-already-open":
      return `That elf was already found behind door ${door ?? ""}. Try again!`;
  }
}

/** A typed guess: where the family thinks the elf is hiding (src/elf/guess.ts). */
export async function postGuess(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const json = wantsJson(req);
  if (!ourOwnPage(req)) return res.status(403).json({ error: ELF_NOT_OURS });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const now = new Date();
  try {
    const s = await signedInFamily(req);
    if (!s) return json ? res.status(401).json({ error: "Please sign in again." }) : res.redirect(303, "/elf/sign-in");
    // The door as it is at this moment, never the calendar's copy: a guess is only taken while it can be.
    const runs = await familyRuns(res, now);
    const run = gameRun(res, runs, doorNumberOf(body.door));
    if (!run) return notFound(res, json);
    const state = doorState(run.facts, now);
    const openPlaces = runs.runs.flatMap((r) => (r.door !== 0 && isOpen(doorState(r.facts, now)) ? [{ door: r.door, names: r.names }] : []));
    const decision = decideGuess({ doorState: state, openPlaces }, body.text);
    if (!decision.ok) {
      // A door's elf is named only once the door can be guessed: until then its name stays a surprise.
      const message = wordsForGuessRefusal(decision.reason, canGuess(state) ? run.elfName : "the elf", decision.door);
      if (json) return res.status(400).json({ reason: decision.reason, message, ...(decision.door === undefined ? {} : { door: decision.door }) });
      // The plain form has no script to show the words: Detective HQ is drawn again with them in the guess
      // form's status line (or in the case, once there is no form to say it in).
      const family = await familyWithDetectives(s.familyId);
      if (!family) return res.redirect(303, "/elf/sign-in");
      const view = await hqViewOf(res, family, now, runs);
      const today = view.today && view.today.door === run.door ? { ...view.today, guessError: message } : view.today;
      return res.status(400).type("html").send(renderHqPage({ ...view, today }));
    }
    await saveGuess(run.year, run.door, s.familyId, { text: decision.text, norm: decision.norm }, now);
    return json ? res.status(200).json({ ok: true, text: decision.text }) : res.redirect(303, "/elf/hq");
  } catch (err) {
    return gameFailed(res, "guess", err, json);
  }
}

export const ELF_PHOTO_POST_PATH = "/api/elf/p/:code/photo";

/** Before the bigger body parser on the photo post (src/app.ts): no body is read unless the request
 *  carries a session cookie the shape of one of ours. Whether the session is real is checked by the
 *  route, after the body is read. */
export function elfPhotoBodyGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "POST") return next();
  if (!sessionIdOf(req)) {
    res.status(401).json({ error: "Please sign in again." });
    return;
  }
  next();
}

const NOT_VISITED = { error: "Type the word on the elf's tag first." };
const NO_CONSENT = { error: "Tick the box to say we can show this photo." };
const PHOTO_LIMIT = { error: "You have sent 5 photos today. Please try again tomorrow." };
// The answers for a picture that cannot be used, one set shared with the fundraisers (src/fundraising/pictures.ts).
const LOOK_AGAIN = PICTURE_LOOK_AGAIN;
const PHOTO_TYPE = PICTURE_TYPE_WORDS;
const PHOTO_SIZE = PICTURE_SIZE_WORDS;
const PHOTO_READ = PICTURE_READ_WORDS;
const PHOTO_BUSY = { error: PICTURE_BUSY_WORDS };
const PHOTO_TOO_MANY_TRIES = { error: "You have tried to send a lot of photos today. Please try again tomorrow." };

export async function postPhoto(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  if (!ourOwnPage(req)) return res.status(403).json({ error: ELF_NOT_OURS });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const now = new Date();
  try {
    const s = await signedInFamily(req);
    if (!s) return res.status(401).json({ error: "Please sign in again." });
    const run = await runByCode(res, String(req.params.code), now);
    if (!run) return notFound(res, true);
    const visits = await familyVisits(run.year, s.familyId);
    if (!visits.some((v) => v.door === run.door)) return res.status(403).json(NOT_VISITED);
    if (body.consent !== true) return res.status(400).json(NO_CONSENT);
    if (!allowedOnce(req, s.familyId, limits.photoFamily, limits.photoAddress)) return res.status(429).json(PHOTO_TOO_MANY_TRIES);
    const bytes = decodeBase64(typeof body.dataBase64 === "string" ? body.dataBase64 : "");
    const check = checkPictureUpload(typeof body.mime === "string" ? body.mime : "", bytes);
    // A JPEG, PNG or WebP whose bytes really are that, as the fundraisers' pictures take: it is made
    // again below, so what is stored is always a fresh JPEG.
    if (!check.ok) {
      const size = !check.ok && check.reason === "size";
      return res.status(size ? 413 : 400).json({ error: LOOK_AGAIN, fields: { photo: size ? PHOTO_SIZE : PHOTO_TYPE } });
    }
    // Made again here, so nothing from the camera is kept: not where, not when, not the phone.
    const made = await processPicture("main", bytes);
    if (!made.ok && made.reason === "busy") return res.status(503).json(PHOTO_BUSY);
    if (!made.ok && made.reason === "size") return res.status(413).json({ error: LOOK_AGAIN, fields: { photo: PHOTO_SIZE } });
    if (!made.ok) return res.status(400).json({ error: LOOK_AGAIN, fields: { photo: PHOTO_READ } });
    const sent = await sendElfPhoto({
      year: run.year,
      door: run.door,
      familyId: s.familyId,
      picture: { mime: made.mime, bytes: made.bytes, width: made.width, height: made.height },
      at: now,
    });
    if (sent === "limit") return res.status(429).json(PHOTO_LIMIT);
    return res.status(202).json({ status: "waiting", token: sent.token });
  } catch (err) {
    return gameFailed(res, "photo", err, true);
  }
}

/** The family takes its own photo down: gone from the door at once, and its bytes deleted (C8). */
async function takeDown(req: Request, res: Response, doorOf: (now: Date) => Promise<{ year: number; door: Door | 0 } | null>): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  if (!ourOwnPage(req)) return res.status(403).json({ error: ELF_NOT_OURS });
  const now = new Date();
  try {
    const s = await signedInFamily(req);
    if (!s) return res.status(401).json({ error: "Please sign in again." });
    const where = await doorOf(now);
    if (!where) return notFound(res, true);
    await takeDownOwnPhoto(where.year, where.door, s.familyId, now);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return gameFailed(res, "photo take down", err, true);
  }
}

export function deletePhotoByCode(req: Request, res: Response): Promise<Response | void> {
  return takeDown(req, res, (now) => runByCode(res, String(req.params.code), now));
}

export function deletePhotoByDoor(req: Request, res: Response): Promise<Response | void> {
  return takeDown(req, res, async () => gameDoor(res, doorNumberOf(req.params.n)));
}

export async function getDoorPhoto(req: Request, res: Response): Promise<Response | void> {
  // Never kept until there is a photo to serve, so no cache holds a "not yet" from before the reveal.
  res.setHeader("Cache-Control", "no-store");
  const n = doorNumberOf(req.params.n);
  const token = String(req.params.token);
  if (!CODE_SHAPE.test(token) || !gameDoor(res, n)) return notFound(res);
  const now = new Date();
  try {
    const run = await oneGameRun(res, n, now);
    // Only while its door is open: a photo sent while the place was still hidden never gives it away.
    if (!run || !isOpen(doorState(run.facts, now))) return notFound(res);
    const photo = await approvedPhoto(run.year, run.door, token);
    if (!photo) return notFound(res);
    // Kept briefly, so a photo taken down stops being served within minutes.
    return sendPicture(res, photo, pictureCache(res, run.door, "public, max-age=300"));
  } catch (err) {
    return gameFailed(res, "door photo", err, false);
  }
}

export async function getDoorElf(req: Request, res: Response): Promise<Response | void> {
  // Never kept until there is an elf to serve, so no cache holds a "not yet" from before its visit counts.
  res.setHeader("Cache-Control", "no-store");
  const where = gameDoor(res, doorNumberOf(req.params.n));
  // A visit's id has the same shape as a detective's.
  const visitId = detectiveIdOf(req.params.visitId);
  if (!where || visitId === null) return notFound(res);
  const now = new Date();
  try {
    const visit = await visitElf(where.year, where.door, visitId);
    // An elf goes on its door only once its visit counts (for most visits, once the place is shown).
    if (!visit || !(visit.countsFrom.getTime() <= now.getTime())) return notFound(res);
    // Drawn in the detective's wardrobe as it stands: this year's doors, never the practice door.
    const doorsDone = await detectiveDoorsDone(settingsOf(res).year, visit.detectiveId, (await familyRuns(res, now)).runs, now);
    const state = wardrobeState(doorsDone);
    const etag = `"${elfPngKey(visit.look, state, 240)}"`;
    const cache = pictureCache(res, where.door, "public, max-age=3600");
    if (String(req.headers["if-none-match"] ?? "") === etag) {
      res.setHeader("Cache-Control", cache);
      res.setHeader("ETag", etag);
      return res.status(304).send();
    }
    const picture = await elfPng(visit.look, state, 240);
    if (!picture) {
      res.setHeader("Retry-After", "2");
      return res.status(503).type("text/plain").send("Busy. Please try again in a moment.");
    }
    res.setHeader("ETag", etag);
    return sendPicture(res, { mime: "image/png", bytes: picture }, cache);
  } catch (err) {
    return gameFailed(res, "door elf", err, false);
  }
}

export async function getCluePicture(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "private, no-store");
  const raw = String(req.params.n);
  const door = doorNumberOf(req.params.door);
  // The practice door has no pictures.
  if (!/^[1-3]$/.test(raw) || door === null || door === 0) return notFound(res);
  const now = new Date();
  try {
    if (!(await signedInFamily(req))) return notFound(res);
    const run = gameRun(res, await familyRuns(res, now), door);
    // Only once its clue is out: never before its time, and never on a snow day, which has no clues.
    if (!run || cluesOut(run.facts, now) < Number(raw)) return notFound(res);
    const picture = await cluePicture(run.year, run.door, Number(raw));
    if (!picture) return notFound(res);
    return sendPicture(res, picture, "private, no-store");
  } catch (err) {
    return gameFailed(res, "clue picture", err, false);
  }
}

elfRouter.get("/elf/p/:code", schoolOn, doorsOn, getPoster);
elfRouter.post("/elf/p/:code/word", forms, schoolOn, doorsOn, postWord);
elfRouter.post("/api/elf/word", forms, schoolOn, doorsOn, postWord);
elfRouter.post("/api/elf/guess", forms, schoolOn, doorsOn, postGuess);
elfRouter.post(ELF_PHOTO_POST_PATH, schoolOn, doorsOn, postPhoto);
elfRouter.delete(ELF_PHOTO_POST_PATH, schoolOn, doorsOn, deletePhotoByCode);
elfRouter.delete("/api/elf/door/:n/photo", schoolOn, doorsOn, deletePhotoByDoor);
elfRouter.get("/elf/door/:n/photo/:token.jpg", schoolOn, doorsOn, getDoorPhoto);
elfRouter.get("/elf/door/:n/elf/:visitId.png", schoolOn, doorsOn, getDoorElf);
elfRouter.get("/elf/hq/clue/:door/:n.jpg", schoolOn, doorsOn, getCluePicture);
