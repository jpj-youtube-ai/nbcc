// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-033 (REQ-025): donate.html's monthly donor benefits tinted band. A
// semantic <section> named by its <h2> (REQ-032) sits inside .page-sections,
// after the give-widget, on the tan-soft tinted-band pattern (.why/.meet-team).
// It separates ALL monthly donor perks (named on the Donors Page unless
// anonymous, cross-linked to the Supporters page REQ-035; post Christmas impact
// update) from Platinum-only extras (social media thank you, optional digital
// supporter badge, personalised supporter certificate). Token-only colours,
// inline aria-hidden SVGs, no <img> (perf budget REQ-033), dash-free copy with
// "NBCC" in full (REQ-031). Parsed with jsdom; mirrors donate-side-panel.test.ts
// and give-monthly-tiers.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("monthly donor benefits (REQ-025)", () => {
  const section = doc.querySelector("section.donor-benefits");
  const groups = [...(section?.querySelectorAll(".benefit-group") ?? [])];
  const groupByHeading = (re: RegExp) =>
    groups.find((g) => re.test(norm(g.querySelector("h3")?.textContent)));
  const allGroup = groupByHeading(/all monthly donors/i);
  const platGroup = groupByHeading(/platinum/i);

  it("renders the benefits section inside the donate page-sections slot", () => {
    expect(section).not.toBeNull();
    expect(section?.closest(".page-sections")).not.toBeNull();
  });

  it("sits after the give-widget section in the flow", () => {
    const order = [...doc.querySelectorAll(".give-widget, section.donor-benefits")];
    expect(order.map((el) => el.className.includes("donor-benefits"))).toEqual([false, true]);
  });

  it("is a section named by its own <h2> (REQ-032)", () => {
    const labelledby = section?.getAttribute("aria-labelledby");
    expect(labelledby).toBeTruthy();
    const heading = section?.querySelector("h2");
    expect(heading?.id).toBe(labelledby);
    expect(norm(heading?.textContent).length).toBeGreaterThan(0);
  });

  it("separates the perks into exactly two distinctly-headed groups", () => {
    expect(groups).toHaveLength(2);
    expect(allGroup).toBeDefined();
    expect(platGroup).toBeDefined();
    expect(allGroup).not.toBe(platGroup);
  });

  it("lists the all-donor perks: named on the Donors Page, post Christmas impact update", () => {
    const items = [...(allGroup?.querySelectorAll(".benefit-list li") ?? [])];
    expect(items.length).toBeGreaterThanOrEqual(2);
    const text = norm(allGroup?.textContent).toLowerCase();
    expect(text).toContain("donors page");
    expect(text).toContain("anonymous");
    expect(text).toContain("impact update");
  });

  it("cross-links the named-donors perk to the Supporters page (REQ-035)", () => {
    const link = allGroup?.querySelector('a[href="/supporters"]');
    expect(link).not.toBeNull();
    expect(norm(link?.textContent).length).toBeGreaterThan(0);
  });

  it("lists the Platinum-only extras: social thank you, optional digital badge, personalised certificate", () => {
    const items = [...(platGroup?.querySelectorAll(".benefit-list li") ?? [])];
    expect(items.length).toBeGreaterThanOrEqual(3);
    const text = norm(platGroup?.textContent).toLowerCase();
    expect(text).toContain("social media");
    expect(text).toContain("digital supporter badge");
    expect(text).toContain("supporter certificate");
  });

  it("keeps the Platinum-only extras out of the all-donor group", () => {
    const allText = norm(allGroup?.textContent).toLowerCase();
    expect(allText).not.toContain("certificate");
    expect(allText).not.toContain("digital supporter badge");
  });

  it("writes 'NBCC' in full and uses the full beneficiary phrasing (REQ-031)", () => {
    const text = norm(section?.textContent);
    expect(text).toContain("NBCC");
    expect(text).toContain("children, young people and vulnerable adults");
  });

  it("writes the benefits copy without dashes (REQ-031)", () => {
    expect(norm(section?.textContent)).not.toMatch(/[–—-]/);
  });

  it("marks decorative icons aria-hidden and ships no <img> (perf budget)", () => {
    const svgs = [...(section?.querySelectorAll("svg") ?? [])];
    expect(svgs.length).toBeGreaterThan(0);
    for (const s of svgs) {
      expect(s.getAttribute("aria-hidden")).toBe("true");
    }
    expect(section?.querySelector("img")).toBeNull();
  });

  it("declares a token-only MONTHLY DONOR BENEFITS CSS block (no hex/rgb)", () => {
    expect(css).toMatch(/MONTHLY DONOR BENEFITS \(REQ-025\)/);
    const blockCss = [...css.matchAll(/\.(?:donor-benefits|benefit-[a-z]+)[^{]*\{[^}]*\}/g)]
      .map((m) => m[0])
      .join("\n");
    expect(blockCss).not.toBe("");
    expect(blockCss.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(blockCss.match(/\brgba?\(/gi) ?? []).toEqual([]);
  });
});
