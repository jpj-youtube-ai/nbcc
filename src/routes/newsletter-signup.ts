import express, { Router, type NextFunction, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ZodIssue } from "zod";
import { createRateLimiter } from "../portal/request-limiter";
import { hashSignupToken, looksLikeSignupToken, newSignupToken, signupSchema } from "../mailing-list/model";
import { renderConfirmPage, renderLinkGonePage, renderThanksPage, renderTroublePage } from "../mailing-list/render";

// Joining the mailing list from the /newsletter page, with a confirm by email step.
//
//   GET  /newsletter                 the sign up page: newsletter.html, served by _redirects
//   GET  /api/newsletter/captcha     the Turnstile site key for the form, or null
//   POST /api/newsletter/signup      { firstName, email }: emails ONE link to confirm. It always
//                                    answers the same, whoever the address belongs to: already on
//                                    the list, never heard of, or one we must not email.
//   GET  /newsletter/confirm?t=      "One more step": a page with a button. Opening it adds nobody,
//                                    so a mail scanner that opens every link changes nothing.
//   POST /newsletter/confirm         adds them to the newsletter's list, and says thank you
//
// THE ONE THING THIS DOES TO THE NEWSLETTER: a confirmed person is added to the SAME list the
// newsletter already uses, by calling the website's existing self sign up (subscribeSelf,
// src/newsletter/self-signup.ts), exactly as the footer form on every page does. Nothing about how
// newsletters are written, previewed, sent, tracked or unsubscribed is touched or changed here.
//
// The link's token is only ever in the email: the database keeps a hash of it. A link works once,
// for 7 days. Everything behind the handlers is passed in (SignupRouteDeps), so they are unit tested
// with fakes (test/unit/newsletter-signup-routes.test.ts).

export interface SignupRouteDeps {
  now: () => Date;
  /** Production: the spam check must be set up and answering, or the form is closed. */
  production: boolean;
  /** The site's own address, no trailing slash. */
  baseUrl: string;
  /** newsletter.html. */
  template: () => string;
  /** Adds the menu items switched on elsewhere (the ball, Get involved). */
  decorate: (html: string, cookieHeader: string | undefined) => Promise<string>;
  captchaEnabled: () => boolean;
  captchaSiteKey: () => string | null;
  verifyCaptcha: (token: unknown, ip: string | undefined) => Promise<{ outcome: "passed" } | { outcome: "refused" | "unavailable"; reason: string }>;
  fromOurOwnPage: (req: Request, res: Response) => boolean;
  /** Is this address on the stop list for bounces and complaints? */
  suppressed: (email: string) => Promise<boolean>;
  /** Keep the request. False when a link went to this address in the last ten minutes. */
  save: (r: { email: string; firstName: string; tokenHash: string }, now: Date) => Promise<boolean>;
  forget: (tokenHash: string) => Promise<void>;
  find: (tokenHash: string, now: Date) => Promise<{ email: string; firstName: string } | null>;
  /** The one email asking them to confirm. Throws when it could not be sent. */
  sendConfirm: (m: { email: string; firstName: string; confirmUrl: string }) => Promise<void>;
  /** Already an active member of the newsletter's own list? */
  alreadyOnList: (email: string) => Promise<boolean>;
  /** The website's existing self sign up. "no_list" when the newsletter list is missing. */
  subscribe: (person: { name: string; email: string }) => Promise<string>;
  /** A note in the audit log that this sign up came from the newsletter page. */
  record: (email: string, outcome: string) => Promise<void>;
}

// The same shape and sizes as the pledge form's limits (src/routes/pledges.ts).
const ipLimiter = createRateLimiter({ max: 8, windowMs: 10 * 60_000 });
const emailLimiter = createRateLimiter({ max: 4, windowMs: 15 * 60_000 });
const confirmLimiter = createRateLimiter({ max: 30, windowMs: 15 * 60_000 });

