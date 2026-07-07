// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-150 (REQ-016): about.html's "Meet the Volunteers" section — two grids on
// the shared .team/.member surface:
//   • .team-leads: five leads/trustees in ROLE order (not alphabetical), each
//     with a headshot, name, role and a mailto contact link.
//   • .team-elves: the thirteen Volunteer Elves in ALPHABETICAL order, under a
//     "Volunteer Elves" subheading. Elves with a supplied headshot use a
//     team-<name>.jpg <img>; those still awaiting one use a .member-photo
//     .is-pending placeholder tile.
// Parsed with jsdom; mirrors about-our-story.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "about.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const LEADS = [
  { nm: "Jodie", rl: "Head Elf (Trustee)", em: "jodie@nbcc.scot" },
  { nm: "Isabel", rl: "Procurement (Trustee)", em: "isabel@nbcc.scot" },
  { nm: "Kenny", rl: "Finance (Trustee)", em: "kenny@nbcc.scot" },
  { nm: "Jaimie", rl: "Project Manager", em: "jaimie@nbcc.scot" },
  { nm: "Jon", rl: "Marketing", em: "jon@nbcc.scot" },
];

const ELVES = [
  "Dawn", "Jill", "Lisa-Marie", "Liz", "Lucy", "Margaret", "Matt",
  "Morag", "Paul", "Scott", "Sue", "Tygan", "Vicky",
];
// Elves whose headshot is in assets/img — now all thirteen.
const ELVES_WITH_PHOTO = ["Dawn", "Jill", "Lisa-Marie", "Liz", "Lucy", "Margaret", "Matt", "Morag", "Paul", "Scott", "Sue", "Tygan", "Vicky"];

describe("about meet the volunteers (REQ-016)", () => {
  const section = doc.querySelector("section.meet-team");

  it("renders the section titled 'Meet the Volunteers', named by its heading", () => {
    expect(section).not.toBeNull();
    const h2 = section?.querySelector("h2");
    expect(section?.getAttribute("aria-labelledby")).toBe(h2?.id);
    expect(norm(h2?.textContent)).toBe("Meet the Volunteers");
  });

  describe("leads grid (.team-leads)", () => {
    const leads = [...(section?.querySelectorAll(".team-leads .member") ?? [])];

    it("lists the five leads in the given role order, each with photo, name, role and email", () => {
      expect(leads).toHaveLength(LEADS.length);
      leads.forEach((m, i) => {
        expect(norm(m.querySelector(".nm")?.textContent)).toBe(LEADS[i].nm);
        expect(norm(m.querySelector(".rl")?.textContent)).toBe(LEADS[i].rl);
        const em = m.querySelector("a.em");
        expect(em?.getAttribute("href")).toBe(`mailto:${LEADS[i].em}`);
        expect(norm(em?.textContent)).toBe(LEADS[i].em);
        const img = m.querySelector("img");
        expect(img?.getAttribute("src")).toMatch(/^\/assets\/img\/team-[a-z]+\.jpg$/);
        expect(img?.getAttribute("width")).toBe("640");
        expect(img?.getAttribute("height")).toBe("800");
        expect(img?.getAttribute("loading")).toBe("lazy");
        expect(norm(img?.getAttribute("alt")).length).toBeGreaterThan(0);
      });
    });
  });

  describe("volunteer elves grid (.team-elves)", () => {
    const elves = [...(section?.querySelectorAll(".team-elves .member") ?? [])];
    const names = elves.map((m) => norm(m.querySelector(".nm")?.textContent));

    it("has a 'Volunteer Elves' subheading before the grid", () => {
      const sub = section?.querySelector(".team-subhead");
      expect(norm(sub?.textContent)).toBe("Volunteer Elves");
    });

    it("lists all thirteen elves in alphabetical order", () => {
      expect(names).toEqual(ELVES);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });

    it("uses a team-<name>.jpg headshot for elves with a photo, a placeholder for the rest", () => {
      for (const m of elves) {
        const nm = norm(m.querySelector(".nm")?.textContent);
        if (ELVES_WITH_PHOTO.includes(nm)) {
          const img = m.querySelector("img");
          expect(img?.getAttribute("src")).toMatch(/^\/assets\/img\/team-[a-z]+\.jpg$/);
          expect(img?.getAttribute("width")).toBe("640");
          expect(img?.getAttribute("height")).toBe("800");
          expect(m.querySelector(".member-photo.is-pending")).toBeNull();
        } else {
          expect(m.querySelector("img")).toBeNull();
          const ph = m.querySelector(".member-photo.is-pending");
          expect(ph).not.toBeNull();
          expect(ph?.getAttribute("aria-label")?.length).toBeGreaterThan(0);
        }
      }
    });

    it("has no placeholder tiles awaiting a headshot", () => {
      expect(section?.querySelectorAll(".team-elves .member-photo.is-pending")).toHaveLength(
        ELVES.length - ELVES_WITH_PHOTO.length,
      );
    });
  });

  it("declares a 5 / 3 / 2 responsive grid at the documented breakpoints", () => {
    expect(css).toMatch(/\.team\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*1fr\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*980px\)\s*\{[\s\S]*?\.team\s*\{[^}]*repeat\(3,\s*1fr\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*680px\)\s*\{[\s\S]*?\.team\s*\{[^}]*repeat\(2,\s*1fr\)/);
  });

  it("leaves the intro, story, page-sections and closing CTA intact", () => {
    expect(doc.querySelector("main .about-intro")).not.toBeNull();
    expect(doc.querySelector("main .our-story")).not.toBeNull();
    expect(doc.querySelector('main .page-sections[data-region="sections"]')).not.toBeNull();
    expect(doc.querySelector("main .closing-cta")).not.toBeNull();
  });
});
