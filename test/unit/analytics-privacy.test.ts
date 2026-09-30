// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-479: the privacy notice says plainly how visits are counted, as the design asks: what is
// counted, no cookies and nothing on the device, the IP address used only for the town and never
// kept, no linking one day to the next, 13 months, and Do Not Track and Global Privacy Control.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const doc = new DOMParser().parseFromString(readFileSync(resolve(ROOT, "privacy.html"), "utf8"), "text/html");

function section(title: string): string {
  const heading = [...doc.querySelectorAll("h2")].find((h) => h.textContent?.trim() === title);
  if (!heading) return "";
  const parts: string[] = [];
  for (let el = heading.nextElementSibling; el && el.tagName !== "H2"; el = el.nextElementSibling) {
    parts.push(el.textContent ?? "");
  }
  return parts.join(" ").replace(/\s+/g, " ");
}

describe("privacy notice: Counting visits", () => {
  const text = section("Counting visits");

  it("has its own section, before how long we keep things", () => {
    const titles = [...doc.querySelectorAll("h2")].map((h) => h.textContent?.trim());
    expect(titles).toContain("Counting visits");
    expect(titles.indexOf("Counting visits")).toBeLessThan(titles.indexOf("How long we keep it"));
  });

  it.each([
    ["what is counted", /which page/i],
    ["no cookies", /without cookies/i],
    ["nothing on the device", /nothing is stored on your phone, tablet or computer/i],
    ["the IP address only for the town", /IP address is used .* town or city/i],
    ["the IP address never kept", /never (store|keep) it/i],
    ["no linking across days", /cannot be linked to a visit (on )?another day|cannot be linked .* next/i],
    ["13 months", /13 months/],
    ["Do Not Track", /Do Not Track/],
    ["Global Privacy Control", /Global Privacy Control/],
  ])("says %s", (_what, pattern) => {
    expect(text).toMatch(pattern);
  });
});
