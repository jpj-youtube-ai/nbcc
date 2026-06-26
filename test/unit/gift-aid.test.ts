// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-031 (REQ-023): donate.html's Gift Aid callout — a checkbox + label inside
// the give-card's .give-main column, beneath the tier containers. The #giftAid id
// is the hook the REQ-028 checkout contract will read. The callout is gated on a
// pending registration decision: it is delimited by GIFT AID CALLOUT START/END
// comments so it can be removed cleanly if NBCC is not registered to claim Gift
// Aid. Parsed with jsdom; mirrors give-once-tiers.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
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
    expect(css).toMatch(/GIFT AID CALLOUT \(REQ-023\)/);
    const giftaidCss = [...css.matchAll(/\.giftaid[^{]*\{[^}]*\}/g)].map((m) => m[0]).join("\n");
    expect(giftaidCss).not.toBe("");
    expect(giftaidCss.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(giftaidCss.match(/\brgba?\(/gi) ?? []).toEqual([]);
  });
});
