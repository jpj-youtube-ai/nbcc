import type { Request, Response, NextFunction, Router } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// TASK-494: the public pages of community fundraising, and Get involved (the Events page, renamed).
//
//   GET /events                    301 to /get-involved, query string kept (old links, newsletters)
//   GET /getinvolved, /involved    301 to /get-involved too, the ways people type it from a poster
//   GET /get-involved              NBCC's events, plus fundraisers while fundraising is switched on
//   GET /fundraise                 the sign up form, or "not open yet" while switched off
//   GET /fundraise/manage          change your page, by the emailed link (?token=); never indexed
//   GET /fundraise/help            ideas, paying in, Gift Aid and staying safe (TASK-498); indexed
//   GET /fundraise/:slug/qr.svg    the page's QR code, to download
//   GET /fundraise/:slug           one fundraiser's page
//
// Added to the site router (src/routes/site.ts) before its catch-all, so "not here" is the site's own
// 404 page: anything that is not an approved, public, raising money fundraiser while fundraising is
// switched on simply falls through to it. The database modules are imported lazily, like the rest of
// the site router, so it stays import safe for tests that never touch a database; and every failure
// falls through too, so a broken read shows the 404 rather than a broken page.

export interface FundraisePageDeps {
  /** Adds the menu items switched on elsewhere (the ball, Get involved). */
  decorate: (html: string, cookieHeader: string | undefined) => Promise<string>;
  eventsPageIsOn: () => Promise<boolean>;
}

async function fundraisingOn(): Promise<boolean> {
  try {
    return await (await import("../db/fundraisers")).fundraisingIsOn();
  } catch {
    return false;
  }
}

// A page that changes as soon as staff act: revalidate on every view (TASK-341's reasoning).
function fresh(res: Response): void {
  res.setHeader("Cache-Control", "public, max-age=0");
}

/** The fundraiser behind /fundraise/:slug, only if it has a public page right now. */
async function publicFundraiser(slug: string) {
  if (!(await fundraisingOn())) return null;
  const [{ getBySlug }, { hasPage }] = await Promise.all([import("../db/fundraisers"), import("../fundraising/model")]);
  const f = await getBySlug(slug);
  return f && hasPage(f) ? f : null;
}