// Exempt from the limits exactly as the other public forms are: only a request made on the box
// itself, local development or the pr.yml BDD suite. Behind the load balancer req.ip is always the
// real client, so no outside request can present as loopback.
function isLoopbackRequest(req: Request): boolean {
  const ip = req.ip ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function fieldErrors(issues: ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

const why = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The one answer the form gives, whoever the address belongs to. */
const CHECK_EMAIL = { status: "check_email" };
const TOO_MANY = { error: "Too many tries. Please wait a few minutes and try again." };
const TRY_LATER = { error: "We could not take your details just now. Please try again in a few minutes." };
const CLOSED = { error: "Joining the mailing list is not available just now. Please try again in a little while." };
const CHECK_BOXES = "Please check the boxes marked below.";

export function makeSignupHandlers(deps: SignupRouteDeps) {
  function getCaptcha(_req: Request, res: Response): Response {
    return res.status(200).json({ siteKey: deps.captchaSiteKey() });
  }

  async function postSignup(req: Request, res: Response): Promise<Response | void> {
    // Honeypot: a real browser never fills the hidden `company` field. Pretend success, keep nothing.
    if (typeof req.body?.company === "string" && req.body.company.trim() !== "") return res.status(200).json(CHECK_EMAIL);
    if (!deps.fromOurOwnPage(req, res)) return;
    if (!isLoopbackRequest(req) && !ipLimiter.allow(req.ip ?? "unknown", Date.now())) return res.status(429).json(TOO_MANY);
    try {
      // The spam check, as on the pledge form: this form emails whoever is named on it, so in
      // production it is never left open to robots. A check that is not set up, or cannot answer,
      // closes the form there; elsewhere (local work, CI) the request goes through.
      if (deps.captchaEnabled()) {
        const verdict = await deps.verifyCaptcha(req.body?.captchaToken, req.ip);
        if (verdict.outcome === "refused") return res.status(400).json({ error: "captcha" });
        if (verdict.outcome === "unavailable") {
          console.error(`newsletter sign up captcha unavailable, ${deps.production ? "request refused" : "request kept"}:`, verdict.reason);
          if (deps.production) return res.status(503).json(CLOSED);
        }
      } else if (deps.production) {
        console.error("newsletter sign up refused: the spam check is not set up in production");
        return res.status(503).json(CLOSED);
      }
      const parsed = signupSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: CHECK_BOXES, fields: fieldErrors(parsed.error.issues) });
      const { email, firstName } = parsed.data;
      if (!isLoopbackRequest(req) && !emailLimiter.allow(email, Date.now())) return res.status(429).json(TOO_MANY);

      // From here on the answer is always the same, so nobody can learn from this form whether an
      // address is on the list, has unsubscribed, or is one we must not email.
      //
      // An address on the stop list (it bounced, or they reported us as spam) is never emailed, so
      // nothing is kept and nothing is sent.
      if (await deps.suppressed(email)) return res.status(200).json(CHECK_EMAIL);
      const token = newSignupToken();
      const tokenHash = hashSignupToken(token);
      // False: a link went to this address in the last ten minutes. No second email yet.
      if (!(await deps.save({ email, firstName, tokenHash }, deps.now()))) return res.status(200).json(CHECK_EMAIL);
      try {
        await deps.sendConfirm({ email, firstName, confirmUrl: `${deps.baseUrl}/newsletter/confirm?t=${token}` });
      } catch (err) {
        // The email did not go. Forget the request, so they are not made to wait before trying again.
        console.error("newsletter sign up email failed:", why(err));
        await deps.forget(tokenHash).catch((e) => console.error("newsletter sign up tidy failed:", why(e)));
      }
      return res.status(200).json(CHECK_EMAIL);
    } catch (err) {
      console.error("newsletter sign up failed:", why(err));
      return res.status(500).json(TRY_LATER);
    }
  }

  // --- the pages the emailed link opens ------------------------------------------------------------

  // One person's own page, its token in the address: never kept by a browser or anything in between,
  // never indexed, and never handed to another website as a referrer.
  async function send(req: Request, res: Response, status: number, html: string): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Referrer-Policy", "no-referrer");
    let out = html;
    try {
      out = await deps.decorate(html, req.headers?.cookie);
    } catch (err) {
      console.error("newsletter sign up page menu failed:", why(err));
    }
    res.status(status).type("html").send(out);
  }

  /** The waiting request a token belongs to, or null (not ours, unknown, used or expired). */
  async function requestFor(token: unknown): Promise<{ email: string; firstName: string; tokenHash: string } | null> {
    if (!looksLikeSignupToken(token)) return null;
    const tokenHash = hashSignupToken(token);
    const found = await deps.find(tokenHash, deps.now());
    return found ? { ...found, tokenHash } : null;
  }

  const tooMany = (req: Request) => !isLoopbackRequest(req) && !confirmLimiter.allow(req.ip ?? "unknown", Date.now());

  async function getConfirmPage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = req.query?.t;
      if (tooMany(req)) return send(req, res, 429, renderLinkGonePage(deps.template()));
      const found = await requestFor(token);
      if (!found) return send(req, res, 404, renderLinkGonePage(deps.template()));
      return send(req, res, 200, renderConfirmPage(deps.template(), { token: String(token) }));
    } catch (err) {
      console.error("newsletter confirm page failed:", why(err));
      next();
    }
  }

  async function postConfirm(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (tooMany(req)) return send(req, res, 429, renderLinkGonePage(deps.template()));
      const found = await requestFor(req.body?.t);
      if (!found) return send(req, res, 404, renderLinkGonePage(deps.template()));
      // On the stop list since they asked (or lifted and put back): never added, and told nothing
      // different. Already on the list: thanked, and nothing is changed.
      const blocked = await deps.suppressed(found.email);
      if (!blocked && !(await deps.alreadyOnList(found.email))) {
        // The existing self sign up: the same list, consent time and welcome as the footer form.
        // Someone who unsubscribed before and is now signing up again themselves is added again,
        // exactly as that form does.
        const outcome = await deps.subscribe({ name: found.firstName, email: found.email });
        // The link is kept, so the button can be pressed again.
        if (outcome === "no_list") return send(req, res, 500, renderTroublePage(deps.template()));
        await deps.record(found.email, outcome).catch((e) => console.error("newsletter sign up note failed:", why(e)));
      }
      // Used: the link works once.
      await deps.forget(found.tokenHash).catch((e) => console.error("newsletter sign up tidy failed:", why(e)));
      return send(req, res, 200, renderThanksPage(deps.template()));
    } catch (err) {
      console.error("newsletter confirm failed:", why(err));
      next();
    }
  }

  return { getCaptcha, postSignup, getConfirmPage, postConfirm };
}

