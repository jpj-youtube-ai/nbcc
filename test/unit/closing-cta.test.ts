// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-019 (REQ-013): the recurring crimson closing CTA strip — present at the
// foot of <main> on index.html + about.html (Home's exact headline), each with a
// Donate now .btn-primary to /donate; absent from donate.html + contact.html.
// Parsed with jsdom; mirrors home-why.test.ts / footer.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const parse = (f: string) =>
  new DOMParser().parseFromString(readFileSync(resolve(ROOT, f), "utf8"), "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const home = parse("index.html");
const about = parse("about.html");
const donate = parse("donate.html");
const contact = parse("contact.html");

describe("closing CTA strip (REQ-013)", () => {
  it("Home has the closing CTA with the exact headline and Donate now -> /donate", () => {
    const cta = home.querySelector("section.closing-cta");
    expect(cta).not.toBeNull();
    expect(norm(cta?.querySelector("h2")?.textContent)).toBe("Help us reach even more in 2026");
    const btn = cta?.querySelector("a.btn.btn-primary");
    expect(btn?.getAttribute("href")).toBe("/donate");
    expect(norm(btn?.textContent)).toContain("Donate now");
  });

  it("About has the closing CTA with its own headline and Donate now -> /donate", () => {
    const cta = about.querySelector("section.closing-cta");
    expect(cta).not.toBeNull();
    const headline = norm(cta?.querySelector("h2")?.textContent);
    expect(headline.length).toBeGreaterThan(0);
    expect(headline).not.toBe("Help us reach even more in 2026");
    const btn = cta?.querySelector("a.btn.btn-primary");
    expect(btn?.getAttribute("href")).toBe("/donate");
    expect(norm(btn?.textContent)).toContain("Donate now");
  });

  it("the strip is the accessible-named last section of <main>", () => {
    const cta = home.querySelector("section.closing-cta");
    expect(cta?.getAttribute("aria-labelledby")).toBe(cta?.querySelector("h2")?.id);
    expect(cta?.parentElement?.classList.contains("site-main")).toBe(true);
  });

  it("does not appear on donate.html or contact.html", () => {
    expect(donate.querySelector(".closing-cta")).toBeNull();
    expect(contact.querySelector(".closing-cta")).toBeNull();
  });
});
