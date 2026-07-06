// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-115 (REQ-066): the admin dashboard shell (admin.html). A private, token-authed staff tool, so
// it sits OUTSIDE the marketing nav/footer (and the marketing guards) and carries its own accessibility
// floor: a skip link to a focusable <main>, the landmark set, a labelled required login form, and a
// noindex robots directive. Parsed with jsdom, mirroring skip-link.test.ts.

const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const TABBABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

describe("admin dashboard shell (REQ-066 · TASK-115)", () => {
  it("is a standalone, noindex HTML5 document", () => {
    expect(html.trimStart()).toMatch(/^<!doctype html>/i);
    expect(html).toMatch(/<html\s+lang="/i);
    expect(html).toMatch(/<meta\s+charset="utf-8"/i);
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toMatch(/noindex/i);
  });

  it("makes the skip link the first tabbable element, targeting a focusable <main>", () => {
    const first = doc.body.querySelector(TABBABLE);
    expect(first?.tagName).toBe("A");
    expect(first?.classList.contains("skip-link")).toBe(true);
    expect(first?.getAttribute("href")).toBe("#admin-main");
    const main = doc.getElementById("admin-main");
    expect(main?.tagName).toBe("MAIN");
    expect(main?.getAttribute("tabindex")).toBe("-1");
  });

  it("has a labelled, required email + password login form", () => {
    const form = doc.getElementById("loginForm");
    expect(form).not.toBeNull();
    for (const id of ["adminEmail", "adminPassword"]) {
      const input = doc.getElementById(id);
      expect(input?.hasAttribute("required"), `#${id} required`).toBe(true);
      expect(norm(doc.querySelector(`label[for="${id}"]`)?.textContent).length).toBeGreaterThan(0);
    }
    expect(doc.getElementById("adminEmail")?.getAttribute("type")).toBe("email");
    expect(doc.getElementById("adminPassword")?.getAttribute("type")).toBe("password");
    // The error region announces politely.
    expect(doc.getElementById("loginError")?.getAttribute("role")).toBe("alert");
  });

  it("carries the landmark set; the app view starts hidden, login visible", () => {
    expect(doc.querySelectorAll("main").length).toBe(1);
    expect(doc.querySelector("header")).not.toBeNull();
    expect(doc.querySelector("nav")).not.toBeNull();
    expect(doc.getElementById("appView")?.hasAttribute("hidden")).toBe(true);
    expect(doc.getElementById("loginView")?.hasAttribute("hidden")).toBe(false);
  });

  it("links the admin stylesheet + both scripts", () => {
    expect(html).toContain('href="/assets/css/admin.css"');
    expect(html).toContain('src="/assets/js/admin/helpers.js"');
    expect(html).toContain('src="/assets/js/admin/app.js"');
  });

  it("has the nav sections + the donor detail view (TASK-117 · TASK-138 gasds)", () => {
    const navViews = [...doc.querySelectorAll(".admin-nav-link")].map((b) => b.getAttribute("data-view"));
    expect(navViews).toEqual(["overview", "search", "donations", "claims", "gasds", "subscriptions", "audit"]);
    for (const v of ["donations", "claims", "gasds", "subscriptions", "audit", "donor"]) {
      expect(doc.getElementById("view-" + v), `#view-${v}`).not.toBeNull();
    }
    // Donor detail is reached from a row, not the nav, and has a Back control + status region.
    expect(doc.getElementById("donorBack")).not.toBeNull();
    expect(doc.getElementById("donorActionStatus")?.getAttribute("role")).toBe("status");
  });
});