// --- the real things behind the handlers ---------------------------------------------------------
// Each module is loaded when first used, so this file stays import safe for unit tests.

function realDeps(page: { template: () => string; decorate: SignupRouteDeps["decorate"] }): SignupRouteDeps {
  const db = () => import("../db/newsletter-signups");
  return {
    now: () => new Date(),
    production: false,
    baseUrl: "",
    template: page.template,
    decorate: page.decorate,
    captchaEnabled: () => false,
    captchaSiteKey: () => null,
    verifyCaptcha: async (token, ip) => (await import("../clients/turnstile")).verifyCaptcha(token, ip),
    fromOurOwnPage: () => false,
    suppressed: async (email) => (await (await import("../db/email-suppressions")).suppressedAmong([email])).has(email.trim().toLowerCase()),
    save: async (r, now) => (await db()).saveSignupRequest(r, now),
    forget: async (tokenHash) => (await db()).deleteSignupRequest(tokenHash),
    find: async (tokenHash, now) => (await db()).findSignupRequest(tokenHash, now),
    sendConfirm: async (m) => {
      const [{ config }, { sendNewsletterSignupConfirm }, { buildSignupConfirmEmail }] = await Promise.all([
        import("../config"),
        import("../clients/email"),
        import("../mailing-list/confirm-email"),
      ]);
      const built = buildSignupConfirmEmail({ firstName: m.firstName, confirmUrl: m.confirmUrl });
      // From the main nbcc.scot address (MAIL_FROM), like every other email that answers something
      // a person has just done on the site: never from the newsletter's own sending address. A reply
      // goes to the newsletter inbox on nbcc.scot, which receives.
      await sendNewsletterSignupConfirm({ email: m.email, from: config.MAIL_FROM, replyTo: config.NEWSLETTER_REPLY_TO_EMAIL, ...built });
    },
    alreadyOnList: async (email) => {
      const lists = await import("../db/subscriber-lists");
      const list = await lists.getSubscriberListBySlug("newsletter");
      if (!list) return false;
      return (await lists.getMembershipStates(list.id, [email])).some((m) => !m.unsubscribed);
    },
    // "footer" is the existing source for "signed up themselves on the website". Where exactly on
    // the website is in the audit note below.
    subscribe: async (person) => (await import("../newsletter/self-signup")).subscribeSelf({ name: person.name, email: person.email, phone: null }, "footer"),
    record: async (email, outcome) => {
      const [{ recordAudit }, lists] = await Promise.all([import("../db/donations"), import("../db/subscriber-lists")]);
      const list = await lists.getSubscriberListBySlug("newsletter");
      const member = list ? await lists.getListMemberByEmail(list.id, email) : null;
      await recordAudit({
        actor: "signup",
        action: "newsletter_signup.confirmed",
        entity: "list_subscriber",
        entityId: member?.id ?? null,
        data: { email, source: "newsletter page", confirmedByEmail: true, outcome },
      });
    },
  };
}

