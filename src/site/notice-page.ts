import { siteFooter, siteHeader } from "./chrome";

// A short page of the site's: a heading and a line or two that a link or a form answers with, such as
// "This letter link is not valid" or the thank you after a story is sent without JavaScript (TASK-615).
// Each used to be a page of its own with no banner, menu or footer. Now each wears the site's (from
// src/site/chrome.ts) and loads the site's stylesheet and script, and its route sends it through
// dressPage like every page. What the page says is the caller's, unchanged.
//
// Pure, but for the home page src/site/chrome.ts reads once.

const escapeText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface NoticePage {
  /** The words in the browser tab. */
  title: string;
  /** What the page says, its heading first. Already safe HTML. */
  body: string;
  /** The content's own look, as the page has always had it: a narrower measure, and centred or not. */
  measure?: string;
  centred?: boolean;
  /** A class for the content, as the page has always had one. */
  className?: string;
  /** Kept out of search engines. */
  noindex?: boolean;
}

/** The whole page. */
export function noticePage(o: NoticePage): string {
  const style = `max-width:${o.measure ?? "40rem"}${o.centred ? ";text-align:center" : ""}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />${o.noindex ? '\n<meta name="robots" content="noindex" />' : ""}
<title>${escapeText(o.title)}</title>
<link rel="stylesheet" href="/assets/css/styles.css" />
<script defer src="/assets/js/main.js"></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
${siteHeader()}
<main class="site-main" id="main" tabindex="-1">
<section class="page-top${o.className ? ` ${o.className}` : ""}">
<div class="wrap" style="${style}">
${o.body}
</div>
</section>
</main>
${siteFooter()}
</body>
</html>`;
}
