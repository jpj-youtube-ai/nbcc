// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  groupPublicSupporters,
  supporterDisplayName,
  type SupporterSourceRow,
} from "../../src/db/donations-model";
import { renderSupportersPage, renderSupporterTiers } from "../../src/routes/site";

// TASK-071 (REQ-035); opt-in monthly 4-band rework TASK-223: the /supporters page renders ONLY
// supporters who OPTED IN and give MONTHLY, grouped into four metal bands (Bronze/Silver/Gold/
// Platinum). The opt-in + banding + suppression + bad-word rules are pure (donations-model) and the
// HTML assembly is pure (renderSupportersPage over the supporters.html template) — both DB-free here.
// The DB read wiring (listPublicSupporters) is covered by test/unit/supporters-read.test.ts;
// supporters.test.ts (the static file's structure) covers the 4-tier fallback markup.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const template = readFileSync(resolve(ROOT, "supporters.html"), "utf8");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

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

// A row factory: everything defaults to "not a supporter" (no paid monthly gift, no opt-in) so each
// case turns on exactly the fields it sets.
function row(overrides: Partial<SupporterSourceRow> & { fullName: string }): SupporterSourceRow {
  return { donorType: "individual", monthlyAmountPence: null, ...overrides };
}

const rows: SupporterSourceRow[] = [
  // Opted-in monthly BUSINESS (company) at platinum, with a custom credit name → shows as an org.
  row({
    donorType: "company",
    fullName: "Casey",
    businessName: "Acme Trading",
    monthlyAmountPence: 10000,
    businessListOptIn: true,
    businessCreditName: "Acme",
  }),
  // Opted-in monthly INDIVIDUAL at gold, with a custom credit name → shows as a person by credit name.
  row({
    fullName: "Ada Lovelace",
    monthlyAmountPence: 5000,
    individualListOptIn: true,
    individualCreditName: "Ada L.",
  }),
  // Opted-in monthly INDIVIDUAL at silver, no credit name → shows by full name.
  row({ fullName: "Beth Silver", monthlyAmountPence: 2500, individualListOptIn: true }),
  // Opted-in monthly BUSINESS by business_name (donor_type individual) at bronze, no credit name → org
  // by business name.
  row({ fullName: "Sam", businessName: "Bramble Cafe", monthlyAmountPence: 1000, businessListOptIn: true }),
  // A one-off donor (no paid monthly gift) who opted in → NOT shown.
  row({ fullName: "One Off Ollie", monthlyAmountPence: null, individualListOptIn: true }),
  // A monthly donor who did NOT opt in → NOT shown.
  row({ fullName: "Silent Sid", monthlyAmountPence: 5000, individualListOptIn: false }),
  // Anonymous, even though opted-in monthly gold → NOT shown.
  row({ fullName: "Anon Ghost", monthlyAmountPence: 5000, individualListOptIn: true, anonymous: true }),
  // Admin-hidden, even though opted-in monthly gold → NOT shown.
  row({
    fullName: "Hidden Harry",
    monthlyAmountPence: 5000,
    individualListOptIn: true,
    hiddenFromSupporters: true,
  }),
  // Under £10/mo, opted-in monthly → NOT shown (below the lowest band).
  row({ fullName: "Tiny Tim", monthlyAmountPence: 900, individualListOptIn: true }),
  // A business that captured but did NOT tick list-on-supporters (businessListOptIn false) → NOT shown.
  row({
    donorType: "company",
    fullName: "Quiet Co contact",
    businessName: "Quiet Company",
    monthlyAmountPence: 10000,
    businessListOptIn: false,
  }),
];

