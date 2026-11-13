import express, { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
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
  familyByEmailsToken,
  findElfSession,
  familyWithDetectives,
  getElfSettings,
  orderForWelcome,
  saveLook,
  setEmailsStopped,
  type ElfSettings,
} from "../db/elf";
import {
  approvedPhoto,
  cluePicture,
  detectiveDoorsDone,
  doorCounts,
  doorPhotos,
  doorsPhotos,
  doorScrapbook,
  familyDoorsDone,
  familyHasWon,
  familyKnowledge,
  familyKnowsDoor,
  familyPhoto,
  familyVisits,
  finderParts,
  giveBackWordTry,
  loadDoorRun,
  loadDoorRunByPosterCode,
  loadDoorRuns,
  loadPractice,
  markAutomaticSnowDays,
  recordWord,
  runsFor,
  saveGuess,
  saveLateGuess,
  sendElfPhoto,
  takeDownOwnPhoto,
  takeWordTry,
  visitElf,
  type DoorRun,
  type FamilyRuns,
} from "../db/elf-game";
import { entryPicture, familyEntries, familyHasMobile, saveEntry } from "../db/elf-grand-prize";
import type { MadePicture } from "../db/fundraiser-pictures";
import { normaliseUkMobile } from "../elf/alerts";
import { DOOR_COUNT, isDoor, type Door } from "../elf/calendar";
import { decideGo, doorsKnown, doorsToCrack, knowsPlace, mayHaveAGo, placesPublic, type FamilyKnowledge, type GoRefusal } from "../elf/catch-up";
import { MAX_WRONG_WORDS, decideWord } from "../elf/claim";
import { canGuess, cluesOut, doorState, isOpen, shownAt, type DoorState } from "../elf/doors";
import { badgeWords } from "../elf/emails";
import { entriesOpenAt, entryOpen, grandPrizeClosesAt, prizeSectionShows } from "../elf/grand-prize";
import { decideGuess, type GuessRefusal } from "../elf/guess";
import { calendarStatus, renderCalendarPage } from "../elf/pages/calendar";
import { doorDetail, doorTile, doorVersion } from "../elf/pages/door";
import { renderEmailsPage } from "../elf/pages/emails";
import { renderEntryPage } from "../elf/pages/entry";
import { goOutcomeWords, renderGoPage } from "../elf/pages/go";
import { renderHqPage } from "../elf/pages/hq";
import { claimWinHtml, renderPosterPage, visitWinHtml, wordRefusalWords } from "../elf/pages/poster";
import { renderRulesPage } from "../elf/pages/rules";
import type { CalendarView, ClaimWin, DoorView, FamilyMarks, GoView, HqView, PosterOutcome, PosterView, VisitWin } from "../elf/pages/types";
import { renderWardrobePage } from "../elf/pages/wardrobe";
import { renderElfCertificate, shareCardSvg } from "../elf/print";
import { progressOf, promotionsBetween, type DoorsDone, type Rank } from "../elf/progress";
import { makePublicCalendar } from "../elf/public-calendar";
import type { ScrapPhoto, Scrapbook } from "../elf/scrapbook";
import { COSTUMES, costumeUnlocked, normaliseLook, wardrobeState, type WardrobeState } from "../elf/wardrobe";
import {
  calendarViewFor,
  doorPlaceOf,
  EMAILS_SWITCH_PATH,
  entryViewFor,
  familyDoorView,
  GRADUATE_VIDEO_PATH,
  goOutcomeOf,
  goViewFor,
  graduateVideoOf,
  hqViewFor,
  lookFromForm,
  marksOf,
  posterViewFor,
  todayRunOf,
  wardrobeViewFor,
  type DetectiveRow,
  type FamilyRow,
} from "../elf/views";
import { realElfDeps, sendProudMoments, type WordMoment } from "../elf/worker";
import { clockWords } from "../elf/words";
import { elfPng, elfPngKey, inTurn } from "../elf/elf-png";
import { sendSignInCodeTo } from "../elf/sign-in-code";
import { buildElfSessionParams, feeCoverPence, joinBodyFromForm, MOBILE_WORDS, parseJoin } from "../elf/join";
import { FESTIVE_SURNAMES, familyDetectiveName, type DetectiveNameParts } from "../elf/names";
import { renderJoinPage } from "../elf/pages/join";
import { ELF_BAR_START } from "../elf/pages/shell";
import { renderSignInPage, renderWelcomePage } from "../elf/pages/sign-in";
import { dressPage } from "../site/chrome";
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
    // A private preview: never listed, never cached, and every page says so across the top, straight
    // under the site's banner.
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "private, no-store");
    const send = res.send.bind(res);
    res.send = ((body?: unknown) =>
      send(typeof body === "string" && body.startsWith("<!doctype html>") ? body.replace(ELF_BAR_START, PREVIEW_STRIP + ELF_BAR_START) : body)) as Response["send"];
  }
  next();
}

const PREVIEW_STRIP =
  '<p class="elf-preview-strip" role="status">Private preview: Elf Detective School is switched off, and only people with the preview link can see this. Payments here are real.</p>';

/** Sends an Elf Detective School page. Its banner and footer are the site's (src/elf/pages/shell.ts),
 *  so as it goes out it gains what every page of the site gains: the menu's items that are switched
 *  on, and the footer's links (dressPage, src/site/chrome.ts), never waiting more than 1.5s for them. */
async function sendPage(req: Request, res: Response, html: string): Promise<Response> {
  const dressed = await dressPage(html, header(req, "cookie"));
  return res.type("html").send(dressed);
}

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
  req: Request,
  res: Response,
  status: number,
  extra: { errors?: string[]; values?: Record<string, string>; signedIn?: { grownUpName: string; email: string } } = {},
): Promise<Response> {
  res.status(status).setHeader("Cache-Control", "no-store");
  return sendPage(
    req,
    res,
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
  try {
    const family = await joiningFamily(req);
    await sendJoinPage(req, res, 200, family ? { signedIn: { grownUpName: family.grownUpName, email: family.email } } : {});
  } catch (err) {
    gameFailed(res, "join page", err, false);
  }
});

/** Enrolments each address may make: loose enough for a family enrolling its children one at a time,
 *  or a busy shared connection on the evening the school opens. */
export const JOIN_LIMIT = { max: 10, windowMs: 10 * 60_000 } as const;
const joinLimiter = createRateLimiter(JOIN_LIMIT);

// The sign up, the sign in code request and the sign in each read the database before or after they
// answer. A failure there is said plainly (gameFailed: a 500, never cached), never a rejected promise,
// which would stop the whole server: src has no unhandledRejection handler. An answer already given
// stays as it was.
export async function postJoin(req: Request, res: Response): Promise<Response | void> {
  try {
    return await answerJoin(req, res);
  } catch (err) {
    return gameFailed(res, "join", err, wantsJson(req));
  }
}

