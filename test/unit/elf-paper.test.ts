// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { giftTag, headingStrip, paperCircle, paperHills, paperSky, paperSprite, rosette, scrap, titleStrip, tornBands } from "../../src/elf/pages/paper";
import { elfPage } from "../../src/elf/pages/shell";

// NBCC Elf Detective School: the paper look's pieces (mockup 6, approved by Jaimie on 4 November 2026),
// drawn on the server as small pieces of SVG: the torn bands under the bar, the cut paper hills above
// the footer, the paper stars drifting down, the torn title and heading strips, scraps, rosettes, gift
// tags and paper circles. Each is drawn from seeded numbers, so it is the same on every visit.

const ROOT = resolve(__dirname, "../..");
const CSS = readFileSync(resolve(ROOT, "assets/css/elf.css"), "utf8");
const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const PIECES: [string, () => string][] = [
  ["the torn bands", () => tornBands()],
  ["the hills", () => paperHills()],
  ["the sky", () => paperSky()],
  ["a scrap", () => scrap("gold", "s")],
  ["a title strip", () => titleStrip({ text: "The wardrobe" })],
  ["a heading strip", () => headingStrip({ text: "Dress up", tag: "h2", back: "crimson" })],
  ["a rosette", () => rosette({ className: "elf-door__rosette", petals: 14 })],
  ["a rosette with tails", () => rosette({ className: "elf-seal", tails: true })],
  ["a gift tag", () => giftTag({ i: 2, colour: "holly" })],
  ["a paper circle", () => paperCircle("#C98E5F")],
];

