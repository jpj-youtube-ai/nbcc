import express, { Router, type NextFunction, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type StripeNS from "stripe";
import type { ZodIssue } from "zod";
import { createRateLimiter } from "../portal/request-limiter";
import type { AdminSessionClaims } from "../admin/session";
import type { CardFeeRate } from "../ball/pricing";
import { londonToday } from "../events/model";
import { hasPage, pagePath, type FundraiserRecord } from "../fundraising/model";
import { safeFirstName } from "../fundraising/emails";
import type { PledgeRecord, PledgeWithFundraiser } from "../db/pledges";
import type { PledgeCheckoutInput } from "../pledges/checkout";
import { buildPledgeEmail, PLEDGE_EMAIL_LABELS, PLEDGE_EMAIL_WHEN, pledgeHiddenNote, samplePledgeEmailData } from "../pledges/emails";
import {
  PLEDGE_WORDING_KEYS,
  canPledge,
  doublePaidCount,
  fullName,
  longDate,
  parsePayAmount,
  payDueDay,
  payLinkRefusal,
  pledgeSchema,
  pledgeTotals,
  pounds,
  statusWords,
  unpaidTwoWeeksOn,
  type PledgeEmailKind,
  type PledgeFundraiser,
  type PledgeInput,
} from "../pledges/model";
import { renderCancelPage, renderConfirmPage, renderPayPage, renderPledgeNotice } from "../pledges/render";
import type { SendAllResult, SendNowOutcome } from "../pledges/runner";
import { newPledgeNonce, pledgeIdOfToken, verifyPledgeToken, type PledgeLinkPurpose } from "../pledges/token";

// Sponsor pledges (Jaimie, 2026-10-03): "Sponsor now, pay after". The rules are in
// src/pledges/model.ts, the SQL in src/db/pledges.ts, the emails and the daily pass in
// src/pledges/emails.ts and runner.ts, and the Stripe session in src/pledges/checkout.ts.
//
// A sponsor, on a sponsorship fundraiser's page (never an event, a page in memory, or a team's own page):
//   POST /api/fundraisers/:slug/pledges         make a pledge (honeypot, per address and per email
//                                               limits, Turnstile like the sign up, our own page
//                                               only). It is UNCONFIRMED: one email asks them to confirm.
//
// The sponsor again, from an emailed link (a signed token, ?t=; pages never kept or indexed). Every
// link only ASKS when opened: a button (a POST) does the thing, so a mail scanner does nothing.
//   GET  /pledge/confirm?t=                     "Confirm your pledge"
//   POST /pledge/confirm                        confirms it: now it is on the page
//   GET  /pledge/pay?t=                         the pay page: a plain form, the amount filled in
//   POST /pledge/pay                            on to Stripe Checkout (303); the webhook marks it paid
//   GET  /pledge/cancel?t=                      "Can't pay after all?"
//   POST /pledge/cancel                         cancels the pledge quietly
//
// The organiser, in their private area (signed in with the emailed code; src/routes/fundraise.ts):
//   GET  /api/fundraise/manage/pledges                               their confirmed pledges: names
//                                                                    (never emails), amounts, state, totals
//   POST /api/fundraise/manage/fundraisers/:id/pledges/:pledgeId/cash   { paid }: paid me in cash
//   POST /api/fundraise/manage/fundraisers/:id/pledges/:pledgeId/hide   { hidden }: off my page (staff are told)
//
// Staff, Admin > Fundraising (section "fundraising"):
//   GET    /api/admin/fundraising/pledges                 every fundraiser's pledges, with emails   view
//   GET    /api/admin/fundraising/pledges/preview/:key    one of the two emails, rendered           view
//   POST   /api/admin/fundraising/pledges/approvals/:key  approve its wording                       admin
//   DELETE /api/admin/fundraising/pledges/approvals/:key  withdraw that approval                    admin
//   POST   /api/admin/fundraising/pledges/send-pay-links  new pay links to everyone unpaid          admin
//   POST   /api/admin/pledges/:id/send-pay-link           send (or resend) the pay link by hand     edit
//   POST   /api/admin/pledges/:id/cancel                  cancel a pledge                           edit
//   POST   /api/admin/pledges/:id/message                 { hidden }: hide its message on the page  edit
//   POST   /api/admin/pledges/:id/checked                 one paid twice has been checked           edit
//
// A pledge is a promise, never money: nothing here writes a donation. Everything behind the handlers
// is passed in (PledgeRouteDeps), so they are unit tested with fakes (test/unit/sponsor-pledges-routes.test.ts).

type Fundraiser = FundraiserRecord;
type Session = { email: string; sessionHash: string };
type WordingApproval = { key: string; approvedAt: string; approvedBy: string };

export interface PledgeRouteDeps {
  now: () => Date;
  /** Production: the spam check must be set up, or pledging is closed. */
  production: boolean;
  /** What signs the emailed links (config.ADMIN_SESSION_SECRET). */
  secret: string;
  /** The site's own address, no trailing slash. */
  baseUrl: string;
  /** pledge.html. */
  template: () => string;
  decorate: (html: string, cookieHeader: string | undefined) => Promise<string>;
  fundraisingOn: () => Promise<boolean>;
  getBySlug: (slug: string) => Promise<Fundraiser | null>;
  /** `capped`: that address has too many pledges waiting to be confirmed; nothing was stored. */
  create: (fundraiserId: number, input: PledgeInput, nonce: string) => Promise<{ pledge: PledgeRecord | null; duplicate: boolean; capped?: boolean }>;
  /** The one email asking the sponsor to confirm. Never throws. */
  sendConfirm: (c: PledgeWithFundraiser) => Promise<"sent" | "blocked" | "failed">;
  confirm: (id: number) => Promise<boolean>;
  getPledge: (id: number) => Promise<PledgeWithFundraiser | null>;
  list: (fundraiserIds: number[]) => Promise<PledgeRecord[]>;
  readAll: () => Promise<PledgeWithFundraiser[]>;
  cancel: (id: number, by: string) => Promise<boolean>;
  markCash: (fundraiserId: number, id: number, paid: boolean, by: string) => Promise<PledgeRecord | null>;
  setHiddenByOrganiser: (fundraiserId: number, id: number, hidden: boolean, by: string) => Promise<PledgeRecord | null>;
  setHidden: (fundraiserId: number, id: number, hidden: boolean, actor: string) => Promise<boolean>;
  /** A plain note to the events inbox. Never throws. */
  notifyStaff: (subject: string, lines: string[]) => Promise<boolean>;
  /** The Stripe session for paying a pledge (src/pledges/checkout.ts). */
  buildCheckout: (input: PledgeCheckoutInput, cardFee: CardFeeRate | undefined, now: Date) => Promise<StripeNS.Checkout.SessionCreateParams>;
  createCheckout: (params: StripeNS.Checkout.SessionCreateParams) => Promise<{ id: string; url: string | null }>;
  /** Close a checkout opened earlier for the same pledge. Throws when Stripe will not (it is paid, or already closed). */
  expireCheckout: (sessionId: string) => Promise<void>;
  /** What Stripe says of a checkout: its status ("open", "complete", "expired") and payment_status. */
  retrieveCheckout: (sessionId: string) => Promise<{ status: string | null; paymentStatus: string | null }>;
  /** Remember the new checkout, only if the pledge still has `previous`. False when another tab won. */
  saveCheckout: (pledgeId: number, sessionId: string, previous: string | null) => Promise<boolean>;
  cardFee: () => Promise<CardFeeRate | undefined>;
  /** The fundraiser's own page to come back to after paying, or null. */
  fundraiserPage: (fundraiserId: number) => Promise<string | null>;
  sendNow: (pledgeId: number, actor: string) => Promise<SendNowOutcome>;
  sendAll: (actor: string) => Promise<SendAllResult>;
  markChecked: (pledgeId: number, actor: string) => Promise<boolean>;
  captchaEnabled: () => boolean;
  verifyCaptcha: (token: unknown, ip: string | undefined) => Promise<{ outcome: "passed" } | { outcome: "refused" | "unavailable"; reason: string }>;
  fromOurOwnPage: (req: Request, res: Response) => boolean;
  signedIn: (req: Request, res: Response) => Promise<Session | null>;
  listForOrganiser: (email: string) => Promise<Fundraiser[]>;
  ownFundraiser: (req: Request, res: Response, s: Session) => Promise<Fundraiser | null>;
  /** Staff with this much of the fundraising section, or an answer for why not. */
  authorize: (req: Request, res: Response, level: "view" | "edit") => Promise<AdminSessionClaims | null>;
  authorizeAdmin: (req: Request, res: Response) => Promise<AdminSessionClaims | null>;
  listApprovals: () => Promise<WordingApproval[]>;
  approve: (key: string, actor: string) => Promise<WordingApproval>;
  withdraw: (key: string, actor: string) => Promise<boolean>;
  touchOn: () => Promise<boolean>;
  /** Offline Stripe stub, never production: hand the built session back, so the BDD can replay it. */
  stubEcho: boolean;
}

const pledgeIpLimiter = createRateLimiter({ max: 8, windowMs: 10 * 60_000 });
const pledgeEmailLimiter = createRateLimiter({ max: 4, windowMs: 15 * 60_000 });
const payIpLimiter = createRateLimiter({ max: 20, windowMs: 15 * 60_000 });
const cashLimiter = createRateLimiter({ max: 60, windowMs: 15 * 60_000 });

// Exempt from the limits exactly as the sign up is (src/routes/fundraise.ts): only a request made on
// the box itself, local development or the pr.yml BDD suite. Behind the load balancer req.ip is
// always the real client, so no outside request can present as loopback.
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

function positiveId(value: unknown): number | null {
  const s = String(value ?? "");
  if (!/^[1-9]\d{0,9}$/.test(s)) return null;
  const n = Number(s);
  return n <= 2147483647 ? n : null;
}

const actorOf = (claims: AdminSessionClaims): string => `admin:${claims.email}`;
const why = (err: unknown) => (err instanceof Error ? err.message : String(err));
const firstNameOf = (name: string): string => safeFirstName(name) ?? "the organiser";
const asPledgeFundraiser = (f: Fundraiser): PledgeFundraiser => f;
const whenWords = (f: { eventDate: string | null; name: string }) => (f.eventDate ? `the day after ${longDate(f.eventDate)}` : `when ${firstNameOf(f.name)} has finished`);

const TOO_MANY = { error: "Too many tries. Please wait a few minutes and try again." };
const NOT_TAKING = { error: "This page is not taking pledges. You can still give on the page." };
const TRY_LATER = { error: "We could not take your pledge just now. Please try again in a few minutes." };
const CLOSED = { error: "Pledging is not available just now. You can still give on the page." };
const UNAVAILABLE = { error: "Admin is temporarily unavailable" };
const CARDS_DOWN = "Card payments are not working just now. Please try again in a few minutes.";

const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" });

/** A pledge as its organiser sees it: a name, never an email or an address. */
function forOrganiser(p: PledgeRecord) {
  return {
    id: p.id,
    name: fullName(p),
    amountPence: p.amountPence,
    paidAmountPence: p.paidAmountPence,
    status: p.status,
    statusWords: statusWords(p),
    giftAid: p.giftAid,
    createdAt: p.createdAt,
    canMarkCash: p.status === "open",
    canUnmarkCash: p.status === "cash" && !p.anonymisedAt,
    hidden: Boolean(p.hiddenAt),
    canHide: p.status === "open",
  };
}

/** A pledge as staff see it: with the email, the message and what has been sent. */
function forStaff(c: PledgeWithFundraiser, today: string) {
  const p = c.p;
  return {
    ...forOrganiser(p),
    // Staff read it as about the organiser.
    statusWords: p.status === "cash" ? "Paid the organiser in cash" : statusWords(p),
    email: p.email,
    message: p.message,
    messageHidden: p.messageHidden,
    showName: p.showName,
    confirmedAt: p.confirmedAt ?? null,
    payEmailSentAt: p.payEmailSentAt,
    payEmailLastSentAt: p.payEmailLastSentAt ?? null,
    reminderSentAt: p.reminderSentAt,
    paidAt: p.paidAt,
    cancelledAt: p.cancelledAt,
    anonymisedAt: p.anonymisedAt,
    // Paid twice, or paid online after cash, and nobody has checked it yet.
    paidTwice: Boolean(p.doublePaidAt && !p.doublePaidCheckedAt),
    // Only once the link is due: never early (payLinkRefusal).
    canSend: payLinkRefusal(p, c.f, today) === null,
    canCancel: p.status === "open",
  };
}

export function makePledgeHandlers(deps: PledgeRouteDeps) {
  // --- a sponsor makes a pledge --------------------------------------------------------------------

  async function postPledge(req: Request, res: Response): Promise<Response | void> {
    // Honeypot: a real browser never fills the hidden `company` field. Pretend success, store nothing.
    if (typeof req.body?.company === "string" && req.body.company.trim() !== "") {
      return res.status(201).json({ status: "pledged", confirm: true });
    }
    if (!deps.fromOurOwnPage(req, res)) return;
    if (!isLoopbackRequest(req) && !pledgeIpLimiter.allow(req.ip ?? "unknown", Date.now())) return res.status(429).json(TOO_MANY);
    try {
      if (!(await deps.fundraisingOn())) return res.status(404).json({ error: "Not found" });
      // The spam check, as on the sign up form: a refused pass stores nothing; a check that cannot
      // answer keeps the pledge and logs why, so a real one is never lost to the checker. In
      // production it must be set up: without it this form would email anyone a robot named, so
      // pledging is closed rather than open (config already refuses to boot production without the
      // keys; this is the second lock).
      if (deps.captchaEnabled()) {
        const verdict = await deps.verifyCaptcha(req.body?.captchaToken, req.ip);
        if (verdict.outcome === "refused") return res.status(400).json({ error: "captcha" });
        if (verdict.outcome === "unavailable") {
          // In production a check that cannot answer closes the form too: this form emails whoever
          // is named on it, so it is never left open to robots. Elsewhere the pledge is kept.
          console.error(`pledge captcha unavailable, ${deps.production ? "pledge refused" : "pledge kept"}:`, verdict.reason);
          if (deps.production) return res.status(503).json(CLOSED);
        }
      } else if (deps.production) {
        console.error("pledge refused: the spam check is not set up in production");
        return res.status(503).json(CLOSED);
      }
      const f = await deps.getBySlug(String(req.params.slug ?? ""));
      if (!f || !hasPage(f)) return res.status(404).json({ error: "Not found" });
      const today = londonToday(deps.now());
      if (!canPledge(asPledgeFundraiser(f), today)) return res.status(409).json(NOT_TAKING);
      const parsed = pledgeSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "Some of the form needs another look", fields: fieldErrors(parsed.error.issues) });
      if (!isLoopbackRequest(req) && !pledgeEmailLimiter.allow(parsed.data.email, Date.now())) return res.status(429).json(TOO_MANY);
      const made = await deps.create(f.id, parsed.data, newPledgeNonce());
      // One email, once. A second press of the button made no second pledge and sends no second
      // email, unless the first never went (the send failed): then this one sends it. An address
      // with too many pledges waiting to be confirmed (capped) stores nothing and is sent nothing.
      const p = made.pledge;
      if (p && p.status === "unconfirmed" && (!made.duplicate || !p.confirmEmailSentAt)) {
        const c = await deps.getPledge(p.id);
        if (c) await deps.sendConfirm(c);
      }
      // The same answer whether or not the email could go (or the pledge was capped), so nobody
      // learns who is on a stop list or how many pledges an address has.
      return res.status(201).json({ status: "pledged", confirm: true, amountPence: parsed.data.amountPence });
    } catch (err) {
      console.error("pledge failed:", why(err));
      return res.status(500).json(TRY_LATER);
    }
  }

  // --- the pages the emailed links open ------------------------------------------------------------

  // A sponsor's own page, its token in the address: never kept by a browser or anything in between,
  // never indexed, and never handed to another website as a referrer.
  function privatePage(res: Response): void {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Referrer-Policy", "no-referrer");
  }

  async function send(req: Request, res: Response, status: number, html: string): Promise<void> {
    privatePage(res);
    res.status(status).type("html").send(await deps.decorate(html, req.headers?.cookie));
  }

  const notice = (heading: string, body: string[], link?: { href: string; label: string }) => renderPledgeNotice(deps.template(), { heading, body, link });

  const NO_LONGER = () =>
    notice("This link no longer works", [
      "It may have been copied wrongly, or the pledge it was for is no longer here.",
      "If you would still like to give, you can do that on the fundraiser's page, or email events@nbcc.scot and we will help.",
    ]);

  /** The pledge a genuine token names, or null: the same answer whatever was wrong with it. */
  async function pledgeForToken(token: unknown, purpose: PledgeLinkPurpose = "pay"): Promise<PledgeWithFundraiser | null> {
    const id = pledgeIdOfToken(token);
    if (id === null) return null;
    const c = await deps.getPledge(id);
    if (!c) return null;
    return verifyPledgeToken(token, () => c.p.tokenNonce, deps.secret, purpose) === id ? c : null;
  }

  const pageOf = (c: PledgeWithFundraiser): string | null => (c.f.status === "approved" || c.f.status === "finished" ? pagePath(c.f) : null);

  /** What to show instead of the pay or cancel form when the pledge is no longer open; null when it is. */
  function closedNotice(c: PledgeWithFundraiser): string | null {
    const who = firstNameOf(c.f.name);
    const page = pageOf(c);
    const seePage = page ? { href: page, label: "See the page" } : undefined;
    switch (c.p.status) {
      case "open":
        return c.p.anonymisedAt || !c.p.email ? NO_LONGER() : null;
      case "paid":
        return notice("Your pledge is paid", [`Thank you. Your payment for ${c.f.title} has gone through, and we have emailed your receipt.`], seePage);
      case "cancelled":
        return notice("This pledge was cancelled", ["No money was taken, and we will not email you about it again.", "Changed your mind? You can still give on the page."], seePage);
      case "cash":
        return notice("This pledge is marked as paid", [`${who} has told us you paid in cash, so there is nothing more to do. Thank you.`], seePage);
      default:
        // Unconfirmed (it has no pay link) or expired.
        return NO_LONGER();
    }
  }

  // --- confirming ----------------------------------------------------------------------------------

  const CONFIRMED = (c: PledgeWithFundraiser, already: boolean) => {
    const page = pageOf(c);
    return notice(
      already ? "Your pledge is already confirmed" : "Your pledge is confirmed",
      [
        `Thank you. Your ${pounds(c.p.amountPence)} pledge to sponsor ${firstNameOf(c.f.name)} for ${c.f.title} is on the page.`,
        `There is nothing to pay today. We will email you a link to pay ${whenWords(c.f)}.`,
      ],
      page ? { href: page, label: "See the page" } : undefined,
    );
  };

  async function getConfirmPage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!(await deps.fundraisingOn())) return next();
      const token = String(req.query?.t ?? "");
      const c = await pledgeForToken(token, "confirm");
      if (!c) return send(req, res, 404, NO_LONGER());
      if (c.p.status === "open") return send(req, res, 200, CONFIRMED(c, true));
      if (c.p.status !== "unconfirmed") return send(req, res, 200, NO_LONGER());
      return send(req, res, 200, renderConfirmPage(deps.template(), { token, title: c.f.title, organiserFirstName: firstNameOf(c.f.name), amountPence: c.p.amountPence }));
    } catch (err) {
      console.error("pledge confirm page failed:", why(err));
      next();
    }
  }

  async function postConfirm(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!(await deps.fundraisingOn())) return next();
      const c = await pledgeForToken(String(req.body?.t ?? ""), "confirm");
      if (!c) return send(req, res, 404, NO_LONGER());
      if (c.p.status === "open") return send(req, res, 200, CONFIRMED(c, true));
      if (c.p.status !== "unconfirmed") return send(req, res, 200, NO_LONGER());
      await deps.confirm(c.p.id);
      return send(req, res, 200, CONFIRMED(c, false));
    } catch (err) {
      console.error("pledge confirm failed:", why(err));
      next();
    }
  }

  // --- paying --------------------------------------------------------------------------------------

  const payPage = (c: PledgeWithFundraiser, token: string, error?: string) =>
    renderPayPage(deps.template(), {
      token,
      title: c.f.title,
      organiserFirstName: firstNameOf(c.f.name),
      sponsorFirstName: safeFirstName(c.p.firstName),
      amountPence: c.p.amountPence,
      giftAid: c.p.giftAid && Boolean(c.p.gaWordingSnapshot) && Boolean(c.p.gaAddress),
      declaredOn: c.p.gaDeclaredAt ? DAY.format(new Date(c.p.gaDeclaredAt)) : null,
      pageUrl: pageOf(c),
      ...(error ? { error } : {}),
    });

  async function getPayPage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!(await deps.fundraisingOn())) return next();
      const token = String(req.query?.t ?? "");
      const c = await pledgeForToken(token);
      if (!c) return send(req, res, 404, NO_LONGER());
      const closed = closedNotice(c);
      return send(req, res, 200, closed ?? payPage(c, token));
    } catch (err) {
      console.error("pledge pay page failed:", why(err));
      next();
    }
  }

  async function postPay(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!(await deps.fundraisingOn())) return next();
      const token = String(req.body?.t ?? "");
      const c = await pledgeForToken(token);
      if (!c) return send(req, res, 404, NO_LONGER());
      // Never a checkout for a pledge that is paid, cancelled or marked as paid in cash.
      const closed = closedNotice(c);
      if (closed) return send(req, res, 200, closed);
      if (!isLoopbackRequest(req) && !payIpLimiter.allow(req.ip ?? "unknown", Date.now())) {
        return send(req, res, 429, payPage(c, token, TOO_MANY.error));
      }
      const amount = parsePayAmount(req.body?.amount, c.p.amountPence);
      if ("error" in amount) return send(req, res, 400, payPage(c, token, amount.error));
      const params = await deps.buildCheckout(
        {
          pledge: c.p,
          payPence: amount.pence,
          giftAid: req.body?.giftAid === "yes",
          coverFee: req.body?.coverFee === "yes",
          payUrl: `${deps.baseUrl}/pledge/pay?t=${encodeURIComponent(token)}`,
          fundraiserPage: await deps.fundraiserPage(c.f.id),
        },
        await deps.cardFee(),
        deps.now(),
      );
      // One checkout at a time: the one opened before (another tab, the email opened twice) is closed
      // first, so nobody pays the same pledge twice. Stripe refuses to close one that is already
      // paid or already expired, so when it refuses we ask which: PAID means the money has been
      // taken and only the webhook is still to land, so no new checkout is opened.
      const previous = c.p.checkoutSessionId ?? null;
      if (previous) {
        try {
          await deps.expireCheckout(previous);
        } catch (err) {
          console.info(`pledge ${c.p.id}: its earlier checkout could not be closed (${why(err)})`);
          let earlier: { status: string | null; paymentStatus: string | null } | null = null;
          try {
            earlier = await deps.retrieveCheckout(previous);
          } catch (e) {
            console.info(`pledge ${c.p.id}: its earlier checkout could not be read (${why(e)})`);
          }
          if (earlier && (earlier.status === "complete" || earlier.paymentStatus === "paid")) {
            const page = pageOf(c);
            return send(
              req,
              res,
              200,
              notice("Your pledge is paid", [`Thank you. Your payment for ${c.f.title} has gone through.`, "Your receipt is on its way."], page ? { href: page, label: "See the page" } : undefined),
            );
          }
        }
      }
      let session: { id: string; url: string | null };
      try {
        session = await deps.createCheckout(params);
      } catch (err) {
        console.error("pledge checkout failed:", why(err));
        return send(req, res, 502, payPage(c, token, CARDS_DOWN));
      }
      // Two tabs at the same moment: only the one whose checkout is remembered goes on to pay. The
      // other closes the checkout it just opened and is told, so there is never a second one to pay.
      let mine = true;
      try {
        mine = await deps.saveCheckout(c.p.id, session.id, previous);
      } catch (err) {
        console.error(`pledge ${c.p.id}: could not remember its checkout:`, why(err));
      }
      if (!mine) {
        try {
          await deps.expireCheckout(session.id);
        } catch (err) {
          console.error(`pledge ${c.p.id}: could not close the checkout that lost:`, why(err));
        }
        return send(req, res, 409, payPage(c, token, "This payment is already open in another tab or window. Please finish it there, or wait a minute and try again."));
      }
      // The offline stub only (never production): the BDD replays the real stamped session as
      // Stripe's signed webhook, as the public checkout's own stub echo lets it (TASK-116).
      if (deps.stubEcho && req.get("accept") === "application/json") {
        privatePage(res);
        res.status(200).json({ url: session.url, session: { id: session.id, metadata: params.metadata, mode: params.mode } });
        return;
      }
      if (!session.url) return send(req, res, 502, payPage(c, token, CARDS_DOWN));
      privatePage(res);
      res.redirect(303, session.url);
    } catch (err) {
      console.error("pledge pay failed:", why(err));
      next();
    }
  }

  async function getCancelPage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!(await deps.fundraisingOn())) return next();
      const token = String(req.query?.t ?? "");
      const c = await pledgeForToken(token);
      if (!c) return send(req, res, 404, NO_LONGER());
      const closed = closedNotice(c);
      if (closed) return send(req, res, 200, closed);
      return send(req, res, 200, renderCancelPage(deps.template(), { token, title: c.f.title, organiserFirstName: firstNameOf(c.f.name), amountPence: c.p.amountPence }));
    } catch (err) {
      console.error("pledge cancel page failed:", why(err));
      next();
    }
  }

  async function postCancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!(await deps.fundraisingOn())) return next();
      const c = await pledgeForToken(String(req.body?.t ?? ""));
      if (!c) return send(req, res, 404, NO_LONGER());
      const closed = closedNotice(c);
      if (closed) return send(req, res, 200, closed);
      await deps.cancel(c.p.id, "sponsor");
      const page = pageOf(c);
      return send(
        req,
        res,
        200,
        notice(
          "Your pledge is cancelled",
          ["That's okay, and thank you for letting us know. No money was taken, and we will not email you about it again."],
          page ? { href: page, label: "Back to the page" } : undefined,
        ),
      );
    } catch (err) {
      console.error("pledge cancel failed:", why(err));
      next();
    }
  }

  // --- the organiser -------------------------------------------------------------------------------

  async function getOrganiserPledges(req: Request, res: Response): Promise<Response | void> {
    try {
      const s = await deps.signedIn(req, res);
      if (!s) return;
      const mine = await deps.listForOrganiser(s.email);
      // Only pledges their sponsor has confirmed by email: an unconfirmed one counts for nothing.
      const all = (await deps.list(mine.map((f) => f.id))).filter((p) => p.status !== "unconfirmed");
      const today = londonToday(deps.now());
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({
        fundraisers: mine.map((f) => {
          const rows = all.filter((p) => p.fundraiserId === f.id);
          return { id: f.id, takesPledges: canPledge(asPledgeFundraiser(f), today), totals: pledgeTotals(rows), pledges: rows.map(forOrganiser) };
        }),
      });
    } catch (err) {
      console.error("organiser pledges read failed:", why(err));
      return res.status(500).json({ error: "This is temporarily unavailable" });
    }
  }

  /** The signed in organiser's own fundraiser and the pledge id in the address, or an answer for why not. */
  async function ownPledge(req: Request, res: Response): Promise<{ s: Session; f: Fundraiser; pledgeId: number } | null> {
    if (!deps.fromOurOwnPage(req, res)) return null;
    res.setHeader("Cache-Control", "no-store");
    const s = await deps.signedIn(req, res);
    if (!s) return null;
    const f = await deps.ownFundraiser(req, res, s);
    if (!f) return null;
    const pledgeId = positiveId(req.params.pledgeId);
    if (!pledgeId) {
      res.status(400).json({ error: "Invalid id" });
      return null;
    }
    if (!isLoopbackRequest(req) && !cashLimiter.allow(s.email, Date.now())) {
      res.status(429).json(TOO_MANY);
      return null;
    }
    return { s, f, pledgeId };
  }

  const CANNOT_CHANGE = { error: "That pledge can no longer be changed. Please refresh the page." };
  const NOT_SAVED = { error: "We could not save that just now. Please try again in a few minutes." };

  async function postOrganiserCash(req: Request, res: Response): Promise<Response | void> {
    try {
      const paid = req.body?.paid;
      const own = await ownPledge(req, res);
      if (!own) return;
      if (typeof paid !== "boolean") return res.status(400).json({ error: "Say whether they paid you in cash." });
      const p = await deps.markCash(own.f.id, own.pledgeId, paid, `organiser:${own.s.email}`);
      if (!p) return res.status(409).json(CANNOT_CHANGE);
      return res.status(200).json({ pledge: forOrganiser(p) });
    } catch (err) {
      console.error("organiser pledge cash failed:", why(err));
      return res.status(500).json(NOT_SAVED);
    }
  }

  async function postOrganiserHide(req: Request, res: Response): Promise<Response | void> {
    try {
      const hidden = req.body?.hidden;
      const own = await ownPledge(req, res);
      if (!own) return;
      if (typeof hidden !== "boolean") return res.status(400).json({ error: "Say whether to hide it from your page." });
      const p = await deps.setHiddenByOrganiser(own.f.id, own.pledgeId, hidden, `organiser:${own.s.email}`);
      if (!p) return res.status(409).json(CANNOT_CHANGE);
      // Staff are told, by pledge number: never the sponsor's name or address in an email.
      if (hidden) {
        const note = pledgeHiddenNote({ title: own.f.title, pledgeId: p.id, amountPence: p.amountPence });
        await deps.notifyStaff(note.subject, note.lines);
      }
      return res.status(200).json({ pledge: forOrganiser(p) });
    } catch (err) {
      console.error("organiser pledge hide failed:", why(err));
      return res.status(500).json(NOT_SAVED);
    }
  }

  // --- staff ---------------------------------------------------------------------------------------

  const isKey = (k: unknown): k is PledgeEmailKind => typeof k === "string" && (PLEDGE_WORDING_KEYS as readonly string[]).includes(k);

  async function approvalsByKey(): Promise<{ map: Record<string, { approvedAt: string; approvedBy: string }>; unavailable: boolean }> {
    try {
      const list = await deps.listApprovals();
      return { map: Object.fromEntries(list.map((a) => [a.key, { approvedAt: a.approvedAt, approvedBy: a.approvedBy }])), unavailable: false };
    } catch (err) {
      console.error("admin pledges: could not read the approved wordings:", why(err));
      return { map: {}, unavailable: true };
    }
  }

  async function getAdminPledges(req: Request, res: Response): Promise<Response | void> {
    if (!(await deps.authorize(req, res, "view"))) return;
    try {
      const [all, approvals, on] = await Promise.all([deps.readAll(), approvalsByKey(), deps.touchOn()]);
      const today = londonToday(deps.now());
      const byFundraiser = new Map<number, PledgeWithFundraiser[]>();
      for (const c of all) byFundraiser.set(c.f.id, [...(byFundraiser.get(c.f.id) ?? []), c]);
      const fundraisers = [...byFundraiser.values()].map((rows) => {
        const f = rows[0].f;
        return {
          id: f.id,
          title: f.title,
          organiser: f.name,
          slug: f.slug,
          status: f.status,
          eventDate: f.eventDate,
          payDue: payDueDay(f),
          totals: pledgeTotals(rows.map((r) => r.p)),
          unpaidTwoWeeks: unpaidTwoWeeksOn(rows, today),
          pledges: rows.map((r) => forStaff(r, today)),
        };
      });
      return res.status(200).json({
        today,
        fundraisers,
        totals: pledgeTotals(all.map((c) => c.p)),
        unpaidTwoWeeks: unpaidTwoWeeksOn(all, today),
        paidTwice: doublePaidCount(all.map((c) => c.p)),
        emails: {
          on,
          approvalsUnavailable: approvals.unavailable,
          kinds: PLEDGE_WORDING_KEYS.map((key) => ({ key, label: PLEDGE_EMAIL_LABELS[key], when: PLEDGE_EMAIL_WHEN[key], approval: approvals.map[key] ?? null })),
        },
      });
    } catch (err) {
      console.error("admin pledges read failed:", why(err));
      return res.status(500).json(UNAVAILABLE);
    }
  }

  async function getAdminPreview(req: Request, res: Response): Promise<Response | void> {
    if (!(await deps.authorize(req, res, "view"))) return;
    const key = req.params.key;
    if (!isKey(key)) return res.status(404).json({ error: "There is no pledge email of that kind" });
    try {
      const approvals = await approvalsByKey();
      const mail = buildPledgeEmail(key, samplePledgeEmailData(deps.baseUrl));
      return res.status(200).json({ key, label: PLEDGE_EMAIL_LABELS[key], when: PLEDGE_EMAIL_WHEN[key], approval: approvals.map[key] ?? null, approvalsUnavailable: approvals.unavailable, ...mail });
    } catch (err) {
      console.error("admin pledge email preview failed:", why(err));
      return res.status(500).json(UNAVAILABLE);
    }
  }

  async function postApproval(req: Request, res: Response): Promise<Response | void> {
    const claims = await deps.authorizeAdmin(req, res);
    if (!claims) return;
    const key = req.params.key;
    if (!isKey(key)) return res.status(404).json({ error: "There is no pledge email wording of that name to approve" });
    try {
      return res.status(200).json({ approval: await deps.approve(key, actorOf(claims)) });
    } catch (err) {
      console.error("admin pledge wording approval failed:", why(err));
      return res.status(500).json(UNAVAILABLE);
    }
  }

  async function deleteApproval(req: Request, res: Response): Promise<Response | void> {
    const claims = await deps.authorizeAdmin(req, res);
    if (!claims) return;
    const key = req.params.key;
    if (!isKey(key)) return res.status(404).json({ error: "There is no pledge email wording of that name" });
    try {
      return res.status(200).json({ withdrawn: await deps.withdraw(key, actorOf(claims)) });
    } catch (err) {
      console.error("admin pledge wording withdrawal failed:", why(err));
      return res.status(500).json(UNAVAILABLE);
    }
  }

  const SWITCHED_OFF = "Automatic emails are switched off, so no pay link can be sent.";
  const FUNDRAISING_OFF = "Fundraising is switched off, so nothing can be sent.";
  const WAITING = "The pay email's wording is waiting for sign off, so it cannot be sent yet.";
  const SEND_REFUSALS: Record<Exclude<SendNowOutcome, "sent">, [number, string]> = {
    not_found: [404, "That pledge no longer exists"],
    not_open: [409, "That pledge is no longer waiting to be paid, so there is no link to send."],
    page: [409, "This fundraiser's page no longer takes pledges, so no pay link can be sent."],
    early: [409, "Their link goes the day after the event. To send it early, mark the fundraiser finished first."],
    switched_off: [409, SWITCHED_OFF],
    off: [409, FUNDRAISING_OFF],
    waiting: [409, WAITING],
    blocked: [409, "This sponsor has asked us not to email them, so the link was not sent."],
    too_soon: [409, "A pay link went to this sponsor in the last 10 minutes. Please wait before sending another."],
    failed: [502, "The email could not be sent just now. Please try again in a few minutes."],
  };

  async function postAdminSend(req: Request, res: Response): Promise<Response | void> {
    const claims = await deps.authorize(req, res, "edit");
    if (!claims) return;
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    const outcome = await deps.sendNow(id, actorOf(claims));
    if (outcome === "sent") return res.status(200).json({ status: "sent" });
    const [status, error] = SEND_REFUSALS[outcome];
    return res.status(status).json({ error });
  }

  /** New pay links to everyone unpaid: for after the signing secret changes. Admins only. */
  async function postAdminSendAll(req: Request, res: Response): Promise<Response | void> {
    const claims = await deps.authorizeAdmin(req, res);
    if (!claims) return;
    const out = await deps.sendAll(actorOf(claims));
    if (out.stopped && out.sent === 0) {
      return res.status(409).json({ error: out.stopped === "switched_off" ? SWITCHED_OFF : out.stopped === "off" ? FUNDRAISING_OFF : WAITING });
    }
    return res.status(200).json(out);
  }

  async function postAdminCancel(req: Request, res: Response): Promise<Response | void> {
    const claims = await deps.authorize(req, res, "edit");
    if (!claims) return;
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    try {
      const done = await deps.cancel(id, actorOf(claims));
      if (!done) return res.status(409).json({ error: "That pledge is no longer waiting to be paid. Look again." });
      return res.status(200).json({ status: "cancelled" });
    } catch (err) {
      console.error("admin pledge cancel failed:", why(err));
      return res.status(500).json(UNAVAILABLE);
    }
  }

  async function postAdminMessage(req: Request, res: Response): Promise<Response | void> {
    const claims = await deps.authorize(req, res, "edit");
    if (!claims) return;
    const id = positiveId(req.params.id);
    const hidden = req.body?.hidden;
    if (!id || typeof hidden !== "boolean") return res.status(400).json({ error: "Say whether to hide the message." });
    try {
      const c = await deps.getPledge(id);
      if (!c || !(await deps.setHidden(c.f.id, id, hidden, actorOf(claims)))) return res.status(404).json({ error: "That pledge no longer exists" });
      return res.status(200).json({ status: hidden ? "hidden" : "shown" });
    } catch (err) {
      console.error("admin pledge message failed:", why(err));
      return res.status(500).json(UNAVAILABLE);
    }
  }

  async function postAdminChecked(req: Request, res: Response): Promise<Response | void> {
    const claims = await deps.authorize(req, res, "edit");
    if (!claims) return;
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    try {
      if (!(await deps.markChecked(id, actorOf(claims)))) return res.status(404).json({ error: "That pledge was not paid twice. Look again." });
      return res.status(200).json({ status: "checked" });
    } catch (err) {
      console.error("admin pledge checked failed:", why(err));
      return res.status(500).json(UNAVAILABLE);
    }
  }

  return {
    postPledge,
    getConfirmPage,
    postConfirm,
    getPayPage,
    postPay,
    getCancelPage,
    postCancel,
    getOrganiserPledges,
    postOrganiserCash,
    postOrganiserHide,
    getAdminPledges,
    getAdminPreview,
    postApproval,
    deleteApproval,
    postAdminSend,
    postAdminSendAll,
    postAdminCancel,
    postAdminMessage,
    postAdminChecked,
  };
}

