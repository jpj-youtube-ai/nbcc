// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-029 (REQ-021): the give-once tiers mounted into the give-widget's
// #tiersOnce container (built empty by TASK-028). Four suggested one-off amounts
// (£10/£25/£50/£100) on the shared .card/.tier surface, the £25 tile marked
// "Most chosen", plus a labelled choose-your-own-amount field. The checkout
// contract (data-amount/startCheckout) is REQ-028 and the monthly tiers REQ-022,
// both out of scope here. Parsed with jsdom; mirrors give-widget.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const AMOUNTS = ["£10", "£25", "£50", "£100"];

describe("give once tiers (REQ-021)", () => {
  const once = doc.querySelector("#tiersOnce");
  const tiers = [...(once?.querySelectorAll(".give-tier") ?? [])];

  it("mounts the tiers into the #tiersOnce container", () => {
    expect(once).not.toBeNull();
    expect(norm(once?.textContent).length).toBeGreaterThan(0);
    expect(tiers.length).toBeGreaterThan(0);
  });

  it("renders the four suggested amounts in order", () => {
    expect(tiers).toHaveLength(4);
    expect(tiers.map((t) => norm(t.querySelector(".give-amount")?.textContent))).toEqual(AMOUNTS);
  });

  it("makes each amount a focusable control with a description (REQ-032)", () => {
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

  it("marks the £25 tier with a visible 'Most chosen' marker", () => {
    const featured = tiers[1];
    expect(norm(featured.querySelector(".give-amount")?.textContent)).toBe("£25");
    const flag = featured.querySelector(".give-flag");
    expect(flag).not.toBeNull();
    expect(norm(flag?.textContent).toLowerCase()).toContain("most chosen");
  });

  it("offers a choose-your-own-amount option with a real label (REQ-032)", () => {
    const custom = once?.querySelector(".give-tier-custom");
    expect(custom).not.toBeNull();
    const input = custom?.querySelector("input");
    const label = custom?.querySelector("label");
    expect(input).not.toBeNull();
    expect(input?.id).toBeTruthy();
    expect(label?.getAttribute("for")).toBe(input?.id);
    expect(norm(label?.textContent).length).toBeGreaterThan(0);
  });

  it("wires the checkout contract: data-mode=once, empty data-plan, data-amount in pence (REQ-028)", () => {
    const pence = ["1000", "2500", "5000", "10000"];
    tiers.forEach((t, i) => {
      expect(t.getAttribute("data-mode")).toBe("once");
      expect(t.getAttribute("data-plan")).toBe("");
      expect(t.getAttribute("data-amount")).toBe(pence[i]);
      // Wiring is via the shared startCheckout listener, never an inline handler.
      expect(t.getAttribute("onclick")).toBeNull();
    });
  });

  it("flags the suggested set with a CONTENT VERIFICATION comment", () => {
    expect(html).toMatch(/CONTENT VERIFICATION \(REQ-021\)/);
  });

  it("writes the visible once copy without dashes (REQ-031)", () => {
    expect(norm(once?.textContent)).not.toMatch(/[–—-]/);
  });

  it("declares a GIVE ONCE TIERS grid and token-only flag (REQ-021)", () => {
    expect(css).toMatch(/\.give-tiers\s*\{[^}]*display:\s*grid/);
    expect(css).toMatch(/\.give-flag\s*\{[^}]*background:\s*var\(--crimson\)/);
  });
});
