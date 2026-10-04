import type { NextFunction, Request, Response, Router } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderRedBagPage } from "../red-bag/render";
import { isStaffRequest } from "../red-bag/staff";
import { RED_BAG_PATH, redBagAccess, redBagIsLive } from "../red-bag/switch";

// Fill a Red Bag: the page, /fill-a-red-bag (docs/superpowers/specs/2026-10-04-fill-a-red-bag-design.md).
//
//   GET /fill-a-red-bag    switched ON (src/red-bag/switch.ts, as it is now): the page, for
//                          everyone. Public but unlisted for now, so it still answers noindex.
//                          switched OFF (one line there takes it down again):
//                            - the public: the site's own 404 page, with a real 404 status;
//                            - a signed in member of staff: the page, under a plain strip saying
//                              "Staff preview: not public yet". Never kept by a browser or a cache.
//
//   GET /fill, /fill-a-bag  the short ways people type it (Jaimie, 4 October 2026). Switched ON:
//                          301 to /fill-a-red-bag, for good, keeping the query string (Express
//                          matches them in any case, with or without a trailing slash, and only
//                          exactly: /fill does not take /fill-a-red-bag or anything else).
//                          Switched OFF: handed on to the site's own 404, as if they were not here.
//                          A forward would say there is a page there; no preview loader either.
//                          Fixed in code like /getinvolved and /involved (TASK-496): not rows in the
//                          spare address table, on no site map, linked from nowhere.
//
// How staff are recognised. The admin keeps its session as a bearer token in the tab's
// sessionStorage, not in a cookie, so an ordinary visit to this address never carries it: every
// plain visit while switched off is the 404, staff included. The 404 served HERE (and only here)
// carries one extra small script, assets/js/red-bag-preview.js: if the tab holds an admin session it
// asks for this same address again WITH the token, and shows the page that comes back. So a member
// of staff signs in at /admin, then goes to /fill-a-red-bag in the same tab. Without a session the
// script does nothing, and the public sees the ordinary 404.
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
  /** fill-a-red-bag.html. */
  template: () => string;
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
    const html = await deps.decorate(renderRedBagPage(deps.template(), { preview: access === "preview" }), req.headers.cookie);

    if (access === "preview") {
      // Never let a shared cache hand a preview to the public.
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Vary", "Authorization");
    }
    // Never indexed: switched off because it is not public, and switched on because the page is
    // public but UNLISTED for now. The page's own robots line says the same. Both come out when the
    // page is listed (the last step left in src/red-bag/switch.ts).
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.type("html").send(html);
  }
}

/** The short addresses that forward to the page. Reserved in src/site/pages.ts (RESERVED_PREFIXES). */
export const RED_BAG_FORWARDS = ["/fill", "/fill-a-bag"];

/** /fill and /fill-a-bag: a permanent redirect to the page while it is public; otherwise not here. */
export function redBagForwardHandler(live: () => boolean = redBagIsLive) {
  return function forwardToRedBag(req: Request, res: Response, next: NextFunction): void {
    if (!live()) return next();
    const at = req.originalUrl.indexOf("?");
    res.redirect(301, `${RED_BAG_PATH}${at === -1 ? "" : req.originalUrl.slice(at)}`);
  };
}

export function addRedBagPageRoutes(router: Router, siteRoot: string, page: Pick<RedBagPageDeps, "decorate" | "live">): void {
  const file = join(siteRoot, "fill-a-red-bag.html");
  const notFoundFile = join(siteRoot, "404.html");
  router.get(RED_BAG_FORWARDS, redBagForwardHandler(page.live));
  router.get(
    RED_BAG_PATH,
    redBagPageHandler({
      template: () => readFileSync(file, "utf8"),
      notFound: () => readFileSync(notFoundFile, "utf8"),
      decorate: page.decorate,
      ...(page.live ? { live: page.live } : {}),
    }),
  );
}
