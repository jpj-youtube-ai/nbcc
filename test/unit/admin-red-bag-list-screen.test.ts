// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Admin > Fill a Red Bag: the list's editor (assets/js/admin/red-bag-list.js), driven in jsdom over
// the view admin.html ships, with the real catalogue and the real rules beside it. The server is a
// stand in that answers as src/routes/admin-red-bag-list.ts does. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const RB = require(resolve(ROOT, "assets/js/red-bag-catalogue.js"));
const L = require(resolve(ROOT, "assets/js/red-bag-list.js"));
const { initAdminRedBagList } = require(resolve(ROOT, "assets/js/admin/red-bag-list.js")) as {
  initAdminRedBagList: (doc: Document, win: unknown) => { open: () => Promise<unknown>; load: () => Promise<unknown>; save: () => Promise<boolean>; isDirty: () => boolean; working: () => List } | null;
};
const adminHtml = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const script = readFileSync(resolve(ROOT, "assets/js/admin/red-bag-list.js"), "utf8");

type Item = { key: string; name: string; pence: number | null; group: string; art: string; hidden: boolean };
type Example = { key: string; theme: string; pence: number | null; words: string; art: string; hidden: boolean };
type List = { v: 1; items: Item[]; examples: Example[] };
type State = { mayEdit: boolean; website: List; publishedId: number | null; draft: { data: List; version: number; updatedAt: string; updatedByName: string; restoredFrom: null } | null; changes: string[]; history: Array<Record<string, unknown>> };
type Call = { method: string; path: string; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const ARROW = String.fromCharCode(0x2192);
const builtIn = (): List => L.builtIn();
const withToy = (pence: number): List => {
  const l = builtIn();
  l.items.find((i) => i.key === "toy")!.pence = pence;
  return l;
};
const state = (over: Partial<State> = {}): State => ({ mayEdit: true, website: builtIn(), publishedId: null, draft: null, changes: [], history: [], ...over });
const draftOf = (data: List, version = 3) => ({ data, version, updatedAt: "2026-10-05T13:05:00.000Z", updatedByName: "Jodie Example", restoredFrom: null });
const version = (id: number, name: string, at: string, changes: string[]) => ({ id, publishedAt: at, publishedByName: name, summary: changes.slice(0, 3).join("; "), changes, restoredFrom: null, restoredOriginal: false });

let calls: Call[];
let answers: Array<(c: Call) => { status: number; body: unknown } | undefined>;
let opened: string[];
let confirmAnswer: boolean;
let confirmAsked: string[];
let store: Map<string, string>;
let api: NonNullable<ReturnType<typeof initAdminRedBagList>>;
let reloaded: number;
let generation = 0;

/** The view as admin.html ships it, inside the signed in app. */
function page() {
  const view = adminHtml.match(/<section class="admin-view" id="view-red-bag"[\s\S]*?<\/section>/)![0];
  document.body.innerHTML =
    '<div id="appView"><nav><button class="admin-nav-link" data-view="donations">Donations</button><button class="admin-nav-link" data-view="red-bag">Fill a Red Bag</button></nav>' +
    '<button id="logoutBtn">Sign out</button>' + view + "</div>";
}
async function start(first: State | { status: number; body?: unknown } | Error, o: { open?: boolean } = {}) {
  page();
  calls = [];
  answers = [];
  opened = [];
  confirmAsked = [];
  confirmAnswer = true;
  reloaded = 0;
  const mine = (generation += 1);
  store = new Map([["nbcc_admin_token", "tok.en"]]);
  let current: unknown = first;
  const win = {
    NBCCRedBag: RB,
    NBCCRedBagList: L,
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => void store.delete(k) },
    addEventListener: vi.fn(),
    open: (url: string) => void opened.push(url),
    confirm: (words: string) => {
      // The page outlives a test in jsdom, and so do the listeners of the screens before this one.
      if (mine !== generation) return true;
      confirmAsked.push(words);
      return confirmAnswer;
    },
    location: { reload: () => void (reloaded += 1) },
    fetch: vi.fn(async (path: string, opts: { method?: string; body?: string; headers?: Record<string, string> } = {}) => {
      const call = { method: opts.method ?? "GET", path, body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers };
      calls.push(call);
      for (const a of answers) {
        const out = a(call);
        if (out) return { ok: out.status < 400, status: out.status, json: async () => out.body };
      }
      if (current instanceof Error) throw current;
      const c = current as { status?: number; body?: unknown };
      if (typeof c.status === "number" && !("website" in c)) return { ok: c.status < 400, status: c.status, json: async () => c.body ?? {} };
      return { ok: true, status: 200, json: async () => current };
    }),
  };
  (start as unknown as { set: (s: unknown) => void }).set = (s) => void (current = s);
  api = initAdminRedBagList(document, win)!;
  // app.js shows the view when its menu link is chosen, and then calls open().
  $("#view-red-bag").hidden = false;
  if (o.open !== false) await api.open();
  return win;
}
const serverNow = (s: unknown) => (start as unknown as { set: (s: unknown) => void }).set(s);
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const text = (sel: string) => norm($(sel)?.textContent);
const row = (key: string) => $(`[data-rbl-item="${key}"], [data-rbl-example="${key}"]`);
const inRow = <T extends Element = HTMLElement>(key: string, sel: string) => row(key).querySelector(sel) as T;
const type = (el: HTMLInputElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const choose = (el: HTMLSelectElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const tick = (el: HTMLInputElement, on: boolean) => {
  el.checked = on;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const click = (sel: string) => ($(sel) as HTMLElement).click();
const changeLines = () => $$("[data-rbl-changes]")[0] ? [...$$("[data-rbl-changes]")[0].querySelectorAll("li")].map((li) => norm(li.textContent)) : [];
const errorOf = (key: string, field: string) => {
  const p = document.getElementById(`rbl-${key}-${field}-error`)!;
  return p.hidden ? "" : norm(p.textContent);
};
const newItemKey = () => api.working().items.map((i) => i.key).find((k) => k.startsWith("n-"))!;
const newExampleKey = () => api.working().examples.map((e) => e.key).find((k) => k.startsWith("n-"))!;

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("how it is wired into the admin", () => {
  it("has its view, its styles and its three scripts in admin.html, the catalogue and the rules before the screen", () => {
    expect(adminHtml).toContain('<section class="admin-view" id="view-red-bag" aria-labelledby="red-bag-heading" hidden>');
    expect(adminHtml).toContain('<h2 id="red-bag-heading">Fill a Red Bag</h2>');
    expect(adminHtml).toContain('<link rel="stylesheet" href="/assets/css/admin-red-bag-list.css" />');
    const at = (src: string) => adminHtml.indexOf(`<script defer src="${src}"></script>`);
    expect(at("/assets/js/red-bag-catalogue.js")).toBeGreaterThan(-1);
    expect(at("/assets/js/red-bag-list.js")).toBeGreaterThan(at("/assets/js/red-bag-catalogue.js"));
    expect(at("/assets/js/admin/red-bag-list.js")).toBeGreaterThan(at("/assets/js/red-bag-list.js"));
  });

  it("is opened by app.js when its menu link is chosen", () => {
    const appJs = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
    expect(appJs).toContain('else if (name === "red-bag") { if (window.AdminRedBagList) window.AdminRedBagList.open(); }');
  });

  it("reads the list at once if app.js had already shown the section before this file ran", async () => {
    const view = adminHtml.match(/<section class="admin-view" id="view-red-bag"[\s\S]*?<\/section>/)![0].replace(" hidden>", ">");
    document.body.innerHTML = '<div id="appView">' + view + "</div>";
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => state() }));
    initAdminRedBagList(document, { NBCCRedBag: RB, NBCCRedBagList: L, fetch, sessionStorage: { getItem: () => "t" }, addEventListener: vi.fn() });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect($$("[data-rbl-item]").length).toBe(13);
  });

  it("does nothing on a page without its view", () => {
    document.body.innerHTML = "<p>Another page</p>";
    expect(initAdminRedBagList(document, {})).toBeNull();
  });

  it("asks its own API with the tab's session, and nothing until it is opened", async () => {
    await start(state(), { open: false });
    expect(calls).toEqual([]);
    await api.open();
    expect(calls.map((c) => [c.method, c.path])).toEqual([["GET", "/api/admin/red-bag-list"]]);
    expect((calls[0] as unknown as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer tok.en");
  });
});

describe("the editor with nothing changed", () => {
  beforeEach(() => start(state()));

  it("draws the four headings with their items as rows", () => {
    expect($$(".rbl-card")[0].querySelectorAll(".rbl-group-title").length).toBe(4);
    expect($$("[data-rbl-group-box] .rbl-group-title").map((h) => norm(h.textContent))).toEqual(["Home comforts", "Play & downtime", "Books & creativity", "Clothing"]);
    expect($$("[data-rbl-item]").map((r) => r.getAttribute("data-rbl-item"))).toEqual(builtIn().items.map((i) => i.key));
    expect(inRow<HTMLInputElement>("toy", "[data-rbl-name]").value).toBe("Toy");
    expect(inRow<HTMLInputElement>("toy", "[data-rbl-price]").value).toBe("15");
    expect(inRow<HTMLInputElement>("pencil", "[data-rbl-price]").value).toBe("0.10");
    expect(inRow<HTMLSelectElement>("toy", "[data-rbl-group]").value).toBe("play");
    expect(inRow<HTMLInputElement>("toy", "[data-rbl-show]").checked).toBe(true);
    expect(inRow("toy", ".rbl-pic svg")).toBeTruthy();
  });

  it("draws the three themes with their examples, the words without could help, which stands fixed beside the box", () => {
    expect($$("[data-rbl-theme-box] .rbl-group-title").map((h) => norm(h.textContent))).toEqual(["After a crisis", "Clothing & school", "A hand at rock bottom"]);
    expect($$("[data-rbl-theme-box] .rbl-group-sub").map((h) => norm(h.textContent))).toEqual(["Helping families start again", "When families can't stretch to it", "When it matters most"]);
    expect($$("[data-rbl-example]").length).toBe(9);
    expect(inRow<HTMLInputElement>("crisis-30", "[data-rbl-amount]").value).toBe("30");
    expect(inRow<HTMLInputElement>("crisis-30", "[data-rbl-words]").value).toBe("with fresh bedding for a child");
    expect(norm(inRow("crisis-30", ".rbl-could-fixed").textContent)).toBe("could help");
  });

  it("has nothing to edit that is fixed: no box for a heading, a theme's name or its description", () => {
    for (const box of $$("[data-rbl-group-box], [data-rbl-theme-box]")) {
      expect(box.querySelector(":scope > input, :scope > .rbl-group-title input")).toBeNull();
    }
    expect(document.querySelectorAll("[data-rbl-name]").length).toBe(13);
    expect(document.querySelectorAll("[data-rbl-words]").length).toBe(9);
  });

  it("labels every control with its item's name", () => {
    expect(inRow("toy", "[data-rbl-name]").getAttribute("aria-label")).toBe("Name of Toy");
    expect(inRow("toy", "[data-rbl-price]").getAttribute("aria-label")).toBe("Price of Toy");
    expect(inRow("toy", "[data-rbl-group]").getAttribute("aria-label")).toBe("Heading for Toy");
    expect(inRow("toy", "[data-rbl-show]").getAttribute("aria-label")).toBe("Show Toy on the page");
    expect(inRow("toy", "[data-rbl-up]").getAttribute("aria-label")).toBe("Move Toy up");
    expect(inRow("toy", "[data-rbl-down]").getAttribute("aria-label")).toBe("Move Toy down");
    expect(inRow("toy", "[data-rbl-picture]").getAttribute("aria-label")).toBe("Change picture of Toy");
    expect(inRow("crisis-30", "[data-rbl-amount]").getAttribute("aria-label")).toBe("Amount for the example £30 could help with fresh bedding for a child");
    expect(inRow("crisis-30", "[data-rbl-up]").getAttribute("aria-label")).toBe("Move the example £30 could help with fresh bedding for a child up");
    for (const el of $$("#rblRoot input, #rblRoot select, #rblRoot button")) {
      expect(el.getAttribute("aria-label") || norm(el.textContent), el.outerHTML.slice(0, 80)).toBeTruthy();
    }
  });

  it("uses real buttons for moving, the first unable to go up and the last unable to go down", () => {
    expect(inRow("toy", "[data-rbl-up]").tagName).toBe("BUTTON");
    expect(inRow<HTMLButtonElement>("toy", "[data-rbl-up]").disabled).toBe(true);
    expect(inRow<HTMLButtonElement>("toy", "[data-rbl-down]").disabled).toBe(false);
    expect(inRow<HTMLButtonElement>("headphones", "[data-rbl-down]").disabled).toBe(true);
  });

  it("says nothing differs, and offers nothing to publish, preview or throw away", () => {
    expect(text("[data-rbl-count]")).toBe("No changes. This is what the website shows now.");
    expect(changeLines()).toEqual([]);
    expect($("[data-rbl-publish]")).toBeNull();
    expect($("[data-rbl-preview]")).toBeNull();
    expect($("[data-rbl-discard]")).toBeNull();
    expect(text("[data-rbl-saved-state]")).toBe("This is the list the website shows. Nothing has been changed.");
    expect($<HTMLButtonElement>("[data-rbl-save]").disabled).toBe(true);
    expect(api.isDirty()).toBe(false);
  });

  it("shows the original list in the history even before anything is published, as what the website shows now", () => {
    const rows = $$("[data-rbl-version]");
    expect(rows.map((r) => r.getAttribute("data-rbl-version"))).toEqual(["original"]);
    expect(norm(rows[0].querySelector(".rbl-version-title")!.textContent)).toBe("The original list On the website now");
  });

  it("offers Remove on nothing that is on the website", () => {
    expect($("[data-rbl-remove]")).toBeNull();
  });
});

describe("the differences, as they are typed", () => {
  beforeEach(() => start(state()));

  it("a price", () => {
    type(inRow("toy", "[data-rbl-price]"), "12");
    expect(changeLines()).toEqual([`Toy £15 ${ARROW} £12`]);
    expect(text("[data-rbl-count]")).toBe("1 change not yet on the website");
    expect(text("[data-rbl-saved-state]")).toBe("You have changes on this screen that are not saved.");
    expect($<HTMLButtonElement>("[data-rbl-save]").disabled).toBe(false);
  });

  it("keeps the box being typed in: it is never redrawn under the cursor", () => {
    const box = inRow<HTMLInputElement>("toy", "[data-rbl-price]");
    box.focus();
    type(box, "1");
    type(box, "12");
    expect(inRow("toy", "[data-rbl-price]")).toBe(box);
    expect(document.activeElement).toBe(box);
  });

  it("a new item, with the present for its picture until one is chosen", () => {
    click('[data-rbl-add-item="play"]');
    const key = newItemKey();
    expect(key).toMatch(/^n-item-[a-z0-9]{5}$/);
    expect(document.activeElement).toBe(inRow(key, "[data-rbl-name]"));
    expect(api.working().items.find((i) => i.key === key)).toMatchObject({ group: "play", art: "present", hidden: false });
    type(inRow(key, "[data-rbl-name]"), "Selection box");
    type(inRow(key, "[data-rbl-price]"), "3");
    expect(changeLines()).toEqual(["New: Selection box £3"]);
    expect(row(key).closest("[data-rbl-group-box]")!.getAttribute("data-rbl-group-box")).toBe("play");
    expect(inRow(key, "[data-rbl-remove]")).toBeTruthy();
  });

  it("a hidden item, and showing it again", () => {
    tick(inRow("hat-gloves", "[data-rbl-show]"), false);
    expect(changeLines()).toEqual(["Hidden: Hat & gloves"]);
    expect(row("hat-gloves").classList.contains("is-hidden")).toBe(true);
    expect(norm(inRow("hat-gloves", ".rbl-show span").textContent)).toBe("Hidden");
    tick(inRow("hat-gloves", "[data-rbl-show]"), true);
    expect(changeLines()).toEqual([]);
    expect(api.isDirty()).toBe(false);
  });

  it("an item moved to another heading goes to the end of it", () => {
    choose(inRow("notebook", "[data-rbl-group]"), "home");
    expect(changeLines()).toEqual(["Moved: Notebook, from Books & creativity to Home comforts"]);
    const home = [...$('[data-rbl-group-box="home"]').querySelectorAll("[data-rbl-item]")].map((r) => r.getAttribute("data-rbl-item"));
    expect(home).toEqual(["blanket", "insulated-cup", "toiletry-set", "notebook"]);
  });

  it("moving up and down with the buttons, the focus staying with the row", () => {
    inRow("soft-toy", "[data-rbl-up]").click();
    expect([...$('[data-rbl-group-box="play"]').querySelectorAll("[data-rbl-item]")].map((r) => r.getAttribute("data-rbl-item"))).toEqual(["soft-toy", "toy", "headphones"]);
    expect(changeLines()).toEqual(["Order changed: Play & downtime"]);
    // It is first now, so Up is spent: the focus goes to its Down.
    expect(document.activeElement).toBe(inRow("soft-toy", "[data-rbl-down]"));
    inRow("soft-toy", "[data-rbl-down]").click();
    expect(document.activeElement).toBe(inRow("soft-toy", "[data-rbl-down]"));
    expect(changeLines()).toEqual([]);
  });

  it("an edited example: the amount and what follows could help", () => {
    type(inRow("crisis-30", "[data-rbl-amount]"), "35");
    type(inRow("crisis-30", "[data-rbl-words]"), "with warm bedding for a child");
    expect(changeLines()).toEqual([`Example changed: £30 could help with fresh bedding for a child ${ARROW} £35 could help with warm bedding for a child`]);
    expect(api.working().examples.find((e) => e.key === "crisis-30")!.words).toBe("could help with warm bedding for a child");
  });

  it("a new example always reads could help, whatever is typed", () => {
    click('[data-rbl-add-example="school"]');
    const key = newExampleKey();
    type(inRow(key, "[data-rbl-amount]"), "20");
    type(inRow(key, "[data-rbl-words]"), "  with a   school bag ");
    expect(api.working().examples.find((e) => e.key === key)).toMatchObject({ theme: "school", pence: 2000, words: "could help with a school bag", art: "present" });
    expect(changeLines()).toEqual(["New example: £20 could help with a school bag"]);
  });

  it("removing something not yet on the website takes it off the screen and out of the differences", () => {
    click('[data-rbl-add-item="home"]');
    const key = newItemKey();
    type(inRow(key, "[data-rbl-name]"), "Selection box");
    inRow(key, "[data-rbl-remove]").click();
    expect(row(key)).toBeNull();
    expect(api.isDirty()).toBe(false);
  });
});

describe("the picture chooser", () => {
  beforeEach(() => start(state()));

  it("opens under the row with every drawing, each named, the one in use marked", () => {
    inRow("toy", "[data-rbl-picture]").click();
    const chooser = inRow("toy", "[data-rbl-chooser]");
    expect(chooser).toBeTruthy();
    const options = [...chooser.querySelectorAll("[data-rbl-art]")];
    expect(options.map((o) => o.getAttribute("data-rbl-art")).sort()).toEqual(Object.keys(RB.ART).sort());
    expect(options.length).toBe(23);
    for (const o of options) {
      expect(o.tagName).toBe("BUTTON");
      expect(o.getAttribute("aria-label")).toBeTruthy();
      expect(o.querySelector("svg")).toBeTruthy();
    }
    expect(chooser.querySelector('[data-rbl-art="present"]')!.getAttribute("aria-label")).toBe("Wrapped present");
    expect(chooser.querySelector('[data-rbl-art="blanket"]')!.getAttribute("aria-label")).toBe("Blanket");
    expect(chooser.querySelector('[data-rbl-art="hand-150"]')!.getAttribute("aria-label")).toBe("Cooker");
    expect(chooser.querySelector('[aria-pressed="true"]')!.getAttribute("data-rbl-art")).toBe("toy");
    expect(inRow("toy", "[data-rbl-picture]").getAttribute("aria-expanded")).toBe("true");
    expect(norm(chooser.querySelector(".rbl-chooser-title")!.textContent)).toBe("Choose a picture for Toy");
  });

  it("choosing one closes it, changes the row's picture, and says so in the differences", () => {
    inRow("toy", "[data-rbl-picture]").click();
    inRow("toy", '[data-rbl-art="present"]').click();
    expect(inRow("toy", "[data-rbl-chooser]")).toBeNull();
    expect(api.working().items.find((i) => i.key === "toy")!.art).toBe("present");
    expect(changeLines()).toEqual(["Picture changed: Toy"]);
    expect(document.activeElement).toBe(inRow("toy", "[data-rbl-picture]"));
  });

  it("can be closed without choosing", () => {
    inRow("toy", "[data-rbl-picture]").click();
    inRow("toy", "[data-rbl-chooser-close]").click();
    expect($("[data-rbl-chooser]")).toBeNull();
    expect(api.isDirty()).toBe(false);
  });

  it("has no way to upload a picture", () => {
    inRow("toy", "[data-rbl-picture]").click();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(script).not.toMatch(/type="file"|FileReader|FormData/);
  });
});

describe("what is wrong, said beside the field as it is typed", () => {
  beforeEach(() => start(state()));

  it("a price out of range, or not a price", () => {
    for (const bad of ["0.05", "501", "abc", ""]) {
      type(inRow("toy", "[data-rbl-price]"), bad);
      expect(errorOf("toy", "price"), bad).toBe("A price must be between 10p and £500.");
      expect(inRow("toy", "[data-rbl-price]").getAttribute("aria-invalid")).toBe("true");
    }
    expect(inRow("toy", "[data-rbl-price]").getAttribute("aria-describedby")).toBe("rbl-toy-price-error");
    type(inRow("toy", "[data-rbl-price]"), "12.50");
    expect(errorOf("toy", "price")).toBe("");
    expect(inRow("toy", "[data-rbl-price]").hasAttribute("aria-invalid")).toBe(false);
  });

  it("a name that is empty, too long, or breaks the wording rules", () => {
    type(inRow("toy", "[data-rbl-name]"), " ");
    expect(errorOf("toy", "name")).toBe("Give this item a name.");
    type(inRow("toy", "[data-rbl-name]"), "x".repeat(41));
    expect(errorOf("toy", "name")).toBe("A name can be 40 characters at most.");
    type(inRow("toy", "[data-rbl-name]"), "A toy that will last");
    expect(errorOf("toy", "name")).toBe('Say "could", never "will": these are examples, not promises.');
    type(inRow("toy", "[data-rbl-name]"), "Buy a toy");
    expect(errorOf("toy", "name")).toBe('Leave out "buy", "buys" and "bought": nothing is bought item by item.');
    type(inRow("toy", "[data-rbl-name]"), "Blanket");
    expect(errorOf("toy", "name")).toBe("Two items showing cannot have the same name.");
  });

  it("an example's amount and words", () => {
    type(inRow("crisis-30", "[data-rbl-amount]"), "0.50");
    expect(errorOf("crisis-30", "amount")).toBe("An amount must be between £1 and £1,000.");
    type(inRow("crisis-30", "[data-rbl-words]"), "");
    expect(errorOf("crisis-30", "words")).toBe("Say what it could help with.");
    type(inRow("crisis-30", "[data-rbl-words]"), "x".repeat(91));
    expect(errorOf("crisis-30", "words")).toBe("This can be 90 characters at most.");
    type(inRow("crisis-30", "[data-rbl-words]"), "and it will buy bedding");
    expect(errorOf("crisis-30", "words")).toMatch(/never "will"/);
  });

  it("does not scold a row that has only just been added", () => {
    click('[data-rbl-add-item="home"]');
    const key = newItemKey();
    expect(errorOf(key, "name")).toBe("");
    expect(errorOf(key, "price")).toBe("");
  });

  it("refuses to save while anything is wrong: says so, shows every problem, and sends nothing", async () => {
    click('[data-rbl-add-item="home"]');
    const key = newItemKey();
    type(inRow("toy", "[data-rbl-price]"), "9999");
    click("[data-rbl-save]");
    await flush();
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(text("[data-rbl-status]")).toBe("Some things above need another look before this can be saved.");
    expect(errorOf(key, "name")).toBe("Give this item a name.");
    expect(errorOf(key, "price")).toBe("A price must be between 10p and £500.");
    expect(text("[data-rbl-saved-state]")).toBe("You have changes on this screen that are not saved. 3 things need another look.");
    // The first field that is wrong has the focus.
    expect(document.activeElement?.getAttribute("aria-invalid")).toBe("true");
  });

  it("says when the last item showing is hidden", async () => {
    for (const i of builtIn().items) tick(inRow(i.key, "[data-rbl-show]"), false);
    click("[data-rbl-save]");
    await flush();
    expect(text("[data-rbl-status]")).toBe("At least one item must be showing.");
    expect(text("[data-rbl-list-error]")).toBe("At least one item must be showing.");
  });

  it("stops offering Add an example once a theme has six", () => {
    for (let n = 0; n < 3; n += 1) click('[data-rbl-add-example="crisis"]');
    expect($<HTMLButtonElement>('[data-rbl-add-example="crisis"]').disabled).toBe(true);
    expect($<HTMLButtonElement>('[data-rbl-add-example="school"]').disabled).toBe(false);
    expect(norm($('[data-rbl-theme-box="crisis"]').textContent)).toContain("A theme can have 6 examples at most.");
  });
});

describe("saving the draft", () => {
  it("sends the whole list with the stamp it was opened at, and then says it is saved", async () => {
    await start(state({ publishedId: 4, website: withToy(1500) }));
    type(inRow("toy", "[data-rbl-price]"), "12");
    serverNow(state({ publishedId: 4, draft: draftOf(withToy(1200), 1), changes: [`Toy £15 ${ARROW} £12`] }));
    click("[data-rbl-save]");
    await flush();
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.path).toBe("/api/admin/red-bag-list/draft");
    expect(put.body.version).toBe(0);
    expect(put.body.publishedId).toBe(4);
    expect(put.body.data.items.find((i: Item) => i.key === "toy").pence).toBe(1200);
    expect(Object.keys(put.body.data)).toEqual(["v", "items", "examples"]);
    expect(text("[data-rbl-status]")).toBe("Draft saved. Nothing has changed on the website yet.");
    expect(text("[data-rbl-saved-state]")).toBe("Everything on this screen is saved in the draft.");
    expect(api.isDirty()).toBe(false);
    expect(text("[data-rbl-draft-meta]")).toBe("Draft last saved by Jodie Example on 5 October 2026 at 2:05pm.");
    expect($("[data-rbl-publish]")).toBeTruthy();
  });

  it("sends the draft's own stamp when there is a draft", async () => {
    await start(state({ draft: draftOf(withToy(1200), 7) }));
    type(inRow("toy", "[data-rbl-price]"), "11");
    click("[data-rbl-save]");
    await flush();
    expect(calls.find((c) => c.method === "PUT")!.body.version).toBe(7);
  });

  it("a stale stamp: the plain message, a Reload button, and nothing typed is lost", async () => {
    await start(state({ draft: draftOf(withToy(1200), 7) }));
    type(inRow("toy", "[data-rbl-price]"), "11");
    answers.push((c) => (c.method === "PUT" ? { status: 409, body: { error: "Someone else has changed the draft. Reload to see their changes.", code: "stale" } } : undefined));
    click("[data-rbl-save]");
    await flush();
    expect(text("[data-rbl-status]")).toBe("Someone else has changed the draft. Reload to see their changes.");
    expect($("[data-rbl-status]").classList.contains("is-error")).toBe(true);
    expect(inRow<HTMLInputElement>("toy", "[data-rbl-price]").value).toBe("11");
    expect(api.isDirty()).toBe(true);
    expect($("[data-rbl-reload]")).toBeTruthy();
    // Reload brings their changes (asking first, since what is typed will go).
    answers.length = 0;
    serverNow(state({ draft: draftOf(withToy(1000), 8) }));
    click("[data-rbl-reload]");
    await flush();
    expect(confirmAsked).toEqual(["You have changes that are not saved. Leave without saving them?"]);
    expect(inRow<HTMLInputElement>("toy", "[data-rbl-price]").value).toBe("10");
    expect($("[data-rbl-reload]")).toBeNull();
  });

  it("the server's own refusal is shown in its words", async () => {
    await start(state());
    type(inRow("toy", "[data-rbl-price]"), "12");
    answers.push((c) => (c.method === "PUT" ? { status: 400, body: { error: "A price must be between 10p and £500.", problems: [] } } : undefined));
    click("[data-rbl-save]");
    await flush();
    expect(text("[data-rbl-status]")).toBe("A price must be between 10p and £500.");
    expect(api.isDirty()).toBe(true);
  });

  it("a save that fails says so and keeps what was typed", async () => {
    await start(state());
    type(inRow("toy", "[data-rbl-price]"), "12");
    answers.push((c) => (c.method === "PUT" ? { status: 500, body: { error: "Admin is temporarily unavailable" } } : undefined));
    click("[data-rbl-save]");
    await flush();
    expect(text("[data-rbl-status]")).toBe("That did not save. Please try again.");
    expect(inRow<HTMLInputElement>("toy", "[data-rbl-price]").value).toBe("12");
  });
});

describe("preview, publish and throw away", () => {
  const saved = () => state({ draft: draftOf(withToy(1200), 3), changes: [`Toy £15 ${ARROW} £12`] });

  it("wait for a save while there are unsaved changes, and say why", async () => {
    await start(saved());
    type(inRow("toy", "[data-rbl-price]"), "11");
    expect($<HTMLButtonElement>("[data-rbl-preview]").disabled).toBe(true);
    expect($<HTMLButtonElement>("[data-rbl-publish]").disabled).toBe(true);
    expect(text("#rblSaveFirst")).toBe("Save the draft first. Preview and Publish use the saved draft.");
    expect($("[data-rbl-publish]").getAttribute("aria-describedby")).toBe("rblSaveFirst");
  });

  it("Preview the page opens the real page, drawn from the draft, in a new tab", async () => {
    await start(saved());
    click("[data-rbl-preview]");
    expect(opened).toEqual(["/fill?preview=draft"]);
    expect(norm($(".rbl-summary").textContent)).toContain("Giving is switched off there.");
  });

  it("Publish asks first, repeating the changes, and does nothing until Publish now", async () => {
    await start(saved());
    click("[data-rbl-publish]");
    const confirm = $('[data-rbl-confirm="publish"]');
    expect(norm(confirm.querySelector(".rbl-confirm-title")!.textContent)).toBe("Publish 1 change to the website?");
    expect([...confirm.querySelectorAll("li")].map((li) => norm(li.textContent))).toEqual([`Toy £15 ${ARROW} £12`]);
    expect(document.activeElement).toBe($("#rblConfirmTitle"));
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    click("[data-rbl-no]");
    expect($("[data-rbl-confirm]")).toBeNull();
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    expect(document.activeElement).toBe($("[data-rbl-publish]"));
  });

  it("Publish now sends the stamp, and the screen then shows the published list with nothing waiting", async () => {
    await start(saved());
    click("[data-rbl-publish]");
    serverNow(state({ website: withToy(1200), publishedId: 9, history: [version(9, "Jodie Example", "2026-10-05T13:10:00.000Z", [`Toy £15 ${ARROW} £12`])] }));
    click("[data-rbl-yes]");
    await flush();
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ path: "/api/admin/red-bag-list/publish", body: { version: 3 } });
    expect(text("[data-rbl-status]")).toBe("Published. The Fill a Red Bag page shows this list now.");
    expect(text("[data-rbl-count]")).toBe("No changes. This is what the website shows now.");
    expect($("[data-rbl-publish]")).toBeNull();
  });

  it("Throw away changes asks first, then drops the draft", async () => {
    await start(saved());
    click("[data-rbl-discard]");
    expect(norm($('[data-rbl-confirm="discard"] .rbl-confirm-title').textContent)).toBe("Throw away this change?");
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    serverNow(state());
    click("[data-rbl-yes]");
    await flush();
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ path: "/api/admin/red-bag-list/discard", body: { version: 3 } });
    expect(text("[data-rbl-status]")).toBe("Changes thrown away. The draft is back to what the website shows.");
    expect(inRow<HTMLInputElement>("toy", "[data-rbl-price]").value).toBe("15");
  });

  it("throwing away changes that were never saved needs no server at all", async () => {
    await start(state());
    type(inRow("toy", "[data-rbl-price]"), "12");
    click("[data-rbl-discard]");
    click("[data-rbl-yes]");
    await flush();
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(inRow<HTMLInputElement>("toy", "[data-rbl-price]").value).toBe("15");
    expect(api.isDirty()).toBe(false);
  });

  it("a publish the server refuses says why", async () => {
    await start(saved());
    answers.push((c) => (c.path.endsWith("/publish") ? { status: 409, body: { error: "Someone else has changed the draft. Reload to see their changes.", code: "stale" } } : undefined));
    click("[data-rbl-publish]");
    click("[data-rbl-yes]");
    await flush();
    expect(text("[data-rbl-status]")).toBe("Someone else has changed the draft. Reload to see their changes.");
    expect($("[data-rbl-reload]")).toBeTruthy();
  });
});