async function answerJoin(req: Request, res: Response): Promise<Response | void> {
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
    json ? res.status(status).json({ errors }) : sendJoinPage(req, res, status, { errors, values: typedValues(req.body ?? {}), signedIn });

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
    return sendSignInPage(req, res, 200, { stage: "code", email, message: JOIN_CHECK_EMAIL });
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

function sendSignInPage(req: Request, res: Response, status: number, view: Parameters<typeof renderSignInPage>[0]): Promise<Response> {
  res.status(status).setHeader("Cache-Control", "no-store");
  return sendPage(req, res, renderSignInPage(view));
}

elfRouter.get("/elf/sign-in", schoolOn, async (req, res) => {
  try {
    await sendSignInPage(req, res, 200, { stage: "email" });
  } catch (err) {
    gameFailed(res, "sign in page", err, false);
  }
});

export async function postSignInRequest(req: Request, res: Response): Promise<Response | void> {
  try {
    return await answerSignInRequest(req, res);
  } catch (err) {
    return gameFailed(res, "sign in code request", err, wantsJson(req));
  }
}

async function answerSignInRequest(req: Request, res: Response): Promise<Response | void> {
  const json = wantsJson(req);
  if (!ourOwnPage(req)) {
    if (json) return res.status(403).json({ error: ELF_NOT_OURS });
    return sendSignInPage(req, res, 403, { stage: "email", message: ELF_NOT_OURS, error: true });
  }
  const parsed = emailSchema.safeParse(req.body?.email);
  if (!parsed.success) {
    const words = "Please give a valid email address.";
    if (json) return res.status(400).json({ error: words });
    return sendSignInPage(req, res, 400, { stage: "email", message: words, error: true });
  }
  const email = parsed.data;
  const now = Date.now();
  // Every limit is counted every time, so a limited email still uses up its address's allowance.
  const allowed =
    isLoopbackRequest(req) ||
    [codeEmailLimiter.allow(email, now), codeEmailDayLimiter.allow(email, now), codeIpLimiter.allow(req.ip ?? "unknown", now)].every(Boolean);
  // Always the same answer, and given BEFORE looking (the page is sent before the search starts), so
  // neither the words nor the time it takes tell anyone who has detectives enrolled.
  if (json) res.status(200).json({ message: ELF_REQUEST_MESSAGE });
  else await sendSignInPage(req, res, 200, { stage: "code", email, message: ELF_REQUEST_MESSAGE });
  if (!allowed) return;
  if (!(await getElfSettings()).schoolOn) return;
  await sendSignInCodeTo(email);
}

export async function postSignIn(req: Request, res: Response): Promise<Response | void> {
  try {
    return await answerSignIn(req, res);
  } catch (err) {
    return gameFailed(res, "sign in", err, wantsJson(req));
  }
}

async function answerSignIn(req: Request, res: Response): Promise<Response | void> {
  const json = wantsJson(req);
  const email = emailSchema.safeParse(req.body?.email);
  const back = (status: number, words: string) => {
    if (json) return res.status(status).json({ error: words });
    return sendSignInPage(req, res, status, { stage: "code", email: email.success ? email.data : "", message: words, error: true });
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
  try {
    return await answerSignOut(req, res);
  } catch (err) {
    return gameFailed(res, "sign out", err, wantsJson(req));
  }
}

async function answerSignOut(req: Request, res: Response): Promise<Response | void> {
  if (!ourOwnPage(req)) return res.status(403).json({ error: ELF_NOT_OURS });
  const id = sessionIdOf(req);
  if (id) await deleteElfSession(hashSessionId(id));
  res.clearCookie(ELF_SESSION_COOKIE, { path: "/" });
  return wantsJson(req) ? res.status(200).json({ status: "signed_out" }) : res.redirect(303, "/elf");
}

export async function getWelcome(req: Request, res: Response): Promise<Response | void> {
  try {
    return await welcome(req, res);
  } catch (err) {
    return gameFailed(res, "welcome", err, false);
  }
}

async function welcome(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const raw = req.query.elf_session;
  const sessionId = typeof raw === "string" && /^cs_[A-Za-z0-9_]{1,200}$/.test(raw) ? raw : null;
  const order = sessionId ? await orderForWelcome(sessionId) : null;
  const token = readCookie(header(req, "cookie"), ELF_PENDING_COOKIE);
  const ours = order !== null && token !== null && /^[0-9a-f]{64}$/.test(token) && order.browserTokenHash === hashElfToken(token);
  if (ours && order.status === "pending") return sendPage(req, res.status(200), renderWelcomePage({ state: "checking" }));
  if (ours && order.status === "paid" && order.openedFamily) {
    await startSession(req, res, order.familyId);
    res.clearCookie(ELF_PENDING_COOKIE, { path: "/" });
    return res.redirect(303, "/elf/hq");
  }
  return sendPage(req, res.status(200), renderWelcomePage({ state: "done" }));
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
  // An answer already on its way cannot be changed, and trying would throw from the catch.
  if (res.headersSent) return res;
  res.setHeader("Cache-Control", "no-store");
  const words = "Something went wrong just now. Please try again in a few minutes.";
  return json ? res.status(500).json({ error: words }) : res.status(500).type("text/plain").send(words);
}

/** A family that has neither guessed nor been anywhere: what is read while December's doors are off. */
const NOTHING_DONE: FamilyKnowledge = { guesses: new Map(), typed: new Set() };

/** What the family has done, door by door (src/elf/catch-up.ts): its guesses, and the doors where one of its
 *  detectives typed the tag word. This year's while December's doors are on, with the practice door's (door
 *  0) merged in while a practice evening runs for this browser; with neither, nothing is read. */
async function knowledgeFor(res: Response, runs: FamilyRuns, familyId: number): Promise<FamilyKnowledge> {
  const settings = settingsOf(res);
  const [year, practice] = await Promise.all([
    settings.doorsOn ? familyKnowledge(settings.year, familyId) : NOTHING_DONE,
    runs.practice ? familyKnowledge(0, familyId) : NOTHING_DONE,
  ]);
  const guesses = new Map(year.guesses);
  const typed = new Set(year.typed);
  const practiceGuess = practice.guesses.get(0);
  if (practiceGuess) guesses.set(0, practiceGuess);
  if (practice.typed.has(0)) typed.add(0);
  return { guesses, typed };
}

/** A family with no grand prize entries: what Detective HQ is given while its grand prize section does not show. */
const NO_ENTRIES: ReadonlyMap<number, { sentAt: Date }> = new Map();

/** Detective HQ's view for a family, all read through runsFor: what the family has done, each detective's
 *  doors done and, once today's door is found and its place shown, who found it (read for that one door
 *  only), and the family's grand prize entries, read only while the grand prize section shows (Plan 2c-2: one
 *  rule, prizeSectionShows, for reading them and for drawing the section). `known` is the doors, and
 *  `knowledge` what the family has done, when the caller has just read them. */
async function hqViewOf(res: Response, family: FamilyRow, now: Date, known?: FamilyRuns, knowledge?: FamilyKnowledge): Promise<HqView> {
  const settings = settingsOf(res);
  const runs = known ?? (await familyRuns(res, now));
  const todayRun = todayRunOf({ settings, now, runs });
  const findersOfToday = async (): Promise<Map<Door, DetectiveNameParts[]>> => {
    if (!todayRun || todayRun.door === 0 || doorState(todayRun.facts, now) !== "found") return new Map();
    return new Map([[todayRun.door, await finderParts(todayRun.year, todayRun.door)]]);
  };
  const prizeShows = prizeSectionShows({ doorsOn: settings.doorsOn, year: settings.year, closesAt: grandPrizeClosesAt(settings), now });
  const [done, doorsDone, finders, entries] = await Promise.all([
    knowledge ?? knowledgeFor(res, runs, family.id),
    familyDoorsDone(settings.year, family.id, runs.runs, now),
    findersOfToday(),
    prizeShows ? familyEntries(settings.year, family.id) : NO_ENTRIES,
  ]);
  // HQ draws no photos: the calendar's script reads the family's own from /api/elf/me.
  return hqViewFor({ family, settings, now, runs, guesses: done.guesses, typed: done.typed, doorsDone, finders, photos: [], entries });
}

export async function getHq(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const now = new Date();
  try {
    const family = await familyOr(req, res);
    if (!family) return;
    return await sendPage(req, res, renderHqPage(await hqViewOf(res, family, now)));
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
    const { runs } = await familyRuns(res, now);
    const [doorsDone, knowledge] = await Promise.all([
      detectiveDoorsDone(settings.year, detective.id, runs, now),
      // What the family has done, for the missed doors it can still crack from Detective HQ (ruling F7): read
      // only while December's doors are on, so with them off the wardrobe is exactly what it was.
      settings.doorsOn ? familyKnowledge(settings.year, family.id) : NOTHING_DONE,
    ]);
    return await sendPage(req, res, renderWardrobePage(wardrobeViewFor({ detective, settings, now, doorsDone, runs, knowledge })));
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
//                            { doors: [{ door, cracked, visited, snow }], photos: [{ door, token, status }] },
//                            and while December's doors are on, known: [door] (the doors whose place the
//                            family can see, in door order) and goes: [door] (the doors it may still
//                            crack, newest first)
//   GET /api/elf/me/door/:n  the family's own door, { tile, detail }, with its place and its photos: only
//                            while December's doors are on, for a door open on the calendar whose place
//                            the family can see (or any open door from Christmas Day until 1 January);
//                            404 otherwise, and 401 signed out
//   GET /api/elf/me/doors    every one of those doors in one answer, { doors: [{ door, tile, detail }] } in
//                            door order, which the calendar's script draws when the page loads: only while
//                            December's doors are on (404 otherwise), and 401 signed out
//
// The calendar is the same for every visitor, so it is built at most once every 15 seconds and shared
// (src/elf/public-calendar.ts), and cached briefly; nothing on it is private, and the practice door is
// never on it. Until Christmas Day it names no place and shows no photo. A family's own places and
// photos never pass through it: they come from the family's own door, drawn over the shared one for that
// family alone, and never kept by a browser or a shared cache.

const PUBLIC_SHORT_CACHE = "public, max-age=15";

/** Cache a public page briefly, but never a private preview of it (a shared cache would hand the
 *  hidden page to someone without the link). */
function publicCache(res: Response): void {
  res.setHeader("Cache-Control", res.locals.elfPreview ? "private, no-store" : PUBLIC_SHORT_CACHE);
}

/** How the public calendar is built: snow in what cannot run (only once December's doors are on), read
 *  the doors through runsFor without the practice door, then who found each found door (its place shown
 *  or not) and the counts and scrapbook of each open one. A door neither found nor open shows nothing
 *  more, so nothing more is read for it. A scrapbook's photos are read only while every place is shown
 *  to everyone, from Christmas Day until 1 January: a photo can show the inside of the place. */
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
      open ? doorScrapbook(run.year, door, now, placesPublic(run.year, now)) : null,
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

// The calendar is built once every 15 seconds and shared, so its view's time can be 15 seconds old. The
// page and the feed each tell the script the time of their own answer, which it sets its clock by.

export async function getCalendarPage(req: Request, res: Response): Promise<Response | void> {
  try {
    const view = await publicCalendar.get(new Date());
    publicCache(res);
    return await sendPage(req, res, renderCalendarPage(view, new Date()));
  } catch (err) {
    return gameFailed(res, "calendar", err, false);
  }
}

export async function getCalendarFeed(_req: Request, res: Response): Promise<Response | void> {
  try {
    const view = await publicCalendar.get(new Date());
    publicCache(res);
    return res.json({
      now: new Date().toISOString(),
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
    // This year's doors only: the practice door never counts towards anything. What the family has done
    // door by door is read only while December's doors are on: with them off this answer is wave 1's.
    const [doorsDone, knowledge] = await Promise.all([
      familyDoorsDone(settings.year, family.id, runs.runs, now),
      settings.doorsOn ? familyKnowledge(settings.year, family.id) : null,
    ]);
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
    if (!knowledge) return res.json({ doors, photos });
    // The doors whose place the family can see, which the calendar's script draws from the family's own
    // door (getMyDoor), and the doors it may still have a go at, newest first.
    const known = doorsKnown({ runs: runs.runs, knowledge, now });
    const goes = doorsToCrack({ runs: runs.runs, knowledge, now }).map((r) => r.door);
    return res.json({ doors, photos, known, goes });
  } catch (err) {
    return gameFailed(res, "marks", err, true);
  }
}

/** The one rule (src/elf/catch-up.ts) at one door: can the family see its place? Never while the door is
 *  not open, whatever the family has done there: a detective who typed the tag word while the place was
 *  still hidden sees it once the door opens, as everyone who can does. Only what the family has done at this
 *  door is read (familyKnowsDoor), never its whole year: every photo in an open scrapbook asks this. */
async function knowsDoorPlace(year: number, familyId: number, door: number, state: DoorState): Promise<boolean> {
  if (!isOpen(state)) return false;
  const { guessed, typed } = await familyKnowsDoor(year, door, familyId);
  return knowsPlace({ state, guessed, typed });
}

/** A family's own door (Plan 2c-1): the door the calendar everyone shares draws, with its place and its
 *  photos laid on, for a family that can see the place, or for anyone from Christmas Day until 1 January.
 *  The calendar's script draws a door in /api/elf/me's `known` from here when that one door changes; all of
 *  them at once, as the page loads, come from getMyDoors. A door that is not open on the shared calendar,
 *  or whose place the family cannot see, is not found, and nothing more is read for it. It is this
 *  family's alone, so no browser or shared cache ever keeps it. */
export async function getMyDoor(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "private, no-store");
  const settings = settingsOf(res);
  const now = new Date();
  try {
    const s = await signedInFamily(req);
    if (!s) return res.status(401).json({ error: "Not signed in" });
    // A real door, while December's doors are on: never the practice door, which is on no calendar.
    const n = doorNumberOf(req.params.n);
    if (!isDoor(n) || !settings.doorsOn) return notFound(res, true);
    // The door as the shared calendar draws it, so the family's door opens when everyone's does.
    const view = await publicCalendar.get(now);
    const shared = view.doors.find((d) => d.door === n);
    if (!shared || !isOpen(shared.state)) return notFound(res, true);
    if (!placesPublic(settings.year, now) && !(await knowsDoorPlace(settings.year, s.familyId, n, shared.state))) return notFound(res, true);
    // A place left empty, or cleared to spaces, is no place (doorPlaceOf), as everywhere else.
    const place = doorPlaceOf(await loadDoorRun(settings.year, n, now));
    if (!place) return notFound(res, true);
    return res.json(ownDoor(view, shared, place, await doorPhotos(settings.year, n)));
  } catch (err) {
    return gameFailed(res, "own door", err, true);
  }
}

/** The family's own door drawn as the shared calendar draws a door: the shared door, with the family's place
 *  and the door's photos laid on (familyDoorView), at the shared view's own time. */
function ownDoor(view: CalendarView, shared: DoorView, place: { name: string; town: string }, photos: readonly ScrapPhoto[]): { tile: string; detail: string } {
  const mine = familyDoorView(shared, { place, photos });
  const ctx = { now: view.now, joinUrl: view.joinUrl, hqUrl: view.hqUrl };
  return { tile: doorTile(mine, view.now), detail: doorDetail(mine, ctx) };
}

/** Every one of the family's own doors (getMyDoor) in one answer, in door order: each door open on the
 *  calendar everyone shares whose place the family can see (or every open door from Christmas Day until 1
 *  January), drawn as getMyDoor draws it. The calendar's script draws the doors in /api/elf/me's `known` from
 *  here when the page loads, so a family that knows many doors costs one request, with the door rows read once
 *  and every door's photos in one query (the rulings on Plan 2c-1, Task 8). Nothing more is read once nothing
 *  is left to draw. It is this family's alone, so no browser or shared cache ever keeps it. */
export async function getMyDoors(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "private, no-store");
  const settings = settingsOf(res);
  const now = new Date();
  try {
    const s = await signedInFamily(req);
    if (!s) return res.status(401).json({ error: "Not signed in" });
    // While December's doors are on: never for a browser that only plays the practice door.
    if (!settings.doorsOn) return notFound(res, true);
    // The doors as the shared calendar draws them, so each family's door opens when everyone's does.
    const view = await publicCalendar.get(now);
    const open = view.doors.filter((d) => isOpen(d.state));
    if (open.length === 0) return res.json({ doors: [] });
    const everyone = placesPublic(settings.year, now);
    const known = everyone ? null : await familyKnowledge(settings.year, s.familyId);
    const seen = known
      ? open.filter((d) => knowsPlace({ state: d.state, guessed: known.guesses.has(d.door), typed: known.typed.has(d.door) }))
      : open;
    if (seen.length === 0) return res.json({ doors: [] });
    // Each door's place from the one read of the year's doors; a place left empty, or cleared to spaces, is no
    // place (doorPlaceOf), so its door is left out.
    const runs = await loadDoorRuns(settings.year, now);
    const placed = seen.flatMap((d) => {
      const run = runs.find((r) => r.door === d.door);
      const place = run ? doorPlaceOf(run) : null;
      return place ? [{ shared: d, place }] : [];
    });
    if (placed.length === 0) return res.json({ doors: [] });
    const photos = await doorsPhotos(settings.year, placed.map((p) => p.shared.door));
    return res.json({ doors: placed.map((p) => ({ door: p.shared.door, ...ownDoor(view, p.shared, p.place, photos.get(p.shared.door) ?? []) })) });
  } catch (err) {
    return gameFailed(res, "own doors", err, true);
  }
}

elfRouter.get("/elf", schoolOn, getCalendarPage);

elfRouter.get("/elf/rules", schoolOn, async (req, res) => {
  try {
    publicCache(res);
    await sendPage(req, res, renderRulesPage({ settings: settingsOf(res) }));
  } catch (err) {
    gameFailed(res, "rules", err, false);
  }
});

elfRouter.get("/api/elf/calendar", schoolOn, getCalendarFeed);
elfRouter.get("/api/elf/door/:n", schoolOn, getDoorFeed);
elfRouter.get("/api/elf/me", schoolOn, getMe);
elfRouter.get("/api/elf/me/door/:n", schoolOn, doorsOn, getMyDoor);
elfRouter.get("/api/elf/me/doors", schoolOn, doorsOn, getMyDoors);

// --- the doors in December: the poster page, the word, the guess, the family's photo, the pictures ------
//
//   GET    /elf/p/:code                    the page a poster's QR code opens (private, never cached)
//   POST   /elf/p/:code/word               the word on the elf's tag from the plain form: the page drawn
//                                          again with the answer in it
//   POST   /api/elf/word                   the same from the page's script, JSON { code, detectiveIds, word }:
//                                          { outcome: "won" | "visited", html }, or { reason, message,
//                                          triesLeft? } with 400 (409 for too early and gone home)
//   POST   /api/elf/guess                  a typed guess, JSON { door, text } or the plain form:
//                                          { ok: true, text }, or 400 { reason, message, door? }; once
//                                          the place is shown, 409 { reason, message, goUrl }: "locked-in"
//                                          back to Detective HQ, or "have-a-go" to the door's go page (the
//                                          plain form goes there), and 409 { reason: "already", message }
//                                          when the family's go was kept in place of the night's save
//   POST   /api/elf/p/:code/photo          the family's photo for the door, JSON { mime, dataBase64,
//                                          consent: true } (the bigger body parser is in src/app.ts):
//                                          202 { status: "waiting", token }
//   DELETE /api/elf/p/:code/photo          the family takes its photo down, from the poster page
//   DELETE /api/elf/door/:n/photo          the same, from the door on the calendar
//   GET    /elf/door/:n/photo/:token.jpg   an approved photo, only while its door is open, and only to a
//                                          signed in family that can see its place (to anyone from
//                                          Christmas Day until 1 January); never cached
//   GET    /elf/door/:n/elf/:visitId.png   a visiting detective's elf, only once the visit counts
//   GET    /elf/hq/clue/:door/:n.jpg       a clue's picture, signed in, only once the clue is out
//
// Every one sits behind schoolOn and doorsOn. While December's doors are off the preview link opens
// the practice door (door 0 of year 0) and nothing else. A family must be signed in for everything but
// the poster page and a visiting detective's elf; a door's photo is open to everyone only from Christmas
// Day until 1 January, and otherwise only to a signed in family that can see the door's place. Every post
// must come from our own pages. Nothing here writes a place, a clue or a tag word into a log, an error or
// a cache.

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
    return await sendPage(req, res.status(200), renderPosterPage(await posterViewOf(run, family, now)));
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
/** Guesses each family may send in 15 minutes: every one is saved, so this is plenty for a family
 *  changing its mind, and far too few for a script to keep the database busy. */
export const GUESS_LIMIT = { max: 60, windowMs: 15 * 60_000 } as const;

const gameLimits = () => ({
  wordFamily: createRateLimiter(WORD_LIMIT),
  wordAddress: createRateLimiter(WORD_ADDRESS_LIMIT),
  photoFamily: createRateLimiter(PHOTO_TRIES),
  photoAddress: createRateLimiter(PHOTO_ADDRESS_TRIES),
  guessFamily: createRateLimiter(GUESS_LIMIT),
});
let limits = gameLimits();

/** For tests: fresh counts for the game's limits. */
export function resetElfLimits(): void {
  limits = gameLimits();
}

/** May this family, from this address, try once more? The family's own limit comes first, and an
 *  address's allowance (where there is one) is spent only on tries the family's limit lets through. A
 *  request made on the box itself (local development, the pr.yml BDD suite) is never limited, as
 *  everywhere in this file. */
function allowedOnce(
  req: Request,
  familyId: number,
  family: ReturnType<typeof createRateLimiter>,
  address?: ReturnType<typeof createRateLimiter>,
): boolean {
  if (isLoopbackRequest(req)) return true;
  const t = Date.now();
  return family.allow(String(familyId), t) && (!address || address.allow(req.ip ?? "unknown", t));
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

/** The proud moments after a word (src/elf/worker.ts): only once the word's answer has gone, and best
 *  effort, so nothing here ever fails the word, holds up its answer, or is left as a promise nobody handles.
 *  The moment is worked out in here too, so even a failure building it is only logged. */
async function proudAfterWord(moment: () => WordMoment): Promise<void> {
  try {
    await sendProudMoments(moment(), realElfDeps());
  } catch (err) {
    console.error("elf proud moments failed:", err instanceof Error ? err.message : err);
  }
}

/** The word on the elf's tag, which claims the elf and stamps a visit (src/elf/claim.ts). JSON for the
 *  page's script, or the poster page drawn again for the plain form. Every answer is awaited inside the
 *  try, so a failure while drawing one is a 500, never a promise that nothing handles. After a word that
 *  stamped someone, the proud moments go once the answer has (proudAfterWord). */
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
    if (limited) return await sendPage(req, res.status(429), renderPosterPage({ ...(await posterViewOf(run, family, now)), wordError: ELF_TOO_MANY }));
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
      if (!json) return sendPage(req, res.status(status), renderPosterPage(await posterViewOf(run, family, now), outcome));
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
    // A visit that counts only from later (its place still hidden) promises nothing that unlocks only
    // then, no promotion and no new things: the "It counts from" line says when it counts.
    const later = result.countsFrom.getTime() > now.getTime();
    // What the word gave, for the proud moments: each detective it stamped, with this door counted only
    // once the visit counts (the sweep sends a promotion that comes from later). With the family's switch for the
    // emails and its token (Plan 2c-2): one that has stopped the emails gets the won email alone.
    const moment = (): WordMoment => ({
      year,
      door,
      elfName: run.elfName,
      family: { id: family.id, grownUpName: family.grownUpName, email: family.email, emailsStopped: family.emailsStopped === true, emailsToken: family.emailsToken ?? null },
      won: result.won,
      stamped: result.stamped.flatMap((id) => {
        const d = family.detectives.find((x) => x.id === id);
        if (!d) return [];
        const was = before.get(id) ?? NO_DOORS;
        return [{ id, name: nameOf(d), doorsDone: later ? was : { ...was, visited: [...(was.visited ?? []), door] } }];
      }),
    });
    let winnerAt: Date | null = result.won ? now : null;
    if (won && !result.won) {
      // Another word was first, in the same moment. If it was this family's own (a double tap), this is
      // still the family's win.
      const fresh = door === 0 ? await loadPractice(now) : await loadDoorRun(year, door, now);
      if (fresh && fresh.foundFamilyId === family.id) winnerAt = fresh.facts.foundAt ?? now;
    }
    if (winnerAt) {
      const sent = await answer(200, goldCard(chosen, before, winnerAt));
      await proudAfterWord(moment);
      return sent;
    }

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
    const sent = await answer(200, { form: "word", ok: true, outcome: "visited", visit });
    await proudAfterWord(moment);
    return sent;
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
 *  whose place was typed, one whose place the family can see. */
export function wordsForGuessRefusal(reason: GuessRefusal, elf: string, door?: number): string {
  switch (reason) {
    case "not-hunting":
      return "There is nothing to guess at this door just now.";
    case "empty":
      return `Type where you think ${elf} is hiding.`;
    case "too-long":
      return "That is a bit long. Up to 80 letters is plenty.";
    case "place-already-open":
      return `That elf was already found behind door ${door ?? ""}. Try again!`;
    case "locked-in":
      return "Your guess is locked in, and the hiding place is shown now.";
    case "have-a-go":
      return "The hiding place is shown now, so this is your one go at this door.";
  }
}

/** A typed guess: where the family thinks the elf is hiding (src/elf/guess.ts). Once the place is shown a
 *  guess is never saved as the family's go: a family with its guess is sent back to Detective HQ to see how
 *  it did, and one that may still crack the case is sent to have its one go on the door's page. */
export async function postGuess(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const json = wantsJson(req);
  if (!ourOwnPage(req)) return res.status(403).json({ error: ELF_NOT_OURS });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const now = new Date();
  try {
    const s = await signedInFamily(req);
    if (!s) return json ? res.status(401).json({ error: "Please sign in again." }) : res.redirect(303, "/elf/sign-in");
    const limited = !allowedOnce(req, s.familyId, limits.guessFamily);
    if (limited && json) return res.status(429).json({ reason: "too-many-requests", message: ELF_TOO_MANY });
    // The door as it is at this moment, never the calendar's copy: a guess is only taken while it can be.
    const runs = await familyRuns(res, now);
    const run = gameRun(res, runs, doorNumberOf(body.door));
    if (!run) return notFound(res, json);
    // The plain form has no script to show the words: Detective HQ is drawn again with them in the guess
    // form's status line (or in the case, once there is no form to say it in).
    const hqSaying = async (status: number, message: string, knowledge?: FamilyKnowledge): Promise<Response | void> => {
      const family = await familyWithDetectives(s.familyId);
      if (!family) return res.redirect(303, "/elf/sign-in");
      const view = await hqViewOf(res, family, now, runs, knowledge);
      const today = view.today && view.today.door === run.door ? { ...view.today, guessError: message } : view.today;
      return sendPage(req, res.status(status), renderHqPage({ ...view, today }));
    };
    if (limited) return await hqSaying(429, ELF_TOO_MANY);
    const state = doorState(run.facts, now);
    // What the family has done: whether it has a guess at this door or may have its go, and the open doors
    // whose place it can see, the only places a refusal may name (Review Focus 3). Any other door's place is
    // an ordinary guess, so a refusal never gives a place away.
    const knowledge = await knowledgeFor(res, runs, s.familyId);
    const guessed = knowledge.guesses.has(run.door);
    const typed = knowledge.typed.has(run.door);
    const known = new Set<number>(doorsKnown({ runs: runs.runs, knowledge, now }));
    const openPlaces = runs.runs.flatMap((r) => (isDoor(r.door) && known.has(r.door) ? [{ door: r.door, names: r.names }] : []));
    const decision = decideGuess(
      { doorState: state, openPlaces, hasGuess: guessed, mayHaveAGo: mayHaveAGo({ year: run.year, state, guessed, typed, now }) },
      body.text,
    );
    if (!decision.ok) {
      // A door's elf is named only once the door can be guessed: until then its name stays a surprise.
      const message = wordsForGuessRefusal(decision.reason, canGuess(state) ? run.elfName : "the elf", decision.door);
      // The place is shown: back to Detective HQ with its guess, or to the door's page for its one go.
      const goUrl = decision.reason === "locked-in" ? "/elf/hq" : decision.reason === "have-a-go" ? `/elf/hq/door/${run.door}` : null;
      if (goUrl) return json ? res.status(409).json({ reason: decision.reason, message, goUrl }) : res.redirect(303, goUrl);
      if (json) return res.status(400).json({ reason: decision.reason, message, ...(decision.door === undefined ? {} : { door: decision.door }) });
      return await hqSaying(400, message, knowledge);
    }
    // The night's save never replaces the family's go (saveGuess): then nothing was saved, and it is told so.
    if (!(await saveGuess(run.year, run.door, s.familyId, { text: decision.text, norm: decision.norm }, now))) {
      const message = wordsForGoRefusal("already", run.elfName);
      return json ? res.status(409).json({ reason: "already", message }) : await hqSaying(409, message, knowledge);
    }
    return json ? res.status(200).json({ ok: true, text: decision.text }) : res.redirect(303, "/elf/hq");
  } catch (err) {
    return gameFailed(res, "guess", err, json);
  }
}

// --- having a go: a missed door's own page in Detective HQ (Plan 2c-1) --------------------------------
//
//   GET  /elf/hq/door/:n      the go page: the door's clues one at a time (?clues=2, ?clues=3), then one
//                             guess; once the family can see the place, how it went
//   POST /elf/hq/door/:n/go   the one guess, JSON { text } or the plain form (text, and how many clues
//                             were showing): JSON answers 200 { cracked, message }, or { reason, message }
//                             with 400 (empty, too long), 409 (closed, already, been there) or 404 (not
//                             open); the plain form goes back to the door's page, which shows how it went,
//                             or draws it again with the words in its form's status line
//
// Both sit behind schoolOn and doorsOn, so while December's doors are off only the practice door has a go
// page, through the preview link. Each is the family's own, so no browser or shared cache keeps either.

/** How many clues the go page shows, from its address or its form: 2 or 3, and 1 for anything else. */
function cluesAsked(raw: unknown): number {
  return raw === "2" ? 2 : raw === "3" ? 3 : 1;
}

/** The door's place, when there is a go to be had at the door at `now`: it is open, and has a place. A
 *  door shut, hunted, found with its place still hidden or snowed in has nothing to crack yet, and nor has
 *  an open door with no place (a door never runs without one). */
function goPlaceOf(run: DoorRun, now: Date): { name: string; town: string } | null {
  return isOpen(doorState(run.facts, now)) ? doorPlaceOf(run) : null;
}

/** The go page's view for a family: what it has done at the door (read here, unless the caller has just
 *  read it) and, once the elf is found, who found it, read for that one door (never the practice door's,
 *  which names no finder). */
async function goViewOf(o: { run: DoorRun; familyId: number; now: Date; cluesShown: number; guessError?: string | null; known?: FamilyKnowledge }): Promise<GoView> {
  const { run, now } = o;
  const named = run.door !== 0 && doorState(run.facts, now) === "found";
  const [known, finders] = await Promise.all([o.known ?? familyKnowledge(run.year, o.familyId), named ? finderParts(run.year, run.door) : []]);
  return goViewFor({ run, now, guess: known.guesses.get(run.door) ?? null, typed: known.typed.has(run.door), finders, cluesShown: o.cluesShown, guessError: o.guessError });
}

export async function getGo(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "private, no-store");
  const now = new Date();
  try {
    const family = await familyOr(req, res);
    if (!family) return;
    // The door as it is at this moment, read through runsFor as every family route reads it.
    const run = gameRun(res, await familyRuns(res, now), doorNumberOf(req.params.n));
    if (!run) return notFound(res);
    if (!goPlaceOf(run, now)) return res.redirect(303, "/elf/hq");
    return await sendPage(req, res, renderGoPage(await goViewOf({ run, familyId: family.id, now, cluesShown: cluesAsked(req.query.clues) })));
  } catch (err) {
    return gameFailed(res, "go page", err, false);
  }
}

/** What to tell a family whose go was refused. Only "empty" names the door's elf, and decideGo reaches it
 *  only at an open door: a door's elf is never named before its door opens. */
export function wordsForGoRefusal(reason: GoRefusal, elf: string): string {
  switch (reason) {
    case "not-open":
      return "There is nothing to guess at this door just now.";
    case "closed":
      return "Having a go closed on Christmas Day.";
    case "already":
      return "You have already had your go at this door.";
    case "been-there":
      return "Your family has been to this hiding place, so there is nothing to guess.";
    case "empty":
      return `Type where you think ${elf} is hiding.`;
    case "too-long":
      return "That is a bit long. Up to 80 letters is plenty.";
  }
}

/** Each refusal's status: what was typed, 400; a go the family cannot have, 409; nothing to crack, 404. */
const GO_REFUSAL_STATUS: Record<GoRefusal, number> = { empty: 400, "too-long": 400, closed: 409, already: 409, "been-there": 409, "not-open": 404 };

/** A family's one go at a door it missed (src/elf/catch-up.ts): decideGo at this moment, then one insert
 *  that never overwrites anything (saveLateGuess), so two tabs or two phones locking in at once save one go
 *  between them, and a guess from the night is never replaced. A go counts against the family's guesses. */
export async function postGo(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "private, no-store");
  const json = wantsJson(req);
  if (!ourOwnPage(req)) return res.status(403).json({ error: ELF_NOT_OURS });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const now = new Date();
  try {
    const s = await signedInFamily(req);
    if (!s) return json ? res.status(401).json({ error: "Please sign in again." }) : res.redirect(303, "/elf/sign-in");
    const limited = !allowedOnce(req, s.familyId, limits.guessFamily);
    if (limited && json) return res.status(429).json({ reason: "too-many-requests", message: ELF_TOO_MANY });
    // The door as it is at this moment, never the calendar's copy.
    const run = gameRun(res, await familyRuns(res, now), doorNumberOf(req.params.n));
    if (!run) return notFound(res, json);
    const doorPage = `/elf/hq/door/${run.door}`;
    const place = goPlaceOf(run, now);
    // The plain form has no script to show the words: the go page is drawn again with them in its form's
    // status line, with as many clues showing as the family had open.
    const pageSaying = async (status: number, message: string | null, known?: FamilyKnowledge): Promise<Response> =>
      sendPage(req, res.status(status), renderGoPage(await goViewOf({ run, familyId: s.familyId, now, cluesShown: cluesAsked(body.clues), guessError: message, known })));
    const refuse = async (reason: GoRefusal, known?: FamilyKnowledge): Promise<Response | void> => {
      const message = wordsForGoRefusal(reason, run.elfName);
      if (json) return res.status(GO_REFUSAL_STATUS[reason]).json({ reason, message });
      if (reason === "not-open") return res.redirect(303, "/elf/hq");
      if (reason === "already" || reason === "been-there") return res.redirect(303, doorPage);
      // Closed, the page says so itself, in place of the form.
      return await pageSaying(GO_REFUSAL_STATUS[reason], reason === "closed" ? null : message, known);
    };
    if (limited) return place ? await pageSaying(429, ELF_TOO_MANY) : res.redirect(303, "/elf/hq");
    if (!place) return await refuse("not-open");
    const known = await familyKnowledge(run.year, s.familyId);
    const typed = known.typed.has(run.door);
    const decision = decideGo({ year: run.year, state: doorState(run.facts, now), guessed: known.guesses.has(run.door), typed, now }, body.text);
    if (!decision.ok) return await refuse(decision.reason, known);
    const go = { text: decision.text, norm: decision.norm };
    if ((await saveLateGuess(run.year, run.door, s.familyId, go, now)) === "already") return await refuse("already", known);
    if (!json) return res.redirect(303, doorPage);
    // Said straight away: whether it cracked the case, and where the elf was, which the family may see now.
    const outcome = goOutcomeOf({ run, now, place, guess: { ...go, at: now, late: true }, typed });
    return res.status(200).json({
      cracked: outcome.verdict === "cracked",
      message: goOutcomeWords({ elfName: run.elfName, verdict: outcome.verdict, place: outcome.place, stillHiding: outcome.stillHiding }),
    });
  } catch (err) {
    return gameFailed(res, "go", err, json);
  }
}

export const ELF_PHOTO_POST_PATH = "/api/elf/p/:code/photo";
/** Where a graduate's grand prize picture is sent (Plan 2c-2): postEntry, below. */
export const ELF_ENTRY_POST_PATH = "/api/elf/entry/:detective";

/** The bigger body parser of the photo post and of the grand prize entry's post (src/app.ts), behind its
 *  guard: only a POST is read with it, and only when it carries a session cookie the shape of one of ours.
 *  Anything else on either address (the photo take down's DELETE) goes on to the usual small parser. Whether
 *  the session is real is checked by the route, after the body is read. */
export function elfPhotoBodyGuard(parser: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (req.method !== "POST") return next();
    if (!sessionIdOf(req)) {
      res.status(401).json({ error: "Please sign in again." });
      return;
    }
    parser(req, res, next);
  };
}

const NOT_VISITED = { error: "Type the word on the elf's tag first." };
const GONE_HOME_PHOTO = { error: "This elf has gone home, so its door is not taking photos now." };
const NO_CONSENT = { error: "Tick the box to say we can show this photo." };
const PHOTO_LIMIT = { error: "You have sent 5 photos today. Please try again tomorrow." };
// The answers for a picture that cannot be used, one set shared with the fundraisers (src/fundraising/pictures.ts).
const LOOK_AGAIN = PICTURE_LOOK_AGAIN;
const PHOTO_TYPE = PICTURE_TYPE_WORDS;
const PHOTO_SIZE = PICTURE_SIZE_WORDS;
const PHOTO_READ = PICTURE_READ_WORDS;
const PHOTO_BUSY = { error: PICTURE_BUSY_WORDS };
const PHOTO_TOO_MANY_TRIES = { error: "You have tried to send a lot of photos today. Please try again tomorrow." };

/** A picture sent as JSON { mime, dataBase64 }, checked and made again as the fundraisers' pictures are: a JPEG,
 *  PNG or WebP whose bytes really are that, made again here so nothing from the camera is kept (not where, not
 *  when, not the phone) and what is stored is always a fresh JPEG. A door's photo and a graduate's grand prize
 *  picture both take it. The made picture, or null once the refusal has been answered, with the photo route's
 *  statuses and words. */
async function madePicture(res: Response, body: Record<string, unknown>): Promise<MadePicture | null> {
  const bytes = decodeBase64(typeof body.dataBase64 === "string" ? body.dataBase64 : "");
  const check = checkPictureUpload(typeof body.mime === "string" ? body.mime : "", bytes);
  if (!check.ok) {
    const size = check.reason === "size";
    res.status(size ? 413 : 400).json({ error: LOOK_AGAIN, fields: { photo: size ? PHOTO_SIZE : PHOTO_TYPE } });
    return null;
  }
  const made = await processPicture("main", bytes);
  if (made.ok) return { mime: made.mime, bytes: made.bytes, width: made.width, height: made.height };
  if (made.reason === "busy") res.status(503).json(PHOTO_BUSY);
  else if (made.reason === "size") res.status(413).json({ error: LOOK_AGAIN, fields: { photo: PHOTO_SIZE } });
  else res.status(400).json({ error: LOOK_AGAIN, fields: { photo: PHOTO_READ } });
  return null;
}

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
    // The place has sent its elf home: the door's pictures stay, but it takes no more.
    if (run.facts.goneHome) return res.status(409).json(GONE_HOME_PHOTO);
    const visits = await familyVisits(run.year, s.familyId);
    if (!visits.some((v) => v.door === run.door)) return res.status(403).json(NOT_VISITED);
    if (body.consent !== true) return res.status(400).json(NO_CONSENT);
    if (!allowedOnce(req, s.familyId, limits.photoFamily, limits.photoAddress)) return res.status(429).json(PHOTO_TOO_MANY_TRIES);
    // Made again here, so nothing from the camera is kept: not where, not when, not the phone.
    const picture = await madePicture(res, body);
    if (!picture) return;
    const sent = await sendElfPhoto({ year: run.year, door: run.door, familyId: s.familyId, picture, at: now });
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
  // Only ever for whoever asked, and never kept by a browser or a shared cache: not a photo, which can
  // show the inside of the place and can be taken down at any moment, and not a "not yet" from before.
  res.setHeader("Cache-Control", "private, no-store");
  const n = doorNumberOf(req.params.n);
  const token = String(req.params.token);
  if (!CODE_SHAPE.test(token) || !gameDoor(res, n)) return notFound(res);
  const now = new Date();
  try {
    const run = await oneGameRun(res, n, now);
    if (!run) return notFound(res);
    const state = doorState(run.facts, now);
    // Only while its door is open: a photo sent while the place was still hidden never gives it away.
    if (!isOpen(state)) return notFound(res);
    // And only to someone who may see the place: anyone from Christmas Day until 1 January (never at the
    // practice door), otherwise a signed in family that can see it (the one rule).
    if (!placesPublic(run.year, now)) {
      const s = await signedInFamily(req);
      if (!s || !(await knowsDoorPlace(run.year, s.familyId, run.door, state))) return notFound(res);
    }
    const photo = await approvedPhoto(run.year, run.door, token);
    if (!photo) return notFound(res);
    return sendPicture(res, photo, "private, no-store");
  } catch (err) {
    return gameFailed(res, "door photo", err, false);
  }
}

/** Every door done: everything in the wardrobe unlocked. A visit's look was made safe against its
 *  detective's doors when it was stored (postWord), so drawn against this it is drawn exactly as
 *  stored, and no doors need reading to draw it. */
const EVERYTHING_UNLOCKED: WardrobeState = { doors: Array.from({ length: DOOR_COUNT }, (_, i) => i + 1) };

/** How many door elves are kept drawn, the most recently asked for: about 100 KB each at 240 pixels,
 *  so a few tens of megabytes at most. A visit's look never changes, so neither does its picture. */
export const DOOR_ELVES_KEPT = 200;
let doorElves = new Map<string, { etag: string; png: Buffer }>();

/** For tests: no door elves kept from before. */
export function resetDoorElves(): void {
  doorElves = new Map();
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
    // The one read, on every request: the visit, when it counts from, and that its family is still in.
    const visit = await visitElf(where.year, where.door, visitId);
    // An elf goes on its door only once its visit counts (for most visits, once the place is shown).
    if (!visit || !(visit.countsFrom.getTime() <= now.getTime())) return notFound(res);
    const key = `${where.year}:${where.door}:${visitId}`;
    let drawn = doorElves.get(key);
    if (drawn) {
      // Kept most recently asked for last, so the one asked for longest ago is the one let go.
      doorElves.delete(key);
      doorElves.set(key, drawn);
    }
    const etag = drawn ? drawn.etag : `"${elfPngKey(visit.look, EVERYTHING_UNLOCKED, 240)}"`;
    const cache = pictureCache(res, where.door, "public, max-age=3600");
    if (String(req.headers["if-none-match"] ?? "") === etag) {
      res.setHeader("Cache-Control", cache);
      res.setHeader("ETag", etag);
      return res.status(304).send();
    }
    if (!drawn) {
      const picture = await elfPng(visit.look, EVERYTHING_UNLOCKED, 240);
      if (!picture) {
        res.setHeader("Retry-After", "2");
        return res.status(503).type("text/plain").send("Busy. Please try again in a moment.");
      }
      drawn = { etag, png: picture };
      doorElves.set(key, drawn);
      if (doorElves.size > DOOR_ELVES_KEPT) doorElves.delete(doorElves.keys().next().value as string);
    }
    res.setHeader("ETag", drawn.etag);
    return sendPicture(res, { mime: "image/png", bytes: drawn.png }, cache);
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

// --- the grand prize: a graduate's picture, sent from Detective HQ (Plan 2c-2) -----------------------------
//
//   GET  /elf/hq/entry/:detective              the entry page: one of the signed in family's own detectives,
//                                              who has done all 24 doors, from midnight as Christmas Eve
//                                              begins (404 otherwise), open until the entries close and
//                                              saying they have closed after
//   POST /api/elf/entry/:detective             the picture, JSON { mime, dataBase64, mobile? } from the page's
//                                              script (the bigger body parser is in src/app.ts): 201 { ok,
//                                              message } for a new entry, 200 for one that replaces the
//                                              picture before; 403 for a detective with doors still to do,
//                                              409 once the entries have closed, 400 for a family with no
//                                              mobile that sends none, 429 after the photo's daily tries, and
//                                              the photo post's answers for a picture it cannot use
//   GET  /elf/hq/entry/:detective/picture.jpg  the family's own picture for its own detective, private
//
// All three sit behind schoolOn and doorsOn, and each answers 404 while December's doors are off even to a
// browser holding the preview link: the grand prize is never the practice door's. Each is the family's own,
// so no browser or shared cache keeps any of them, and an entry's picture goes to its own family only.

/** The signed in family's own detective named in an address, the doors it has done and whether it has graduated:
 *  all 24 doors done, worked out here from the doors every family route reads (familyRuns), never taken from the
 *  page. Null when the detective is not one of the family's own. The entry page and its post use it, and so do a
 *  graduate's certificate and share card (ruling F9). */
async function ownDetective(
  res: Response,
  family: FamilyRow,
  raw: unknown,
  now: Date,
): Promise<{ detective: DetectiveRow; doors: DoorsDone; graduate: boolean } | null> {
  const id = detectiveIdOf(raw);
  const detective = family.detectives.find((d) => d.id === id);
  if (!detective) return null;
  const doors = (await familyDoorsDone(settingsOf(res).year, family.id, (await familyRuns(res, now)).runs, now)).get(detective.id) ?? NO_DOORS;
  return { detective, doors, graduate: progressOf(doors).graduate };
}

/** A detective's name as its own family sees it, in full: "Detective Ruby Tinselfoot". */
const familyNameOf = (d: DetectiveRow): string => familyDetectiveName({ firstName: d.firstName, surname: d.surname, approved: true });

const ENTRY_TOO_MANY_TRIES = { error: "You have tried to send a lot of pictures today. Please try again tomorrow." };

/** The words once the entries have closed, with their closing time on the clock in London. */
const entriesClosedWords = (closesAt: Date): string => `Grand prize entries closed at ${clockWords(closesAt)} on Christmas Eve.`;

export async function getEntry(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "private, no-store");
  const settings = settingsOf(res);
  const now = new Date();
  try {
    // Only while December's doors are on, whatever the preview link says, and from midnight as Christmas Eve begins.
    if (!settings.doorsOn) return notFound(res);
    const family = await familyOr(req, res);
    if (!family) return;
    if (now.getTime() < entriesOpenAt(settings.year).getTime()) return notFound(res);
    const own = await ownDetective(res, family, req.params.detective, now);
    if (!own || !own.graduate) return notFound(res);
    const [hasMobile, entries] = await Promise.all([familyHasMobile(family.id), familyEntries(settings.year, family.id)]);
    const sentAt = entries.get(own.detective.id)?.sentAt ?? null;
    return await sendPage(req, res, renderEntryPage(entryViewFor({ detective: own.detective, hasMobile, closesAt: grandPrizeClosesAt(settings), now, sentAt })));
  } catch (err) {
    return gameFailed(res, "grand prize entry page", err, false);
  }
}

/** A graduate's picture for the grand prize (planner's calls 4 and 5): one a detective, replaced in place until
 *  the entries close (saveEntry), sent with the picture script as a door's photo is, sharing the photo's daily
 *  tries, and made again exactly as a door's photo is (madePicture). A mobile typed with it goes on a family
 *  that has none. */
export async function postEntry(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "private, no-store");
  if (!ourOwnPage(req)) return res.status(403).json({ error: ELF_NOT_OURS });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const settings = settingsOf(res);
  const now = new Date();
  try {
    const s = await signedInFamily(req);
    if (!s) return res.status(401).json({ error: "Please sign in again." });
    // Only while December's doors are on, whatever the preview link says.
    if (!settings.doorsOn) return notFound(res, true);
    const family = await familyWithDetectives(s.familyId);
    if (!family) return res.status(401).json({ error: "Please sign in again." });
    const own = await ownDetective(res, family, req.params.detective, now);
    if (!own) return notFound(res, true);
    const name = familyNameOf(own.detective);
    if (!own.graduate) return res.status(403).json({ error: `${name} has not done all 24 doors yet.` });
    const closesAt = grandPrizeClosesAt(settings);
    if (now.getTime() < entriesOpenAt(settings.year).getTime()) return notFound(res, true);
    // The one rule for the window (entryOpen), which fails closed: a closing that is not a real time refuses.
    if (!entryOpen({ graduate: own.graduate, year: settings.year, closesAt, now })) return res.status(409).json({ error: entriesClosedWords(closesAt) });
    // A family with no mobile gives one, with the join form's words and check; one sent by a family that has a
    // mobile already is ignored, so the store is given none.
    const askMobile = !(await familyHasMobile(family.id));
    const mobile = askMobile ? normaliseUkMobile(body.mobile) : null;
    if (askMobile && mobile === null) return res.status(400).json({ error: MOBILE_WORDS, fields: { mobile: MOBILE_WORDS } });
    if (!allowedOnce(req, family.id, limits.photoFamily, limits.photoAddress)) return res.status(429).json(ENTRY_TOO_MANY_TRIES);
    // Made again here, so nothing from the camera is kept: not where, not when, not the phone.
    const picture = await madePicture(res, body);
    if (!picture) return;
    const saved = await saveEntry({ year: settings.year, detectiveId: own.detective.id, familyId: family.id, picture, mobile, at: now });
    const message = `Thank you! ${name}'s picture is in. You can change it until ${clockWords(closesAt)} on Christmas Eve.`;
    return res.status(saved.replaced ? 200 : 201).json({ ok: true, message });
  } catch (err) {
    return gameFailed(res, "grand prize entry", err, true);
  }
}

