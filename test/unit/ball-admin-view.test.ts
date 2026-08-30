import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

// TASK-313: the admin Festive Ball screen is markup in admin.html driven by code in
// assets/js/admin/app.js, joined only by element ids. Nothing type-checks that join: rename an
// id in the HTML and the screen fails silently at runtime — `el("ballGateToggle")` returns null
// and the launch control simply does not work, with no error until someone tries to publish.
//
// This walks every id the ball code reaches for and proves the markup provides it.

const APP_JS = read("assets/js/admin/app.js");
const ADMIN_HTML = read("admin.html");

function ballBlock(): string {
  const start = APP_JS.indexOf("// --- Festive Ball (TASK-313)");
  expect(start, "the ball block should exist in the admin bundle").toBeGreaterThan(-1);
  return APP_JS.slice(start);
}

describe("the admin Festive Ball screen is wired to its markup", () => {
  it("every element id the code touches exists in admin.html", () => {
    const ids = [...new Set([...ballBlock().matchAll(/el\("([A-Za-z0-9_-]+)"\)/g)].map((m) => m[1]))];
    expect(ids.length).toBeGreaterThan(10);
    const missing = ids.filter((id) => !ADMIN_HTML.includes(`id="${id}"`));
    expect(missing, `admin.html is missing ids the ball screen needs: ${missing.join(", ")}`).toEqual([]);
  });

  it("the view panel and its nav button both exist", () => {
    expect(ADMIN_HTML).toContain('id="view-ball"');
    expect(ADMIN_HTML).toContain('data-view="ball"');
    expect(ADMIN_HTML).toMatch(/data-view="ball">Festive Ball</);
  });

  it("selecting the view actually loads it", () => {
    expect(APP_JS).toContain('else if (name === "ball") loadBall();');
  });

  it("the ball code lives INSIDE the module IIFE, not after it", () => {
    // Appended past the closing `})();` it would sit in global scope and every helper it uses
    // (el, authFetch, canEdit, statCard) would be undefined at runtime, while still parsing fine.
    const ballAt = APP_JS.indexOf("// --- Festive Ball (TASK-313)");
    const iifeCloses = APP_JS.lastIndexOf("})();");
    expect(ballAt).toBeLessThan(iifeCloses);
  });

  it("offers no way to edit the ticket price", () => {
    // £100 is printed in a magazine that cannot be recalled.
    const block = ballBlock();
    expect(block).not.toMatch(/seatPrice|tablePrice|pricePence/i);
    expect(ADMIN_HTML).not.toContain('id="ballSeatPrice"');
  });

  it("warns before publishing, and says what publishing actually does", () => {
    const block = ballBlock();
    expect(block).toContain("window.confirm(");
    expect(block).toMatch(/publishes the ticket page/i);
    expect(block).toMatch(/home page/i);
  });

  it("hides the write controls from someone with view-only access", () => {
    expect(ballBlock()).toContain('canEdit("ball")');
  });
});