describe("history", () => {
  const history = [
    version(9, "Jodie Example", "2026-10-05T13:10:00.000Z", [`Toy £15 ${ARROW} £12`, "New: Selection box £3", "Hidden: Hat & gloves"]),
    version(6, "Kim Example", "2026-10-03T09:00:00.000Z", ["Picture changed: Book"]),
    version(4, "sam@nbcc.test", "2026-10-01T16:30:00.000Z", ["Hidden: Socks (pair)", "Order changed: Clothing"]),
  ];
  const published = () => state({ website: withToy(1200), publishedId: 9, history });

  it("lists every publish, newest first, with who, how many changes and when, and the original list last", async () => {
    await start(published());
    expect($$("[data-rbl-version]").map((r) => r.getAttribute("data-rbl-version"))).toEqual(["9", "6", "4", "original"]);
    expect($$(".rbl-version-title").map((t) => norm(t.textContent))).toEqual([
      "Jodie published 3 changes, 5 October 2026 On the website now",
      "Kim published 1 change, 3 October 2026",
      "sam@nbcc.test published 2 changes, 1 October 2026",
      "The original list",
    ]);
    expect(norm($('[data-rbl-version="9"] .rbl-version-sub').textContent)).toBe(`Toy £15 ${ARROW} £12; New: Selection box £3; Hidden: Hat & gloves`);
    expect(norm($('[data-rbl-version="original"] .rbl-version-sub').textContent)).toBe("The list the page started with. It is always here.");
  });

  it("an earlier version can be looked at, and closed again", async () => {
    await start(published());
    answers.push((c) => (c.path.endsWith("/versions/6") ? { status: 200, body: { version: { id: 6, data: withToy(900) } } } : undefined));
    click('[data-rbl-version="6"] [data-rbl-look]');
    await flush();
    const list = norm($('[data-rbl-version="6"] [data-rbl-version-list]').textContent);
    expect(list).toContain("Play & downtime: Toy £9, Soft toy £4, Headphones £9");
    expect(list).toContain("After a crisis: £15 could help replace a child's favourite cuddly toy");
    expect($('[data-rbl-version="6"] [data-rbl-look]').getAttribute("aria-expanded")).toBe("true");
    click('[data-rbl-version="6"] [data-rbl-look]');
    expect($("[data-rbl-version-list]")).toBeNull();
  });

  it("the original list can be looked at too", async () => {
    await start(published());
    answers.push((c) => (c.path.endsWith("/versions/original") ? { status: 200, body: { version: { id: "original", data: builtIn() } } } : undefined));
    click('[data-rbl-version="original"] [data-rbl-look]');
    await flush();
    expect(norm($('[data-rbl-version="original"] [data-rbl-version-list]').textContent)).toContain("Toy £15");
  });

  it("says so when a version cannot load", async () => {
    await start(published());
    answers.push((c) => (c.path.includes("/versions/") ? { status: 500, body: {} } : undefined));
    click('[data-rbl-version="4"] [data-rbl-look]');
    await flush();
    expect(norm($('[data-rbl-version="4"] .rbl-error').textContent)).toBe("That version could not load just now. Try again in a moment.");
  });

  it("Put back as a draft asks first, then makes that list the draft", async () => {
    await start(published());
    click('[data-rbl-version="6"] [data-rbl-putback]');
    expect(norm($('[data-rbl-confirm="restore"]').textContent)).toContain("Put this list back as a draft?");
    expect(norm($('[data-rbl-confirm="restore"]').textContent)).toContain("Nothing changes on the website until you publish.");
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    serverNow(state({ website: withToy(1200), publishedId: 9, history, draft: draftOf(withToy(900), 1), changes: [`Toy £12 ${ARROW} £9`] }));
    click("[data-rbl-yes]");
    await flush();
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ path: "/api/admin/red-bag-list/restore", body: { from: 6, version: 0, publishedId: 9 } });
    expect(text("[data-rbl-status]")).toBe("That list is now the draft. Nothing has changed on the website yet.");
    expect(changeLines()).toEqual([`Toy £12 ${ARROW} £9`]);
    expect($("[data-rbl-publish]")).toBeTruthy();
  });

  it("the original list can be put back as a draft", async () => {
    await start(published());
    click('[data-rbl-version="original"] [data-rbl-putback]');
    click("[data-rbl-yes]");
    await flush();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ from: "original", version: 0, publishedId: 9 });
  });

  it("warns that putting back replaces the changes there are", async () => {
    await start(state({ website: withToy(1200), publishedId: 9, history, draft: draftOf(withToy(1100), 2) }));
    click('[data-rbl-version="6"] [data-rbl-putback]');
    expect(norm($('[data-rbl-confirm="restore"]').textContent)).toContain("It replaces the changes not yet on the website.");
  });
});

