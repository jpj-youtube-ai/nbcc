// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHomePromo } from "../../src/ball/home-promo";

// The new top of the home page: the big logo and the four gift tags on the gold ribbon. This is the
// page a printed advert's QR code lands on for the Festive Ball, so most of this file is about the
// Ball's promotion still landing, using the real renderHomePromo on the real index.html.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
// This machine checks files out with CRLF, CI with LF. The budget is judged on what CI sees.
const lfBytes = (rel: string) => Buffer.byteLength(read(rel).replace(/\r\n/g, "\n"));
const docOf = (html: string) => new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const HOME = read("index.html");
const PROMO_SOURCE = read("src/ball/home-promo.ts");
const CSS = read("assets/css/home-top.css");

// The anchors are read out of home-promo.ts rather than copied, so this cannot pass against a
// stale copy of them. The literal values are pinned as well: they must not move either.
const anchorFromSource = (name: string): string => {
  const found = PROMO_SOURCE.match(new RegExp(`const ${name} = '([^']+)';`));
  expect(found, `${name} not found in home-promo.ts`).not.toBeNull();
  return found![1];
};
const MAIN_ANCHOR = anchorFromSource("MAIN_ANCHOR");
const AFTER_HERO_ANCHOR = anchorFromSource("AFTER_HERO_ANCHOR");

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const mainChildren = (html: string) => {
  const main = docOf(html).querySelector("main");
  return [...(main?.children ?? [])];
};
const label = (el: Element) => {
  if (el.matches("a.ball-banner")) return "banner";
  if (el.matches("section.hero")) return "hero";
  if (el.matches("section.home-lane")) return "tags";
  if (el.matches("section.ball-home-feature")) return "feature";
  if (el.matches('section.section.tint[aria-label="What we do"]')) return "what we do";
  if (el.matches("section#year-round")) return "year round";
  return "other";
};