/**
 * The handlers, wired to the real database, email and config on first use. The few things a handler
 * reads without waiting (the site's address, the same origin check, whether the spam check is on)
 * are filled in from their modules before each request.
 */
function wired(page: { template: () => string; decorate: SignupRouteDeps["decorate"] }) {
  const deps = realDeps(page);
  let ready: Promise<void> | null = null;
  const prepare = (): Promise<void> => {
    ready ??= (async () => {
      const [{ config }, turnstile, signIn] = await Promise.all([import("../config"), import("../clients/turnstile"), import("../fundraising/sign-in")]);
      deps.baseUrl = config.PORTAL_BASE_URL.replace(/\/+$/, "");
      deps.production = config.NODE_ENV === "production";
      deps.captchaEnabled = turnstile.captchaEnabled;
      deps.captchaSiteKey = turnstile.captchaSiteKey;
      deps.fromOurOwnPage = (req, res) => {
        const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
        const ok = signIn.sentFromOurOwnPage({ secFetchSite: one(req.headers["sec-fetch-site"]), origin: one(req.headers.origin) }, one(req.headers.host) ?? "");
        if (!ok) res.status(403).json({ error: "Please send this from our own page." });
        return ok;
      };
    })();
    return ready;
  };
  const handlers = makeSignupHandlers(deps);
  type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
  const after =
    (h: Handler): Handler =>
    async (req, res, next) => {
      try {
        await prepare();
      } catch (err) {
        ready = null;
        console.error("newsletter sign up could not start:", why(err));
        return next();
      }
      return h(req, res, next);
    };
  return Object.fromEntries(Object.entries(handlers).map(([name, h]) => [name, after(h as Handler)])) as Record<keyof typeof handlers, Handler>;
}

// The API: mounted in src/app.ts. It draws no pages, so it needs no template and no menu.
export const newsletterSignupRouter = Router();
{
  const h = wired({ template: () => "", decorate: async (html) => html });
  newsletterSignupRouter.get("/api/newsletter/captcha", h.getCaptcha);
  newsletterSignupRouter.post("/api/newsletter/signup", h.postSignup);
}

/**
 * The pages the emailed link opens, added to the site router (src/routes/site.ts) before its catch
 * all. The button posts as a plain form (it works without JavaScript), so the POST reads its own
 * small urlencoded body.
 */
export function addNewsletterSignupPageRoutes(router: Router, siteRoot: string, page: { decorate: SignupRouteDeps["decorate"] }): void {
  const file = join(siteRoot, "newsletter.html");
  const h = wired({ template: () => readFileSync(file, "utf8"), decorate: page.decorate });
  const form = express.urlencoded({ extended: false, limit: "8kb" });
  router.get("/newsletter/confirm", h.getConfirmPage);
  router.post("/newsletter/confirm", form, h.postConfirm);
}
