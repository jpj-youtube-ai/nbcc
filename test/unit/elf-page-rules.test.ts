// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderRulesPage } from "../../src/elf/pages/rules";
import { ELF_DEFAULTS } from "../../src/elf/settings";

// NBCC Elf Detective School: the rules page, which a grown up agrees to when enrolling.

const doc = new DOMParser().parseFromString(renderRulesPage({ settings: { ...ELF_DEFAULTS, schoolOn: true } }), "text/html");
const words = (doc.querySelector("main")?.textContent ?? "").replace(/\s+/g, " ");

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
