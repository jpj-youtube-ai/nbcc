// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-014 (REQ-008): the restrained motion system. initReveal adds .is-visible
// to .reveal elements as they intersect, with a reduced-motion / no-IO fallback
// that reveals everything immediately; the stylesheet carries the
// prefers-reduced-motion off-switch (REQ-032). Mirrors nav.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { initReveal } = require(resolve(ROOT, "assets/js/main.js"));
const CSS = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: /reduce/.test(q) ? reduce : false,
    media: q,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  })) as unknown as typeof window.matchMedia;
}

describe("scroll reveal behaviour (initReveal)", () => {
  let instances: Array<{ cb: IntersectionObserverCallback; observed: Element[] }>;

  beforeEach(() => {
    document.body.innerHTML = '<div class="reveal" id="a"></div><div class="reveal" id="b"></div>';
    instances = [];
    // Stub IntersectionObserver: capture the callback and observed elements.
    window.IntersectionObserver = class {
      cb: IntersectionObserverCallback;
      observed: Element[] = [];
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
        instances.push(this);
      }
      observe(el: Element) {
        this.observed.push(el);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver;
    setReducedMotion(false);
  });

  it("adds .is-visible to .reveal elements when they intersect", () => {
    initReveal(document, window);
    expect(instances).toHaveLength(1);
    expect(instances[0].observed).toHaveLength(2);
    expect(document.querySelectorAll(".reveal.is-visible")).toHaveLength(0);

    const io = instances[0];
    io.cb(
      io.observed.map((target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry),
      io as unknown as IntersectionObserver,
    );

    expect(document.querySelectorAll(".reveal.is-visible")).toHaveLength(2);
  });

  it("reveals everything immediately with NO observer when reduced motion is set", () => {
    setReducedMotion(true);
    let constructed = 0;
    window.IntersectionObserver = class {
      constructor() {
        constructed++;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver;

    initReveal(document, window);

    expect(constructed).toBe(0);
    expect(document.querySelectorAll(".reveal.is-visible")).toHaveLength(2);
  });

  it("reveals everything immediately when IntersectionObserver is unavailable", () => {
    // @ts-expect-error simulate an environment without IntersectionObserver
    window.IntersectionObserver = undefined;
    initReveal(document, window);
    expect(document.querySelectorAll(".reveal.is-visible")).toHaveLength(2);
  });
});

describe("reduced-motion off-switch in the stylesheet (REQ-032)", () => {
  it("has a prefers-reduced-motion: reduce block that zeroes transition + animation", () => {
    expect(CSS).toMatch(/@media[^{]*prefers-reduced-motion:\s*reduce/i);
    expect(CSS).toMatch(/transition:\s*none\s*!important/i);
    expect(CSS).toMatch(/animation:\s*none\s*!important/i);
  });
});
