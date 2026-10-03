// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// What gifts could do: the card in Admin > Fundraising, in the admin's jsdom harness (admin.html's
// <body>, a stand in for the admin API, app.js evaluated against it). Admins add an example, change
// one, switch it off or on, and move it up or down the list. Every person and amount is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Example = { id: number; amountPence: number; wording: string; active: boolean; sortOrder: number; onGiveForm: boolean; meterLine: string | null };
let examples: Example[] | null = null;
let perms: PermissionMap = effectivePermissions({ role: "admin", permissions: null });
let role = "admin";
let calls: { method: string; path: string; body: unknown }[] = [];
let failures: Record<string, { status: number; body: unknown }> = {};

function starting(): Example[] {
  return [
    { id: 1, amountPence: 500, wording: "could help put a cosy pair of pyjamas in a Red Bag", active: true, sortOrder: 10, onGiveForm: true, meterLine: null },
    { id: 2, amountPence: 2500, wording: "could help buy a pair of school shoes", active: true, sortOrder: 20, onGiveForm: true, meterLine: null },
    { id: 3, amountPence: 5000, wording: "could help fill a whole Red Bag Full of Joy", active: true, sortOrder: 30, onGiveForm: true, meterLine: "red_bags" },
    { id: 4, amountPence: 4000, wording: "could help a child start school in a uniform that fits", active: true, sortOrder: 40, onGiveForm: false, meterLine: "uniforms" },
    { id: 5, amountPence: 1500, wording: "could help buy a warm winter hat", active: false, sortOrder: 50, onGiveForm: true, meterLine: null },
  ];
}
const sorted = () => (examples || []).slice().sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const path = url.split("?")[0];
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, path, body });
  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: "fern@example.com", role: role as "admin", now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "fern@example.com", role } });
  }
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: perms });
  if (path === "/api/admin/whats-new") return j({ areas: [] });
  const fail = failures[method + " " + path];
  if (fail) return j(fail.body, fail.status);
  if (path === "/api/admin/fundraising/settings") return j({ pageOn: true, updatedAt: null, updatedBy: null });
  if (path === "/api/admin/fundraisers" && method === "GET") return j({ pageOn: true, fundraisers: [] });
  if (path === "/api/admin/impact-examples" && examples) {
    if (method === "POST") {
      const added = { id: 9, amountPence: body.amountPence, wording: body.wording, active: true, sortOrder: 99, onGiveForm: body.onGiveForm !== false, meterLine: null };
      examples = [...examples, added];
      return j({ example: added }, 201);
    }
    return j({ examples: sorted().map((e) => ({ ...e })) });
  }
  const change = path.match(/^\/api\/admin\/impact-examples\/(\d+)$/);
  if (change && method === "PATCH" && examples) {
    const e = examples.find((x) => x.id === Number(change[1]))!;
    Object.assign(e, body);
    return j({ example: { ...e } });
  }
  const move = path.match(/^\/api\/admin\/impact-examples\/(\d+)\/move$/);
  if (move && method === "POST" && examples) {
    const list = sorted();
    const at = list.findIndex((x) => x.id === Number(move[1]));
    const to = body.direction === "up" ? at - 1 : at + 1;
    if (to >= 0 && to < list.length) [list[at], list[to]] = [list[to], list[at]];
    list.forEach((x, i) => (x.sortOrder = (i + 1) * 10));
    return j({ examples: sorted().map((e) => ({ ...e })) });
  }
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 8; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const sent = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);
const lines = (id: string) => qa(`#${id} li .fr-impact-line`).map((n) => text(n));

async function openFundraising() {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (q('.admin-nav-link[data-view="fundraising"]') as HTMLElement).click();
  await settle();
}
function asRole(r: "admin" | "editor" | "viewer") {
  role = r;
  perms = effectivePermissions({ role: r, permissions: null });
}

