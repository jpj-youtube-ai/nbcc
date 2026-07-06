// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-034 (REQ-026): donate.html's reassurance section. A semantic <section>
// named by its <h2> (REQ-032) sits inside .page-sections, after the give widget
// (REQ-020+) and the monthly donor benefits band (REQ-025). It renders exactly
// three trust items on the shared .card surface: cancel any time under the
// Direct Debit Guarantee; secure via Stripe with monthly giving set up by adults
// 18 or over; and a help line to Jaimie Wakefield at
// giving@nbcc.scot (mailto) and 01292 811 015 (tel). Token-only
// colours, inline aria-hidden SVGs, no <img> (perf budget), dash-free copy with
// "NBCC" not "NB4CC" (REQ-031). Parsed with jsdom; mirrors donate-side-panel and
// monthly-donor-benefits tests.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("donate reassurance (REQ-026)", () => {
  const section = doc.querySelector("section.reassure");
  const items = [...(section?.querySelectorAll(".reassure-item") ?? [])];
  const text = norm(section?.textContent).toLowerCase();

  it("renders the reassurance section inside the donate page-sections slot", () => {
    expect(section).not.toBeNull();
    expect(section?.closest(".page-sections")).not.toBeNull();
  });

  it("sits after the give widget and the monthly donor benefits band", () => {
    const order = [...doc.querySelectorAll(".give-widget, section.donor-benefits, section.reassure")];
    expect(order.map((el) => el.className.replace(/\s.*/, ""))).toEqual([
      "give-widget",
      "donor-benefits",
      "reassure",
    ]);
  });

  it("is a section named by its own <h2> (REQ-032)", () => {
    const labelledby = section?.getAttribute("aria-labelledby");
    expect(labelledby).toBeTruthy();
    const heading = section?.querySelector("h2");
    expect(heading?.id).toBe(labelledby);
    expect(norm(heading?.textContent).length).toBeGreaterThan(0);
  });

  it("renders exactly three reassurance items on the .card surface", () => {
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.classList.contains("card")).toBe(true);
      expect(norm(item.textContent).length).toBeGreaterThan(0);
    }
  });

  it("item 1: cancel any time under the Direct Debit Guarantee", () => {
    expect(text).toContain("cancel any time");
    expect(norm(section?.textContent)).toContain("Direct Debit Guarantee");
  });

  it("item 2: secure via Stripe and donors are 18 or over", () => {
    expect(norm(section?.textContent)).toContain("Stripe");
    expect(text).toContain("18 or over");
  });

  it("item 3: a help line to Jaimie Wakefield by email and phone", () => {
    expect(text).toContain("jaimie wakefield");

    const mail = section?.querySelector('a[href^="mailto:giving@nbcc.scot"]');
    expect(mail).not.toBeNull();
    expect(norm(mail?.textContent)).toContain("giving@nbcc.scot");

    const tel = section?.querySelector('a[href^="tel:"]');
    expect(tel).not.toBeNull();
    // tel href digits normalise to the UK number; the visible text shows it spaced.
    expect((tel?.getAttribute("href") ?? "").replace(/\D/g, "")).toContain("1292811015");
    expect(norm(tel?.textContent)).toContain("01292 811 015");

    // The email and phone live together in the one help item.
    const helpItem = items.find((i) => i.querySelector('a[href^="mailto:"]'));
    expect(helpItem).toBeDefined();
    expect(helpItem?.querySelector('a[href^="tel:"]')).not.toBeNull();
  });

  it("writes 'NBCC' (never 'NB4CC') in the visible copy (REQ-031)", () => {
    const raw = norm(section?.textContent);
    expect(raw).toContain("NBCC");
    expect(raw).not.toContain("NB4CC");
  });

  it("writes the reassurance copy without dashes (REQ-031)", () => {
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

  it("declares a token-only DONATE REASSURANCE CSS block (no hex/rgb)", () => {
    // The settled stylesheet groups the reassurance rules under a labelled block
    // (the "monthly benefits + reassurance" section); assert that block is present.
    expect(css).toMatch(/reassurance/i);
    const blockCss = [...css.matchAll(/\.reassure[a-z-]*[^{]*\{[^}]*\}/g)].map((m) => m[0]).join("\n");
    expect(blockCss).not.toBe("");
    expect(blockCss.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(blockCss.match(/\brgba?\(/gi) ?? []).toEqual([]);
  });
});
