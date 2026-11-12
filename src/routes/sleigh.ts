import { Router } from "express";
import { stripe } from "../clients/stripe";
import { londonDate } from "../ball/sales-report";
import { publicNights, publicSettings, sleighTotals } from "../db/sleigh";
import { SLEIGH_OLD_PATH, SLEIGH_PATH, SLEIGH_THANKS_PATH, roadStop, sleighPhase, type SleighNight, type SleighSettings } from "../sleigh/model";
import { amountFromSession, renderSleighPage, renderSleighThanks } from "../sleigh/page";
import { dressPage } from "../site/chrome";

// The Kilmarnock Santa Sleigh (src/sleigh/page.ts): /sleigh, its thank you, and the long address.
// Mounted before the site router, whose catch all is the 404.
//
// The page reads the nights, the settings and the year's total. A night list or settings read that
// fails leaves the page up with what the code knows (no nights drawn, never switched off by a
// failure); a total that fails leaves the number out (sleighTotals keeps its last good value).

export interface SleighRouterDeps {
  now: () => Date;
  nights: () => Promise<SleighNight[]>;
  settings: () => Promise<SleighSettings>;
  total: () => Promise<number | null>;
  session: (id: string) => Promise<{ payment_status?: string | null; amount_total?: number | null; metadata?: Record<string, string> | null } | null>;
  /** What every page gains in the site's menu and footer as it goes out (src/routes/site.ts). */
  decorate: (html: string, cookieHeader: string | undefined) => Promise<string>;
}

const FALLBACK_SETTINGS: SleighSettings = { seasonFrom: "2026-11-01", offOn: "2027-01-31" };

const defaults: SleighRouterDeps = {
  now: () => new Date(),
  // Cached a minute and never a long wait (src/db/sleigh.ts): a QR scan never waits on the database.
  nights: publicNights,
  settings: publicSettings,
  total: async () => (await sleighTotals())?.totalPence ?? null,
  session: async (id) => (await stripe.checkout.sessions.retrieve(id)) as never,
  decorate: async (html, cookieHeader) => (await import("./site")).decorateSitePage(html, cookieHeader),
};

// The menu's extras are read from the database, and a slow read never holds a QR scan up: after 1.5s,
// or on any failure, the page goes out with the site's menu and footer as they are (src/site/chrome.ts).
const dressed = (d: SleighRouterDeps, html: string, cookieHeader: string | undefined): Promise<string> => dressPage(html, cookieHeader, d.decorate);

// A Checkout Session id as Stripe writes it ("cs_test_..." or "cs_live_...").
const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]{1,250}$/;

export function createSleighRouter(overrides: Partial<SleighRouterDeps> = {}): Router {
  const d: SleighRouterDeps = { ...defaults, ...overrides };
  const router = Router();

  // The query string goes along, so a QR code's tags still reach the page.
  router.get(SLEIGH_OLD_PATH, (req, res) => {
    const q = req.originalUrl.indexOf("?");
    res.redirect(301, q === -1 ? SLEIGH_PATH : `${SLEIGH_PATH}${req.originalUrl.slice(q)}`);
  });

  router.get(SLEIGH_PATH, async (req, res) => {
    const [nights, settings, total] = await Promise.all([
      d.nights().catch((err) => {
        console.error("sleigh page: could not read the nights:", err instanceof Error ? err.message : err);
        return [] as SleighNight[];
      }),
      d.settings().catch(() => FALLBACK_SETTINGS),
      d.total().catch(() => null),
    ]);
    const today = londonDate(d.now());
    const phase = sleighPhase(today, nights, settings.offOn);
    // ?at=after shows the thank you state before the last night, for staff to look at. One view
    // only, never cached, never for search engines.
    const preview = req.query.at === "after";
    if (phase === "off" && !preview) {
      res.redirect(302, "/");
      return;
    }
    const shown = preview ? "after" : phase === "off" ? "after" : phase;
    const stop = shown === "after" ? nights.length : roadStop(today, nights);
    if (preview) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Cache-Control", "private, no-store");
    } else {
      res.setHeader("Cache-Control", "public, max-age=0");
    }
    res.type("html").send(await dressed(d, renderSleighPage({ nights, phase: shown, stop, totalPence: total }), req.headers.cookie));
  });

  router.get(SLEIGH_THANKS_PATH, async (req, res) => {
    // Whatever goes wrong (no id, Stripe out of reach, a session that is not ours) the giver still
    // gets a thank you, a plain one.
    let amount: number | null = null;
    const sessionId = req.query.session_id;
    if (typeof sessionId === "string" && CHECKOUT_SESSION_ID.test(sessionId)) {
      try {
        amount = amountFromSession(await d.session(sessionId));
      } catch (err) {
        console.error("sleigh thank you: could not read the session:", err instanceof Error ? err.message : err);
      }
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.type("html").send(await dressed(d, renderSleighThanks(amount), req.headers.cookie));
  });

  return router;
}
