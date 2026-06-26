// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-030 (REQ-022): the four monthly give tiers mounted into the give-widget's
// #tiersMonthly container (built empty by TASK-028). Bronze/Silver/Gold/Platinum
// at £10/£25/£50/£100 per month, each with its exact leaflet headline and
// description, on the shared .card/.tier surface, plus an other-monthly-amount
// line linking to giving@nightbeforechristmas.co.uk. The checkout contract
// (data-amount/startCheckout) is REQ-028 and the side-panel content REQ-024,
// both out of scope here. Parsed with jsdom; mirrors give-once-tiers.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

// The four leaflet tiers, in order: plan name, monthly amount, exact headline.
const TIERS: Array<{ name: string; amount: string; head: string }> = [
  { name: "Bronze", amount: "£10", head: "Building towards Christmas joy" },
  { name: "Silver", amount: "£25", head: "Halfway to a Red Bag Full of Joy" },
  { name: "Gold", amount: "£50", head: "One Christmas made brighter" },
  { name: "Platinum", amount: "£100", head: "More joy, every month" },
];

describe("give monthly tiers (REQ-022)", () => {
  const monthly = doc.querySelector("#tiersMonthly");
  const tiers = [...(monthly?.querySelectorAll(".give-tier") ?? [])];

  it("mounts the tiers into the #tiersMonthly container", () => {
    expect(monthly).not.toBeNull();
    expect(norm(monthly?.textContent).length).toBeGreaterThan(0);
    expect(tiers.length).toBeGreaterThan(0);
  });

  it("renders the four named tiers in order", () => {
    expect(tiers).toHaveLength(4);
    expect(tiers.map((t) => norm(t.querySelector(".give-tier-name")?.textContent))).toEqual(
      TIERS.map((t) => t.name),
    );
  });

  it("shows each tier's monthly amount in order", () => {
    expect(tiers.map((t) => norm(t.querySelector(".give-amount")?.textContent))).toEqual(
      TIERS.map((t) => t.amount),
    );
  });

  it("shows the per-month cadence on each amount (REQ-031)", () => {
    for (const t of tiers) {
      expect(norm(t.querySelector(".give-cadence")?.textContent).toLowerCase()).toContain("per month");
    }
  });

  it("renders each tier's exact leaflet headline in order", () => {
    expect(tiers.map((t) => norm(t.querySelector(".give-tier-head")?.textContent))).toEqual(
      TIERS.map((t) => t.head),
    );
  });

  it("carries a leaflet description on each tier (REQ-032)", () => {
    for (const t of tiers) {
      expect(t.tagName).toBe("BUTTON");
      expect(norm(t.querySelector(".give-tier-desc")?.textContent).length).toBeGreaterThan(0);
    }
  });

  it("reuses the shared .card/.tier surface (REQ-009)", () => {
    for (const t of tiers) {
      expect(t.classList.contains("card")).toBe(true);
      expect(t.classList.contains("tier")).toBe(true);
    }
  });

  it("offers an other-monthly-amount line linking to the giving mailbox", () => {
    const link = monthly?.querySelector('a[href^="mailto:giving@nightbeforechristmas.co.uk"]');
    expect(link).not.toBeNull();
    expect(norm(link?.textContent).length).toBeGreaterThan(0);
  });

  it("does NOT wire the checkout contract yet (that is REQ-028)", () => {
    for (const t of tiers) {
      expect(t.getAttribute("data-amount")).toBeNull();
      expect(t.getAttribute("data-plan")).toBeNull();
      expect(t.getAttribute("data-mode")).toBeNull();
      expect(t.getAttribute("onclick")).toBeNull();
    }
  });

  it("writes the visible monthly copy without dashes (REQ-031)", () => {
    expect(norm(monthly?.textContent)).not.toMatch(/[–—-]/);
  });

  it("declares a GIVE MONTHLY TIERS block with the cadence label (REQ-022)", () => {
    expect(css).toMatch(/\.give-cadence\s*\{/);
  });
});
