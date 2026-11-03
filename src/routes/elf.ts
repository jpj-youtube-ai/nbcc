import express, { Router, type NextFunction, type Request, type Response } from "express";
import { config } from "../config";
import { captchaEnabled, captchaSiteKey, verifyCaptcha } from "../clients/turnstile";
import { createRateLimiter } from "../portal/request-limiter";
import { attachStripeSession, createPendingJoin, getElfSettings, type ElfSettings } from "../db/elf";
import { buildElfSessionParams, feeCoverPence, joinBodyFromForm, parseJoin } from "../elf/join";
import { FESTIVE_SURNAMES } from "../elf/names";
import { renderJoinPage } from "../elf/pages/join";
import { ELF_PENDING_COOKIE, elfPendingCookieOptions, hashElfToken, newElfToken } from "../elf/session";
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
