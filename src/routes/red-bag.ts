import type { NextFunction, Request, Response, Router } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderRedBagPage, renderRedBagThanksPage } from "../red-bag/render";
import { isStaffRequest } from "../red-bag/staff";
import { RED_BAG_PATH, RED_BAG_THANKS_PATH, redBagAccess, redBagIsLive } from "../red-bag/switch";

// Fill a Red Bag: its pages (docs/superpowers/specs/2026-10-04-fill-a-red-bag-design.md).
//
//   GET /fill              the giving page. Switched ON (src/red-bag/switch.ts, as it is now): the
//                          page, for everyone, and search engines may list it (no noindex).
//                          Switched OFF (one line there takes it down again):
//                            - the public: the site's own 404 page, with a real 404 status;
//                            - a signed in member of staff: the page, under a plain strip saying
//                              "Staff preview: not public yet". Never kept by a browser or a cache,
//                              and never indexed.
//   GET /fill/thank-you    where a donor lands after paying (Stripe's return address, built in
//                          src/routes/api.ts). The same rules, except that it is NEVER indexed.
//   GET /fill-a-red-bag,   the address the page first had, and the other way people type it.
//       /fill-a-bag        Switched ON: 301 to /fill, for good, keeping the query string (Express
//                          matches them in any case, with or without a trailing slash, and only
//                          exactly). An old return from paying, ?thanks=1, goes to /fill/thank-you
//                          instead, so that donor still lands on a thank you.
//                          Switched OFF: handed on to the site's own 404, as if they were not here.
//                          Fixed in code like /getinvolved and /involved (TASK-496): not rows in the
//                          spare address table.
//
// How staff are recognised. The admin keeps its session as a bearer token in the tab's
// sessionStorage, not in a cookie, so an ordinary visit to this address never carries it: every
// plain visit while switched off is the 404, staff included. The 404 served at these two pages (and only there)
// carries one extra small script, assets/js/red-bag-preview.js: if the tab holds an admin session it
// asks for this same address again WITH the token, and shows the page that comes back. So a member
// of staff signs in at /admin, then goes to /fill-a-red-bag in the same tab. Without a session the
// script does nothing, and the public sees the ordinary 404. (The script asks for whichever address
// it is on, so it serves /fill and /fill/thank-you alike.)
//
// Added to the site router (src/routes/site.ts) before its catch-all. No database of its own: the
// list comes from the catalogue file, and the staff check reads one row only when a token is sent.
//
// Nothing here may hang or crash a request (Express 4 does not catch what an async handler throws).
// If the page's file, the 404's file or the catalogue cannot be read, or the menu cannot be added,
// it is logged and the request is handed on (next) to that same catch-all: the site's own 404.

/** The one line added to the 404 page served at this address while switched off. */
export const PREVIEW_LOADER = '<script defer src="/assets/js/red-bag-preview.js"></script>\n';

export interface RedBagPageDeps {
  /** The page's file: fill-a-red-bag.html, or fill-thank-you.html. */
  template: () => string;
  /** Draws the page from its file. Defaults to the giving page (renderRedBagPage). */
  render?: (template: string, opts: { preview: boolean }) => string;
  /**
   * May search engines list this page when it is public? True for the giving page only. A page
   * that is not (the thank you), a staff preview and the 404 all answer noindex.
   */
  indexable?: boolean;
  /** 404.html. */
  notFound: () => string;
  /** Adds the menu items switched on elsewhere (the ball, Get involved). */
  decorate: (html: string, cookieHeader: string | undefined) => Promise<string>;
  /** The switch. Defaults to the constant in src/red-bag/switch.ts. */
  live?: () => boolean;
  /** Is this Authorization header a signed in member of staff? Defaults to the admin's own session. */
  isStaff?: (authorization: string | undefined) => Promise<boolean>;
}

export function redBagPageHandler(deps: RedBagPageDeps) {
  const live = deps.live ?? redBagIsLive;
  const isStaff = deps.isStaff ?? isStaffRequest;
  const render = deps.render ?? renderRedBagPage;

  return async function getRedBagPage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await answer(req, res);
    } catch (err) {
      console.error("fill a red bag page failed:", err instanceof Error ? err.message : err);
      next();
    }
  };

  async function answer(req: Request, res: Response): Promise<void> {
    const on = live();
    let staff = false;
    if (!on) {
      try {
        staff = await isStaff(req.headers.authorization);
      } catch {
        staff = false; // cannot tell: closed
      }
    }
    const access = redBagAccess(on, staff);

    if (access === "closed") {
      // Exactly the catch-all's 404 (src/routes/site.ts), plus the staff preview's loader. Read
      // BEFORE anything is set on the response, so a failure hands on a clean one.
      const page = deps.notFound().replace("</head>", `${PREVIEW_LOADER}</head>`);
      res.status(404);
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Cache-Control", "no-store");
      res.type("html").send(page);
      return;
    }

    // Drawn BEFORE anything is set on the response, for the same reason.
    const html = await deps.decorate(render(deps.template(), { preview: access === "preview" }), req.headers.cookie);

    if (access === "preview") {
      // Never let a shared cache hand a preview to the public.
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Vary", "Authorization");
    }
    // Public, the giving page may be listed by search engines: no header (and no robots line in
    // its file). A staff preview is never indexed, and neither is a page not meant for listing
    // (the thank you), whose file says the same.
    if (access === "preview" || deps.indexable !== true) res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.type("html").send(html);
  }
}

/**
 * The addresses that forward to the page: the one it first had, and the other way people type it.
 * Reserved in src/site/pages.ts (RESERVED_PREFIXES).
 */
export const RED_BAG_FORWARDS = ["/fill-a-red-bag", "/fill-a-bag"];

/**
 * A permanent redirect to /fill while it is public, keeping the query string; otherwise not here.
 * The old page said thank you at ?thanks=1, so a donor coming back to that address from paying is
 * sent to the thank you page instead.
 */
export function redBagForwardHandler(live: () => boolean = redBagIsLive) {
  return function forwardToRedBag(req: Request, res: Response, next: NextFunction): void {
    if (!live()) return next();
    const at = req.originalUrl.indexOf("?");
    const to = req.query.thanks === "1" ? RED_BAG_THANKS_PATH : RED_BAG_PATH;
    res.redirect(301, `${to}${at === -1 ? "" : req.originalUrl.slice(at)}`);
  };
}

export function addRedBagPageRoutes(router: Router, siteRoot: string, page: Pick<RedBagPageDeps, "decorate" | "live" | "isStaff">): void {
  const file = join(siteRoot, "fill-a-red-bag.html");
  const thanksFile = join(siteRoot, "fill-thank-you.html");
  const notFoundFile = join(siteRoot, "404.html");
  const shared = {
    notFound: () => readFileSync(notFoundFile, "utf8"),
    decorate: page.decorate,
    ...(page.live ? { live: page.live } : {}),
    ...(page.isStaff ? { isStaff: page.isStaff } : {}),
  };
  router.get(RED_BAG_FORWARDS, redBagForwardHandler(page.live));
  router.get(RED_BAG_PATH, redBagPageHandler({ ...shared, template: () => readFileSync(file, "utf8"), indexable: true }));
  router.get(
    RED_BAG_THANKS_PATH,
    redBagPageHandler({ ...shared, template: () => readFileSync(thanksFile, "utf8"), render: renderRedBagThanksPage, indexable: false }),
  );
}