export async function getEntryPicture(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "private, no-store");
  const settings = settingsOf(res);
  try {
    if (!settings.doorsOn) return notFound(res);
    const s = await signedInFamily(req);
    const family = s ? await familyWithDetectives(s.familyId) : null;
    const id = detectiveIdOf(req.params.detective);
    const detective = family ? family.detectives.find((d) => d.id === id) : undefined;
    if (!family || !detective) return notFound(res);
    // The store matches the detective and the family both, so a picture only ever goes to its own family.
    const picture = await entryPicture(settings.year, detective.id, family.id);
    if (!picture) return notFound(res);
    return sendPicture(res, picture, "private, no-store");
  } catch (err) {
    return gameFailed(res, "grand prize picture", err, false);
  }
}

// --- a graduate's certificate, share card and the graduates' video (Plan 2c-2) -----------------------------------
//
//   GET /elf/hq/certificate/:detective  the certificate, a sheet to print (src/fundraising/materials.ts' print shell,
//                                       as Elf Detective School's other prints are), not a page of the site
//   GET /elf/hq/share/:detective.png    the share card, a PNG drawn here from its SVG
//   GET /elf/hq/video                   303 to the graduates' video that a head elf saved in Head Elf HQ > Settings
//
// The first two are for one of the signed in family's own detectives who has done all 24 doors (ownDetective), and
// not found otherwise; the video is for a signed in family with a graduate, and not found otherwise. All three sit
// behind schoolOn and doorsOn, and each answers 404 while December's doors are off even to a browser holding the
// preview link. Each is the family's own, so no browser or shared cache keeps any of them. The certificate names the
// detective in full, as their own family sees them; the share card is made to be shared, so it names them as the
// public sees them (ruling F11): a first name staff have not ticked shows as its first letter.