// --- the real thing ----------------------------------------------------------------------------------
// Every database and Stripe module is loaded when first used, so this file stays import safe for the
// unit tests and for the site router, which must never need a database just to be imported.

function realDeps(page: { template: () => string; decorate: PledgeRouteDeps["decorate"] }): PledgeRouteDeps {
  const db = () => import("../db/pledges");
  const runner = () => import("../pledges/runner");
  // The few values a handler reads without waiting are filled in by wired(), below. Until then it is
  // closed: production with no spam check.
  const deps: PledgeRouteDeps = {
    now: () => new Date(),
    production: true,
    secret: "",
    baseUrl: "",
    stubEcho: false,
    template: page.template,
    decorate: page.decorate,
    fundraisingOn: async () => {
      try {
        return await (await import("../db/fundraisers")).fundraisingIsOn();
      } catch {
        return false;
      }
    },
    getBySlug: async (slug) => (await import("../db/fundraisers")).getBySlug(slug),
    create: async (id, input, nonce) => (await db()).createPledge(id, input, nonce),
    sendConfirm: async (c) => (await runner()).sendPledgeConfirmEmail(c),
    confirm: async (id) => (await db()).confirmPledge(id),
    getPledge: async (id) => (await db()).getPledgeWithFundraiser(id),
    list: async (ids) => (await db()).listPledges(ids),
    readAll: async () => (await db()).readAllPledges(),
    cancel: async (id, by) => (await db()).cancelPledge(id, by),
    markCash: async (fid, id, paid, by) => (await db()).markPledgeCash(fid, id, paid, by),
    setHiddenByOrganiser: async (fid, id, hidden, by) => (await db()).setPledgeHiddenByOrganiser(fid, id, hidden, by),
    setHidden: async (fid, id, hidden, actor) => (await db()).setPledgeMessageHidden(fid, id, hidden, actor),
    notifyStaff: async (subject, lines) => (await runner()).sendPledgeStaffNote(subject, lines),
    buildCheckout: async (input, cardFee, now) => (await import("../pledges/checkout")).buildPledgeSessionParams(input, cardFee, now),
    createCheckout: async (params) => {
      const s = await (await import("../clients/stripe")).stripe.checkout.sessions.create(params);
      return { id: s.id, url: s.url };
    },
    expireCheckout: async (sessionId) => {
      await (await import("../clients/stripe")).stripe.checkout.sessions.expire(sessionId);
    },
    retrieveCheckout: async (sessionId) => {
      const s = await (await import("../clients/stripe")).stripe.checkout.sessions.retrieve(sessionId);
      return { status: s.status ?? null, paymentStatus: s.payment_status ?? null };
    },
    saveCheckout: async (id, sessionId, previous) => (await db()).saveCheckoutSession(id, sessionId, previous),
    cardFee: async () => (await import("./api")).currentCardFee(),
    fundraiserPage: async (id) => (await import("./api")).fundraiserReturnPage(id),
    sendNow: async (id, actor) => (await runner()).sendPledgeEmailNow(id, actor),
    sendAll: async (actor) => (await runner()).sendAllPayLinks(actor),
    markChecked: async (id, actor) => (await db()).markDoublePaidChecked(id, actor),
    captchaEnabled: () => false,
    verifyCaptcha: async (token, ip) => (await import("../clients/turnstile")).verifyCaptcha(token, ip),
    fromOurOwnPage: () => false,
    signedIn: async (req, res) => (await import("./fundraise")).signedIn(req, res),
    listForOrganiser: async (email) => (await import("../db/fundraisers")).listForOrganiser(email),
    ownFundraiser: async (req, res, s) => (await import("./fundraise")).ownFundraiser(req, res, s),
    authorize: async (req, res, level) => (await import("./admin-authz")).authorizeSection(req, res, "fundraising", level),
    authorizeAdmin: async (req, res) => (await import("./admin-authz")).authorizeSectionAsAdmin(req, res, "fundraising"),
    listApprovals: async () => (await import("../db/fundraising-touch")).listWordingApprovals(),
    approve: async (key, actor) => (await import("../db/fundraising-touch")).approveWording(key, actor),
    withdraw: async (key, actor) => (await import("../db/fundraising-touch")).withdrawWording(key, actor),
    touchOn: async () => (await import("../db/fundraising-touch")).touchEmailsOn(),
  };
  return deps;
}

