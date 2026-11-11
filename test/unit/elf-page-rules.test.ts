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

  // TASK-613: the grown up's mobile, asked for when enrolling, said beside what else is deleted when.
  it("says the mobile number is only for ringing the grand prize winner, and goes at the end of January", () => {
    const safe = [...doc.querySelectorAll('[aria-labelledby="elf-rules-safe"] li')].map((li) => (li.textContent ?? "").replace(/\s+/g, " ").trim());
    const deleted = safe.indexOf("All photos come down, and children's details are deleted, at the end of January.");
    expect(deleted).toBeGreaterThan(-1);
    expect(safe[deleted + 1]).toBe(
      "The mobile number you give when you enrol is only for ringing the grand prize winner, and it is deleted at the end of January with everything else.",
    );
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

// Wave 2 (Plan 2b, Task 7): decision 1 (the elf stays at its place all December, and the finder wins the
// prize) and C6 (one prize a family a year) reach the rules only once December's doors are switched on. With
// them off the page reads exactly as wave 1's did, so no new words go live before the doors do, as the
// calendar's steps already do.
describe("how the hunt works, with December's doors off and on", () => {
  const page = (doorsOn: boolean) =>
    new DOMParser().parseFromString(renderRulesPage({ settings: { ...ELF_DEFAULTS, schoolOn: true, doorsOn } }), "text/html");
  const hunt = (d: Document) =>
    [...d.querySelectorAll('[aria-labelledby="elf-rules-how"] li')].map((li) => (li.textContent ?? "").replace(/\s+/g, " ").trim());

  // TASK-613 changed one line with the doors off too: Christmas Eve's clues come in the morning.
  it("reads as wave 1's did while December's doors are off, with Christmas Eve's clues in the morning", () => {
    expect(hunt(page(false))).toEqual([
      "Each day from 1 to 24 December, one elf hides in a local shop, cafe or business. Where it hides is a secret.",
      "Signed in detectives get three clues each day, from hard to nearly a giveaway: at 5:30pm, 6pm and 6:30pm on school days, and at 10am, 10:30am and 11am at weekends, in the holidays and on Christmas Eve.",
      "Work out where the elf is hiding and type your guess in Detective HQ. A right guess earns new things for your elf.",
      "The first detective to reach the elf and type the secret word on its tag wins that elf's prize. Each family can win one elf.",
      "Visit a place after its elf is found to collect a candy cane stamp.",
    ]);
  });

  it("says the finder wins that door's prize, the elf stays there, and one prize a family, once December's doors are on", () => {
    const on = hunt(page(true));
    expect(on).toHaveLength(5);
    expect(on[3]).toBe(
      "The first detective to reach the elf and type the word on its tag wins that door's prize. The elf stays there for everyone else to find. Each family can win one prize.",
    );
    expect(on.join(" ")).not.toContain("win one elf");
    expect(on.join(" ")).not.toContain("secret word");
    expect(on[1]).toMatch(/and at 10am, 10:30am and 11am at weekends, in the holidays and on Christmas Eve\.$/);
  });

  it("uses no dashes either way", () => {
    for (const doorsOn of [false, true]) {
      expect((page(doorsOn).querySelector("main")?.textContent ?? "").replace(/\s+/g, " ")).not.toMatch(/[‒–—―]| - /);
    }
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
    // Eleven since TASK-613's line about the grown up's mobile number.
    expect(doc.querySelectorAll(".elf-rules-list li").length).toBe(11);
    expect(css).toMatch(/\.elf-rules-list \{[^}]*list-style:\s*none/);
    expect(css).toMatch(/\.elf-rules-list li::before \{[^}]*border-radius:\s*50%/);
  });

  it("sends people to enrol on a torn paper button", () => {
    expect(doc.querySelector('main a[href="/elf/join"]')!.className).toBe("elf-btn elf-btn--crimson");
    expect(doc.querySelector(".site-main .btn")).toBeNull();
  });
});
