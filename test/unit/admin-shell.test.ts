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

  // TASK-469: app.js reads window.PasteProse when a prose box is pasted into, so it must be there first.
  it("loads the paste converter before the app that uses it", () => {
    const at = html.indexOf('src="/assets/js/admin/paste-prose.js"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(html.indexOf('src="/assets/js/admin/app.js"'));
  });

  it("has the nav sections + the donor detail view (TASK-117 · TASK-138 gasds · TASK-161 newsletter · TASK-163 thank-you · 2026-07-10 contact inbox · TASK-208 business supporters · TASK-401 outreach)", () => {
    const navViews = [...doc.querySelectorAll(".admin-nav-link")].map((b) => b.getAttribute("data-view"));
    expect(navViews).toEqual([
      "overview",
      "search",
      "donations",
      "claims",
      "gasds",
      "subscriptions",
      "fulfilments",
      // TASK-447: the individuals giving monthly, beside the businesses.
      "monthly",
      "stories",
      "ticker",
      // TASK-453: the Events page's events and its switch, beside the other website content.
      "events",
      // TASK-495: community fundraising, beside the Events page it grows out of.
      "fundraising",
      "ball",
      "contact",
      "newsletter",
      "thank-you",
      "outreach",
      "audit",
      "email-audit",
      // TASK-482: site analytics, in the Admin group.
      "analytics",
      "site",
      // TASK-492: QR codes for every page, beside Site pages.
      "qr",
      "team",
    ]);
    for (const v of [
      "donations",
      "claims",
      "gasds",
      "subscriptions",
      "fulfilments",
      "stories",
      "ticker",
      "events",
      "contact",
      "newsletter",
      "thank-you",
      "outreach",
      "audit",
      "team",
      "qr",
      "donor",
      "story",
    ]) {
      expect(doc.getElementById("view-" + v), `#view-${v}`).not.toBeNull();
    }
    // Donor detail is reached from a row, not the nav, and has a Back control + status region.
    expect(doc.getElementById("donorBack")).not.toBeNull();
    expect(doc.getElementById("donorActionStatus")?.getAttribute("role")).toBe("status");
  });

  // Task C: the Stories tab (list + status filter) and its detail sub-view (reached from a row).
  it("has the Stories view with a status filter, and the story detail view", () => {
    expect(doc.getElementById("view-stories")).not.toBeNull();
    expect(doc.getElementById("storiesTable")).not.toBeNull();
    const filterButtons = [...doc.querySelectorAll("#storiesStatusFilter .admin-seg")].map((b) =>
      b.getAttribute("data-status"),
    );
    expect(filterButtons).toEqual(["", "new", "reviewed", "used", "withdrawn"]);
    expect(doc.getElementById("storyBack")).not.toBeNull();
    expect(doc.getElementById("storyDetail")).not.toBeNull();
    expect(doc.getElementById("storyActionStatus")?.getAttribute("role")).toBe("status");
  });

  // TASK-461: the old website's stories come in through a closed panel on the Stories view, shown
  // only once the script knows the person can edit stories.
  it("has the old website import on the Stories view, hidden until the script allows it", () => {
    const panel = doc.getElementById("storiesImport")!;
    expect(panel.tagName).toBe("DETAILS");
    expect(panel.hasAttribute("hidden")).toBe(true);
    expect(panel.hasAttribute("open")).toBe(false);
    expect(panel.closest("#view-stories")).not.toBeNull();
    const file = doc.getElementById("storiesImportFile") as HTMLInputElement;
    expect(file.type).toBe("file");
    expect(file.getAttribute("accept")).toContain(".csv");
    expect(doc.querySelector('label[for="storiesImportFile"]')).not.toBeNull();
    expect(doc.getElementById("storiesImportPlan")).not.toBeNull();
    expect(doc.getElementById("storiesImportStatus")?.getAttribute("role")).toBe("status");
  });

  // TASK-208: the Business supporters (fulfilment) tab — an Editor+ area, gated in the nav on
  // business-supporters:edit (data-edit-gate) to match its server route (TASK-406), with its own
  // table + status region.
  it("has the Business supporters view, gated Editor+ via data-edit-gate on the nav link", () => {
    const navLink = doc.querySelector('.admin-nav-link[data-view="fulfilments"]');
    expect(navLink).not.toBeNull();
    expect(navLink?.getAttribute("data-edit-gate")).toBe("business-supporters");
    expect(doc.getElementById("view-fulfilments")).not.toBeNull();
    expect(doc.getElementById("fulfilmentsTable")).not.toBeNull();
    expect(doc.getElementById("fulfilmentActionStatus")?.getAttribute("role")).toBe("status");
  });
});