describe("someone with view access only", () => {
  beforeEach(() => start(state({ mayEdit: false, draft: draftOf(withToy(1200), 3), history: [version(9, "Jodie Example", "2026-10-05T13:10:00.000Z", ["Hidden: Socks (pair)"])] })));

  it("sees every item and example, as words", () => {
    expect($$("[data-rbl-item]").length).toBe(13);
    expect($$("[data-rbl-example]").length).toBe(9);
    expect(norm(row("toy").textContent)).toBe("Toy £12 Showing");
    expect(norm(row("crisis-30").textContent)).toBe("£30 could help with fresh bedding for a child Showing");
  });

  it("has nothing to type in and no button that changes anything", () => {
    expect($$("#rblRoot input, #rblRoot select, #rblRoot textarea")).toEqual([]);
    for (const sel of ["[data-rbl-save]", "[data-rbl-publish]", "[data-rbl-discard]", "[data-rbl-putback]", "[data-rbl-add-item]", "[data-rbl-add-example]", "[data-rbl-up]", "[data-rbl-picture]", "[data-rbl-remove]"]) {
      expect($(sel), sel).toBeNull();
    }
    expect(text("[data-rbl-readonly]")).toBe("You can look at this list. Changing it needs edit access to Fill a Red Bag.");
  });

  it("still sees the differences, the history, a version, and the preview", () => {
    expect(changeLines()).toEqual([`Toy £15 ${ARROW} £12`]);
    expect($$("[data-rbl-version]").length).toBe(2);
    expect($("[data-rbl-look]")).toBeTruthy();
    click("[data-rbl-preview]");
    expect(opened).toEqual(["/fill?preview=draft"]);
  });
});

