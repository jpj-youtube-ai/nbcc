// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  groupPublicSupporters,
  supporterTierForAmount,
  supporterDisplayName,
  type SupporterSourceRow,
} from "../../src/db/donations-model";
import { renderSupportersPage, renderSupporterTiers } from "../../src/routes/site";

// TASK-071 (REQ-035): the /supporters page now renders the real, donation-sourced donor
// list. The tiering / name / anonymous-exclusion logic is pure (donations-model) and the
// HTML assembly is pure (renderSupportersPage over the supporters.html template) — both
// DB-free-testable here. The DB read wiring (listPublicSupporters) is covered by
// test/unit/supporters-read.test.ts; the true DB-backed path by features/supporters.feature.
// supporters.test.ts (the static file's structure) continues to pass unchanged.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const template = readFileSync(resolve(ROOT, "supporters.html"), "utf8");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("supporterTierForAmount — give-monthly thresholds", () => {
  it("bands by amount: gold ≥ £50, silver ≥ £25, else bronze (platinum folds into gold)", () => {
    expect(supporterTierForAmount(999)).toBe("bronze");
    expect(supporterTierForAmount(2500)).toBe("silver");
    expect(supporterTierForAmount(4999)).toBe("silver");
    expect(supporterTierForAmount(5000)).toBe("gold");
    expect(supporterTierForAmount(10000)).toBe("gold"); // platinum-level gift → Gold
  });
});

describe("supporterDisplayName", () => {
  it("uses business name for a company, full name for an individual", () => {
    expect(supporterDisplayName({ donorType: "company", fullName: "Casey", businessName: "Acme Ltd" })).toBe(
      "Acme Ltd",
    );
    expect(supporterDisplayName({ donorType: "individual", fullName: "Ada Lovelace" })).toBe("Ada Lovelace");
  });

  it("uses business name for an individual sole trader that carries one", () => {
    expect(
      supporterDisplayName({ donorType: "individual", fullName: "Sam", businessName: "Sam's Bakes" }),
    ).toBe("Sam's Bakes");
  });
});

const rows: SupporterSourceRow[] = [
  { donorType: "individual", fullName: "Zara Individual", amountPence: 5000 }, // gold, person
  { donorType: "company", fullName: "Casey", businessName: "Beacon Trading", amountPence: 2500 }, // silver, org
  { donorType: "individual", fullName: "Anon Ghost", amountPence: 5000, anonymous: true }, // excluded
  { donorType: "individual", fullName: "Adam Bronze", amountPence: 1000 }, // bronze, person
  { donorType: "individual", fullName: "Beth Gold", amountPence: 9000 }, // gold, person
];

describe("groupPublicSupporters", () => {
  const tiers = groupPublicSupporters(rows);

  it("never lists an anonymous donor in any tier", () => {
    const allNames = [...tiers.bronze, ...tiers.silver, ...tiers.gold].map((s) => s.name);
    expect(allNames).not.toContain("Anon Ghost");
  });

  it("places donors in the tier their amount earns", () => {
    expect(tiers.gold.map((s) => s.name)).toEqual(["Beth Gold", "Zara Individual"]);
    expect(tiers.silver.map((s) => s.name)).toEqual(["Beacon Trading"]);
    expect(tiers.bronze.map((s) => s.name)).toEqual(["Adam Bronze"]);
  });

  it("labels a company as an organisation and an individual as a person", () => {
    expect(tiers.silver[0]).toEqual({ name: "Beacon Trading", kind: "organisation" });
    expect(tiers.gold[0].kind).toBe("person");
  });

  it("sorts each tier alphabetically by display name", () => {
    for (const tier of [tiers.bronze, tiers.silver, tiers.gold]) {
      const names = tier.map((s) => s.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
  });
});

describe("renderSupportersPage — injects real donors into the supporters.html markup", () => {
  const html = renderSupportersPage(template, groupPublicSupporters(rows));
  const doc = new DOMParser().parseFromString(html, "text/html");

  it("keeps the three Bronze/Silver/Gold tier sections in order", () => {
    const tiers = [...doc.querySelectorAll("main .supporter-tier")];
    expect(tiers.map((t) => norm(t.querySelector(".supporter-tier-name")?.textContent))).toEqual([
      "Bronze",
      "Silver",
      "Gold",
    ]);
  });

  it("renders the real donors and their kind label, excluding anonymous", () => {
    const names = [...doc.querySelectorAll("main .supporter .supporter-name")].map((n) => norm(n.textContent));
    expect(names).toContain("Zara Individual");
    expect(names).toContain("Beacon Trading");
    expect(names).not.toContain("Anon Ghost");
  });

  it("marks each entry person/organisation with a decorative aria-hidden SVG, no <img>", () => {
    expect(doc.querySelectorAll("main .supporter-tier img")).toHaveLength(0);
    const supporters = [...doc.querySelectorAll("main .supporter")];
    expect(supporters.length).toBeGreaterThan(0);
    for (const s of supporters) {
      expect(["person", "organisation"]).toContain(s.getAttribute("data-type"));
      const icon = s.querySelector(".supporter-icon");
      expect(icon?.tagName.toLowerCase()).toBe("svg");
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("keeps the intro above the tiers", () => {
    expect(norm(doc.querySelector("main .supporters-intro .eyebrow")?.textContent)).toBe("Supporters");
  });
});

describe("renderSupporterTiers — escapes a single quote in a donor name (G1 item 4)", () => {
  it("never leaves a raw ' in the rendered HTML attribute/text context", () => {
    const html = renderSupporterTiers({
      bronze: [{ name: "Sam's Bakes", kind: "organisation" }],
      silver: [],
      gold: [],
    });
    expect(html).toContain("Sam&#39;s Bakes");
    expect(html).not.toContain("Sam's Bakes");
  });
});