/** The elf on its stage for a print, as a PNG data address: a print or a picture made on the server cannot fetch
 *  the elf's address. */
const pngData = (png: Buffer): string => `data:image/png;base64,${png.toString("base64")}`;

/** Too many pictures are being made just now: ask again in a moment, as the elves' pictures say. */
function picturesBusy(res: Response): Response {
  res.setHeader("Retry-After", "2");
  return res.status(503).type("text/plain").send("Busy. Please try again in a moment.");
}

/** The share card as a PNG, drawn by sharp from its SVG (the October plan's Stage B), or null when too many pictures
 *  are already waiting. It takes its turn with the elves' pictures (inTurn, src/elf/elf-png.ts), so the one small
 *  task never makes two at once. sharp is loaded the first time, never as the app starts, and by then elfPng has made
 *  the card's elf, which set sharp up its way (no cache, one thread). The image needs fonts for the card's words: the
 *  Dockerfile's fontconfig and fonts-dejavu-core, which pr.yml's image check proves are there. */
function shareCardPng(svg: string): Promise<Buffer | null> {
  return inTurn<Buffer | null>(async () => {
    const m = await import("sharp");
    const sharp = ((m as unknown as { default?: typeof m.default }).default ?? m) as typeof m.default;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }, null);
}

export async function getCertificate(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "private, no-store");
  const settings = settingsOf(res);
  const now = new Date();
  try {
    // Only while December's doors are on, whatever the preview link says.
    if (!settings.doorsOn) return notFound(res);
    const family = await familyOr(req, res);
    if (!family) return;
    const own = await ownDetective(res, family, req.params.detective, now);
    if (!own || !own.graduate) return notFound(res);
    const { detective, doors } = own;
    const progress = progressOf(doors);
    // Drawn in the wardrobe the detective has earned, worked out here, never taken from the browser.
    const elf = await elfPng(detective.look, wardrobeState(doors), 340);
    if (!elf) return picturesBusy(res);
    const page = renderElfCertificate({
      name: familyNameOf(detective),
      badgeNumber: detective.badgeNumber === null ? "" : badgeWords(detective.badgeNumber),
      year: settings.year,
      doorsDone: progress.doorsDone,
      goldSeal: progress.goldSeal,
      elfPicture: pngData(elf),
      // Dated the day it is printed (planner's call 10): a detective can only graduate from Christmas Eve.
      awardedOn: now,
    });
    // A sheet to print, sent as it is: it is not a page of the site, so it wears no banner.
    return res.type("html").send(page);
  } catch (err) {
    return gameFailed(res, "certificate", err, false);
  }
}