export function addFundraisePageRoutes(router: Router, siteRoot: string, deps: FundraisePageDeps): void {
  const getInvolvedFile = join(siteRoot, "events.html");
  const signUpFile = join(siteRoot, "fundraise.html");
  const manageFile = join(siteRoot, "fundraise-manage.html");
  const pageFile = join(siteRoot, "fundraiser.html");
  const helpFile = join(siteRoot, "fundraise-help.html");

  // The page was /events until TASK-494. Links in old newsletters and on Facebook still point there,
  // so it is a permanent redirect whether or not the page is on (switched off, /get-involved is the
  // 404 the old address would have been). The query string goes too: newsletter links carry their
  // utm tags on it.
  // Said aloud, on a poster or on the radio, people type it without the dash, or just "involved", so
  // those go there too (Express matches them in any case and with or without a trailing slash).
  router.get(["/events", "/getinvolved", "/involved"], (req, res) => {
    const at = req.originalUrl.indexOf("?");
    res.redirect(301, `/get-involved${at === -1 ? "" : req.originalUrl.slice(at)}`);
  });

  router.get("/get-involved", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!(await deps.eventsPageIsOn())) return next();
      const [{ listPageEvents }, { londonToday }, { renderGetInvolvedPage }] = await Promise.all([
        import("../db/events"),
        import("../events/model"),
        import("../fundraising/render"),
      ]);
      const today = londonToday(new Date());
      const on = await fundraisingOn();
      let fundraisers: import("../fundraising/model").PublicCard[] = [];
      if (on) {
        // A failed fundraiser read must not take NBCC's own events down with it: the page goes out
        // without the fundraisers rather than not at all.
        try {
          const [{ listApprovedPublic }, { isListed, publicCard }] = await Promise.all([
            import("../db/fundraisers"),
            import("../fundraising/model"),
          ]);
          fundraisers = (await listApprovedPublic()).filter((f) => isListed(f, today)).map((f) => publicCard(f, f.meter));
        } catch (err) {
          console.error("get involved fundraisers failed:", err instanceof Error ? err.message : err);
        }
      }
      const events = await listPageEvents(today);
      const html = renderGetInvolvedPage(readFileSync(getInvolvedFile, "utf8"), {
        events,
        fundraisers,
        fundraisingOn: on,
        today,
      });
      fresh(res);
      res.type("html").send(await deps.decorate(html, req.headers.cookie));
    } catch (err) {
      console.error("get involved page failed:", err instanceof Error ? err.message : err);
      next();
    }
  });

  router.get("/fundraise", async (req, res, next) => {
    try {
      const { renderFundraiseSignUp } = await import("../fundraising/render");
      const html = renderFundraiseSignUp(readFileSync(signUpFile, "utf8"), await fundraisingOn());
      fresh(res);
      res.type("html").send(await deps.decorate(html, req.headers.cookie));
    } catch (err) {
      console.error("fundraise page failed:", err instanceof Error ? err.message : err);
      next();
    }
  });

  // Registered before /fundraise/:slug, so "manage" is never read as a fundraiser (the core also
  // refuses it as a slug). The token rides in the address, so: never indexed, never cached, and
  // never handed to another website as a referrer when the organiser follows a link from here.
  // A 404 while fundraising is switched off, like every other fundraising page.
  router.get("/fundraise/manage", async (req, res, next) => {
    try {
      if (!(await fundraisingOn())) return next();
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Cache-Control", "no-store");
      res.type("html").send(await deps.decorate(readFileSync(manageFile, "utf8"), req.headers.cookie));
    } catch (err) {
      console.error("fundraise manage page failed:", err instanceof Error ? err.message : err);
      next();
    }
  });

  // TASK-498: the help page. Also before /fundraise/:slug, so "help" is never read as a fundraiser
  // (the core refuses it as a slug too). Indexed like the sign up, but only there while fundraising
  // is switched on: switched off it is the site's 404, so the words can merge before sign off.
  router.get("/fundraise/help", async (req, res, next) => {
    try {
      if (!(await fundraisingOn())) return next();
      fresh(res);
      res.type("html").send(await deps.decorate(readFileSync(helpFile, "utf8"), req.headers.cookie));
    } catch (err) {
      console.error("fundraise help page failed:", err instanceof Error ? err.message : err);
      next();
    }
  });

  router.get("/fundraise/:slug/qr.svg", async (req, res, next) => {
    try {
      const f = await publicFundraiser(String(req.params.slug));
      if (!f) return next();
      const [{ qrSvg }, { fundraiserPageUrl }] = await Promise.all([import("../fundraising/qr"), import("../fundraising/send")]);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `inline; filename="nbcc-${f.slug}-qr-code.svg"`);
      fresh(res);
      res.type("image/svg+xml").send(qrSvg(fundraiserPageUrl(f.slug), { title: `QR code for ${f.title}`, size: 1024 }));
    } catch (err) {
      console.error("fundraiser qr failed:", err instanceof Error ? err.message : err);
      next();
    }
  });

  router.get("/fundraise/:slug", async (req, res, next) => {
    try {
      const f = await publicFundraiser(String(req.params.slug));
      if (!f) return next();
      const [{ wallRows }, { publicPage, wallEntries }, { renderFundraiserPage }, { fundraiserPageUrl }] = await Promise.all([
        import("../db/fundraisers"),
        import("../fundraising/model"),
        import("../fundraising/render"),
        import("../fundraising/send"),
      ]);
      const page = publicPage(f, f.meter, wallEntries(await wallRows(f.id)));
      // ?thanks=1 is where the server sends a giver back to after paying (src/routes/api.ts): a thank
      // you at the top. Anyone can add it to the address, and all it shows is a thank you.
      const thanks = req.query.thanks === "1" ? { message: req.query.message === "1" } : undefined;
      const html = renderFundraiserPage(readFileSync(pageFile, "utf8"), page, {
        pageUrl: fundraiserPageUrl(f.slug),
        now: new Date(),
        thanks,
      });
      fresh(res);
      res.type("html").send(await deps.decorate(html, req.headers.cookie));
    } catch (err) {
      console.error("fundraiser page failed:", err instanceof Error ? err.message : err);
      next();
    }
  });
}
