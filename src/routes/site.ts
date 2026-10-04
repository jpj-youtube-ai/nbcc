import express, { Router } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { keepQuery } from "../site/redirect";
import { addFundraisePageRoutes } from "./fundraise-pages";
import { addTeamPageRoutes } from "./team-pages";
import { addPledgePageRoutes } from "./pledges";
import { addRedBagPageRoutes } from "./red-bag";
import {
  SUPPORTER_TIERS,
  type SupporterTier,
  type PublicSupporter,
} from "../db/donations-model";

// Serves the static marketing site (REQ-001 pages) from the Express app and
// applies the clean-URL rules from the repo-root `_redirects` file (TASK-002).
// `_redirects` is the single source of truth: it drives this runtime AND stays
// valid for any future static host. Only `/`, the clean URLs and `/assets` are
// served — repo files are never exposed (golden rule 6: `/health` stays cheap;
// this router does no DB work).

export type RedirectRule = { from: string; to: string; status: string };

// Pure parser for the Netlify `_redirects` format: `<from> <to> [status]`,
// one rule per line, `#` comments and blank lines ignored, status defaults 200.
export function parseRedirects(text: string): RedirectRule[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [from, to, status = "200"] = line.split(/\s+/);
      return { from, to, status };
    });
}

// --- Supporters wall server-side render (TASK-071 / REQ-035) -----------------
// The /supporters clean URL renders the real, donation-sourced donor list into the
// TASK-023 markup instead of serving the hand-authored static list. The list logic
// (tiering, name, anonymous exclusion) is pure and lives in src/db/donations-model.ts;
// the SQL read in src/db/donations.ts; only the HTML assembly lives here. The static
// supporters.html stays the template (and the fallback if the DB read fails), so its
// structure guards (supporters.test.ts, accessibility/copy/brand) still hold.

const TIER_LABELS: Record<SupporterTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
};

// The decorative aria-hidden inline-SVG icons, matching supporters.html exactly (person
// vs building, stroke=currentColor, no <img>) so the markup/accessibility guards hold.
const PERSON_ICON =
  '<svg class="supporter-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
const ORG_ICON =
  '<svg class="supporter-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22" aria-hidden="true"><path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16"/><path d="M15 9h4a1 1 0 0 1 1 1v11"/><path d="M2 21h20"/><path d="M8 8h3M8 12h3M8 16h3"/></svg>';

// Escape user-sourced donor names for safe HTML interpolation.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSupporter(s: PublicSupporter): string {
  const icon = s.kind === "organisation" ? ORG_ICON : PERSON_ICON;
  const kindLabel = s.kind === "organisation" ? "Organisation" : "Individual";
  return (
    `<li class="card supporter" data-type="${s.kind}">${icon}` +
    `<span class="supporter-meta"><span class="supporter-name">${escapeHtml(s.name)}</span>` +
    `<span class="supporter-kind">${kindLabel}</span></span></li>`
  );
}

// Build the inner HTML of `<div class="supporter-tiers">`: the three Bronze/Silver/Gold
// tier sections (in that order), each with its heading and a `.supporter-grid` of the
// real donors. Pure — testable without a DB or the file.
// Shown when no supporter has opted in yet (every band empty): the wall would otherwise render four
// bare band headings, which reads as unfinished. A warm invitation instead. No dashes, "NBCC" in full,
// donation (not gift), and no definitive impact claim (Code of Fundraising Practice).
const SUPPORTERS_EMPTY_HTML =
  '<div class="supporters-empty reveal">' +
  '<p class="supporters-empty-lead">Our monthly supporters will be celebrated here. When you set up a monthly ' +
  'donation and choose to be shown, your name joins the wall, and you could be among the first.</p>' +
  '<a class="btn btn-primary" href="/donate">Become a monthly supporter</a>' +
  "</div>";