export async function getShareCard(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "private, no-store");
  const settings = settingsOf(res);
  const file = /^(\d{1,10})\.png$/.exec(String(req.params.file));
  const now = new Date();
  try {
    // Only while December's doors are on, whatever the preview link says.
    if (!settings.doorsOn || !file) return notFound(res);
    const s = await signedInFamily(req);
    const family = s ? await familyWithDetectives(s.familyId) : null;
    if (!family) return notFound(res);
    const own = await ownDetective(res, family, file[1], now);
    if (!own || !own.graduate) return notFound(res);
    const { detective, doors } = own;
    const progress = progressOf(doors);
    const elf = await elfPng(detective.look, wardrobeState(doors), 340);
    if (!elf) return picturesBusy(res);
    // The name in its parts, with staff's tick, never familyDetectiveName's: the card works out the public form itself.
    const svg = shareCardSvg(
      { detective: { firstName: detective.firstName, surname: detective.surname, approved: detective.nameApproved }, rank: progress.rank, doorsDone: progress.doorsDone, year: settings.year },
      pngData(elf),
    );
    const card = await shareCardPng(svg);
    if (!card) return picturesBusy(res);
    res.setHeader("Content-Disposition", 'inline; filename="elf-detective-school-graduate.png"');
    return sendPicture(res, { mime: "image/png", bytes: card }, "private, no-store");
  } catch (err) {
    return gameFailed(res, "share card", err, false);
  }
}