describe("when it cannot load", () => {
  it.each([
    ["the server fails", { status: 500, body: { error: "Admin is temporarily unavailable" } }],
    ["the answer is not the list", { status: 200, body: { hello: "world" } }],
    ["the request never arrives", new Error("network")],
    ["access is refused", { status: 403, body: { error: "forbidden" } }],
  ])("says so in the admin's words, and never draws an empty editor (%s)", async (_what, answer) => {
    await start(answer as never);
    expect(text("[data-rbl-failed]")).toBe("The Fill a Red Bag list could not load. Open it again in a moment.");
    expect($("[data-rbl-failed]").classList.contains("admin-unavailable")).toBe(true);
    expect($$("[data-rbl-item], [data-rbl-add-item], [data-rbl-save], .rbl-card")).toEqual([]);
  });

  it("loads when opened again", async () => {
    await start({ status: 500 });
    serverNow(state());
    await api.open();
    expect($$("[data-rbl-item]").length).toBe(13);
  });

  it("goes back to the sign in when the session has ended", async () => {
    await start({ status: 401, body: { error: "Invalid or expired admin session" } });
    expect(store.has("nbcc_admin_token")).toBe(false);
    expect(reloaded).toBe(1);
  });
});

describe("leaving with changes that are not saved", () => {
  it("asks before another section of the admin is opened, and stays if the answer is no", async () => {
    await start(state());
    type(inRow("toy", "[data-rbl-price]"), "12");
    const heard = vi.fn();
    $('.admin-nav-link[data-view="donations"]').addEventListener("click", heard);
    confirmAnswer = false;
    click('.admin-nav-link[data-view="donations"]');
    expect(confirmAsked).toEqual(["You have changes that are not saved. Leave without saving them?"]);
    expect(heard).not.toHaveBeenCalled();
    expect(api.isDirty()).toBe(true);
    confirmAnswer = true;
    click('.admin-nav-link[data-view="donations"]');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(api.isDirty()).toBe(false);
  });

  it("asks before signing out too, and never when nothing has changed", async () => {
    await start(state());
    click("#logoutBtn");
    click('.admin-nav-link[data-view="donations"]');
    expect(confirmAsked).toEqual([]);
    type(inRow("toy", "[data-rbl-price]"), "12");
    confirmAnswer = false;
    click("#logoutBtn");
    expect(confirmAsked.length).toBe(1);
  });

  it("warns before the tab is closed or reloaded", async () => {
    const win = await start(state());
    const handler = (win.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === "beforeunload")![1] as (e: { preventDefault: () => void; returnValue?: string }) => unknown;
    const calm = { preventDefault: vi.fn(), returnValue: undefined as string | undefined };
    handler(calm);
    expect(calm.preventDefault).not.toHaveBeenCalled();
    type(inRow("toy", "[data-rbl-price]"), "12");
    const e = { preventDefault: vi.fn(), returnValue: undefined as string | undefined };
    handler(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.returnValue).toBeTruthy();
  });

  it("opening the section again keeps what is being typed rather than reading over it", async () => {
    await start(state());
    type(inRow("toy", "[data-rbl-price]"), "12");
    const before = calls.length;
    await api.open();
    expect(calls.length).toBe(before);
    expect(inRow<HTMLInputElement>("toy", "[data-rbl-price]").value).toBe("12");
  });
});

