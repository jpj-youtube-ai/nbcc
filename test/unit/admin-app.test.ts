// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";

// TASK-118 (REQ-066): an integration test of the admin dashboard app wiring (assets/js/admin/app.js).
// It mounts admin.html's <body> into jsdom, stubs window.AdminHelpers + a mocked fetch, evaluates
// app.js against that DOM, and drives the real flow — sign in, the app + overview render, browse
// donations, open a donor — asserting the wiring holds. This is the repeatable, CI-run stand-in for a
// manual browser click-through (the endpoints themselves are covered by admin-api / admin-read).

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const tokenFor = (role: string) =>
  signAdminSession({ sub: 3, email: role + "@nbcc", role, now: new Date(), secret: "s" }).token;

let loginToken = tokenFor("editor"); // the token the mocked /login hands back (per test)

const donation = {
  id: 11, donor_id: 5, donor_name: "Ada Test", mode: "monthly", plan: "silver",
  amount_pence: 2500, currency: "gbp", gift_aid: true, claim_status: "eligible",
  payment_channel: "online", created_at: "2026-01-02T00:00:00Z",
};
const snapshot = {
  fullName: "Ada Test", email: "ada@x.co", emailConsent: true, anonymous: false,
  subscriptionPlan: "silver", subscriptionId: "sub_1", giftAid: true,
};

function respond(url: string) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status < 400,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  if (url.includes("/api/admin/login")) return j({ token: loginToken, user: { email: "s@nbcc", role: "editor" } });
  if (url.includes("/api/admin/donors/")) return j(snapshot);
  if (url.includes("/api/admin/donations")) return j({ results: [donation], total: 1 });
  return j({ results: [] }); // queues / adjustment-due
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const el = (id: string) => document.getElementById(id) as HTMLElement;

async function signIn() {
  (el("adminEmail") as HTMLInputElement).value = "s@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await flush();
  await flush();
  await flush();
}

describe("admin app integration (jsdom, TASK-118)", () => {
  beforeEach(() => {
    loginToken = tokenFor("editor");
    window.sessionStorage.clear();
    document.body.innerHTML = bodyHtml;
    (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: unknown) =>
      Promise.resolve(respond(String(url))),
    );
    // eslint-disable-next-line no-eval
    (0, eval)(appSrc); // run the IIFE against this DOM
  });

  it("boots to the login view with the app hidden", () => {
    expect(el("loginView").hidden).toBe(false);
    expect(el("appView").hidden).toBe(true);
  });

  it("signs in, renders the app + overview, browses donations, opens a donor", async () => {
    await signIn();

    expect(el("appView").hidden).toBe(false);
    expect(el("userEmail").textContent).toBe("editor@nbcc");
    expect(el("userRole").textContent).toBe("editor");
    expect(document.querySelectorAll("#overviewStats .admin-stat").length).toBe(4);
    await flush();
    expect(document.querySelector("#overviewRecent table")).not.toBeNull();

    // Browse donations
    (document.querySelector('.admin-nav-link[data-view="donations"]') as HTMLElement).click();
    await flush();
    await flush();
    expect(document.querySelector("#donationsTable table")).not.toBeNull();
    const view = document.querySelector("#donationsTable [data-donor]") as HTMLElement;
    expect(view).not.toBeNull();

    // Open the donor detail
    view.click();
    await flush();
    await flush();
    expect(el("view-donor").hidden).toBe(false);
    expect(el("donorDetail").textContent).toContain("Ada Test");
    // Editor => the edit form + cancel actions are present
    expect(el("donorEditForm")).not.toBeNull();
    expect(el("cancelSubBtn")).not.toBeNull();
    expect(el("cancelGaBtn")).not.toBeNull();
  });

  it("hides the write controls for a Viewer", async () => {
    loginToken = tokenFor("viewer");
    await signIn();
    // Open a donor via search-free path: click Donations, then the View button.
    (document.querySelector('.admin-nav-link[data-view="donations"]') as HTMLElement).click();
    await flush();
    await flush();
    (document.querySelector("#donationsTable [data-donor]") as HTMLElement).click();
    await flush();
    await flush();
    expect(el("donorDetail").textContent).toContain("Ada Test");
    // Viewer => no edit form / cancel actions
    expect(el("donorEditForm")).toBeNull();
    expect(el("cancelSubBtn")).toBeNull();
    expect(el("cancelGaBtn")).toBeNull();
  });
});