/** The graduates' video (ruling F10): Detective HQ links only to this site, so its link is this address, which sends a
 *  signed in family with a graduate on to the https link a head elf saved (graduateVideoOf), telling the video's site
 *  nothing of where the family came from. */
export async function getGraduateVideo(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const settings = settingsOf(res);
  const now = new Date();
  try {
    const link = graduateVideoOf(settings);
    // Only while December's doors are on, whatever the preview link says, and only with a link set.
    if (!settings.doorsOn || !link) return notFound(res);
    const s = await signedInFamily(req);
    const family = s ? await familyWithDetectives(s.familyId) : null;
    if (!family) return notFound(res);
    const doorsDone = await familyDoorsDone(settings.year, family.id, (await familyRuns(res, now)).runs, now);
    if (!family.detectives.some((d) => progressOf(doorsDone.get(d.id) ?? NO_DOORS).graduate)) return notFound(res);
    return res.redirect(303, link);
  } catch (err) {
    return gameFailed(res, "graduates' video", err, false);
  }
}

// --- the emails a family can stop (Plan 2c-2, Task 7) ------------------------------------------------------------
//
//   GET  /elf/emails/:token  the page the small link at the foot of a clue email, a promotion or a graduation opens:
//                            the family's switch for the emails that are not essential, as a button, since following a
//                            link never changes anything; 404 for a token that is no family's
//   POST /elf/emails/:token  the page's button, the plain form's stopped=yes or stopped=no, from our own page only
//                            (403): the page again, saying what it did; 404 for a token that is no family's, and 400,
//                            changing nothing, for any other choice
//   POST /api/elf/emails     Detective HQ's switch, for the signed in family: JSON { stopped } or the plain form's
//                            stopped=yes or stopped=no, from our own page only (403); JSON { ok, stopped }, or 303
//                            back to Detective HQ
//
// The link's page and its button answer while Elf Detective School is on, whatever December's doors say, so a family
// can always stop the emails it has had. Detective HQ's switch answers only while December's doors are on, whatever
// the preview link says (ruling F16). Every answer is the family's own, so no browser or shared cache keeps any of
// them, and the link's page is never listed. The token in the link is the family's own (elf_families.emails_token),
// and its page shows nothing of the family, so a forwarded email gives nothing away. The won email, sign in codes and
// the welcome, which is the family's receipt, always go.

