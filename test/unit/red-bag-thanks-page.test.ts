// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { renderRedBagThanksPage } from "../../src/red-bag/render";
import { BLOCKED_NAME_LISTS } from "../../src/donors/display-name-filter";
import { MATERIALS_STATEMENT } from "../../src/legal/registration";

// Fill a Red Bag: the feel good pieces on the thank you page, /fill/thank-you, AS DRAWN by the
// server (fill-thank-you.html through src/red-bag/render.ts), and the page's own stylesheet for them
// (assets/css/red-bag-thanks.css). The rest of the page is held by test/unit/red-bag-page.test.ts;
// how the pieces behave is in test/unit/red-bag-thanks-extras.test.ts. No database.

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const template = read("fill-thank-you.html");
const html = renderRedBagThanksPage(template, { preview: false });
const doc = new DOMParser().parseFromString(html, "text/html");
const main = doc.querySelector("main")!;
const rules = read("assets/css/red-bag-thanks.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** The Workshop's line, in the owner's words (5 October 2026). */
const WORKSHOP_LINE = "Bag packed. The elves will take it from here.";

describe("the thank you page, with its feel good pieces", () => {
  it("loads its own stylesheet, after the shared ones, and no other page loads it or the scene", () => {
    const sheets = [...doc.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href"));
    expect(sheets).toEqual(["/assets/css/styles.css", "/assets/css/red-bag.css", "/assets/css/red-bag-thanks.css"]);
    for (const f of readdirSync(ROOT).filter((n) => n.endsWith(".html") && n !== "fill-thank-you.html")) {
      expect(read(f), f).not.toContain("red-bag-thanks.css");
      expect(read(f), f).not.toContain("red-bag-workshop.js");
    }
    expect(read("assets/css/styles.css")).not.toMatch(/\.rbw|\.rb-cert|\.rb-workshop|\.rb-name/);
  });

  it("is still one heading, never indexed, with nothing from another address and no sound", () => {
    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(norm(doc.querySelector("h1")?.textContent)).toBe("Thank you for filling a Red Bag");
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
    for (const el of doc.querySelectorAll("script[src], link[href], img[src]")) expect(el.getAttribute("src") ?? el.getAttribute("href")).toMatch(/^\/assets\//);
    expect(doc.querySelector("audio, video, iframe, form")).toBeNull();
  });

  it("puts the Workshop where the bag was, with its line under it, in the owner's words", () => {
    const box = main.querySelector("[data-rb-workshop]")!;
    expect(box.querySelector(".rb-thanks__bag svg.rb-bag")).not.toBeNull();
    const scene = box.querySelector("[data-rb-workshop-scene]")!;
    expect(scene.getAttribute("aria-hidden")).toBe("true");
    expect(scene.hasAttribute("hidden")).toBe(true); // the still bag shows until the script has drawn the scene
    const line = box.querySelector("[data-rb-workshop-line]")!;
    expect(norm(line.textContent)).toBe(WORKSHOP_LINE);
    expect(line.tagName).toBe("P");
    expect(line.hasAttribute("hidden")).toBe(false);
    expect(line.hasAttribute("aria-live")).toBe(false);
    expect(line.closest("[aria-hidden]")).toBeNull();
  });

  it("says it in this order: the Workshop and its line, the donation lines, the name, the picture, the share, the certificate, Fill another bag", () => {
    const marks = ["data-rb-workshop-scene", "data-rb-workshop-line", "data-rb-thanks-total", "data-rb-thanks-receipt", "data-rb-name", "data-rb-share-picture", "data-rb-share-send", "data-rb-cert-ask", "data-rb-again", "data-rb-cert"];
    const order = [...main.querySelectorAll(marks.map((m) => `[${m}]`).join(","))].map((el) => marks.find((m) => el.hasAttribute(m)));
    expect(order).toEqual(marks);
  });

  it("asks for the name in a box with a label, put away until the script can use it", () => {
    const name = main.querySelector("[data-rb-name]")!;
    expect(name.hasAttribute("hidden")).toBe(true);
    expect(norm(name.querySelector("label")?.textContent)).toBe("Add a name to your picture (optional)");
    const input = name.querySelector("input")!;
    expect(name.querySelector("label")!.getAttribute("for")).toBe(input.id);
    expect(input.getAttribute("maxlength")).toBe("30");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(norm(name.querySelector(".rb-name__hint")?.textContent)).toBe("A first name, a family, a class or a workplace. It goes on your certificate too, and it never leaves this page.");
    const error = name.querySelector("[data-rb-name-error]")!;
    expect(norm(error.textContent)).toBe("Please choose a different name.");
    expect(error.hasAttribute("hidden")).toBe(true);
    expect(main.querySelector("[data-rb-cert-ask]")?.hasAttribute("hidden")).toBe(true);
  });

  it("draws the supporter wall's filter into the page, and the charity's statement onto the certificate", () => {
    expect(html).not.toContain("<!-- red-bag:");
    const holder = doc.querySelector("script[data-rb-name-filter]")!;
    expect(holder.getAttribute("type")).toBe("application/json");
    expect(JSON.parse(holder.textContent!)).toEqual({ words: [...BLOCKED_NAME_LISTS.words], inside: [...BLOCKED_NAME_LISTS.inside] });
    expect(norm(main.querySelector(".rb-cert__legal")?.textContent)).toBe(MATERIALS_STATEMENT);
  });

  it("has a certificate with no amount on it, that is not on the screen", () => {
    const cert = main.querySelector("[data-rb-cert]")!;
    expect(cert.getAttribute("aria-hidden")).toBe("true");
    expect(norm(cert.textContent)).not.toMatch(/£|\bamount\b|donat/i);
    expect(norm(cert.querySelector(".rb-cert__title")?.textContent)).toBe("Certificate of thanks");
    expect(norm(cert.querySelector(".rb-cert__to")?.textContent)).toBe("This certificate is presented to");
    expect(norm(cert.querySelector("[data-rb-cert-for]")?.textContent)).toBe("for filling a Red Bag Full of Joy");
    expect(norm(cert.querySelector(".rb-cert__hand")?.textContent)).toBe("Thank you for being part of this.");
    expect(norm(cert.querySelector(".rb-cert__elves")?.textContent)).toBe("The Elves");
    expect(cert.querySelector("h1, h2, h3, a, button, input")).toBeNull();
    const logo = cert.querySelector("img")!;
    expect(logo.getAttribute("src")).toBe("/assets/img/nbcc-logo.png");
    expect(logo.hasAttribute("width") && logo.hasAttribute("height")).toBe(true);
    // Off the screen; on the printed page only, one A4 sheet, upright, with no room for the
    // browser's own header and footer (the address and the date).
    expect(rules).toMatch(/\.rb-cert\{[^}]*display:none/);
    expect(rules).toMatch(/@media print\{[\s\S]*\.rb-print-cert \.rb-cert\{[^}]*display:flex/);
    expect(rules).toMatch(/@page rbcert\{size:A4 portrait;margin:0\}/);
  });

  it("ranks nobody and presses nobody: no title for the giver, no ask", () => {
    const words = norm(main.textContent);
    expect(words).not.toMatch(/\b(hero|champion|star|legend|gold|silver|bronze|top|level|badge|rank)\b/i);
    expect(words).not.toMatch(/\b(give more|give again|another £|upgrade|only £)\b/i);
  });
});

describe("the thank you page's own stylesheet", () => {
  it("takes every colour from the site's tokens, and brings no font or file of its own", () => {
    expect(rules.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(rules).not.toMatch(/\brgba?\(|@font-face|@import|url\(|https?:/);
  });

  it("has no scrollbar inside anything, no stripe down one side and no gradient text", () => {
    expect(rules).not.toMatch(/overflow(-[xy])?\s*:\s*(auto|scroll)/);
    expect(rules).not.toMatch(/max-height/);
    expect(rules).not.toMatch(/border-(left|right|inline-start|inline-end)\s*:/);
    expect(rules).not.toMatch(/background-clip\s*:\s*text/);
  });

  it("moves with transform and opacity only, once, with no bounce", () => {
    const frames = rules.match(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g) ?? [];
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      const props = [...f.replace(/^@keyframes[^{]*\{/, "").matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(["transform", "opacity"], f).toContain(p);
    }
    expect(rules).not.toMatch(/infinite|alternate/);
    expect(rules).not.toMatch(/transition\s*:[^;}]*(width|height|margin|padding|top|left)/);
    // No curve overshoots: every control point's height stays between 0 and 1.
    for (const m of rules.matchAll(/cubic-bezier\(([^)]+)\)/g)) {
      const [, y1, , y2] = m[1].split(",").map(Number);
      expect(y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1, m[0]).toBe(true);
    }
  });

  it("plays only while the script says so, and never for someone who asked for less motion", () => {
    let seen = 0;
    for (const m of rules.matchAll(/([^{}]+)\{[^{}]*animation\s*:[^{}]*\}/g)) {
      if (/animation:none/.test(m[0])) continue;
      seen += 1;
      expect(m[1], m[0]).toMatch(/\.is-playing/);
    }
    expect(seen).toBeGreaterThan(3);
    expect(rules).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)\{[^}]*\.rb-workshop[^}]*animation:none !important/);
  });

  it("gives the name box a focus ring and room for a thumb, and styles nothing of the giving page", () => {
    expect(rules).toMatch(/\.rb-name__input:focus-visible\{[^}]*outline:/);
    expect(rules).toMatch(/\.rb-name__input\{[^}]*min-height:(4[4-9]|5\d)px/);
    expect(rules).not.toMatch(/\.rb-(paper|panel|item|example|bar|layout|bags|art|bag)\b/);
  });
});