describe("groupPublicSupporters — opt-in monthly 4-band rules (TASK-223)", () => {
  const tiers = groupPublicSupporters(rows);
  const allNames = () =>
    [...tiers.bronze, ...tiers.silver, ...tiers.gold, ...tiers.platinum].map((s) => s.name);

  it("shows an opted-in monthly business by its credit name, as an organisation, in its band", () => {
    expect(tiers.platinum).toContainEqual({ name: "Acme", kind: "organisation" });
  });

  it("shows an opted-in monthly individual by credit name, and by full name when none is set", () => {
    expect(tiers.gold).toContainEqual({ name: "Ada L.", kind: "person" });
    expect(tiers.silver).toContainEqual({ name: "Beth Silver", kind: "person" });
  });

  it("treats a donor with a business_name as an organisation (business opt-in channel)", () => {
    expect(tiers.bronze).toContainEqual({ name: "Bramble Cafe", kind: "organisation" });
  });

  it("excludes a one-off donor, a non-opted-in monthly donor, and an under-£10/mo gift", () => {
    expect(allNames()).not.toContain("One Off Ollie");
    expect(allNames()).not.toContain("Silent Sid");
    expect(allNames()).not.toContain("Tiny Tim");
  });

  it("excludes an anonymous donor and an admin-hidden donor even when opted-in monthly", () => {
    expect(allNames()).not.toContain("Anon Ghost");
    expect(allNames()).not.toContain("Hidden Harry");
  });

  it("excludes a business that did not tick list-on-supporters", () => {
    expect(allNames()).not.toContain("Quiet Company");
  });

  it("groups into four bands and sorts each alphabetically by display name", () => {
    for (const tier of [tiers.bronze, tiers.silver, tiers.gold, tiers.platinum]) {
      const names = tier.map((s) => s.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
    // Every shown entry landed in the band its monthly amount earns.
    expect(tiers.platinum.map((s) => s.name)).toContain("Acme"); // £100/mo
    expect(tiers.gold.map((s) => s.name)).toContain("Ada L."); // £50/mo
    expect(tiers.silver.map((s) => s.name)).toContain("Beth Silver"); // £25/mo
    expect(tiers.bronze.map((s) => s.name)).toContain("Bramble Cafe"); // £10/mo
  });

  it("is a render-time safety net: omits any entry whose FINAL display name trips the bad-word filter", () => {
    const filtered = groupPublicSupporters([
      row({
        donorType: "company",
        fullName: "Clean Contact",
        businessName: "Cleanco",
        monthlyAmountPence: 10000,
        businessListOptIn: true,
        businessCreditName: "Fuck Co",
      }),
    ]);
    const names = [...filtered.bronze, ...filtered.silver, ...filtered.gold, ...filtered.platinum].map(
      (s) => s.name,
    );
    expect(names).not.toContain("Fuck Co");
    expect(names).toHaveLength(0);
  });
});

describe("groupPublicSupporters — grandfathered pre-223 supporters (TASK-228)", () => {
  // A grandfathered donor is kept on the wall WITHOUT the TASK-223 opt-in, banded by their MAX PAID
  // amount across ANY frequency (four metal bands, no £10 floor). The opt-in monthly path still takes
  // precedence for a donor who is BOTH grandfathered and a qualifying opt-in monthly supporter.
  const gf = (overrides: Partial<SupporterSourceRow> & { fullName: string }): SupporterSourceRow =>
    row({ grandfathered: true, ...overrides });

  const names = (t: Record<"bronze" | "silver" | "gold" | "platinum", { name: string }[]>) =>
    [...t.bronze, ...t.silver, ...t.gold, ...t.platinum].map((s) => s.name);

  it("shows a grandfathered ONE-OFF donor, banded by their max paid amount (any frequency)", () => {
    // No monthly gift at all (one-off only), but £50 paid → grandfathered into Gold as a person.
    const t = groupPublicSupporters([
      gf({ fullName: "Olive One-off", monthlyAmountPence: null, maxPaidAmountPence: 5000 }),
    ]);
    expect(t.gold).toContainEqual({ name: "Olive One-off", kind: "person" });
  });

  it("shows a grandfathered SUB-£10 donor in Bronze (no £10 floor drops them)", () => {
    const t = groupPublicSupporters([
      gf({ fullName: "Penny Small", monthlyAmountPence: null, maxPaidAmountPence: 500 }),
    ]);
    expect(t.bronze).toContainEqual({ name: "Penny Small", kind: "person" });
  });

  it("shows a grandfathered BUSINESS one-off as an organisation, by business name, banded by amount", () => {
    const t = groupPublicSupporters([
      gf({
        donorType: "company",
        fullName: "Contact",
        businessName: "Old Faithful Ltd",
        monthlyAmountPence: null,
        maxPaidAmountPence: 3000, // £30 → silver
      }),
    ]);
    expect(t.silver).toContainEqual({ name: "Old Faithful Ltd", kind: "organisation" });
  });

  it("does NOT show a grandfathered donor who is anonymous", () => {
    const t = groupPublicSupporters([
      gf({ fullName: "Anon Grand", maxPaidAmountPence: 5000, anonymous: true }),
    ]);
    expect(names(t)).not.toContain("Anon Grand");
  });

  it("does NOT show a grandfathered donor who is admin-hidden", () => {
    const t = groupPublicSupporters([
      gf({ fullName: "Hidden Grand", maxPaidAmountPence: 5000, hiddenFromSupporters: true }),
    ]);
    expect(names(t)).not.toContain("Hidden Grand");
  });

  it("does NOT show a non-grandfathered, non-opted-in donor (even with a paid one-off gift)", () => {
    const t = groupPublicSupporters([
      row({ fullName: "Nobody Special", monthlyAmountPence: null, maxPaidAmountPence: 5000 }),
    ]);
    expect(names(t)).not.toContain("Nobody Special");
  });

  it("still shows a NEW opt-in monthly supporter (not grandfathered) by their monthly band + credit name", () => {
    const t = groupPublicSupporters([
      row({
        fullName: "Nadia New",
        monthlyAmountPence: 5000,
        individualListOptIn: true,
        individualCreditName: "Nadia N.",
      }),
    ]);
    expect(t.gold).toContainEqual({ name: "Nadia N.", kind: "person" });
  });

  it("uses the MONTHLY band for a donor who is BOTH grandfathered and an opted-in monthly supporter", () => {
    // Grandfather amount would be Platinum (£200 one-off), but the £50/mo opt-in monthly gift wins →
    // Gold, by credit name. Precedence: opt-in monthly over grandfathering.
    const t = groupPublicSupporters([
      gf({
        fullName: "Dora Double",
        maxPaidAmountPence: 20000, // £200 → grandfather Platinum
        monthlyAmountPence: 5000, // £50/mo → monthly Gold
        individualListOptIn: true,
        individualCreditName: "Dora D.",
      }),
    ]);
    expect(t.gold).toContainEqual({ name: "Dora D.", kind: "person" });
    expect(t.platinum.map((s) => s.name)).not.toContain("Dora D.");
  });

  it("grandfathers a donor with a paid monthly gift who did NOT opt in (banded by max paid amount)", () => {
    // Not an opt-in monthly supporter (opt-in false), but grandfathered → still shown, banded by their
    // MAX PAID amount (here the £50/mo gift, £50 → Gold), by full name (no credit name applied).
    const t = groupPublicSupporters([
      gf({
        fullName: "Gina Grand",
        monthlyAmountPence: 5000,
        maxPaidAmountPence: 5000,
        individualListOptIn: false,
      }),
    ]);
    expect(t.gold).toContainEqual({ name: "Gina Grand", kind: "person" });
  });
});

describe("supporters empty-state (TASK-227): a warm invitation when no one has opted in", () => {
  const empty = { bronze: [], silver: [], gold: [], platinum: [] };

  it("renderSupporterTiers returns the empty-state, not four bare band headings", () => {
    const html = renderSupporterTiers(empty);
    expect(html).not.toContain("supporter-tier");
    expect(html).toContain("supporters-empty");
    expect(norm(html)).toContain("will be celebrated here");
    expect(html).toContain('href="/donate"');
    expect(norm(html)).not.toMatch(/[–—]/);
  });

  it("renderSupportersPage injects the empty-state into the page when there are no supporters", () => {
    const doc = new DOMParser().parseFromString(renderSupportersPage(template, empty), "text/html");
    expect(doc.querySelectorAll("main .supporter-tier")).toHaveLength(0);
    expect(doc.querySelector("main .supporters-empty")).not.toBeNull();
    expect(norm(doc.querySelector(".supporters-empty-lead")?.textContent)).toContain("monthly");
  });
});

describe("renderSupportersPage — injects the opted-in monthly donors into the supporters.html markup", () => {
  const html = renderSupportersPage(template, groupPublicSupporters(rows));
  const doc = new DOMParser().parseFromString(html, "text/html");

  it("keeps the four Bronze/Silver/Gold/Platinum tier sections in order", () => {
    const tiers = [...doc.querySelectorAll("main .supporter-tier")];
    expect(tiers.map((t) => norm(t.querySelector(".supporter-tier-name")?.textContent))).toEqual([
      "Bronze",
      "Silver",
      "Gold",
      "Platinum",
    ]);
  });

  it("renders the opted-in donors (incl. a Platinum entry) and excludes the rest", () => {
    const names = [...doc.querySelectorAll("main .supporter .supporter-name")].map((n) => norm(n.textContent));
    expect(names).toContain("Acme"); // platinum business
    expect(names).toContain("Ada L."); // gold individual
    expect(names).toContain("Bramble Cafe"); // bronze business
    expect(names).not.toContain("One Off Ollie");
    expect(names).not.toContain("Anon Ghost");
    expect(names).not.toContain("Hidden Harry");
  });

  it("puts the Platinum entry inside the Platinum section", () => {
    const platinum = [...doc.querySelectorAll("main .supporter-tier")].find(
      (t) => norm(t.querySelector(".supporter-tier-name")?.textContent) === "Platinum",
    );
    const names = [...(platinum?.querySelectorAll(".supporter-name") ?? [])].map((n) => norm(n.textContent));
    expect(names).toContain("Acme");
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
      platinum: [],
    });
    expect(html).toContain("Sam&#39;s Bakes");
    expect(html).not.toContain("Sam's Bakes");
  });
});