describe("what it writes", () => {
  it("escapes everything that came from the server", async () => {
    const l = builtIn();
    l.items[0].name = '<img src=x onerror="alert(1)">';
    l.examples[0].words = "could help <b>boldly</b>";
    await start(state({ website: l, history: [version(3, "<script>x</script>", "2026-10-01T10:00:00.000Z", ["<i>sly</i>"])] }));
    expect(document.querySelector("#rblRoot img")).toBeNull();
    expect(document.querySelector("#rblRoot b, #rblRoot i, #rblRoot script")).toBeNull();
    expect(inRow<HTMLInputElement>("blanket", "[data-rbl-name]").value).toBe('<img src=x onerror="alert(1)">');
  });

  it("has no en or em dash in anything staff read, and says Fill a Red Bag exactly", () => {
    const view = adminHtml.match(/<section class="admin-view" id="view-red-bag"[\s\S]*?<\/section>/)![0];
    const dash = new RegExp("[" + String.fromCharCode(0x2013) + String.fromCharCode(0x2014) + "]");
    expect(dash.test(script)).toBe(false);
    expect(dash.test(view)).toBe(false);
    expect(dash.test(readFileSync(resolve(ROOT, "assets/js/red-bag-list.js"), "utf8"))).toBe(false);
    for (const m of (script + view).match(/fill a red bag/gi) ?? []) expect(m).toBe("Fill a Red Bag");
  });
});
