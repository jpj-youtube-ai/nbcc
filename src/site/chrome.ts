import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The site's banner, menu bar and footer, for a page built in code (TASK-615).
//
// Jaimie, 11 November 2026: "every page should have the same banner and the same nav bar across the
// entire site". The site's own pages are files at the root of the repository, sharing one banner (the
// logo, the menu and the Donate button) and one footer, which test/unit/footer-master.test.ts keeps
// in step with partials/footer.html. A page drawn in code takes both from here, read from the home
// page itself, so it can never drift from them: Elf Detective School's pages, the Festive Ball's guest
// and thank you pages and the Santa Sleigh's. It never draws a banner or a footer of its own:
// test/unit/site-chrome-everywhere.test.ts fails if any page does.
//
// As such a page goes out, its route hands it to dressPage, which adds what every page of the site
// gains as it goes out (decorateSitePage, src/routes/site.ts: the menu's items that are switched on,
// such as Get involved, and the footer's links).
//
// The one file read is the home page, once. A home page that cannot be read leaves the banner and
// footer out rather than taking a page down.

const ROOT = resolve(__dirname, "../..");
/** How the home page marks itself as the page you are on. No other page is the home page. */
const HERE = / class="active" aria-current="page"/g;
/** The banner's Donate button, as every page of the site has it. */
const DONATE = '<a class="nav-cta" href="/donate">';

let chrome: { header: string; footer: string } | null = null;

function fromHome(): { header: string; footer: string } {
  if (chrome) return chrome;
  let home: string;
  try {
    home = readFileSync(resolve(ROOT, "index.html"), "utf8").replace(/\r\n/g, "\n");
  } catch (err) {
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