/** The plain form's choice: stopped=yes stops the emails, stopped=no starts them again; anything else is none. */
const stoppedFromForm = (raw: unknown): boolean | null => (raw === "yes" ? true : raw === "no" ? false : null);

/** The link's own address, where its page's button posts. */
const emailsPagePath = (token: string): string => `/elf/emails/${token}`;

/** Never kept by a browser or a shared cache, and never listed: set before anything else, so every answer has it. */
function emailsPageHeaders(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

export async function getEmailsPage(req: Request, res: Response): Promise<Response | void> {
  emailsPageHeaders(res);
  try {
    const token = String(req.params.token);
    const family = await familyByEmailsToken(token);
    if (!family) return notFound(res);
    return await sendPage(req, res, renderEmailsPage({ stopped: family.stopped, said: null, postUrl: emailsPagePath(token) }));
  } catch (err) {
    return gameFailed(res, "emails page", err, false);
  }
}

export async function postEmailsPage(req: Request, res: Response): Promise<Response | void> {
  emailsPageHeaders(res);
  if (!ourOwnPage(req)) return res.status(403).type("text/plain").send(ELF_NOT_OURS);
  try {
    const token = String(req.params.token);
    const family = await familyByEmailsToken(token);
    if (!family) return notFound(res);
    const postUrl = emailsPagePath(token);
    const stopped = stoppedFromForm((req.body ?? {}).stopped);
    // Not a choice the page's button sends: nothing changes, and the page is drawn as it stands.
    if (stopped === null) return await sendPage(req, res.status(400), renderEmailsPage({ stopped: family.stopped, said: null, postUrl }));
    await setEmailsStopped(family.id, stopped);
    return await sendPage(req, res, renderEmailsPage({ stopped, said: stopped ? "stopped" : "started", postUrl }));
  } catch (err) {
    return gameFailed(res, "emails", err, false);
  }
}

export async function postEmails(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "private, no-store");
  const json = wantsJson(req);
  if (!ourOwnPage(req)) return res.status(403).json({ error: ELF_NOT_OURS });
  try {
    // Only while December's doors are on, whatever the preview link says (ruling F16).
    if (!settingsOf(res).doorsOn) return notFound(res, json);
    const s = await signedInFamily(req);
    if (!s) return json ? res.status(401).json({ error: "Please sign in again." }) : res.redirect(303, "/elf/sign-in");
    const sent = (req.body ?? {}) as Record<string, unknown>;
    const stopped = json ? (typeof sent.stopped === "boolean" ? sent.stopped : null) : stoppedFromForm(sent.stopped);
    if (stopped === null) return json ? res.status(400).json({ error: ELF_NOT_OURS }) : res.status(400).type("text/plain").send(ELF_NOT_OURS);
    await setEmailsStopped(s.familyId, stopped);
    return json ? res.status(200).json({ ok: true, stopped }) : res.redirect(303, "/elf/hq");
  } catch (err) {
    return gameFailed(res, "emails switch", err, json);
  }
}

