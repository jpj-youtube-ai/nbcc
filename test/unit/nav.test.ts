// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-007 (REQ-002): a sticky nav ported from the NBCC baseline into our four
// clean-URL pages. Static markup is asserted per page; the scroll/burger/Escape
// behaviour is exercised in jsdom against the real initNav from main.js
// (golden rules 1 & 5).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const navOf = (html: string) =>
  html.match(/<header[^>]*class="nav"[\s\S]*?<\/header>/i)?.[0] ?? "";
const linkListOf = (nav: string) =>
  nav.match(/<ul[^>]*class="nav-links"[\s\S]*?<\/ul>/i)?.[0] ?? "";

const PAGES = [
  { file: "index.html", active: "/" },
  { file: "about.html", active: "/about-us" },
  { file: "donate.html", active: "/donate" },
  { file: "contact.html", active: "/contact" },
  { file: "supporters.html", active: "/supporters" },
] as const;

describe.each(PAGES)("$file nav markup", ({ file, active }) => {
  const nav = navOf(read(file));
  const list = linkListOf(nav);

  it("has a brand: the logo lockup linking to /", () => {
    expect(nav).not.toBe("");
    const brand = nav.match(/<a[^>]*class="brand"[\s\S]*?<\/a>/i)?.[0] ?? "";
    expect(brand).toMatch(/href="\/"/);
    expect(brand).toMatch(/<img[^>]+src="[^"]*nbcc-logo\.png"[^>]*>/i);
    expect(brand).toMatch(/alt="[^"]+"/);
  });

  it("lists the five pages by clean URL", () => {
    for (const href of ["/", "/about-us", "/donate", "/contact", "/supporters"]) {
      expect(list).toContain(`href="${href}"`);
    }
  });

  it("marks the current page's link active + aria-current=page", () => {
    const tag =
      list.match(new RegExp(`<a[^>]*href="${active.replace(/\//g, "\\/")}"[^>]*>`, "i"))?.[0] ?? "";
    expect(tag).toMatch(/class="[^"]*\bactive\b/);
    expect(tag).toMatch(/aria-current="page"/);
  });

  it("has a persistent Donate CTA to /donate", () => {
    expect(nav).toMatch(/class="nav-cta"[^>]*href="\/donate"|href="\/donate"[^>]*class="nav-cta"/);
  });

  it("has an accessible burger button (aria-expanded + aria-controls)", () => {
    expect(nav).toMatch(/<button[^>]*class="burger"[\s\S]*?<\/button>/i);
    expect(nav).toMatch(/aria-expanded="false"/);
    expect(nav).toMatch(/aria-controls="navLinks"/);
  });
});

describe("nav behaviour (jsdom)", () => {
  const { initNav } = require(resolve(ROOT, "assets/js/main.js"));
  let nav: HTMLElement;
  let burger: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = navOf(read("index.html"));
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as typeof window.requestAnimationFrame;
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    initNav(document, window);
    nav = document.getElementById("nav")!;
    burger = document.getElementById("burger")!;
  });

  it("toggles .scrolled past 24px and back at the top", () => {
    expect(nav.classList.contains("scrolled")).toBe(false);
    Object.defineProperty(window, "scrollY", { value: 30, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    expect(nav.classList.contains("scrolled")).toBe(true);
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    expect(nav.classList.contains("scrolled")).toBe(false);
  });

  it("burger click toggles .open and aria-expanded", () => {
    expect(burger.getAttribute("aria-expanded")).toBe("false");
    burger.click();
    expect(nav.classList.contains("open")).toBe(true);
    expect(burger.getAttribute("aria-expanded")).toBe("true");
    burger.click();
    expect(nav.classList.contains("open")).toBe(false);
    expect(burger.getAttribute("aria-expanded")).toBe("false");
  });

  it("Escape closes the open menu and refocuses the burger", () => {
    burger.click();
    expect(nav.classList.contains("open")).toBe(true);
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    expect(nav.classList.contains("open")).toBe(false);
    expect(burger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(burger);
  });
});
