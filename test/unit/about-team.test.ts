// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-024 (REQ-016): about.html's "meet the team" responsive grid — ten member
// cards (portrait placeholder + name + role), six "Volunteer Elf" placeholders
// flagged for confirmation, and a 5/3/2 responsive grid. Parsed with jsdom;
// mirrors about-our-story.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "about.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("about meet the team (REQ-016)", () => {
  const section = doc.querySelector("section.meet-team");
  const members = [...(section?.querySelectorAll(".member") ?? [])];

  it("renders the team section, named by its heading", () => {
    expect(section).not.toBeNull();
    expect(section?.getAttribute("aria-labelledby")).toBe(section?.querySelector("h2")?.id);
  });

  it("renders exactly ten member cards", () => {
    expect(members).toHaveLength(10);
  });

  it("each card has a name, a role and an aria-hidden icon placeholder, no <img>", () => {
    for (const m of members) {
      expect(norm(m.querySelector(".member-name")?.textContent).length).toBeGreaterThan(0);
      expect(norm(m.querySelector(".member-role")?.textContent).length).toBeGreaterThan(0);
      expect(m.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(m.querySelector("img")).toBeNull();
    }
  });

  it("has exactly six 'Volunteer Elf' roles, flagged for confirmation", () => {
    const roles = members.map((m) => norm(m.querySelector(".member-role")?.textContent));
    expect(roles.filter((r) => r === "Volunteer Elf")).toHaveLength(6);
    // the placeholders are called out in a content-verification HTML comment
    expect(html).toMatch(/<!--[\s\S]*?Volunteer Elf[\s\S]*?-->/i);
  });

  it("declares a 5 / 3 / 2 responsive grid at the documented breakpoints", () => {
    expect(css).toMatch(/\.team-grid\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*1fr\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*?\.team-grid\s*\{[^}]*repeat\(3,\s*1fr\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*680px\)\s*\{[\s\S]*?\.team-grid\s*\{[^}]*repeat\(2,\s*1fr\)/);
  });

  it("leaves the intro, story, page-sections and closing CTA intact", () => {
    expect(doc.querySelector("main .about-intro")).not.toBeNull();
    expect(doc.querySelector("main .our-story")).not.toBeNull();
    expect(doc.querySelector('main .page-sections[data-region="sections"]')).not.toBeNull();
    expect(doc.querySelector("main .closing-cta")).not.toBeNull();
  });
});
