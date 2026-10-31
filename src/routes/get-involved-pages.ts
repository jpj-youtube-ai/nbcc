import type { Router } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVENTS_NAV_ITEM } from "../events/nav-link";
import { addFillToDropOff } from "../red-bag/fill-links";
import { markAfterBallCheck } from "../site/after-ball";
import { SHORT_PAGES } from "../site/pages";

// The short pages under /get-involved/: Drop-off points, Referrals, Volunteer, Your business, Your
// school, Your club or group. Each is a plain page, get-involved-<name>.html, with the menu items of
// the day added as it goes out. The events switch does not govern them: they are about helping NBCC,
// not about events, so with it off they stay and only the menu's Get involved and What's on go.
//
// They live here and not at /volunteer and /referrals because those two are live forwards to the
// volunteer and referral sites, in the spare address table. A page there would silently replace them.

export interface ShortPageDeps {
  /**
   * Adds the menu items switched on elsewhere (the ball, Get involved, What's on). Given a query, it
   * answers for that view of the page (src/site/after-ball.ts).
   */
  decorate: (html: string, cookieHeader: string | undefined, query?: unknown) => Promise<string>;
  /** Is this view after the Ball's moment? Left out: no. */
  isAfterBall?: (query?: unknown) => boolean;
}

/** The one short page the spec names for checking the moment: the others take no ?at=after-ball. */
const DROP_OFF_PATH = "/get-involved/drop-off-points";

// In the Get involved section, though not on the page itself, so "true" and not "page".
const IN_SECTION = '<li><a href="/get-involved" class="active" aria-current="true">Get involved</a></li>';

/** Light up Get involved in the menu, when the events switch has put it there. */
function markSection(html: string): string {
  return html.replace(EVENTS_NAV_ITEM, IN_SECTION);
}

export function addShortPageRoutes(router: Router, siteRoot: string, deps: ShortPageDeps): void {
  for (const { path } of SHORT_PAGES) {
    const file = join(siteRoot, `get-involved-${path.slice("/get-involved/".length)}.html`);
    router.get(path, async (req, res, next) => {
      try {
        const query = path === DROP_OFF_PATH ? req.query : undefined;
        const source = readFileSync(file, "utf8");
        const page = path === DROP_OFF_PATH && deps.isAfterBall?.(query) ? addFillToDropOff(source) : source;
        // The menu items depend on the database, and the page does not: it goes out without them
        // rather than not at all, as the plain pages do.
        const html = await deps.decorate(page, req.headers.cookie, query).then(markSection, (err: unknown) => {
          console.error("short page menu failed:", err instanceof Error ? err.message : err);
          return page;
        });
        res.setHeader("Cache-Control", "public, max-age=0");
        markAfterBallCheck(res, query);
        res.type("html").send(html);
      } catch (err) {
        console.error("short page failed:", err instanceof Error ? err.message : err);
        next();
      }
    });
  }
}
