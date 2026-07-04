// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  SINGLE_DONATION_WORDING,
  ALL_DONATIONS_WORDING,
} from "../../src/declarations/wording";

// TASK-031 (REQ-023): donate.html's Gift Aid callout — a checkbox + label inside
// the give-card's .give-main column, beneath the tier containers. The #giftAid id
// is the hook the REQ-028 checkout contract will read. The callout is gated on a
// pending registration decision: it is delimited by GIFT AID CALLOUT START/END
// comments so it can be removed cleanly if NBCC is not registered to claim Gift
// Aid. Parsed with jsdom; mirrors give-once-tiers.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("gift aid callout (REQ-023)", () => {
  const callout = doc.querySelector(".giftaid");

  it("renders the callout in the give-card main column, beneath the tiers", () => {
    expect(callout).not.toBeNull();
    expect(doc.querySelector(".give-card .give-main .giftaid")).not.toBeNull();
  });

  it("has a #giftAid checkbox tied to a real <label for>", () => {
    const input = doc.querySelector("#giftAid") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.getAttribute("type")).toBe("checkbox");
    const label = callout?.querySelector('label[for="giftAid"]');
    expect(label).not.toBeNull();
    expect(norm(label?.textContent).length).toBeGreaterThan(0);
  });

  it("does not pre-tick Gift Aid (the donor opts in)", () => {
    expect((doc.querySelector("#giftAid") as HTMLInputElement)?.hasAttribute("checked")).toBe(false);
  });

  it("states Gift Aid is worth 25% on eligible gifts, naming NBCC", () => {
    const text = norm(callout?.textContent);
    expect(text).toContain("Gift Aid");
    expect(text).toContain("25%");
    expect(text.toLowerCase()).toContain("eligible");
    expect(text).toContain("NBCC");
  });

  it("writes the callout copy without dashes (REQ-031)", () => {
    expect(norm(callout?.textContent)).not.toMatch(/[–—-]/);
  });

  it("documents a gating switch to remove the callout if NBCC is not registered", () => {
    expect(html).toMatch(/GIFT AID CALLOUT START/);
    expect(html).toMatch(/GIFT AID CALLOUT END/);
    expect(html).toMatch(/CONTENT VERIFICATION \(REQ-023\)/);
  });

  it("notes the REQ-028 checkout dependency on the #giftAid id", () => {
    expect(html).toMatch(/REQ-028/);
  });

  it("styles the callout token-only (no hex/rgb in the .giftaid rules)", () => {
    // The settled stylesheet labels the callout rules with a "gift-aid callout" block header.
    expect(css).toMatch(/gift-aid callout/i);
    const giftaidCss = [...css.matchAll(/\.giftaid[^{]*\{[^}]*\}/g)].map((m) => m[0]).join("\n");
    expect(giftaidCss).not.toBe("");
    expect(giftaidCss.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(giftaidCss.match(/\brgba?\(/gi) ?? []).toEqual([]);
  });
});

// REQ-042 (TASK-052): the opt-in tick must be bound to the VERBATIM HMRC
// declaration the donor sees, not generic copy — and the shown statement must
// switch with the give mode: the single-donation template for give once, the
// all-donations template for give monthly (the default). The exact text is the
// source-of-truth snapshot in src/declarations/wording.ts. We import those
// snapshots and assert the hand-synced HTML matches them (no build step renders
// the page, so the wording is duplicated into donate.html and this guard fails
// the instant the two drift apart).
describe("gift aid declaration wording (REQ-042)", () => {
  const callout = doc.querySelector(".giftaid");
  const label = callout?.querySelector('label[for="giftAid"]');
  const statementFor = (mode: string) =>
    label?.querySelector(`.giftaid-statement[data-mode="${mode}"]`);

  it("binds the tick to a verbatim HMRC statement per give mode, inside the label", () => {
    // Both statements live inside the <label for="giftAid"> so the affirmative
    // tick is bound to the exact declaration on screen (REQ-032 real label).
    expect(statementFor("once")).not.toBeNull();
    expect(statementFor("monthly")).not.toBeNull();
  });

  it("shows the single-donation snapshot for give once (verbatim, drift-guarded)", () => {
    expect(norm(statementFor("once")?.textContent)).toBe(norm(SINGLE_DONATION_WORDING.wording_snapshot));
  });

  it("shows the all-donations snapshot for give monthly (verbatim, drift-guarded)", () => {
    expect(norm(statementFor("monthly")?.textContent)).toBe(norm(ALL_DONATIONS_WORDING.wording_snapshot));
  });

  it("defaults to the monthly (all-donations) statement without JS, single hidden", () => {
    // Progressive enhancement: monthly is the default mode, so its statement is
    // visible in the markup and the once statement ships hidden; initGiveToggle
    // swaps them. Mirrors the #tiersMonthly/#tiersOnce default.
    expect(statementFor("monthly")?.hasAttribute("hidden")).toBe(false);
    expect(statementFor("once")?.hasAttribute("hidden")).toBe(true);
  });

  it("never pre-ticks the opt-in (affirmative consent only)", () => {
    const input = doc.querySelector("#giftAid") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.hasAttribute("checked")).toBe(false);
    expect(input?.checked).toBe(false);
  });
});

// The visible statement must track the mode at runtime, driven by the same
// initGiveToggle that swaps #tiersOnce/#tiersMonthly. Exercised against the real
// main.js in jsdom, mirroring give-widget.test.ts.
describe("gift aid statement follows the give mode (jsdom, REQ-042)", () => {
  const { initGiveToggle } = require(resolve(ROOT, "assets/js/main.js"));
  const widgetHtml = doc.querySelector("section.give-widget")?.outerHTML ?? "";
  const stmt = (mode: string) =>
    document.querySelector(`.giftaid-statement[data-mode="${mode}"]`) as HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = widgetHtml;
    initGiveToggle(document);
  });

  it("starts on give monthly: the all-donations statement visible, single hidden", () => {
    expect(stmt("monthly").hidden).toBe(false);
    expect(stmt("once").hidden).toBe(true);
  });

  it("activating give once swaps to the single-donation statement", () => {
    (document.getElementById("giveOnce") as HTMLElement).click();
    expect(stmt("once").hidden).toBe(false);
    expect(stmt("monthly").hidden).toBe(true);
  });

  it("switching back to give monthly restores the all-donations statement", () => {
    (document.getElementById("giveOnce") as HTMLElement).click();
    (document.getElementById("giveMonthly") as HTMLElement).click();
    expect(stmt("monthly").hidden).toBe(false);
    expect(stmt("once").hidden).toBe(true);
  });
});
