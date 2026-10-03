import type { Request, Response, NextFunction, Router } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVENT_PAGE_PREFIX, pagePath, type FundraiserRecord } from "../fundraising/model";

// TASK-494: the public pages of community fundraising, and Get involved (the Events page, renamed).
//
//   GET /events                    301 to /get-involved, query string kept (old links, newsletters)
//   GET /getinvolved, /involved    301 to /get-involved too, the ways people type it from a poster
//   GET /get-involved              NBCC's events, plus fundraisers while fundraising is switched on
//   GET /fundraise                 the sign up form, or "not open yet" while switched off; its
//                                  categories drawn from the database's list, A to Z
//   GET /fundraise/manage          change your page, by the emailed link (?token=); never indexed
//   GET /fundraise/help            ideas, paying in, Gift Aid and staying safe (TASK-498); indexed
//   GET /fundraise/logos           the logo pack: the official logos and simple rules (TASK-504)
//   GET /fundraise/sponsor-form    a blank sponsor form to print, with HMRC's Gift Aid columns (TASK-504)
//   GET /fundraise/:slug/qr.svg    the page's QR code, to download
//   GET /fundraise/:slug/qr.png    the same code as a print size PNG, about 2000px square (TASK-504)
//   GET /fundraise/<old>[/qr.svg|/qr.png]  TASK-511: an address the page used to have, before staff
//                                  changed it: a 301 to its address now, query string kept, so a QR
//                                  code printed with the old link never breaks
//   GET /fundraise/:slug           one fundraiser's page (TASK-502: a finished one keeps it, saying
//                                  so, and still takes gifts; ?thanks=1&session_id= is the thank you
//                                  after paying, with the optional step to add to the wall;
//                                  TASK-506: its countdown, and the news staff approved)
//   GET /event/:slug[/qr.svg|/qr.png]  Event pages: an approved public event's own page, by the same
//                                  code, and its QR codes. Each prefix answers only for its own kind:
//                                  /fundraise/<x> for an event, or /event/<x> for a fundraiser, is a
//                                  302 on to its own address (never kept: review fix), so a staff
//                                  change of kind, or a link typed the wrong way, never breaks. The
//                                  slug is one column, unique across both, so the two never clash.
//
// Added to the site router (src/routes/site.ts) before its catch-all, so "not here" is the site's own
// 404 page: anything that is not a public, raising money fundraiser, approved or finished, while
// fundraising is switched on simply falls through to it. The database modules are imported lazily, like the rest of
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

// TASK-504 review: a QR code depends only on the address it carries, so a browser may keep it for a
// day, and the server draws each one once (src/fundraising/qr-cache.ts).
function keepADay(res: Response): void {
  res.setHeader("Cache-Control", "public, max-age=86400");
}

/** The fundraiser or event with this address, only if it has a public page right now (either kind). */
async function publicFundraiser(slug: string) {
  if (!(await fundraisingOn())) return null;
  const [{ getBySlug }, { hasPage }] = await Promise.all([import("../db/fundraisers"), import("../fundraising/model")]);
  const f = await getBySlug(slug);
  return f && hasPage(f) ? f : null;
}

/**
 * TASK-511: the path now of the page that used to be at <slug>, if it still has a page (staff
 * changed its address, and the old one is kept in fundraiser_slug_history). Null otherwise, and on
 * any failure, so the caller falls through to the site's 404. Only asked once no page has that
 * address now: a page with it always answers first. Event pages: the path is the page's own kind's,
 * /event/<x> or /fundraise/<x> (pagePath).
 */