let confirmed: string[] = [];
beforeEach(() => {
  examples = starting();
  perms = effectivePermissions({ role: "admin", permissions: null });
  role = "admin";
  calls = [];
  failures = {};
  confirmed = [];
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = (msg?: string) => {
    confirmed.push(String(msg));
    return true;
  };
  window.prompt = () => "";
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string } | undefined));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

describe("the What gifts could do card", () => {
  it("lists the examples switched on in the list's order, and the ones switched off", async () => {
    await openFundraising();
    expect(el("frImpact").hidden).toBe(false);
    expect(lines("frImpactList")).toEqual([
      "£5 could help put a cosy pair of pyjamas in a Red Bag",
      "£25 could help buy a pair of school shoes",
      "£50 could help fill a whole Red Bag Full of Joy",
      "£40 could help a child start school in a uniform that fits",
    ]);
    expect(lines("frImpactOff")).toEqual(["£15 could help buy a warm winter hat"]);
    expect(el("frImpactOff").hidden).toBe(false);
  });

  it("says where each one shows", async () => {
    await openFundraising();
    const where = qa("#frImpactList li .fr-impact-where").map((n) => text(n));
    expect(where[0]).toBe("Under the give amounts");
    expect(where[2]).toBe("Under the give amounts. Counts the Red Bags under the meter.");
    expect(where[3]).toBe("Big totals only. Counts the school uniforms under the meter.");
  });

  for (const r of ["editor", "viewer"] as const) {
    it(`shows ${r === "editor" ? "an editor" : "a viewer"} the list, read only`, async () => {
      asRole(r);
      await openFundraising();
      expect(el("frImpact").hidden).toBe(false);
      expect(lines("frImpactList")).toHaveLength(4);
      expect(qa("#frImpact li button")).toHaveLength(0);
      expect(el("frImpactAddForm").hidden).toBe(true);
      expect(el("frImpactReadOnly").hidden).toBe(false);
      expect(text(el("frImpactReadOnly"))).toBe("Only an admin can change these.");
    });
  }

  it("gives an admin the controls, and no read only note", async () => {
    await openFundraising();
    expect(el("frImpactAddForm").hidden).toBe(false);
    expect(el("frImpactReadOnly").hidden).toBe(true);
  });

  it("keeps the two the meter line counts with fixed: no Edit, a note, but on and off and moving still work", async () => {
    await openFundraising();
    expect(q('[data-frimpactedit="3"]')).toBeNull();
    expect(q('[data-frimpactedit="4"]')).toBeNull();
    expect(q('[data-frimpactedit="1"]')).not.toBeNull();
    const fixed = qa("#frImpactList li .fr-impact-fixed").map((n) => text(n));
    expect(fixed).toEqual([
      "Used for the line under the meter, so its words and amount are fixed.",
      "Used for the line under the meter, so its words and amount are fixed.",
    ]);
    expect(q('[data-frimpactoff="3"]')).not.toBeNull();
    expect(q('[data-frimpactup="3"]')).not.toBeNull();
  });

  it("says so when the list cannot load", async () => {
    failures["GET /api/admin/impact-examples"] = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    await openFundraising();
    expect(text(el("frImpactList"))).toMatch(/could not load/i);
  });

  it("adds one, with the amount in pounds and the words as typed", async () => {
    await openFundraising();
    (el("frImpactAmount") as HTMLInputElement).value = "£100";
    (el("frImpactWording") as HTMLInputElement).value = "  could help buy a warm winter coat ";
    el("frImpactAdd").click();
    await settle();
    expect(sent("POST", "/api/admin/impact-examples")[0].body).toEqual({ amountPence: 10000, wording: "could help buy a warm winter coat", onGiveForm: true });
    expect(lines("frImpactList")).toContain("£100 could help buy a warm winter coat");
    expect(text(el("frImpactStatus"))).toBe("Added. It shows on fundraiser, event and team pages now.");
    expect((el("frImpactAmount") as HTMLInputElement).value).toBe("");
    expect((el("frImpactWording") as HTMLInputElement).value).toBe("");
  });

  it("can add one for big totals only", async () => {
    await openFundraising();
    (el("frImpactAmount") as HTMLInputElement).value = "75";
    (el("frImpactWording") as HTMLInputElement).value = "could help a family of three";
    (el("frImpactGive") as HTMLInputElement).checked = false;
    el("frImpactAdd").click();
    await settle();
    expect(sent("POST", "/api/admin/impact-examples")[0].body).toMatchObject({ amountPence: 7500, onGiveForm: false });
  });

  it("asks for an amount and words before sending", async () => {
    await openFundraising();
    (el("frImpactWording") as HTMLInputElement).value = "could help buy a hat";
    el("frImpactAdd").click();
    await settle();
    expect(sent("POST", "/api/admin/impact-examples")).toHaveLength(0);
    expect(text(el("frImpactStatus"))).toMatch(/amount/i);
  });

  it("shows the server's reason when the words are refused", async () => {
    failures["POST /api/admin/impact-examples"] = { status: 400, body: { error: "Use the word could, like could help buy a pair of school shoes." } };
    await openFundraising();
    (el("frImpactAmount") as HTMLInputElement).value = "25";
    (el("frImpactWording") as HTMLInputElement).value = "buys a pair of school shoes";
    el("frImpactAdd").click();
    await settle();
    expect(text(el("frImpactStatus"))).toBe("Use the word could, like could help buy a pair of school shoes.");
    expect(el("frImpactStatus").classList.contains("is-error")).toBe(true);
    // What was typed stays, to put right.
    expect((el("frImpactWording") as HTMLInputElement).value).toBe("buys a pair of school shoes");
  });

  it("edits one in place: amount, words and where it shows", async () => {
    await openFundraising();
    (q('[data-frimpactedit="2"]') as HTMLElement).click();
    await settle();
    (el("frImpactEditAmount") as HTMLInputElement).value = "30";
    (el("frImpactEditWording") as HTMLInputElement).value = "could help buy school shoes that fit";
    (q("[data-frimpactsave]") as HTMLElement).click();
    await settle();
    expect(sent("PATCH", "/api/admin/impact-examples/2")[0].body).toEqual({ amountPence: 3000, wording: "could help buy school shoes that fit", onGiveForm: true });
    expect(lines("frImpactList")).toContain("£30 could help buy school shoes that fit");
    expect(el("frImpactEditAmount")).toBeNull();
  });

  it("switches one off, after asking, and back on", async () => {
    await openFundraising();
    (q('[data-frimpactoff="2"]') as HTMLElement).click();
    await settle();
    expect(confirmed[0]).toMatch(/switch off/i);
    expect(sent("PATCH", "/api/admin/impact-examples/2")[0].body).toEqual({ active: false });
    expect(lines("frImpactOff")).toContain("£25 could help buy a pair of school shoes");
    (q('[data-frimpacton="2"]') as HTMLElement).click();
    await settle();
    expect(sent("PATCH", "/api/admin/impact-examples/2")[1].body).toEqual({ active: true });
    expect(lines("frImpactList")).toContain("£25 could help buy a pair of school shoes");
  });

  it("moves one up and down the list", async () => {
    await openFundraising();
    (q('[data-frimpactup="2"]') as HTMLElement).click();
    await settle();
    expect(sent("POST", "/api/admin/impact-examples/2/move")[0].body).toEqual({ direction: "up" });
    expect(lines("frImpactList")[0]).toBe("£25 could help buy a pair of school shoes");
    (q('[data-frimpactdown="2"]') as HTMLElement).click();
    await settle();
    expect(lines("frImpactList")[1]).toBe("£25 could help buy a pair of school shoes");
    // The first has no Move up, and the last no Move down.
    expect(q('[data-frimpactup="1"]')).toBeNull();
    expect(q('[data-frimpactdown="4"]')).toBeNull();
  });
});
