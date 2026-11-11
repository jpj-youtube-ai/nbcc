import { escapeHtml } from "../../events/render";
import { CHARITY_NAME, REGISTRATION_LINES } from "../../legal/registration";
import { schoolLogo } from "../logo";
import { paperHills, paperSky, paperSprite, tornBands } from "./paper";

// NBCC Elf Detective School: the page every elf screen sits in. The plan is
// docs/superpowers/plans/2026-10-04-elf-detective-a3-screens.md.
//
// A whole document as a string, the way src/ball/thank-you-page.ts is, so no file at the root of the
// site is needed. It loads the site's own stylesheet and then assets/css/elf.css, which holds every
// style these screens add. The bar across the top is the site's, cut down to the logo and one link,
// and it stays solid cream: the red logo sits on cream only (.impeccable.md). On the calendar the
// logo in the bar is the charity's and leads to the site; the calendar wears the school's own logo
// as its heading. On every other screen the school's logo takes that place in the bar and leads
// back to the calendar: the two logos are the same peeping elf, and one of them is enough.
//
// Every page is in paper (docs/superpowers/specs/2026-11-04-elf-paper-design.md): torn bands under the
// bar, a few paper stars drifting down, and cut paper hills running into the footer (src/elf/pages/paper.ts).
//
// Scripts are files, never text in the page, and each one only improves a page that already works
// without it.
//
// Pure. Unit tested through the screens that use it and in test/unit/elf-pages-house-rules.test.ts.

export { escapeHtml };

export interface ElfPageOptions {
  /** The words in the browser tab, before the charity's name. */
  title: string;
  /** One sentence for search engines and link previews. */
  description: string;
  /** The one link in the bar across the top. */
  cta: { href: string; label: string };
  /** The calendar's address. Given, the logo in the bar is the school's own and leads there. */
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

/** The whole page. */
export function elfPage(o: ElfPageOptions): string {
  const scripts = (o.scripts ?? [])
    .filter((name) => /^[a-z0-9-]+\.js$/.test(name))
    .map((name) => `<script defer src="/assets/js/${name}"></script>`)
    .join("\n");
  const robots = o.listed ? "" : '\n<meta name="robots" content="noindex, nofollow" />';
  const home = sitePath(o.home);
  const brand = home
    ? `<a class="brand elf-school" href="${escapeHtml(home)}">${schoolLogo(68)}</a>`
    : `<a class="brand" href="/"><img src="/assets/img/nbcc-logo.png" alt="${CHARITY_NAME}" width="50" height="50" /></a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />${robots}
<title>${escapeHtml(o.title)} | ${CHARITY_NAME}</title>
<meta name="description" content="${escapeHtml(o.description)}" />
<link rel="stylesheet" href="/assets/css/styles.css" />
<link rel="stylesheet" href="/assets/css/elf.css" />
</head>
<body class="elf-page">
<a class="skip-link" href="#main">Skip to content</a>
${paperSprite()}
${paperSky()}
<header class="nav" id="nav" data-region="nav">
  <div class="wrap">
    ${brand}
    <a class="nav-cta" href="${escapeHtml(sitePath(o.cta.href) ?? "/")}">${escapeHtml(o.cta.label)}</a>
  </div>
</header>

<main class="site-main" id="main" tabindex="-1">
${tornBands()}
${o.main}
</main>
${paperHills()}
<footer class="site-footer" data-region="footer">
  <div class="legal">
    <div class="wrap">
      <span>${REGISTRATION_LINES[0]}</span>
      <span>${REGISTRATION_LINES[1]}</span>
    </div>
  </div>
</footer>
${scripts}
</body>
</html>`;
}
