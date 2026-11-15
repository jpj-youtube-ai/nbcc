// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// Admin > Partners in the kit's look (docs/superpowers/specs/2026-11-14-admin-refresh-content.md), in
// the admin's jsdom harness: admin.html's <body>, a pretend server, app.js run against it. The list is
// about 390 names, so it filters in the browser and draws a hundred at a time; every press answers in
// the card that was pressed. Before this, Hide, Show and Delete said nothing when they failed.
// Every partner here is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const kit = require(resolve(ROOT, "assets/js/admin/kit.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const token = signAdminSession({ sub: 3, email: "admin@nbcc", role: "admin", now: new Date(), secret: "s" }).token;

type Partner = { id: number; name: string; active: boolean; sortOrder: number; createdAt: string };
type Call = { method: string; path: string; body?: string };
let perms: PermissionMap = {};
let calls: Call[] = [];
let partners: Partner[] = [];
// What a write answers: "ok" does it; a number is that status with nothing changed; "down" never arrives.
let writeAnswer: "ok" | "down" | number = "ok";
let nextId = 100;

const partner = (id: number, name: string, active: boolean, extra: Partial<Partner> = {}): Partner => ({
  id, name, active, sortOrder: 0, createdAt: "2026-03-0" + ((id % 9) + 1) + "T10:00:00Z", ...extra,
});
const inOrder = () =>
  [...partners].sort((a, b) => a.sortOrder - b.sortOrder || a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id - b.id);