/**
 * The handlers, wired to the real database, Stripe and config on first use. The few things a handler
 * reads without waiting (the signing secret, the site's address, the same origin check, whether the
 * spam check is on) are filled in from their modules before each request.
 */
function wired(page: { template: () => string; decorate: PledgeRouteDeps["decorate"] }) {
  const deps = realDeps(page);
  let ready: Promise<void> | null = null;
  const prepare = (): Promise<void> => {
    ready ??= (async () => {
      const [{ config }, turnstile, fundraise, stripe] = await Promise.all([
        import("../config"),
        import("../clients/turnstile"),
        import("./fundraise"),
        import("../clients/stripe"),
      ]);
      deps.secret = config.ADMIN_SESSION_SECRET;
      deps.baseUrl = config.PORTAL_BASE_URL.replace(/\/+$/, "");
      deps.production = config.NODE_ENV === "production";
      deps.stubEcho = !stripe.stripeConfigured && config.NODE_ENV !== "production";
      deps.captchaEnabled = turnstile.captchaEnabled;
      deps.fromOurOwnPage = fundraise.fromOurOwnPage;
    })();
    return ready;
  };
  const handlers = makePledgeHandlers(deps);
  type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
  const after =
    (h: Handler): Handler =>
    async (req, res, next) => {
      try {
        await prepare();
      } catch (err) {
        ready = null;
        console.error("pledges could not start:", why(err));
        return next();
      }
      return h(req, res, next);
    };
  return Object.fromEntries(Object.entries(handlers).map(([name, h]) => [name, after(h as Handler)])) as Record<keyof typeof handlers, Handler>;
}