export function renderSupporterTiers(tiers: Record<SupporterTier, PublicSupporter[]>): string {
  const total = SUPPORTER_TIERS.reduce((n, tier) => n + tiers[tier].length, 0);
  if (total === 0) return SUPPORTERS_EMPTY_HTML;
  return SUPPORTER_TIERS.map((tier) => {
    const items = tiers[tier].map(renderSupporter).join("");
    const headingId = `tier-${tier}-heading`;
    return (
      `<section class="supporter-tier reveal" aria-labelledby="${headingId}">` +
      `<h2 class="supporter-tier-name" id="${headingId}">${TIER_LABELS[tier]}</h2>` +
      `<ul class="supporter-grid">${items}</ul></section>`
    );
  }).join("");
}

// Replace the static `.supporter-tiers` block in supporters.html with the rendered real
// donor tiers, leaving the rest of the document (intro, nav, footer, head) untouched.
// Pure string transform: takes the template HTML + tier data, returns the page HTML.
export function renderSupportersPage(
  template: string,
  tiers: Record<SupporterTier, PublicSupporter[]>,
): string {
  return template.replace(
    /<div class="supporter-tiers">[\s\S]*?<\/div>/,
    `<div class="supporter-tiers">${renderSupporterTiers(tiers)}</div>`,
  );
}

// TASK-326: is the ball published? Read per request, deliberately NOT cached.
//
// A cache was the obvious move, and it was wrong. It bought very little: this is one indexed
// read of a single-row table, and `/` and `/supporters` already query the database on every
// request, so the two busiest pages have always done exactly this. It cost two real things:
// staff flipping the gate in admin would wait out the TTL before other pages agreed, and the
// BDD scenarios set the gate by SQL rather than through the app, so a stale entry from the
// previous scenario would make them fail at random.
//
// The robustness worry a cache appears to answer is answered better below: every caller falls
// back to sending the file untouched, so a database outage costs the ball LINK, never the page.
//
// Fails to "shut": if we cannot tell, the link is absent, which is the safe way to be wrong
// about an event that has not been announced.
async function ballIsPublished(cookieHeader: string | undefined): Promise<boolean> {
  try {
    const [{ getSettings }, { isGateOpen }, { holdsPreviewCookie }] = await Promise.all([
      import("../db/ball"),
      import("../ball/gate"),
      import("../ball/preview-access"),
    ]);
    if (isGateOpen(await getSettings(), new Date())) return true;
    // Staff previewing before launch see the nav item too (TASK-330). Without this the
    // preview was inconsistent with itself: the home page showed the promotion band to a
    // cookie holder while the nav on every page pretended the ball did not exist, so the one
    // thing staff were checking could not be reached from the page they were checking it on.
    return holdsPreviewCookie(cookieHeader);
  } catch {
    return false;
  }
}

// TASK-453: is the Events page (Get involved since TASK-494) switched on? Read fresh on every request, like the ball's gate, so
// an admin's switch takes effect on the very next page view. Any failure reads as OFF: a broken
// read must never put a menu link to a missing page on every page of the site.
async function eventsPageIsOn(): Promise<boolean> {
  try {
    const { getEventsSettings } = await import("../db/events");
    return (await getEventsSettings()).pageOn;
  } catch {
    return false;
  }
}

// TASK-494: is community fundraising switched on? For the site maps and the footer's "Fundraise for
// us" link; the fundraising pages ask for themselves. Any failure reads as OFF.
async function fundraisingIsOn(): Promise<boolean> {
  try {
    return await (await import("../db/fundraisers")).fundraisingIsOn();
  } catch {
    return false;
  }
}

// The menu items a page gets on top of what is in its file: the Festive Ball's while the ball is
// published (or being previewed), and Get involved (TASK-494, was Events) while that page is switched
// on. And while fundraising is switched on, the footer's "Fundraise for us" goes to the sign up
// rather than the contact page (TASK-494). Each is idempotent, so a page that already carries one
// is left as it is.
async function decorateNav(html: string, cookieHeader: string | undefined): Promise<string> {
  const [ball, events, fundraising] = await Promise.all([ballIsPublished(cookieHeader), eventsPageIsOn(), fundraisingIsOn()]);
  let out = html;
  if (ball) out = (await import("../ball/nav-link")).addBallNavLink(out);
  if (events) out = (await import("../events/nav-link")).addEventsNavLink(out);
  if (fundraising) out = (await import("../fundraising/footer-link")).addFundraiseFooterLink(out);
  return out;
}