describe("the Ball's promotion still lands on the new home page", () => {
  it("keeps both anchors byte for byte", () => {
    expect(MAIN_ANCHOR).toBe('<main class="site-main home" id="main" tabindex="-1">');
    expect(AFTER_HERO_ANCHOR).toBe('<section class="section tint" aria-label="What we do">');
    expect(count(HOME, MAIN_ANCHOR)).toBe(1);
    expect(count(HOME, AFTER_HERO_ANCHOR)).toBe(1);
    // renderHomePromo looks for the second one with its six spaces of indent.
    expect(count(HOME, "      " + AFTER_HERO_ANCHOR)).toBe(1);
  });

  it("puts the page in the order hero, the four tags, the Ball feature, then the rest", () => {
    const order = mainChildren(renderHomePromo(HOME, { gateOpen: true })).map(label);
    expect(order.slice(0, 6)).toEqual(["banner", "hero", "tags", "feature", "what we do", "year round"]);
  });

  it("draws the banner, the feature and the menu item exactly once", () => {
    const html = renderHomePromo(HOME, { gateOpen: true });
    const doc = docOf(html);
    expect(doc.querySelectorAll("a.ball-banner")).toHaveLength(1);
    expect(doc.querySelectorAll("section.ball-home-feature")).toHaveLength(1);
    expect(doc.querySelectorAll('#navLinks a[href="/ball"]')).toHaveLength(1);
    expect(doc.querySelector(".ball-home-feature a.btn")?.getAttribute("href")).toBe("/ball");
    expect(doc.querySelector("a.ball-banner")?.getAttribute("href")).toBe("/ball");
  });

  // The promotion's own rule, ".ball-banner + .hero", stops the hero clearing the nav a second
  // time. It only applies if the hero is still a .hero sitting straight after the banner.
  it("leaves the hero directly after the banner, so the promotion's spacing rule still applies", () => {
    const doc = docOf(renderHomePromo(HOME, { gateOpen: true }));
    expect(doc.querySelector("a.ball-banner")?.nextElementSibling?.matches("section.hero")).toBe(true);
    expect(renderHomePromo(HOME, { gateOpen: true })).toContain(".ball-banner + .hero{padding-top:");
  });

  // home-top.css comes before the promotion's inline styles, so a rule of equal weight loses to
  // them. A heavier rule on the hero's top padding would quietly bring the double gap back.
  it("does not outweigh the promotion's rule for the hero's top padding", () => {
    const uncommented = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const heavier = [...uncommented.matchAll(/([^{}]*\.hero(?![-\w])[^{}]*)\{[^}]*padding(?:-top)?:/g)]
      .map((m) => m[1].trim())
      .filter((selector) => selector !== ".home .hero");
    expect(heavier).toEqual([]);
  });

  it("loads home-top.css before the promotion's inline styles", () => {
    const html = renderHomePromo(HOME, { gateOpen: true });
    const shared = html.indexOf('href="assets/css/styles.css"');
    const homeTop = html.indexOf('href="/assets/css/home-top.css"');
    expect(shared).toBeGreaterThan(-1);
    expect(homeTop).toBeGreaterThan(shared);
    expect(homeTop).toBeLessThan(html.indexOf("<style>"));
  });

  it("with the gate shut the file goes out byte for byte and has no sign of the Ball", () => {
    const html = renderHomePromo(HOME, { gateOpen: false });
    expect(html).toBe(HOME);
    expect(html).not.toContain("/ball");
    expect(mainChildren(html).map(label).slice(0, 4)).toEqual(["hero", "tags", "what we do", "year round"]);
  });

  it("renders the same with CRLF and LF line endings", () => {
    const lf = HOME.replace(/\r\n/g, "\n");
    const order = mainChildren(renderHomePromo(lf, { gateOpen: true })).map(label);
    expect(order.slice(0, 5)).toEqual(["banner", "hero", "tags", "feature", "what we do"]);
  });

  it("does not change the stylesheet the promotion's banner relies on", () => {
    // The transparent nav and the hero's first paint are styles.css's: neither is overridden here.
    expect(CSS).not.toMatch(/(^|[\s,}])\.nav\b/);
    expect(CSS).not.toMatch(/\.ball-banner(?!\s*\+)/);
    // The drift may follow the feature, but nothing here restyles the feature itself.
    expect(CSS).not.toMatch(/\.ball-home-feature[^{,]*\{/);
  });
});

describe("the hero keeps its words and its buttons", () => {
  const doc = docOf(HOME);
  const hero = doc.querySelector("section.hero");

  it("keeps the eyebrow, the headline and the sentence", () => {
    expect(norm(hero?.querySelector(".eyebrow")?.textContent)).toBe("Volunteer led Scottish charity · Annbank, Ayrshire");
    expect(norm(hero?.querySelector("h1")?.textContent)).toBe("You know us at Christmas.We’re here all year.");
    expect(norm(hero?.querySelector(".lede")?.textContent)).toBe(
      "NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland.",
    );
  });

  it('keeps "Donate now" and "What we do all year"', () => {
    const donate = hero?.querySelector("a.btn.btn-primary");
    expect(norm(donate?.textContent)).toBe("Donate now");
    expect(donate?.getAttribute("href")).toBe("/donate");
    const about = hero?.querySelector("a.btn.btn-ghost");
    expect(norm(about?.textContent)).toBe("What we do all year");
    expect(about?.getAttribute("href")).toBe("/about-us");
  });
});

describe("the logo", () => {
  const img = docOf(HOME).querySelector(".hero-art img");

  it("is the full vector logo in the hero, with alt text and its size", () => {
    expect(img?.getAttribute("src")).toBe("/assets/img/nbcc-logo-full.svg");
    expect(img?.getAttribute("alt")).toBe("Night Before Christmas Campaign logo: a smiling elf peeking over the letters NBCC");
    expect(img?.getAttribute("width")).toBe("1071");
    expect(img?.getAttribute("height")).toBe("1038");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("is a real file, a vector, with nothing in it that runs", () => {
    expect(existsSync(resolve(ROOT, "assets/img/nbcc-logo-full.svg"))).toBe(true);
    const svg = read("assets/img/nbcc-logo-full.svg");
    expect(svg).toContain('viewBox="397 42 1071 1038"');
    expect(svg).not.toMatch(/<script|<image|onload=/i);
    expect(statSync(resolve(ROOT, "assets/img/nbcc-logo-full.svg")).size).toBeLessThan(60 * 1024);
  });

  it("is listed in the image credits", () => {
    expect(read("assets/img/CREDITS.md")).toContain("nbcc-logo-full.svg");
  });

  it("sits on plain cream: the hero's glow and the logo's shadow are switched off", () => {
    expect(CSS).toMatch(/\.home \.hero::before\{[^}]*display:none/);
    expect(CSS).toMatch(/\.home \.hero-art \.logo-big\{[^}]*filter:none/);
  });
});

describe("the four tags", () => {
  const doc = docOf(HOME);
  const lane = doc.querySelector("section.home-lane");
  const tag = (cls: string) => lane?.querySelector(`.gift.${cls}`);
  const links = (cls: string) =>
    [...(tag(cls)?.querySelectorAll("a") ?? [])].map((a) => [
      norm(a.childNodes[0]?.textContent),
      a.getAttribute("href"),
    ]);

  it('asks "Where would you like to start?" above the ribbon', () => {
    expect(norm(lane?.querySelector("h2")?.textContent)).toBe("Where would you like to start?");
    expect(lane?.getAttribute("aria-labelledby")).toBe(lane?.querySelector("h2")?.id);
    expect(lane?.querySelector(".ribbon .bow")).not.toBeNull();
  });

  it("has the four tags, in order", () => {
    const heads = [...(lane?.querySelectorAll(".gift h3") ?? [])].map((h) => norm(h.textContent));
    expect(heads).toEqual(["Donate", "Drop-off points", "Referrals", "Volunteer"]);
  });

  it("uses the prototype's wording, with the Donate wording as the owner set it", () => {
    const words = [...(lane?.querySelectorAll(".gift-text") ?? [])].map((p) => norm(p.textContent));
    expect(words).toEqual([
      "Give once or monthly. Our elves use your gift wherever it’s needed most, at Christmas and all year round.",
      "Bring a donation near you, or open your doors and become one.",
      "For schools and the services who support children, young people and vulnerable adults.",
      "Pack, drive, photograph or organise. Any skill, 16 or over.",
    ]);
  });

  it("links Donate to /donate, in the same tab, with an empty small line", () => {
    expect(links("g-donate")).toEqual([["Donate", "/donate"]]);
    expect(tag("g-donate")?.querySelector("a")?.hasAttribute("target")).toBe(false);
    expect(tag("g-donate")?.querySelector(".gift-small")?.textContent).toBe("");
  });

  it("links the other three to the live sites and to the pages under /get-involved/", () => {
    expect(links("g-drop")).toEqual([
      ["Find a drop-off point", "https://drop.nbcc.scot/"],
      ["Become one", "https://drop.nbcc.scot/sign-up"],
      ["How it works", "/get-involved/drop-off-points"],
    ]);
    expect(links("g-ref")).toEqual([
      ["Make a referral", "https://referrals.nbcc.scot/"],
      ["Sign in", "https://referrals.nbcc.scot/sign-in"],
      ["How it works", "/get-involved/referrals"],
    ]);
    expect(links("g-vol")).toEqual([
      ["Sign up to volunteer", "https://vol.nbcc.scot/sign-up"],
      ["Sign in", "https://vol.nbcc.scot/sign-in"],
      ["How it works", "/get-involved/volunteer"],
    ]);
  });

  it("opens the other sites in a new tab, and says so", () => {
    const outside = [...(lane?.querySelectorAll('a[href^="https://"]') ?? [])];
    expect(outside).toHaveLength(6);
    for (const a of outside) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener");
      expect(norm(a.querySelector(".sr-only")?.textContent)).toBe(", opens in a new tab");
    }
  });

  it("the How it works pages really exist", () => {
    for (const page of ["drop-off-points", "referrals", "volunteer"]) {
      expect(existsSync(resolve(ROOT, `get-involved-${page}.html`))).toBe(true);
    }
  });

  it("draws the parcel, the whole door with its wreath and parcel, the envelope and the elf", () => {
    expect(tag("g-donate")?.querySelector("svg.art-parcel")).not.toBeNull();
    const door = tag("g-drop")?.querySelector("svg.art-door");
    expect(door?.querySelector('circle[stroke-dasharray="3 1.500"]'), "the wreath").not.toBeNull();
    expect(door?.querySelector('g[transform="translate(92 104)"]'), "the parcel on the step").not.toBeNull();
    expect(door?.querySelector('rect[fill="#FFFDFA"]'), "the step").not.toBeNull();
    expect(tag("g-ref")?.querySelector("svg.art-env")).not.toBeNull();
    const elf = tag("g-vol")?.querySelector("img.art-elf");
    expect(elf?.getAttribute("src")).toBe("/assets/img/nbcc-elf.png");
    expect(elf?.getAttribute("alt")).toBe("The NBCC elf");
    expect(elf?.getAttribute("width")).toBeTruthy();
    expect(elf?.getAttribute("height")).toBeTruthy();
    expect(elf?.getAttribute("loading")).toBe("lazy");
  });

  it("hides every drawing from screen readers", () => {
    for (const svg of lane?.querySelectorAll("svg") ?? []) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("leaves the band's peeking elf out", () => {
    expect(lane?.querySelector(".peek")).toBeNull();
    expect(CSS).not.toContain(".peek");
    // The elf on the Volunteer tag is the only picture of him in the band.
    expect(lane?.querySelectorAll("img")).toHaveLength(1);
  });

  it("has nothing of Fill a Red Bag anywhere", () => {
    expect(HOME).not.toMatch(/\bfb-|class="fb\b|id="fb/);
    expect(HOME).not.toContain("Fill a Red Bag");
    expect(HOME).not.toContain("rb-art");
    expect(HOME).not.toContain("rb-list-data");
    expect(HOME).not.toContain('href="/fill');
    expect(CSS).not.toMatch(/\.fb\b|\.fb-|\.rb-/);
    expect(tag("g-donate")?.querySelector(".fb-bag, .fb-front")).toBeFalsy();
  });

  it("has no placeholder or prototype leftovers", () => {
    expect(HOME).not.toMatch(/tofill|Photo to come|Prototype|proto-pill|\/files\//);
  });
});

describe("how the band ends", () => {
  const lane = docOf(HOME).querySelector("section.home-lane");

  it("finishes with the snow drift, drawn in the page's cream", () => {
    const last = lane?.lastElementChild;
    expect(last?.tagName.toLowerCase()).toBe("svg");
    expect(last?.classList.contains("drift")).toBe(true);
    expect(last?.getAttribute("preserveAspectRatio")).toBe("none");
    expect(CSS).toMatch(/\.home-lane \.drift\{[^}]*color:var\(--cream\)/);
  });
});

describe("motion, and nothing depending on it", () => {
  const withoutKeyframes = CSS.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");

  it("has the hang entrance and the hover swing", () => {
    expect(CSS).toMatch(/@keyframes hang\{/);
    expect(CSS).toMatch(/\.gift\{[^}]*animation:hang /);
    expect(CSS).toMatch(/\.gift:hover\{[^}]*transform:rotate\(/);
  });

  it("turns the entrance off for less motion, and only swings when motion is welcome", () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^@]*\.gift\{animation:none/);
    expect(CSS).toMatch(/@media \(hover:hover\) and \(prefers-reduced-motion:no-preference\)\{\s*\.gift:hover\{/);
    // Only inside that media query: a bare hover rule would still move for less motion.
    const bare = CSS.replace(/@media \(hover:hover\)[^{]*\{[^{}]*\{[^{}]*\}\s*\}/g, "");
    expect(bare).not.toContain(".gift:hover");
  });

  it("hides nothing unless the animation is running, so a dead script cannot hide a tag", () => {
    expect(withoutKeyframes).not.toMatch(/opacity:0|visibility:hidden/);
    expect(withoutKeyframes).not.toMatch(/\.js\s/);
    // "backwards" is held only for the moment before the entrance plays.
    expect(CSS).not.toMatch(/animation:hang[^;}]*(forwards|both)/);
  });

  it("the tags are in the page, not built by a script", () => {
    const lane = docOf(HOME).querySelector("section.home-lane");
    expect(lane?.querySelectorAll("[hidden]")).toHaveLength(0);
    expect(lane?.querySelectorAll("script")).toHaveLength(0);
  });
});

describe("the page's weight", () => {
  const home = docOf(HOME);
  const first = [
    "index.html",
    "assets/css/styles.css",
    "assets/css/home-top.css",
    "assets/js/main.js",
    "assets/js/pulse.js",
  ];
  const fonts = ["assets/fonts/playfair-var.woff2", "assets/fonts/poppins-400.woff2"];

  it("stays inside the 262KB first paint budget, in LF bytes", () => {
    const bytes =
      first.reduce((sum, f) => sum + lfBytes(f), 0) + fonts.reduce((sum, f) => sum + statSync(resolve(ROOT, f)).size, 0);
    expect(bytes).toBeLessThanOrEqual(262 * 1024);
  });

  it("every stylesheet on the page is in that sum", () => {
    const sheets = [...home.querySelectorAll('link[rel="stylesheet"]')].map((l) =>
      (l.getAttribute("href") ?? "").replace(/^\//, ""),
    );
    expect(sheets.sort()).toEqual(["assets/css/home-top.css", "assets/css/styles.css"]);
  });

  it("adds no font file and no request for an image on first paint", () => {
    // The band's grain is written into the file, so it costs no request.
    const withoutGrain = CSS.replace(/url\("data:[^"]*"\)/g, "");
    expect(withoutGrain).not.toMatch(/@font-face|@import|url\(/);
    for (const img of home.querySelectorAll("img")) expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("keeps home-top.css and the tags light", () => {
    expect(lfBytes("assets/css/home-top.css")).toBeLessThan(10 * 1024);
    expect(lfBytes("index.html")).toBeLessThan(25 * 1024);
  });

  it("is on the home page only, so donate.html's budget is untouched", () => {
    expect(read("donate.html")).not.toContain("home-top.css");
  });
});