// The API: mounted in src/app.ts. It draws no pages, so it needs no template and no menu.
export const pledgesRouter = Router();
{
  const h = wired({ template: () => "", decorate: async (html) => html });
  pledgesRouter.post("/api/fundraisers/:slug/pledges", h.postPledge);
  pledgesRouter.get("/api/fundraise/manage/pledges", h.getOrganiserPledges);
  pledgesRouter.post("/api/fundraise/manage/fundraisers/:id/pledges/:pledgeId/cash", h.postOrganiserCash);
  pledgesRouter.post("/api/fundraise/manage/fundraisers/:id/pledges/:pledgeId/hide", h.postOrganiserHide);
  pledgesRouter.get("/api/admin/fundraising/pledges", h.getAdminPledges);
  pledgesRouter.get("/api/admin/fundraising/pledges/preview/:key", h.getAdminPreview);
  pledgesRouter.post("/api/admin/fundraising/pledges/approvals/:key", h.postApproval);
  pledgesRouter.delete("/api/admin/fundraising/pledges/approvals/:key", h.deleteApproval);
  pledgesRouter.post("/api/admin/fundraising/pledges/send-pay-links", h.postAdminSendAll);
  pledgesRouter.post("/api/admin/pledges/:id/send-pay-link", h.postAdminSend);
  pledgesRouter.post("/api/admin/pledges/:id/cancel", h.postAdminCancel);
  pledgesRouter.post("/api/admin/pledges/:id/message", h.postAdminMessage);
  pledgesRouter.post("/api/admin/pledges/:id/checked", h.postAdminChecked);
}

export interface PledgePageDeps {
  /** Adds the menu items switched on elsewhere (the ball, Get involved). */
  decorate: (html: string, cookieHeader: string | undefined) => Promise<string>;
}

/**
 * The confirm, pay and cancel pages, added to the site router (src/routes/site.ts) before its catch
 * all, so "not here" (fundraising switched off) is the site's own 404 page. Their forms post as plain
 * forms, so each POST reads its own small urlencoded body.
 */
export function addPledgePageRoutes(router: Router, siteRoot: string, page: PledgePageDeps): void {
  const file = join(siteRoot, "pledge.html");
  const h = wired({ template: () => readFileSync(file, "utf8"), decorate: page.decorate });
  const form = express.urlencoded({ extended: false, limit: "8kb" });
  router.get("/pledge/confirm", h.getConfirmPage);
  router.post("/pledge/confirm", form, h.postConfirm);
  router.get("/pledge/pay", h.getPayPage);
  router.post("/pledge/pay", form, h.postPay);
  router.get("/pledge/cancel", h.getCancelPage);
  router.post("/pledge/cancel", form, h.postCancel);
}