elfRouter.get("/elf/p/:code", schoolOn, doorsOn, getPoster);
elfRouter.post("/elf/p/:code/word", forms, schoolOn, doorsOn, postWord);
elfRouter.post("/api/elf/word", forms, schoolOn, doorsOn, postWord);
elfRouter.post("/api/elf/guess", forms, schoolOn, doorsOn, postGuess);
elfRouter.get("/elf/hq/door/:n", schoolOn, doorsOn, getGo);
elfRouter.post("/elf/hq/door/:n/go", forms, schoolOn, doorsOn, postGo);
elfRouter.post(ELF_PHOTO_POST_PATH, schoolOn, doorsOn, postPhoto);
elfRouter.delete(ELF_PHOTO_POST_PATH, schoolOn, doorsOn, deletePhotoByCode);
elfRouter.delete("/api/elf/door/:n/photo", schoolOn, doorsOn, deletePhotoByDoor);
elfRouter.get("/elf/door/:n/photo/:token.jpg", schoolOn, doorsOn, getDoorPhoto);
elfRouter.get("/elf/door/:n/elf/:visitId.png", schoolOn, doorsOn, getDoorElf);
elfRouter.get("/elf/hq/clue/:door/:n.jpg", schoolOn, doorsOn, getCluePicture);
elfRouter.get("/elf/hq/entry/:detective", schoolOn, doorsOn, getEntry);
elfRouter.post(ELF_ENTRY_POST_PATH, schoolOn, doorsOn, postEntry);
elfRouter.get("/elf/hq/entry/:detective/picture.jpg", schoolOn, doorsOn, getEntryPicture);
elfRouter.get("/elf/hq/certificate/:detective", schoolOn, doorsOn, getCertificate);
elfRouter.get("/elf/hq/share/:file", schoolOn, doorsOn, getShareCard);
elfRouter.get(GRADUATE_VIDEO_PATH, schoolOn, doorsOn, getGraduateVideo);
elfRouter.get("/elf/emails/:token", schoolOn, getEmailsPage);
elfRouter.post("/elf/emails/:token", forms, schoolOn, postEmailsPage);
elfRouter.post(EMAILS_SWITCH_PATH, forms, schoolOn, doorsOn, postEmails);