describe("the paper pieces", () => {
  it("are drawn the same every time", () => {
    for (const [name, draw] of PIECES) expect(draw(), name).toBe(draw());
  });

  it("are pieces a screen reader skips, all but the words of a strip", () => {
    for (const [name, draw] of PIECES) {
      const page = doc(`<body>${draw()}</body>`);
      for (const svg of page.querySelectorAll("svg")) expect(svg.closest('[aria-hidden="true"]'), `${name}: every drawing`).not.toBeNull();
      for (const img of page.querySelectorAll("img")) expect(img.getAttribute("alt"), name).toBe("");
    }
    expect(doc(titleStrip({ text: "The wardrobe" })).querySelector("h1")!.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("writes the words of a strip safely, as the heading asked for", () => {
    const title = doc(titleStrip({ text: "<b>Elves</b> & co", id: "t" }));
    expect(title.querySelector("h1 b")).toBeNull();
    expect(title.querySelector("h1")!.textContent).toBe("<b>Elves</b> & co");
    expect(title.querySelector("h1")!.id).toBe("t");
    const heading = doc(headingStrip({ text: "<i>Dress</i> up", tag: "h3", back: "gold" }));
    expect(heading.querySelector("h3 i")).toBeNull();
    expect(heading.querySelector("h3")!.textContent).toBe("<i>Dress</i> up");
  });

  it("takes only a real colour for a paper circle", () => {
    expect(paperCircle("#9C6644")).toContain('fill="#9C6644"');
    for (const bad of ['red" onload="alert(1)', "url(x)", "#12345", ""]) {
      const circle = paperCircle(bad);
      expect(circle, bad).not.toContain("onload");
      expect(circle, bad).not.toContain("url(");
    }
  });

  it("shows only the painted pictures and shapes of the paper look", () => {
    for (const [name, draw] of PIECES) {
      for (const m of draw().matchAll(/(?:src|href)="([^"#]+)"/g)) {
        expect(m[1], name).toMatch(/^\/assets\/img\/elf\/paper\//);
        expect(existsSync(resolve(ROOT, m[1].slice(1))), m[1]).toBe(true);
      }
    }
  });
});

describe("every page", () => {
  const page = doc(elfPage({ title: "A page", description: "A page.", cta: { href: "/elf/hq", label: "Detective HQ" }, main: "<section><h1>A page</h1></section>" }));

  it("wears the torn bands under the bar, the paper sky and the cut paper hills above the footer, once each", () => {
    for (const piece of [".elf-bands", ".elf-sky", ".elf-hills", "#elf-paper-lift"]) expect(page.querySelectorAll(piece).length, piece).toBe(1);
    const order = [...page.body.querySelectorAll(".elf-bands, main, .elf-hills, footer")].map((el) => el.className || el.tagName.toLowerCase());
    expect(order.indexOf("elf-hills")).toBeGreaterThan(order.findIndex((c) => /site-main/.test(c)));
    expect(page.querySelector(".elf-hills")!.nextElementSibling!.tagName.toLowerCase()).toBe("footer");
  });

  it("keeps the paper's shadows in one place every piece can use", () => {
    expect(paperSprite()).toContain('id="elf-paper-lift"');
  });
});

describe("the stylesheet", () => {
  it("uses the paper files, never a torn shape written into the stylesheet", () => {
    for (const m of CSS.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      const address = m[1];
      if (address.startsWith("data:")) expect(address.length, address.slice(0, 60)).toBeLessThan(1024);
      else expect(address, address).toMatch(/^\/assets\/(img\/elf\/paper\/|fonts\/)/);
    }
  });

  it("names only paper files that exist", () => {
    const used = [...CSS.matchAll(/url\(\s*["']?(\/assets\/img\/elf\/paper\/[^"')]+)["']?\s*\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(20);
    for (const address of new Set(used)) expect(existsSync(resolve(ROOT, address.slice(1))), address).toBe(true);
  });
});

// The final review (5 November 2026): in the private preview the strip sat under the bar, and the
// torn bands dropped below it, leaving a gap. TASK-615: it sits straight under the site's banner, above
// Elf Detective School's own strip, which moves down after it, so the torn bands stay joined to that.
describe("the private preview's strip", () => {
  it("sits under the banner, with Elf Detective School's strip moved down after it", () => {
    expect(CSS).toMatch(/\.elf-preview-strip \{[^}]*margin:\s*var\(--nav-h\) 0 0/);
    expect(CSS).toMatch(/\.elf-preview-strip \+ \.elf-bar \{[^}]*margin-top:\s*0/);
  });
});

// TASK-615: the site's banner, then Elf Detective School's strip of holly paper, then the page, whose
// torn bands run on from the strip.
describe("the strip under the site's banner", () => {
  const page = doc(elfPage({ title: "A page", description: "A page.", cta: { href: "/elf/hq", label: "Detective HQ" }, main: "<section><h1>A page</h1></section>" }));

  it("comes straight after the banner and before the page, with the torn bands at the top of the page", () => {
    const strip = page.querySelector("nav.elf-bar")!;
    expect(strip.previousElementSibling!.matches("header.nav")).toBe(true);
    expect(strip.nextElementSibling!.matches("main.site-main")).toBe(true);
    expect(page.querySelector("main.site-main")!.firstElementChild!.matches(".elf-bands")).toBe(true);
  });

  it("is laid under the fixed banner, in holly, and the torn bands start where it ends", () => {
    expect(CSS).toMatch(/\.elf-bar \{[^}]*margin-top:\s*var\(--nav-h\)[^}]*background-color:\s*var\(--holly\)/);
    expect(CSS).toMatch(/\.elf-bands \{[^}]*top:\s*0;/);
    expect(CSS).toMatch(/\.elf-page \.page-top \{\s*padding-top:\s*calc\(40px \+/);
  });
});

// The repository is public, so the paper build's design and plan name no folder on anyone's computer.
describe("the paper build's documents", () => {
  it("name no user folder on a computer", () => {
    for (const doc of ["docs/superpowers/specs/2026-11-04-elf-paper-design.md", "docs/superpowers/plans/2026-11-04-elf-paper.md"]) {
      expect(readFileSync(resolve(ROOT, doc), "utf8"), doc).not.toMatch(/[A-Z]:[\\/]+Users[\\/]+/i);
    }
  });
});
