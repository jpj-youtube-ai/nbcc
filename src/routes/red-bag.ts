import type { Request, Response, Router } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderRedBagPage } from "../red-bag/render";
import { isStaffRequest } from "../red-bag/staff";
import { RED_BAG_PATH, redBagAccess, redBagIsLive } from "../red-bag/switch";

// Fill a Red Bag: the page, /fill-a-red-bag (docs/superpowers/specs/2026-10-04-fill-a-red-bag-design.md).
//
//   GET /fill-a-red-bag    switched ON: the page, for everyone.
//                          switched OFF (src/red-bag/switch.ts, as it ships):
//                            - the public: the site's own 404 page, with a real 404 status;
//                            - a signed in member of staff: the page, under a plain strip saying
//                              "Staff preview: not public yet". Never kept by a browser or a cache.
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

  return async function getRedBagPage(req: Request, res: Response): Promise<void> {
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
      // Exactly the catch-all's 404 (src/routes/site.ts), plus the staff preview's loader.
      res.status(404);
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Cache-Control", "no-store");
      res.type("html").send(deps.notFound().replace("</head>", `${PREVIEW_LOADER}</head>`));
      return;
    }

    if (access === "preview") {
      // Never let a shared cache hand a preview to the public.
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Vary", "Authorization");
    }
    // Switched off, nothing here is ever indexed. (Switched on, the page's own robots line decides:
    // it comes out when the page is listed, the last go live step in src/red-bag/switch.ts.)
    if (!on) res.setHeader("X-Robots-Tag", "noindex, nofollow");
    const html = renderRedBagPage(deps.template(), { preview: access === "preview" });
    res.type("html").send(await deps.decorate(html, req.headers.cookie));
  };
}

export function addRedBagPageRoutes(router: Router, siteRoot: string, page: Pick<RedBagPageDeps, "decorate">): void {
  const file = join(siteRoot, "fill-a-red-bag.html");
  const notFoundFile = join(siteRoot, "404.html");
  router.get(
    RED_BAG_PATH,
    redBagPageHandler({
      template: () => readFileSync(file, "utf8"),
      notFound: () => readFileSync(notFoundFile, "utf8"),
      decorate: page.decorate,
    }),
  );
}