export function createSiteRouter(siteRoot: string): Router {
  const router = Router();
  const redirectsFile = join(siteRoot, "_redirects");
  const rules = existsSync(redirectsFile)
    ? parseRedirects(readFileSync(redirectsFile, "utf8"))
    : [];

  // `/` serves the home page (no `_redirects` rule — served automatically).
  //
  // TASK-313: it also carries the Festive Ball promotion once staff open the gate. This matters
  // more than it looks: the printed advert's QR code points at nbcc.scot, not /ball, so without
  // this block every scan on launch morning lands somewhere with no way to buy a ticket.
  //
  // While the gate is shut renderHomePromo returns the file byte for byte, so the promotion is
  // absent from the page source rather than hidden — which is what lets it ship days early. The
  // ball modules are imported lazily so this router stays import-safe for the DB-free
  // parseRedirects tests, and any failure falls back to the plain home page: a broken ball
  // promo must never take the front page down with it.
  const homeFile = join(siteRoot, "index.html");
  router.get("/", async (req, res) => {
    try {
      const [{ getSettings }, { isGateOpen }, { renderHomePromo }, { holdsPreviewCookie }] =
        await Promise.all([
          import("../db/ball"),
          import("../ball/gate"),
          import("../ball/home-promo"),
          import("../ball/preview-access"),
        ]);
      const settings = await getSettings();
      const gateOpen = isGateOpen(settings, new Date());

      // TASK-320: staff asked how to see the launch-morning home page before launching it.
      // Anyone carrying a valid preview cookie — which you only get by typing the ball
      // password — sees the promotion band while the gate is still shut. Everyone else gets
      // the file byte for byte, so the ball is absent from the page SOURCE rather than
      // hidden in it.
      const preview = gateOpen ? false : await holdsPreviewCookie(req.headers.cookie);
      if (!gateOpen && !preview) {
        // TASK-453: the changes this branch can need are the Get involved menu item and (TASK-494)
        // the footer's fundraising link. With both switched off, the file goes out byte for byte.
        const [events, fundraising] = await Promise.all([eventsPageIsOn(), fundraisingIsOn()]);
        if (events || fundraising) {
          let html = readFileSync(homeFile, "utf8");
          if (events) html = (await import("../events/nav-link")).addEventsNavLink(html);
          if (fundraising) html = (await import("../fundraising/footer-link")).addFundraiseFooterLink(html);
          res.type("html").send(html);
          return;
        }
        res.sendFile(homeFile);
        return;
      }

      if (preview) {
        // Never let a shared cache hand this response to the public. There is no CDN in
        // front of the ALB today, but the whole point of the gate is that this page must
        // not reach anyone who has not typed the password.
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("Vary", "Cookie");
      }
      const template = readFileSync(homeFile, "utf8");
      // renderHomePromo adds the Festive Ball item itself; the Events item is ours to add.
      let html = renderHomePromo(template, { gateOpen: true });
      if (await eventsPageIsOn()) html = (await import("../events/nav-link")).addEventsNavLink(html);
      if (await fundraisingIsOn()) html = (await import("../fundraising/footer-link")).addFundraiseFooterLink(html);
      res.type("html").send(html);
    } catch (err) {
      console.error("home ball promo failed:", err instanceof Error ? err.message : err);
      res.sendFile(homeFile);
    }
  });

  // /supporters (REQ-035) renders the real donor list server-side instead of serving
  // the static file — registered BEFORE the generic `_redirects` loop so it wins over
  // that file's 200 rewrite. The DB module is imported lazily so this router stays
  // import-safe for the pure parseRedirects tests (no config/pool at module load). If
  // the DB read fails, fall back to the static supporters.html so the page still renders.
  const supportersFile = join(siteRoot, "supporters.html");
  router.get("/supporters", async (req, res, next) => {
    try {
      const { listPublicSupporters } = await import("../db/donations");
      const tiers = await listPublicSupporters();
      const template = readFileSync(supportersFile, "utf8");
      const html = renderSupportersPage(template, tiers);
      // Rendered by hand rather than served from disk, so it does not pass through the
      // `_redirects` loop below and needs the nav items adding here too (TASK-326, TASK-453).
      // This is also the page where getting the anchor wrong shows: its own nav item carries
      // class="active", so matching the link rather than the list finds the FOOTER first.
      res.type("html").send(await decorateNav(html, req.headers.cookie));
    } catch (err) {
      if (existsSync(supportersFile)) {
        res.sendFile(supportersFile);
      } else {
        next(err);
      }
    }
  });

  // Gift Aid declaration completion links (TASK-075/076). The in-person confirmation email
  // embeds `/gift-aid/declare?token=…` (full) and `/g/:token` (QR short); both resolve to the
  // token-scoped form served by GET /api/gift-aid/:token. Kept as thin redirects so the email
  // link format (owned by TASK-075's declarationLinks) and the form endpoint stay decoupled.
  router.get("/gift-aid/declare", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) return res.redirect(302, "/donate");
    res.redirect(302, `/api/gift-aid/${encodeURIComponent(token)}`);
  });
  router.get("/g/:token", (req, res) => {
    res.redirect(302, `/api/gift-aid/${encodeURIComponent(req.params.token)}`);
  });

  // TASK-453 built /events from the events table; TASK-494 renamed it Get involved, at
  // /get-involved, and added the public fundraising pages. /events now redirects for good. Get
  // involved is served only while an admin has the page switched on; switched off it falls through to
  // the catch-all below exactly as if the route were not here. src/routes/fundraise-pages.ts.
  addFundraisePageRoutes(router, siteRoot, { decorate: decorateNav, eventsPageIsOn });
  // Team pages: the join form at /fundraise/<team>/join (src/routes/team-pages.ts).
  addTeamPageRoutes(router, siteRoot, { decorate: decorateNav });
  // Sponsor pledges: the pay and "can't pay after all" pages an emailed link opens (src/routes/pledges.ts).
  addPledgePageRoutes(router, siteRoot, { decorate: decorateNav });
  // Fill a Red Bag: /fill-a-red-bag. Public, but linked from nowhere (the switch is
  // src/red-bag/switch.ts); switched off it is the 404 to the public and a preview to signed in
  // staff (src/routes/red-bag.ts).
  addRedBagPageRoutes(router, siteRoot, { decorate: decorateNav });

  // Apply each rule: 301 -> permanent redirect to the clean URL; 200 -> serve
  // the target file in place (the address bar keeps the clean URL).
  for (const rule of rules) {
    router.get(rule.from, async (req, res) => {
      if (rule.status.startsWith("301")) {
        // TASK-492: with the query it arrived with, so a visit's tags survive the hop.
        res.redirect(301, keepQuery(rule.to, req.originalUrl));
        return;
      }
      const file = join(siteRoot, rule.to.replace(/^\//, ""));
      if (!file.endsWith(".html")) {
        res.sendFile(file);
        return;
      }
      // While the ball is unpublished and the Events page is switched off this is byte-for-byte
      // the old behaviour: the file is sent as-is and no page mentions either.
      const [ball, events, fundraising] = await Promise.all([
        ballIsPublished(req.headers.cookie),
        eventsPageIsOn(),
        fundraisingIsOn(),
      ]);
      if (!ball && !events && !fundraising) {
        res.sendFile(file);
        return;
      }
      try {
        let html = readFileSync(file, "utf8");
        if (ball) html = (await import("../ball/nav-link")).addBallNavLink(html);
        if (events) html = (await import("../events/nav-link")).addEventsNavLink(html);
        if (fundraising) html = (await import("../fundraising/footer-link")).addFundraiseFooterLink(html);
        res.type("html").send(html);
      } catch (err) {
        console.error("nav link failed:", err instanceof Error ? err.message : err);
        res.sendFile(file);
      }
    });
  }

  // Shared CSS/JS/fonts/images — the only directory exposed wholesale.
  router.use("/assets", express.static(join(siteRoot, "assets")));

  // --- Site addressing (site-pages feature) ------------------------------------------------

  // /sitemap: the branded page tree, server-rendered into sitemap.html's .sitemap-tree
  // placeholder (the /supporters pattern) so it can never go stale. Deliberately unlisted:
  // nothing links here, the file carries noindex, and the header repeats it for robots that
  // read headers only. Ball pages appear only once the gate is open.
  const sitemapFile = join(siteRoot, "sitemap.html");
  router.get("/sitemap", async (req, res) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    try {
      const { SITE_PAGES, renderSitemapTree } = await import("../site/pages");
      const [ballOpen, eventsOn, fundraisingOn] = await Promise.all([
        ballIsPublished(req.headers.cookie),
        eventsPageIsOn(),
        fundraisingIsOn(),
      ]);
      const template = readFileSync(sitemapFile, "utf8");
      const html = template.replace(
        /<div class="sitemap-tree">[\s\S]*?<\/div>/,
        `<div class="sitemap-tree">${renderSitemapTree(SITE_PAGES, ballOpen, eventsOn, fundraisingOn)}</div>`,
      );
      res.type("html").send(html);
    } catch (err) {
      console.error("sitemap render failed:", err instanceof Error ? err.message : err);
      res.sendFile(sitemapFile);
    }
  });

  // /sitemap.xml: the search-engine feed — the registry, minus ball-gated pages while the
  // gate is shut, filtered by the admin's per-page visibility choices (site_page_seo).
  router.get("/sitemap.xml", async (req, res) => {
    try {
      const { SITE_PAGES, renderSitemapXml } = await import("../site/pages");
      const { getSeoOverrides } = await import("../db/site-pages");
      const [overrides, ballOpen, eventsOn, fundraisingOn] = await Promise.all([
        getSeoOverrides(),
        ballIsPublished(undefined), // never let a preview cookie leak the ball to a crawler
        eventsPageIsOn(),
        fundraisingIsOn(),
      ]);
      res
        .type("application/xml")
        .send(renderSitemapXml(SITE_PAGES, "https://nbcc.scot", overrides, ballOpen, eventsOn, fundraisingOn));
    } catch (err) {
      console.error("sitemap.xml failed:", err instanceof Error ? err.message : err);
      res.status(500).type("text/plain").send("sitemap unavailable");
    }
  });

  // The catch-all: spare addresses first, then the branded 404. This router is mounted LAST in
  // src/app.ts, so reaching here means no real route wanted the request.
  //
  //   1. GET/HEAD only — anything else keeps Express's default handling.
  //   2. /api/* gets a JSON 404: a machine caller must never receive an HTML page.
  //   3. The alias table is consulted (one indexed read); a hit is a 301 to the canonical page
  //      so the spare address never becomes a second home for the same content.
  //   4. Otherwise: 404.html with a REAL 404 status and noindex, so a mistyped URL can neither
  //      read as success to a monitor nor enter a search index.
  //
  // A database failure skips straight to the 404 — a broken alias lookup must never take
  // page-serving down with it.
  const notFoundFile = join(siteRoot, "404.html");
  router.use(async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
    try {
      const { resolveAlias } = await import("../db/site-pages");
      const target = await resolveAlias(req.path);
      // TASK-492: with the query it arrived with, so a QR code made for a spare address still
      // counts its scans as QR code rather than Direct.
      if (target) return res.redirect(301, keepQuery(target, req.originalUrl));
    } catch (err) {
      console.error("alias lookup failed:", err instanceof Error ? err.message : err);
    }
    res.status(404);
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    if (existsSync(notFoundFile)) return res.sendFile(notFoundFile);
    return res.type("text/plain").send("Not found");
  });

  return router;
}
