import { escapeHtml } from "../../events/render";
import { CHARITY_NAME } from "../../legal/registration";
import { siteFooter, siteHeader } from "../../site/chrome";
import { paperHills, paperSky, paperSprite, tornBands } from "./paper";

// NBCC Elf Detective School: the page every elf screen sits in. The plan is
// docs/superpowers/plans/2026-10-04-elf-detective-a3-screens.md.
//
// A whole document as a string, so no file at the root of the site is needed. It loads the site's own
// stylesheet and script and then assets/css/elf.css, which holds every style these screens add.
//
// The banner across the top, with the site's menu and its Donate button, and the footer are the site's
// own, from src/site/chrome.ts, exactly as on every other page (Jaimie, 11 November 2026: "every page
// should have the same banner and the same nav bar across the entire site"). Straight under the banner
// is Elf Detective School's own strip, in holly paper: its name, leading back to the calendar, and the
// page's own button (Join, Sign in, The calendar or Detective HQ). The calendar wears Elf Detective
// School's logo as its heading. The route adds to the banner and footer what every page gains as it
// goes out (dressPage, src/site/chrome.ts).
//
// Every page is in paper (docs/superpowers/specs/2026-11-04-elf-paper-design.md): torn bands under the
// strip, a few paper stars drifting down, and cut paper hills running into the footer
// (src/elf/pages/paper.ts).
//
// Scripts are files, never text in the page, and each one only improves a page that already works
// without it.
//
// Pure, but for the home page src/site/chrome.ts reads once. Unit tested through the screens that use
// it, in test/unit/elf-pages-house-rules.test.ts and in test/unit/site-chrome-everywhere.test.ts.

export { escapeHtml };

export interface ElfPageOptions {
  /** The words in the browser tab, before the charity's name. */
  title: string;
  /** One sentence for search engines and link previews. */
  description: string;
  /** The page's own button, in Elf Detective School's strip under the site's banner. */
  cta: { href: string; label: string };
  /** The calendar's address, where the strip's Elf Detective School leads. Left out: /elf. */
  home?: string;
  /** The sections that go inside <main>. Already safe HTML. */
  main: string;
  /** Script files to load, by name: "elf-calendar.js". */
  scripts?: readonly string[];
  /** True for a page that search engines may list. Left out, the page asks not to be listed. */
  listed?: boolean;
}

/** A path on this site and nothing else: it starts with one slash and holds only plain characters.
 *  Null for anything else, so an address from data can never point off the site or break out of the
 *  attribute or the style it is written into. */
export function sitePath(value: unknown): string | null {
  return typeof value === "string" && /^\/(?!\/)[A-Za-z0-9/_.~%?=&-]*$/.test(value) ? value : null;
}

// ---- small helpers the screens share ---------------------------------------------------------------

/** A paragraph, with a class when one is given. `html` is already safe. */
export const line = (html: string, cls = ""): string => `<p${cls ? ` class="${cls}"` : ""}>${html}</p>`;

/** Is this a real moment? A date built from a missing or mangled value is not, and must never bring a
 *  page down. */
export const real = (d: unknown): d is Date => d instanceof Date && Number.isFinite(d.getTime());

/** A count as a whole number that is safe to write into a page, whatever a database hands over. */
export const count = (n: unknown): number => Math.max(0, Math.floor(Number(n)) || 0);

/** Where Elf Detective School's strip starts. A page's notice for staff goes straight before it,
 *  under the site's banner (the private preview, src/routes/elf.ts). */
export const ELF_BAR_START = '<nav class="elf-bar"';

/** Elf Detective School's strip, under the site's banner: its name, leading to the calendar, and the
 *  page's own button. */
function elfBar(home: string, cta: { href: string; label: string }): string {
  return (
    `${ELF_BAR_START} aria-label="Elf Detective School"><div class="wrap">` +
    `<a class="elf-bar__home" href="${escapeHtml(home)}">Elf Detective School</a>` +
    `<a class="elf-btn elf-btn--s elf-bar__go" href="${escapeHtml(sitePath(cta.href) ?? "/")}">${escapeHtml(cta.label)}</a>` +
    "</div></nav>"
  );
}

/** The whole page. */
export function elfPage(o: ElfPageOptions): string {
  const scripts = (o.scripts ?? [])
    .filter((name) => /^[a-z0-9-]+\.js$/.test(name))
    .map((name) => `<script defer src="/assets/js/${name}"></script>`)
    .join("\n");
  const robots = o.listed ? "" : '\n<meta name="robots" content="noindex, nofollow" />';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />${robots}
<title>${escapeHtml(o.title)} | ${CHARITY_NAME}</title>
<meta name="description" content="${escapeHtml(o.description)}" />
<link rel="stylesheet" href="/assets/css/styles.css" />
<link rel="stylesheet" href="/assets/css/elf.css" />
<script defer src="/assets/js/main.js"></script>
</head>
<body class="elf-page">
<a class="skip-link" href="#main">Skip to content</a>
${paperSprite()}
${paperSky()}
${siteHeader()}
${elfBar(sitePath(o.home) ?? "/elf", o.cta)}
<main class="site-main" id="main" tabindex="-1">
${tornBands()}
${o.main}
</main>
${paperHills()}
${siteFooter()}
${scripts}
</body>
</html>`;
}