// TASK-453: the Events screen. The page switch, the list, the eight-step form and the two previews.
// The previews are frames holding the real page's markup and stylesheets, sized to what they hold:
// the client's standing rule is that nothing in the admin scrolls inside a box.
describe("the Events screen (TASK-453)", () => {
  const view = () => doc.getElementById("view-events")!;

  // TASK-464: the Festive Ball ticket report, set up under the page switch.
  it("has the ticket report card: its state, who it goes to, the switch, a test and a preview", () => {
    const card = doc.getElementById("evReport")!;
    expect(card.closest("#view-events")).not.toBeNull();
    expect(card.hasAttribute("hidden")).toBe(true);
    expect(doc.getElementById("evReportState")?.getAttribute("aria-live")).toBe("polite");
    const toggle = doc.getElementById("evReportToggle")!;
    expect(toggle.getAttribute("aria-controls")).toBe("evReportBody");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(doc.getElementById("evReportBody")?.hasAttribute("hidden")).toBe(true);
    expect(doc.getElementById("evReportList")).not.toBeNull();
    for (const id of ["evReportName", "evReportEmail"]) {
      expect(doc.querySelector(`label[for="${id}"]`), id).not.toBeNull();
    }
    expect((doc.getElementById("evReportEmail") as HTMLInputElement).type).toBe("email");
    expect((doc.getElementById("evReportOn") as HTMLInputElement).type).toBe("checkbox");
    expect(doc.getElementById("evReportSave")).not.toBeNull();
    expect(doc.getElementById("evReportTest")?.textContent).toContain("Send a test to me");
    expect(doc.getElementById("evReportStatus")?.getAttribute("role")).toBe("status");
    // Everyone sees everyone's address: the card says so where the list is built.
    expect(doc.getElementById("evReportBody")?.textContent).toMatch(/sees everyone else.s address/);
    const preview = doc.getElementById("evReportPreview")!;
    expect(preview.tagName).toBe("IFRAME");
    expect(preview.getAttribute("title")).toBeTruthy();
    // No scrolling inside the page: the frame is sized to the email.
    expect(preview.getAttribute("scrolling")).toBe("no");
  });

  it("has the page switch, the list and the form", () => {
    expect(view()).not.toBeNull();
    expect(doc.getElementById("evSwitchBtn")).not.toBeNull();
    expect(doc.getElementById("evSwitchState")?.getAttribute("aria-live")).toBe("polite");
    expect(doc.getElementById("evList")).not.toBeNull();
    expect(view().querySelectorAll("#evForm fieldset.ev-step")).toHaveLength(8);
  });

  it("names every form answer after the field the API expects", () => {
    const keys = new Set([...view().querySelectorAll("[data-evk]")].map((i) => i.getAttribute("data-evk")));
    for (const k of ["name", "gist", "date", "start", "venue", "town", "imageFit", "cover", "costFront", "bookingHow",
      "bookingUrl", "whatsOn", "runBy", "partnerName", "partnerCredit", "status", "showFrom"]) {
      expect(keys.has(k), k).toBe(true);
    }
  });

  it("shows the previews in frames that never scroll inside themselves", () => {
    for (const id of ["evCardPreview", "evPagePreview"]) {
      const frame = doc.getElementById(id)!;
      expect(frame.tagName).toBe("IFRAME");
      expect(frame.getAttribute("scrolling")).toBe("no");
      expect(frame.getAttribute("title")).toBeTruthy();
    }
  });
});
