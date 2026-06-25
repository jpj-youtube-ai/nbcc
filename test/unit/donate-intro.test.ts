// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-027 (REQ-019): donate.html's intro — crimson eyebrow "Donate", the brand
// H1 "Your gift becomes someone's Christmas" with the .rule under it, and a lede
// noting the volunteer base and that around £50 is the value of one Red Bag Full
// of Joy. Parsed with jsdom; mirrors about-intro.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("donate intro (REQ-019)", () => {
  const intro = doc.querySelector("section.donate-intro");

  it("renders the intro section", () => {
    expect(intro).not.toBeNull();
  });

  it("has the eyebrow 'Donate'", () => {
    expect(norm(intro?.querySelector(".eyebrow")?.textContent)).toBe("Donate");
  });

  it("has the exact H1", () => {
    expect(norm(intro?.querySelector("h1")?.textContent)).toBe(
      "Your gift becomes someone's Christmas",
    );
  });

  it("places the .rule divider immediately after the heading (REQ-007)", () => {
    const h1 = intro?.querySelector("h1");
    expect(h1?.nextElementSibling?.classList.contains("rule")).toBe(true);
  });

  it("has a lede with the volunteer base and the £50-per-Red-Bag framing", () => {
    const lede = norm(intro?.querySelector(".lede")?.textContent);
    expect(lede).toContain("NBCC");
    expect(lede).toContain("volunteer");
    expect(lede).toContain("£50");
    expect(lede).toContain("Red Bag Full of Joy");
  });

  it("writes the intro copy without dashes and always 'NBCC' (REQ-031)", () => {
    expect(norm(intro?.textContent)).not.toMatch(/[–—-]/);
  });

  it("drops the placeholder copy but keeps page-sections, nav and footer", () => {
    expect(norm(doc.querySelector("main")?.textContent)).not.toContain("placeholder Donate page");
    expect(doc.querySelector('main .page-sections[data-region="sections"]')).not.toBeNull();
    expect(doc.querySelector("header.nav")).not.toBeNull();
    expect(doc.querySelector("footer.site-footer")).not.toBeNull();
  });
});
