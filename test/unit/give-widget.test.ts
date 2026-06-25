// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-028 (REQ-020): donate.html's give-widget shell — the conversion card, a
// two-column layout (main column + Holly Green side panel) on the shared
// .card/.card-lg surface, with a "give once" / "give monthly" segmented toggle.
// The toggle (initGiveToggle in main.js) shows/hides two placeholder tier
// containers (#tiersOnce/#tiersMonthly) that later REQs fill; "give monthly" is
// the default. Static markup is parsed with jsdom; behaviour is exercised
// against the real initGiveToggle, mirroring nav.test.ts. Tier/side content is
// out of scope (REQ-021/022/024).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("give widget shell (REQ-020)", () => {
  const widget = doc.querySelector("section.give-widget");

  it("renders the widget section, named by its heading (REQ-032)", () => {
    expect(widget).not.toBeNull();
    expect(widget?.getAttribute("aria-labelledby")).toBe(widget?.querySelector("h2")?.id);
  });

  it("lives in the donate page-sections slot, below the intro", () => {
    expect(doc.querySelector('main .page-sections[data-region="sections"] .give-widget')).not.toBeNull();
    expect(doc.querySelector("main .donate-intro")).not.toBeNull();
  });

  it("builds a two-column card on the .card/.card-lg surface", () => {
    const card = widget?.querySelector(".give-card");
    expect(card).not.toBeNull();
    expect(card?.classList.contains("card")).toBe(true);
    expect(card?.classList.contains("card-lg")).toBe(true);
    expect(card?.querySelector(".give-main")).not.toBeNull();
    expect(card?.querySelector(".give-side")).not.toBeNull();
  });

  it("makes the side panel a Holly Green panel (cream-on-holly, token-only)", () => {
    expect(widget?.querySelector("aside.give-side")).not.toBeNull();
    expect(css).toMatch(/\.give-side\s*\{[^}]*background:\s*var\(--holly\)/);
  });

  it("renders a once/monthly toggle with two labelled controls", () => {
    const toggle = widget?.querySelector(".give-toggle");
    expect(toggle).not.toBeNull();
    const controls = [...(toggle?.querySelectorAll(".give-mode") ?? [])];
    expect(controls).toHaveLength(2);
    for (const c of controls) {
      expect(norm(c.textContent).length).toBeGreaterThan(0);
      expect(c.getAttribute("aria-pressed")).not.toBeNull();
      expect(c.getAttribute("aria-controls")).not.toBeNull();
    }
    expect(norm(controls[0].textContent).toLowerCase()).toContain("once");
    expect(norm(controls[1].textContent).toLowerCase()).toContain("monthly");
  });

  it("renders two empty tier containers for later REQs to fill", () => {
    const once = widget?.querySelector("#tiersOnce");
    const monthly = widget?.querySelector("#tiersMonthly");
    expect(once).not.toBeNull();
    expect(monthly).not.toBeNull();
    expect(norm(once?.textContent)).toBe("");
    expect(norm(monthly?.textContent)).toBe("");
  });

  it("defaults to give monthly visible without JS (progressive enhancement)", () => {
    expect(doc.querySelector("#giveMonthly")?.getAttribute("aria-pressed")).toBe("true");
    expect(doc.querySelector("#giveOnce")?.getAttribute("aria-pressed")).toBe("false");
    expect((doc.querySelector("#tiersMonthly") as HTMLElement)?.hidden).toBe(false);
    expect((doc.querySelector("#tiersOnce") as HTMLElement)?.hidden).toBe(true);
  });

  it("writes the widget copy without dashes (REQ-031)", () => {
    expect(norm(widget?.textContent)).not.toMatch(/[–—-]/);
  });
});

describe("give widget toggle behaviour (jsdom)", () => {
  const { initGiveToggle } = require(resolve(ROOT, "assets/js/main.js"));
  const widgetHtml = doc.querySelector("section.give-widget")?.outerHTML ?? "";

  const tiers = (id: string) => document.getElementById(id) as HTMLElement;
  const pressed = (id: string) => document.getElementById(id)?.getAttribute("aria-pressed");

  beforeEach(() => {
    document.body.innerHTML = widgetHtml;
    initGiveToggle(document);
  });

  it("starts on give monthly: monthly visible, once hidden", () => {
    expect(pressed("giveMonthly")).toBe("true");
    expect(pressed("giveOnce")).toBe("false");
    expect(tiers("tiersMonthly").hidden).toBe(false);
    expect(tiers("tiersOnce").hidden).toBe(true);
  });

  it("activating give once shows the once tiers and hides monthly", () => {
    (document.getElementById("giveOnce") as HTMLElement).click();
    expect(pressed("giveOnce")).toBe("true");
    expect(pressed("giveMonthly")).toBe("false");
    expect(tiers("tiersOnce").hidden).toBe(false);
    expect(tiers("tiersMonthly").hidden).toBe(true);
  });

  it("switching back to give monthly restores the monthly tiers", () => {
    (document.getElementById("giveOnce") as HTMLElement).click();
    (document.getElementById("giveMonthly") as HTMLElement).click();
    expect(pressed("giveMonthly")).toBe("true");
    expect(pressed("giveOnce")).toBe("false");
    expect(tiers("tiersMonthly").hidden).toBe(false);
    expect(tiers("tiersOnce").hidden).toBe(true);
  });

  it("marks the active control with .is-active for styling", () => {
    expect(document.getElementById("giveMonthly")?.classList.contains("is-active")).toBe(true);
    (document.getElementById("giveOnce") as HTMLElement).click();
    expect(document.getElementById("giveOnce")?.classList.contains("is-active")).toBe(true);
    expect(document.getElementById("giveMonthly")?.classList.contains("is-active")).toBe(false);
  });
});
