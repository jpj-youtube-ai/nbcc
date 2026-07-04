// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-018 (REQ-012): index.html's "why your donation matters" section — eyebrow,
// emotive H2 with the .rule under it, two leaflet paragraphs, a Support NBCC CTA
// to /donate, and a photo slot. Parsed with jsdom; mirrors home-pillars.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("home why-your-donation-matters (REQ-012)", () => {
  const why = doc.querySelector("section.why");

  it("renders the section", () => {
    expect(why).not.toBeNull();
  });

  it("has the eyebrow and the emotive heading", () => {
    expect(norm(why?.querySelector(".eyebrow")?.textContent)).toBe("Why your donation matters");
    expect(norm(why?.querySelector("h2")?.textContent)).toBe(
      "Every pound helps remind someone that they have not been forgotten.",
    );
  });

  it("places the .rule divider immediately after the heading (REQ-007)", () => {
    const h2 = why?.querySelector("h2");
    expect(h2?.nextElementSibling?.classList.contains("rule")).toBe(true);
  });

  it("has exactly two body paragraphs of leaflet copy", () => {
    const paras = [...(why?.querySelectorAll(".prose p") ?? [])];
    expect(paras).toHaveLength(2);
    expect(norm(paras[0]?.textContent)).toContain("Your donation helps NBCC");
    expect(norm(paras[1]?.textContent)).toContain("essential costs of running the charity");
  });

  it("has a Support NBCC CTA reusing the button system, linking to /donate", () => {
    const btn = why?.querySelector("a.btn");
    expect(btn?.getAttribute("href")).toBe("/donate");
    expect(norm(btn?.textContent)).toContain("Support NBCC");
  });

  it("has a labelled photo slot: a captioned <img> or the pending placeholder (REQ-012/034)", () => {
    // REQ-012 ships a photo *slot* that is currently a labelled placeholder, to be
    // swapped for a real consented packing photo. Accept either.
    const slot = why?.querySelector("figure.photo-slot, .figure[role='img']");
    expect(slot).not.toBeNull();
    const img = slot?.querySelector("img");
    if (img) {
      expect(img.getAttribute("src")).toMatch(/^\/assets\/img\/[a-z-]+\.jpg$/);
      expect(img.getAttribute("width")).toBeTruthy();
      expect(img.getAttribute("height")).toBeTruthy();
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(norm(img.getAttribute("alt")).length).toBeGreaterThan(0);
    } else {
      expect(norm(slot?.getAttribute("aria-label")).length).toBeGreaterThan(0);
    }
  });
});