async function movedTo(slug: string): Promise<string | null> {
  try {
    const { currentSlugFor } = await import("../db/fundraiser-slugs");
    const now = await currentSlugFor(slug);
    const f = now && now !== slug ? await publicFundraiser(now) : null;
    return f ? pagePath(f) : null;
  } catch (err) {
    console.error("fundraiser old address lookup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * What gifts could do, for this page: the shared examples (src/impact/examples.ts), or none for a
 * page in memory of someone (showsImpact). Never fails the page: on any failure, no examples.
 */
async function impactFor(f: Pick<FundraiserRecord, "kind"> & { inMemory?: boolean | null }) {
  try {
    const [{ showsImpact }, { loadImpactExamples }] = await Promise.all([import("../fundraising/impact-render"), import("../db/impact-examples")]);
    return showsImpact(f) ? await loadImpactExamples() : undefined;
  } catch (err) {
    console.error("impact examples for a page failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

/**
 * Event pages: what <prefix>/<slug> is for this kind of page. The page, when one of this kind has the
 * address; the path to send them on to, when the other kind has it (the slug is unique across both,
 * so there is only ever one) or when a page used to have it (movedTo); null for the site's 404.
 */
async function lookUp(
  slug: string,
  kind: "raising" | "event",
): Promise<{ page: NonNullable<Awaited<ReturnType<typeof publicFundraiser>>> } | { to: string; otherKind: boolean } | null> {
  const f = await publicFundraiser(slug);
  if (f) return f.path === kind ? { page: f } : { to: pagePath(f), otherKind: true };
  const to = await movedTo(slug);
  return to ? { to, otherKind: false } : null;
}

/**
 * Send them on from lookUp. An old address is for good (movedOn). The other kind's page is only for
 * now (review fix): staff may change an event's kind and change it back, and a redirect a browser
 * kept would then go round in a circle; and the address may carry a giver's thank you
 * (?thanks=1&session_id=), which must never be kept anywhere. So: a 302, never kept.
 */
function sendOn(res: Response, found: { to: string; otherKind: boolean }, to: string): void {
  if (!found.otherKind) return movedOn(res, to);
  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, to);
}

/**
 * A 301 from an old address to the page's address now. Kept by a browser for an hour only (review
 * fix): a 301 with no caching rule is kept for good, so if staff changed a link and later changed
 * it back, someone who scanned in between would go round in a circle.
 */
function movedOn(res: Response, to: string): void {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.redirect(301, to);
}

/** The query string of the request, as it came ("?utm_source=poster"), or nothing. */
function queryOf(req: Request): string {
  const at = req.originalUrl.indexOf("?");
  return at === -1 ? "" : req.originalUrl.slice(at);
}

/**
 * TASK-502: the thank you after paying. With Stripe's checkout session id (?session_id=, which Stripe
 * fills in on the way back), it offers the optional step to add to the wall, unless the gift that
 * session paid for already cannot take one (wallStepVerdict): another fundraiser's, paid in, failed,
 * or added to already. Not recorded yet is fine: the webhook may be a moment behind, and the step
 * asks again when it is sent. Missing, not Stripe's, or unreadable: the plain thank you. A gift that
 * left a message on the give form (?message=1, a page opened before TASK-502) has had its say.
 * ?added=1 is the thank you once they have added to the wall.
 */
async function thanksFor(
  query: Request["query"],
  fundraiserId: number,
): Promise<{ message: boolean; sessionId: string | null; added: boolean }> {
  const message = query.message === "1";
  const added = query.added === "1";
  const id = query.session_id;
  const base = { message, sessionId: null, added };
  try {
    const { isCheckoutSessionId, wallStepVerdict } = await import("../fundraising/model");
    if (message || added || !isCheckoutSessionId(id)) return base;
    const { giftForSession } = await import("../db/fundraisers");
    const verdict = wallStepVerdict(await giftForSession(id), fundraiserId);
    return verdict === "ok" || verdict === "not_recorded" ? { ...base, sessionId: id } : base;
  } catch (err) {
    console.error("fundraiser thank you gift read failed:", err instanceof Error ? err.message : err);
    return base;
  }
}

/**
 * TASK-506: the news updates staff approved, newest first. Only a part of the page: if they cannot
 * be read, the page goes out without them rather than not at all.
 */
async function newsFor(fundraiserId: number): Promise<import("../fundraising/news").NewsEntry[]> {
  try {
    const [{ approvedForPage }, { publicNews }] = await Promise.all([import("../db/fundraiser-updates"), import("../fundraising/news")]);
    return publicNews(await approvedForPage(fundraiserId));
  } catch (err) {
    console.error("fundraiser page news failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

export function addFundraisePageRoutes(router: Router, siteRoot: string, deps: FundraisePageDeps): void {
  const getInvolvedFile = join(siteRoot, "events.html");
  const signUpFile = join(siteRoot, "fundraise.html");
  const manageFile = join(siteRoot, "fundraise-manage.html");
  const pageFile = join(siteRoot, "fundraiser.html");
  const helpFile = join(siteRoot, "fundraise-help.html");
  const logosFile = join(siteRoot, "fundraise-logos.html");

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
          // Team pages: a team once, with its combined meter; its member pages are on the team page.
          const [{ listApprovedPublic }, { isListed, publicCard }, { teamsOnGetInvolved }] = await Promise.all([
            import("../db/fundraisers"),
            import("../fundraising/model"),
            import("./team-pages"),
          ]);
          fundraisers = (await teamsOnGetInvolved(await listApprovedPublic())).filter((f) => isListed(f, today)).map((f) => publicCard(f, f.meter));
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
      const [{ renderFundraiseSignUp }, { loadCategories }, { formCategories }] = await Promise.all([
        import("../fundraising/render"),
        import("../db/fundraising-categories"),
        import("../fundraising/categories"),
      ]);
      // The categories on offer, A to Z, Other last, as the database has them (kept for a
      // minute; the starting list if it cannot be read).
      const categories = formCategories(await loadCategories());
      const html = renderFundraiseSignUp(readFileSync(signUpFile, "utf8"), await fundraisingOn(), categories);
      fresh(res);
      // TASK-503: opened from a staff invite, its token in the address until the page's script takes
      // it out. Until then: never kept by a browser or anything in between, never indexed, and only
      // ever our origin as a referrer, never the address with its token, to anyone, our own pages
      // included (same-origin would still send it in full to ours). Only the origin keeps the spam
      // check, which may look at it, working. A plain visit to the form is unchanged.
      // TASK-515: likewise for a Do it again link from the year on email (?again=).
      if (req.query.invite !== undefined || req.query.again !== undefined) {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Referrer-Policy", "strict-origin");
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
      }
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

  // TASK-504: the logo pack, public like the help page and only while fundraising is on. Before
  // /fundraise/:slug, and "logos" is a reserved slug too.
  router.get("/fundraise/logos", async (req, res, next) => {
    try {
      if (!(await fundraisingOn())) return next();
      fresh(res);
      res.type("html").send(await deps.decorate(readFileSync(logosFile, "utf8"), req.headers.cookie));
    } catch (err) {
      console.error("fundraise logos page failed:", err instanceof Error ? err.message : err);
      next();
    }
  });

  // TASK-504: a blank sponsor form, the same print page an organiser gets from their private area
  // but with no fundraiser on it, for anyone (linked from the help page). Nobody's details, so it
  // may be kept like any page; it is a print page, so it is not indexed.
  router.get("/fundraise/sponsor-form", async (_req, res, next) => {
    try {
      if (!(await fundraisingOn())) return next();
      const { materialAssets, renderSponsorForm } = await import("../fundraising/materials");
      fresh(res);
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.type("html").send(renderSponsorForm(null, materialAssets()));
    } catch (err) {
      console.error("fundraise sponsor form failed:", err instanceof Error ? err.message : err);
      next();
    }
  });

  // The pages themselves, their QR codes and their old addresses: a fundraiser's at /fundraise/<slug>,
  // and (event pages) an event's at /event/<short name>, by the same code.
  addPageRoutes(router, "raising", pageFile, deps);
  addPageRoutes(router, "event", pageFile, deps);
}

type PageKind = "raising" | "event";

/**
 * Event pages: one kind's page routes, under its own prefix (/fundraise or /event). Each answers
 * only for its own kind: the other kind's page, or an address it used to have, is a 301 on to its
 * address now (lookUp), so a staff change of kind, or a link typed the wrong way, never breaks.
 */
function addPageRoutes(router: Router, kind: PageKind, pageFile: string, deps: FundraisePageDeps): void {
  const prefix = kind === "event" ? EVENT_PAGE_PREFIX : "/fundraise";

  // TASK-504: the page's QR code as a print size PNG, beside the SVG below: the same code, drawn by
  // the same encoder. Wherever the SVG answers, so does this.
  router.get(`${prefix}/:slug/qr.png`, async (req, res, next) => {
    try {
      const found = await lookUp(String(req.params.slug), kind);
      // TASK-511: an old address's PNG goes on to the page's address now, like the SVG.
      if (!found) return next();
      if ("to" in found) return sendOn(res, found, `${found.to}/qr.png${queryOf(req)}`);
      const f = found.page;
      const [{ qrPng }, { pageUrlFor }, { qrPngCache }] = await Promise.all([
        import("../fundraising/qr-png"),
        import("../fundraising/page-url"),
        import("../fundraising/qr-cache"),
      ]);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `attachment; filename="nbcc-${f.slug}-qr-code.png"`);
      keepADay(res);
      res.type("image/png").send(qrPngCache.get(pageUrlFor(f), qrPng));
    } catch (err) {
      console.error("fundraiser qr png failed:", err instanceof Error ? err.message : err);
      next();
    }
  });

  // TASK-501 review: the code also answers for a finished fundraiser that had a page, so its
  // organiser keeps it in their private area. TASK-502: wherever the page is, as a finished one keeps it.
  router.get(`${prefix}/:slug/qr.svg`, async (req, res, next) => {
    try {
      const found = await lookUp(String(req.params.slug), kind);
      if (!found) return next();
      if ("to" in found) return sendOn(res, found, `${found.to}/qr.svg${queryOf(req)}`);
      const f = found.page;
      const [{ qrSvg }, { pageUrlFor }, { qrSvgCache }] = await Promise.all([
        import("../fundraising/qr"),
        import("../fundraising/page-url"),
        import("../fundraising/qr-cache"),
      ]);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `inline; filename="nbcc-${f.slug}-qr-code.svg"`);
      keepADay(res);
      // TASK-504 review: kept by the address and the title it is labelled with, since both go in it.
      const url = pageUrlFor(f);
      const title = `QR code for ${f.title}`;
      res.type("image/svg+xml").send(qrSvgCache.get(`${url}
${title}`, () => qrSvg(url, { title, size: 1024 })));
    } catch (err) {
      console.error("fundraiser qr failed:", err instanceof Error ? err.message : err);
      next();
    }
  });

  router.get(`${prefix}/:slug`, async (req, res, next) => {
    try {
      const found = await lookUp(String(req.params.slug), kind);
      // TASK-511: an address the page used to have goes on to its address now, for good.
      if (!found) return next();
      if ("to" in found) return sendOn(res, found, `${found.to}${queryOf(req)}`);
      const f = found.page;
      const [{ wallRows }, { publicPage, wallEntries, shortName }, { renderFundraiserPage }, { pageUrlFor }, { teamPageExtras }] = await Promise.all([
        import("../db/fundraisers"),
        import("../fundraising/model"),
        import("../fundraising/render"),
        import("../fundraising/page-url"),
        import("./team-pages"),
      ]);
      // Team pages: a team's combined meter and members; a member page's team.
      const extras = await teamPageExtras(f, shortName);
      const page = {
        ...publicPage(f, extras.meter ?? f.meter, wallEntries(await wallRows(f.id))),
        news: await newsFor(f.id),
        ...(f.isTeam ? { teamName: f.title } : {}),
      };
      // ?thanks=1 is where the server sends a giver back to after paying (src/routes/api.ts): a thank
      // you at the top. Anyone can add it to the address, and all it shows is a thank you.
      const thanks = req.query.thanks === "1" ? await thanksFor(req.query, f.id) : undefined;
      const withSession = req.query.session_id !== undefined;
      if (withSession) {
        // TASK-502: a giver's own thank you, with their payment's id in the address: never kept by a
        // browser or anything in between, never indexed, and never handed to another website as a
        // referrer, whether or not the step is offered.
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Referrer-Policy", "same-origin");
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
      }
      // In memory of someone (Jaimie, 2026-10-03): the quieter page (src/fundraising/memory-render.ts).
      const render = f.inMemory ? (await import("../fundraising/memory-render")).renderMemoryPage : renderFundraiserPage;
      const html = render(readFileSync(pageFile, "utf8"), page, {
        pageUrl: pageUrlFor(f),
        now: new Date(),
        thanks,
        team: extras.team,
        impact: await impactFor(f),
      });
      if (!withSession) fresh(res);
      res.type("html").send(await deps.decorate(html, req.headers.cookie));
    } catch (err) {
      console.error("fundraiser page failed:", err instanceof Error ? err.message : err);
      next();
    }
  });
}
