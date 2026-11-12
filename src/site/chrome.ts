import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Request, Response } from "express";

// The site's banner, menu bar and footer, for a page built in code (TASK-615).
//
// Jaimie, 11 November 2026: "every page should have the same banner and the same nav bar across the
// entire site". The site's own pages are files at the root of the repository, sharing one banner (the
// logo, the menu and the Donate button) and one footer, which test/unit/footer-master.test.ts keeps
// in step with partials/footer.html. A page drawn in code takes both from here, read from the home
// page itself, so it can never drift from them: Elf Detective School's pages, the Festive Ball's guest
// and thank you pages, the Santa Sleigh's, the newsletter's unsubscribe and email choices pages, and
// the short pages a link or a form answers with (src/site/notice-page.ts). It never draws a banner or
// a footer of its own: test/unit/site-chrome-everywhere.test.ts fails if any page does.
//
// As such a page goes out, its route hands it to dressPage (or sendSitePage, which sends it too), which
// adds what every page of the site gains as it goes out (decorateSitePage, src/routes/site.ts: the
// menu's items that are switched on, such as Get involved, and the footer's links).
//
// The one file read is the home page, once. A home page that cannot be read leaves the banner and
// footer out rather than taking a page down; it is tried again after a minute, and said once a minute.

const ROOT = resolve(__dirname, "../..");
/** How the home page marks itself as the page you are on. No other page is the home page. */
const HERE = / class="active" aria-current="page"/g;
/** The banner's Donate button, as every page of the site has it. */
const DONATE = '<a class="nav-cta" href="/donate">';
/** How long a home page that could not be read is left before it is tried again. */
const RETRY_AFTER_MS = 60_000;

let chrome: { header: string; footer: string } | null = null;
let unreadableUntil = 0;

function fromHome(): { header: string; footer: string } {
  if (chrome) return chrome;
  if (Date.now() < unreadableUntil) return { header: "", footer: "" };
  let home: string;
  try {
    home = readFileSync(resolve(ROOT, "index.html"), "utf8").replace(/\r\n/g, "\n");
  } catch (err) {
    // Said once, then left alone for a minute: not a read and a line in the log on every page view.
    unreadableUntil = Date.now() + RETRY_AFTER_MS;
    console.error("site chrome: could not read the home page for its banner and footer:", err instanceof Error ? err.message : err);
    return { header: "", footer: "" };
  }
  const header = (home.match(/<header class="nav"[\s\S]*?<\/header>/)?.[0] ?? "").replace(HERE, "");
  const footer = home.match(/<footer class="site-footer"[\s\S]*?<\/footer>/)?.[0] ?? "";
  return (chrome = { header, footer });
}

const attribute = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The site's banner and menu bar, with no page marked as the one you are on. `donateHref` sends its
 * Donate button to a page's own give form instead of the donate page (the Santa Sleigh's, so a gift
 * from there counts as the sleigh's); nothing else about the banner can change.
 */
export function siteHeader(o: { donateHref?: string } = {}): string {
  const { header } = fromHome();
  const href = o.donateHref;
  return href === undefined ? header : header.replace(DONATE, () => `<a class="nav-cta" href="${attribute(href)}">`);
}

/** The site's footer, the master's (partials/footer.html). */
export function siteFooter(): string {
  return fromHome().footer;
}

/** What a page gains as it goes out, with the visitor's cookie (the Ball's preview reads it). */
export type DecoratePage = (html: string, cookieHeader: string | undefined) => Promise<string>;

/** The extras every page of the site gains (src/routes/site.ts), loaded when first asked for. */
const decorateSitePage: DecoratePage = async (html, cookieHeader) => (await import("../routes/site")).decorateSitePage(html, cookieHeader);

// The menu's extras are read from the database. A slow read never holds a page up (a QR scan, someone
// who has just paid): after this long, or on any failure, the page goes out with the banner and footer
// as they are.
const DECORATE_WAIT_MS = 1500;

/** The page as it goes out: with what every page of the site gains, or as it is if that cannot be had
 *  in time. Never throws. */
export async function dressPage(html: string, cookieHeader: string | undefined, decorate: DecoratePage = decorateSitePage): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      decorate(html, cookieHeader),
      new Promise<string>((done) => {
        timer = setTimeout(() => done(html), DECORATE_WAIT_MS);
      }),
    ]);
  } catch (err) {
    console.error("site chrome: could not add the menu's extras:", err instanceof Error ? err.message : err);
    return html;
  } finally {
    clearTimeout(timer);
  }
}

/** Sends a page of the site as it goes out: dressed, with the visitor's cookie, as HTML. The status
 *  and any headers are the route's to set first. */
export async function sendSitePage(req: Request, res: Response, html: string): Promise<Response> {
  return res.type("html").send(await dressPage(html, req.headers?.cookie));
}

/** The words a page that could not be drawn answers with. */
export const PAGE_FAILED_WORDS = "Something went wrong just now. Please try again in a few minutes.";

/** A page that could not be drawn: said in the log (the error's own message only), and a plain 500
 *  sent, never cached, so a route that awaits never leaves a request hanging or a rejected promise loose
 *  in the process. An answer already on its way is left alone: changing it would throw from the catch. */
export function pageFailed(res: Response, what: string, err: unknown): void {
  console.error(`${what} failed:`, err instanceof Error ? err.message : err);
  if (res.headersSent) return;
  res.setHeader("Cache-Control", "no-store");
  res.status(500).type("text/plain").send(PAGE_FAILED_WORDS);
}
