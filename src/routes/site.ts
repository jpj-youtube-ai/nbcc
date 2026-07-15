import express, { Router } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

export function createSiteRouter(siteRoot: string): Router {
  const router = Router();
  const redirectsFile = join(siteRoot, "_redirects");
  const rules = existsSync(redirectsFile)
    ? parseRedirects(readFileSync(redirectsFile, "utf8"))
    : [];

  // `/` serves the home page (no `_redirects` rule — served automatically).
  router.get("/", (_req, res) => {
    res.sendFile(join(siteRoot, "index.html"));
  });

  // /supporters (REQ-035) renders the real donor list server-side instead of serving
  // the static file — registered BEFORE the generic `_redirects` loop so it wins over
  // that file's 200 rewrite. The DB module is imported lazily so this router stays
  // import-safe for the pure parseRedirects tests (no config/pool at module load). If
  // the DB read fails, fall back to the static supporters.html so the page still renders.
  const supportersFile = join(siteRoot, "supporters.html");
  router.get("/supporters", async (_req, res, next) => {
    try {
      const { listPublicSupporters } = await import("../db/donations");
      const tiers = await listPublicSupporters();
      const template = readFileSync(supportersFile, "utf8");
      res.type("html").send(renderSupportersPage(template, tiers));
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

  // Apply each rule: 301 -> permanent redirect to the clean URL; 200 -> serve
  // the target file in place (the address bar keeps the clean URL).
  for (const rule of rules) {
    router.get(rule.from, (_req, res) => {
      if (rule.status.startsWith("301")) {
        res.redirect(301, rule.to);
      } else {
        res.sendFile(join(siteRoot, rule.to.replace(/^\//, "")));
      }
    });
  }

  // Shared CSS/JS/fonts/images — the only directory exposed wholesale.
  router.use("/assets", express.static(join(siteRoot, "assets")));

  return router;
}
