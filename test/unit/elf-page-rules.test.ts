// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderRulesPage } from "../../src/elf/pages/rules";
import { ELF_DEFAULTS } from "../../src/elf/settings";

// NBCC Elf Detective School: the rules page, which a grown up agrees to when enrolling.

const doc = new DOMParser().parseFromString(renderRulesPage({ settings: { ...ELF_DEFAULTS, schoolOn: true } }), "text/html");
const words = (doc.querySelector("main")?.textContent ?? "").replace(/\s+/g, " ");

// Jaimie, on the paper pictures (5 November 2026): entering the grand prize must not need a visit to
// every place; every door done is enough, each one cracked with a right guess or visited.
describe("the grand prize, as Jaimie set it on 5 November 2026", () => {
  const prize = (doc.querySelector('[aria-labelledby="elf-rules-prize"]')?.textContent ?? "").replace(/\s+/g, " ");

  it("is for every detective who does all 24 doors, each one cracked or visited", () => {
    expect(prize).toContain("Every detective who does all 24 doors");
    expect(prize).toContain("crack its case with a right guess");
    expect(prize).toContain("visit its hiding place");
    expect(prize).toContain("you do not have to visit every place");
    expect(prize).not.toContain("visits all 24 places");
  });

  it("tells a family who joined late how to catch up", () => {
    expect(prize).toContain("Joined late? Visit the places from before you joined to do their doors.");
  });
});

describe("the rules page", () => {
  it("says the main prize is judged, never drawn at random", () => {
    expect(words).toContain("judged");
    expect(words).toContain("never drawn");
    expect(words).toContain("Jodie, Head Elf");
  });

  it("says a grown up must be with under 16s at hiding places", () => {
    expect(words).toMatch(/Under 16s must have a grown up with them/);
  });

  it("says children appear only by detective name, and when their details are deleted", () => {
    expect(words).toContain("detective name");
    expect(words).toContain("end of January");
  });

  it("says pay what you can, with the admin's amounts", () => {
    expect(words).toContain("Pay what you can");
    expect(words).toContain("£5");
    expect(words).toContain("£1");
  });

  it("uses no dashes, and never the other elf's name", () => {
    expect(words).not.toMatch(/[‒–—―]| - /);
    expect(words).not.toMatch(/elf on the shelf/i);
  });
});

// The paper look (docs/superpowers/specs/2026-11-04-elf-paper-design.md): the rules in paper.
describe("the rules, in paper", () => {
  const css = readFileSync(resolve(__dirname, "../../assets/css/elf.css"), "utf8");

  it("has its title on a torn strip", () => {
    expect((doc.querySelector(".elf-title h1#elf-rules-heading")?.textContent ?? "").trim()).toBe("The rules of Elf Detective School");
  });

  it("sets every part on one taped sheet torn off a pad, each heading on a torn strip", () => {
    const sheet = doc.querySelector("main .elf-paper.elf-rules-sheet")!;
    expect(sheet.querySelector(":scope > .elf-tape")!.getAttribute("aria-hidden")).toBe("true");
    const parts = [...sheet.querySelectorAll(".elf-rules-part")];
    expect(parts.length).toBe(5);
    for (const part of parts) {
      const heading = part.querySelector("h2")!;
      expect(heading.classList.contains("elf-strip")).toBe(true);
      expect(part.getAttribute("aria-labelledby")).toBe(heading.id);
    }
  });

  it("marks each rule with a small circle of paper", () => {
    expect(doc.querySelectorAll(".elf-rules-list li").length).toBe(10);
    expect(css).toMatch(/\.elf-rules-list \{[^}]*list-style:\s*none/);
    expect(css).toMatch(/\.elf-rules-list li::before \{[^}]*border-radius:\s*50%/);
  });

  it("sends people to enrol on a torn paper button", () => {
    expect(doc.querySelector('main a[href="/elf/join"]')!.className).toBe("elf-btn elf-btn--crimson");
    expect(doc.querySelector(".site-main .btn")).toBeNull();
  });
});