function respond(method: string, path: string, body?: string) {
  const j = (payload: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  if (path === "/api/admin/login") return j({ token, user: { email: "admin@nbcc", role: "admin" } });
  if (path === "/api/admin/me") return j({ email: "admin@nbcc", permissions: perms });
  if (path === "/api/admin/ticker" && method === "GET") return j({ results: inOrder().map((p) => ({ ...p })) });
  if (path.startsWith("/api/admin/ticker") && method !== "GET") {
    if (writeAnswer === "down") throw new TypeError("Failed to fetch");
    if (writeAnswer !== "ok") return j({ error: "No" }, writeAnswer);
    const sent = JSON.parse(body || "{}") as Partial<Partner>;
    if (method === "POST") {
      const id = nextId++;
      partners.push(partner(id, String(sent.name), true));
      return j({ id }, 201);
    }
    const id = Number(path.split("/").pop());
    const found = partners.find((p) => p.id === id);
    if (!found) return j({ error: "Not found" }, 404);
    if (method === "PATCH") Object.assign(found, sent);
    if (method === "DELETE") partners = partners.filter((p) => p.id !== id);
    return j({ ok: true });
  }
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 8; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement;
const all = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const card = (id: number) => q(`#tickerTable [data-ticker-card="${id}"]`);
const toggle = (id: number) => q(`#tickerTable [data-ticker-toggle="${id}"]`);
const said = (id: number) => card(id).querySelector("[data-ticker-said]") as HTMLElement;
const names = () => all("#tickerTable .pt-card__name").map((n) => n.textContent);
const tile = (key: string) => q(`#tickerTiles [data-ticker-filter="${key}"]`);
const tileCount = (key: string) => (tile(key).querySelector(".ak-tile__n") as HTMLElement).textContent;
const writes = () => calls.filter((c) => c.method !== "GET" && c.path.startsWith("/api/admin/ticker"));
const reads = () => calls.filter((c) => c.method === "GET" && c.path === "/api/admin/ticker");

async function press(target: HTMLElement) {
  target.click();
  await settle();
}
async function type(input: HTMLElement, value: string) {
  (input as HTMLInputElement).value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
}
async function openPartners() {
  (el("adminEmail") as HTMLInputElement).value = "admin@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  await press(q('.admin-nav-link[data-view="ticker"]'));
}
// The rest of a partner's card: Rename, Put first and Remove.
async function openMore(id: number) {
  await press(q(`#tickerTable [data-ticker-more="${id}"]`));
}

beforeEach(() => {
  perms = effectivePermissions({ role: "admin", permissions: null });
  calls = [];
  writeAnswer = "ok";
  nextId = 100;
  partners = [
    partner(1, "Thistle Example Motors", true),
    partner(2, "Ayr Example Bakery", true),
    partner(3, "Rowan Example Joinery", false),
    partner(4, "Bramble Example Florist", false),
    partner(5, "Heather Example Cafe", false),
  ];
  window.sessionStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (window as unknown as { AdminKit: unknown }).AdminKit = kit;
  window.confirm = () => true;
  window.prompt = () => null;
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: { method?: string; body?: string }) => {
    const method = (init?.method || "GET").toUpperCase();
    const path = String(url).split("?")[0];
    calls.push({ method, path, body: init?.body });
    try {
      return Promise.resolve(respond(method, path, init?.body));
    } catch (err) {
      return Promise.reject(err);
    }
  };
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

describe("the Partners screen", () => {
  it("is in the kit's look and opens with one plain sentence saying what it is for", () => {
    expect(el("view-ticker").classList.contains("ak")).toBe(true);
    const intro = q("#view-ticker .admin-view-intro").textContent || "";
    expect(intro).toContain("Choose which partners' names show on the website.");
    expect(intro).not.toContain("—");
  });

  it("counts the partners on three tiles, and keeps the old line of totals", async () => {
    await openPartners();
    expect([tileCount("showing"), tileCount("hidden"), tileCount("all")]).toEqual(["2", "3", "5"]);
    expect(el("tickerCount").textContent).toBe("5 total · 2 showing");
    expect(tile("all").getAttribute("aria-pressed")).toBe("true");
  });

  it("lists every partner as a card, in the website's order, with its name as words and never as markup", async () => {
    partners.push(partner(6, '<img src=x onerror="1">', false));
    await openPartners();
    expect(names()).toEqual([
      '<img src=x onerror="1">', "Ayr Example Bakery", "Bramble Example Florist", "Heather Example Cafe",
      "Rowan Example Joinery", "Thistle Example Motors",
    ]);
    expect(document.querySelector("#tickerTable img")).toBeNull();
    expect(document.querySelector("#tickerTable table")).toBeNull();
  });

  it("filters in the browser when a tile is pressed, without asking the server again", async () => {
    await openPartners();
    await press(tile("hidden"));
    expect(names()).toEqual(["Bramble Example Florist", "Heather Example Cafe", "Rowan Example Joinery"]);
    expect(tile("hidden").getAttribute("aria-pressed")).toBe("true");
    expect(tile("all").getAttribute("aria-pressed")).toBe("false");
    expect(el("tickerListed").textContent).toBe("3 partners hidden.");
    await press(tile("showing"));
    expect(names()).toEqual(["Ayr Example Bakery", "Thistle Example Motors"]);
    expect(el("tickerListed").textContent).toBe("2 partners showing on the website.");
    expect(reads()).toHaveLength(1);
  });

  it("finds a partner by part of its name, and says how many it found", async () => {
    await openPartners();
    await type(el("tickerSearch"), "exAMple j");
    expect(names()).toEqual(["Rowan Example Joinery"]);
    expect(el("tickerListed").textContent).toBe('1 partner matches "exAMple j".');
    expect(reads()).toHaveLength(1);
  });

  it("says when the name is on the list but not under this tile, and offers the whole list", async () => {
    await openPartners();
    await press(tile("showing"));
    await type(el("tickerSearch"), "rowan");
    expect(names()).toEqual([]);
    expect(el("tickerListed").textContent).toContain('No partner showing on the website matches "rowan". 1 on the whole list does.');
    await press(el("tickerSearchAll"));
    expect(names()).toEqual(["Rowan Example Joinery"]);
    expect(tile("all").getAttribute("aria-pressed")).toBe("true");
  });

  it("draws the first hundred of a long list, says so, and Show more draws the next hundred", async () => {
    partners = [];
    for (let i = 1; i <= 230; i++) partners.push(partner(i, "Example Partner " + String(i).padStart(3, "0"), false));
    await openPartners();
    expect(all("#tickerTable [data-ticker-card]")).toHaveLength(100);
    expect(el("tickerListed").textContent).toBe("230 partners on the list. The first 100 are listed.");
    expect(el("tickerMore").hidden).toBe(false);
    await press(el("tickerMore"));
    expect(all("#tickerTable [data-ticker-card]")).toHaveLength(200);
    await press(el("tickerMore"));
    expect(all("#tickerTable [data-ticker-card]")).toHaveLength(230);
    expect(el("tickerMore").hidden).toBe(true);
    expect(el("tickerListed").textContent).toBe("230 partners on the list.");
  });

  it("can list the newest first", async () => {
    partners[2].createdAt = "2026-11-01T10:00:00Z";
    partners[0].createdAt = "2026-10-01T10:00:00Z";
    await openPartners();
    await press(q('#tickerSort [data-ticker-sort="newest"]'));
    expect(names().slice(0, 2)).toEqual(["Rowan Example Joinery", "Thistle Example Motors"]);
    expect(q('#tickerSort [data-ticker-sort="newest"]').getAttribute("aria-pressed")).toBe("true");
  });
});

describe("the Show or Hide switch on a partner's card", () => {
  it("is one switch a card, on for a partner that is showing", async () => {
    await openPartners();
    expect(toggle(1).getAttribute("role")).toBe("switch");
    expect(toggle(1).getAttribute("aria-checked")).toBe("true");
    expect(toggle(1).textContent).toContain("Showing");
    expect(toggle(3).getAttribute("aria-checked")).toBe("false");
    expect(toggle(3).textContent).toContain("Hidden");
    expect(card(1).querySelectorAll("[data-ticker-toggle]")).toHaveLength(1);
  });

  it("hides a partner, says so in its card, and leaves the card where it is", async () => {
    await openPartners();
    const before = card(1);
    await press(toggle(1));
    expect(writes()).toEqual([{ method: "PATCH", path: "/api/admin/ticker/1", body: '{"active":false}' }]);
    expect(card(1)).toBe(before);
    expect(toggle(1).getAttribute("aria-checked")).toBe("false");
    expect(said(1).textContent).toBe("Hidden from the website now.");
    expect(said(1).classList.contains("is-ok")).toBe(true);
    expect([tileCount("showing"), tileCount("hidden")]).toEqual(["1", "4"]);
    expect(el("tickerCount").textContent).toBe("5 total · 1 showing");
    expect(reads()).toHaveLength(1);
  });

  it("shows a hidden partner, and keeps it in the list it was pressed in", async () => {
    await openPartners();
    await press(tile("hidden"));
    await press(toggle(3));
    expect(writes()[0].body).toBe('{"active":true}');
    expect(said(3).textContent).toBe("Showing on the website now.");
    // Still under Hidden until the tile is pressed again: nothing moves under the thumb.
    expect(names()).toContain("Rowan Example Joinery");
    await press(tile("hidden"));
    expect(names()).not.toContain("Rowan Example Joinery");
  });

  // The fault this screen had: an empty catch, so a failed Hide, Show or Delete looked like nothing.
  it.each([
    [500, 1, "Could not hide that partner. Please try again.", "true"],
    ["down", 1, "Could not hide that partner. Please try again.", "true"],
    [500, 3, "Could not show that partner. Please try again.", "false"],
  ] as const)("says so in the card when the server answers %s, and leaves the switch as it was", async (answer, id, sentence, checked) => {
    writeAnswer = answer;
    await openPartners();
    await press(toggle(id));
    expect(said(id).textContent).toBe(sentence);
    expect(said(id).classList.contains("is-error")).toBe(true);
    expect(said(id).classList.contains("err")).toBe(false);
    expect(toggle(id).getAttribute("aria-checked")).toBe(checked);
    expect([tileCount("showing"), tileCount("hidden")]).toEqual(["2", "3"]);
  });

  it("goes back to signing in, and says nothing in the card, when the session has ended", async () => {
    writeAnswer = 401;
    await openPartners();
    await press(toggle(1));
    expect(el("loginView").hidden).toBe(false);
  });
});

describe("Rename, Put first and Remove, inside the card", () => {
  it("are not drawn until the card is opened", async () => {
    await openPartners();
    expect(document.querySelector("#tickerTable [data-ticker-remove]")).toBeNull();
    await openMore(2);
    expect(q('#tickerTable [data-ticker-more="2"]').getAttribute("aria-expanded")).toBe("true");
    expect(card(2).querySelector("[data-ticker-rename]")).not.toBeNull();
    expect(card(2).querySelector("[data-ticker-first]")).not.toBeNull();
    expect(card(2).querySelector("[data-ticker-remove]")).not.toBeNull();
    // Each says what it does, under the button.
    expect(card(2).querySelectorAll(".ak-says").length).toBeGreaterThanOrEqual(3);
  });

  it("renames on the page, with no browser box", async () => {
    const prompt = vi.spyOn(window, "prompt");
    await openPartners();
    await openMore(2);
    const input = card(2).querySelector("[data-ticker-rename] input") as HTMLInputElement;
    expect(input.value).toBe("Ayr Example Bakery");
    input.value = "  Ayr Example Bakehouse ";
    (card(2).querySelector("[data-ticker-rename]") as HTMLElement).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(prompt).not.toHaveBeenCalled();
    expect(writes()).toEqual([{ method: "PATCH", path: "/api/admin/ticker/2", body: '{"name":"Ayr Example Bakehouse"}' }]);
    expect((card(2).querySelector(".pt-card__name") as HTMLElement).textContent).toBe("Ayr Example Bakehouse");
    expect(said(2).textContent).toBe("Saved.");
  });

  it("says so in the card when the new name could not be saved", async () => {
    await openPartners();
    await openMore(2);
    writeAnswer = 500;
    (card(2).querySelector("[data-ticker-rename] input") as HTMLInputElement).value = "Another Example Name";
    (card(2).querySelector("[data-ticker-rename]") as HTMLElement).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(said(2).textContent).toBe("Could not rename that partner. Please try again.");
    expect(said(2).classList.contains("is-error")).toBe(true);
    expect((card(2).querySelector(".pt-card__name") as HTMLElement).textContent).toBe("Ayr Example Bakery");
  });

  it("puts a partner first on the website", async () => {
    await openPartners();
    await openMore(1);
    await press(card(1).querySelector("[data-ticker-first]") as HTMLElement);
    expect(writes()).toEqual([{ method: "PATCH", path: "/api/admin/ticker/1", body: '{"sortOrder":-1}' }]);
    expect(said(1).textContent).toBe("First on the website now.");
    expect(all("#tickerPreview .pt-strip__name").map((n) => n.textContent)).toEqual(["Thistle Example Motors", "Ayr Example Bakery"]);
  });

  it("asks before removing, in the page, and No sends nothing", async () => {
    const confirm = vi.spyOn(window, "confirm");
    await openPartners();
    await openMore(2);
    await press(card(2).querySelector("[data-ticker-remove]") as HTMLElement);
    const ask = card(2).querySelector("[data-ticker-remove-ask]") as HTMLElement;
    expect(ask.hidden).toBe(false);
    expect(ask.textContent).toContain("Remove “Ayr Example Bakery” from the partners list? This cannot be undone.");
    await press(card(2).querySelector("[data-ticker-remove-no]") as HTMLElement);
    expect((card(2).querySelector("[data-ticker-remove-ask]") as HTMLElement).hidden).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("removes on Yes, and says what went where the card was", async () => {
    await openPartners();
    await openMore(2);
    await press(card(2).querySelector("[data-ticker-remove]") as HTMLElement);
    await press(card(2).querySelector("[data-ticker-remove-yes]") as HTMLElement);
    expect(writes()).toEqual([{ method: "DELETE", path: "/api/admin/ticker/2", body: undefined }]);
    expect(card(2).textContent).toBe("“Ayr Example Bakery” was removed from the list.");
    expect([tileCount("showing"), tileCount("all")]).toEqual(["1", "4"]);
  });

  it("says so in the card when it could not be removed, and keeps the card", async () => {
    await openPartners();
    await openMore(2);
    await press(card(2).querySelector("[data-ticker-remove]") as HTMLElement);
    writeAnswer = 500;
    await press(card(2).querySelector("[data-ticker-remove-yes]") as HTMLElement);
    expect(said(2).textContent).toBe("Could not remove that partner. Please try again.");
    expect(said(2).classList.contains("is-error")).toBe(true);
    expect((card(2).querySelector(".pt-card__name") as HTMLElement).textContent).toBe("Ayr Example Bakery");
    expect(tileCount("all")).toBe("5");
  });
});

describe("adding a partner", () => {
  it("adds a new name, says so beside the button, and lists it", async () => {
    await openPartners();
    (el("tickerName") as HTMLInputElement).value = " Juniper Example Print ";
    el("tickerForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(writes()).toEqual([{ method: "POST", path: "/api/admin/ticker", body: '{"name":"Juniper Example Print"}' }]);
    expect(el("tickerStatus").textContent).toBe("Added. “Juniper Example Print” is showing on the website now.");
    expect(el("tickerStatus").classList.contains("is-ok")).toBe(true);
    expect((el("tickerName") as HTMLInputElement).value).toBe("");
    expect(names()).toContain("Juniper Example Print");
    expect(el("tickerStatus").closest("#tickerAddPanel")).not.toBeNull();
  });

  it("sends one add for a double press, and lets the button be pressed again once it is done", async () => {
    await openPartners();
    (el("tickerName") as HTMLInputElement).value = "Juniper Example Print";
    el("tickerForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    el("tickerForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    expect((el("tickerAdd") as HTMLButtonElement).disabled).toBe(true);
    await settle();
    expect(writes().filter((w) => w.method === "POST")).toHaveLength(1);
    expect((el("tickerAdd") as HTMLButtonElement).disabled).toBe(false);
  });

  it("says a partner could not be added, in the word the screen uses", async () => {
    writeAnswer = 500;
    await openPartners();
    (el("tickerName") as HTMLInputElement).value = "Juniper Example Print";
    el("tickerForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(el("tickerStatus").textContent).toBe("Could not add that partner. Please try again.");
    expect(el("tickerStatus").classList.contains("is-error")).toBe(true);
    expect((el("tickerName") as HTMLInputElement).value).toBe("Juniper Example Print");
  });

  it("shows what is already on the list as the name is typed, with Show it for one that is hidden", async () => {
    await openPartners();
    await type(el("tickerName"), "example j");
    const dupes = el("tickerDupes");
    expect(dupes.textContent).toContain("Already on the list");
    expect(dupes.textContent).toContain("Rowan Example Joinery");
    expect(dupes.textContent).toContain("Hidden");
    await press(dupes.querySelector('[data-ticker-show="3"]') as HTMLElement);
    expect(writes()).toEqual([{ method: "PATCH", path: "/api/admin/ticker/3", body: '{"active":true}' }]);
    expect(el("tickerStatus").textContent).toBe("“Rowan Example Joinery” is showing on the website now.");
    expect(el("tickerDupes").querySelector("[data-ticker-show]")).toBeNull();
    expect(toggle(3).getAttribute("aria-checked")).toBe("true");
  });

  it("offers no Show it for a partner that is already showing, and nothing at all for a letter or two", async () => {
    await openPartners();
    await type(el("tickerName"), "a");
    expect(el("tickerDupes").textContent).toBe("");
    await type(el("tickerName"), "ayr");
    expect(el("tickerDupes").textContent).toContain("Ayr Example Bakery");
    expect(el("tickerDupes").querySelector("[data-ticker-show]")).toBeNull();
  });

  it("does not add a name that is already on the list, whatever its capitals and spaces", async () => {
    await openPartners();
    (el("tickerName") as HTMLInputElement).value = "rowan  example JOINERY";
    el("tickerForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(writes()).toEqual([]);
    expect(el("tickerStatus").textContent).toBe("“Rowan Example Joinery” is already on the list. It is hidden: press Show it to put it on the website.");
    expect(el("tickerStatus").classList.contains("is-error")).toBe(true);
  });

  it("adds several at once, one name a line, leaving out any already on the list", async () => {
    await openPartners();
    (el("tickerMany") as HTMLTextAreaElement).value = "Juniper Example Print\n\n  ayr example bakery\nLarch Example Taxis\nJuniper Example Print\n";
    await press(el("tickerManyAdd"));
    expect(writes().map((w) => [w.method, w.body])).toEqual([
      ["POST", '{"name":"Juniper Example Print"}'],
      ["POST", '{"name":"Larch Example Taxis"}'],
    ]);
    expect(el("tickerManyStatus").textContent).toBe("Added 2 of 3. Already on the list, so left out: ayr example bakery.");
    expect((el("tickerMany") as HTMLTextAreaElement).value).toBe("");
    expect(names()).toContain("Larch Example Taxis");
  });

  it("keeps the names that could not be added in the box, and says which", async () => {
    await openPartners();
    writeAnswer = 500;
    (el("tickerMany") as HTMLTextAreaElement).value = "Juniper Example Print\nLarch Example Taxis";
    await press(el("tickerManyAdd"));
    expect(el("tickerManyStatus").textContent).toBe("Added 0 of 2. Could not add: Juniper Example Print, Larch Example Taxis. Please try those again.");
    expect(el("tickerManyStatus").classList.contains("is-error")).toBe(true);
    expect((el("tickerMany") as HTMLTextAreaElement).value).toBe("Juniper Example Print\nLarch Example Taxis");
  });
});

describe("how it looks on the website", () => {
  it("shows the names that are showing, in the website's order, and links to the Supporters page", async () => {
    partners[1].sortOrder = 5;
    await openPartners();
    expect(all("#tickerPreview .pt-strip__name").map((n) => n.textContent)).toEqual(["Thistle Example Motors", "Ayr Example Bakery"]);
    const link = q("#view-ticker a[href='/supporters#partners']");
    expect(link.textContent).toBe("See the Supporters page");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("says so when no partner is showing", async () => {
    partners.forEach((p) => (p.active = false));
    await openPartners();
    expect(el("tickerPreview").textContent).toBe("No partner is showing on the website yet. Switch one on in the list below.");
  });
});

describe("someone who may only look at Partners", () => {
  beforeEach(() => {
    perms = effectivePermissions({ role: "viewer", permissions: null });
  });

  it("sees the list, the tiles and the search, and nothing that changes a partner", async () => {
    await openPartners();
    expect(names()).toHaveLength(5);
    expect(tileCount("all")).toBe("5");
    expect(document.querySelector("#tickerTable [data-ticker-toggle]")).toBeNull();
    expect(document.querySelector("#tickerTable [data-ticker-more]")).toBeNull();
    expect(el("tickerAddPanel").hidden).toBe(true);
    expect(el("tickerAdd").hidden).toBe(true);
    // What the switch would have said is still said, as a word.
    expect(card(1).textContent).toContain("Showing");
    expect(card(3).textContent).toContain("Hidden");
  });
});

describe("when the list cannot be read", () => {
  it("says so in the page, with no counts", async () => {
    const real = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: { method?: string; body?: string }) =>
      String(url).split("?")[0] === "/api/admin/ticker"
        ? Promise.resolve({ status: 500, ok: false, json: () => Promise.resolve({ error: "down" }), text: () => Promise.resolve(""), headers: { get: () => "application/json" } })
        : (real as unknown as (u: unknown, i?: unknown) => Promise<unknown>)(url, init);
    await openPartners();
    expect(el("tickerTable").textContent).toBe("Could not load the partners. Please try again.");
    expect(el("tickerCount").textContent).toBe("");
    expect([tileCount("showing"), tileCount("hidden"), tileCount("all")]).toEqual(["", "", ""]);
    expect(el("tickerPreview").textContent).toBe("");
  });
});
