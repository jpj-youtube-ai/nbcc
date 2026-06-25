import express, { Router } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
