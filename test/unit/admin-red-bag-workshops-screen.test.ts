// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { slugFromName as serverSlug } from "../../src/db/red-bag-workshops";

// Admin > Fill a Red Bag > Company Workshops: the screen (assets/js/admin/red-bag-workshops.js),
// against a stand-in server. Every company name is invented.
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

const require = createRequire(import.meta.url);
const screen = require(resolve(__dirname, "../../assets/js/admin/red-bag-workshops.js")) as {
  initAdminRedBagWorkshops: (doc: Document, win: unknown) => { open: () => Promise<void> } | null;
  slugFromName: (name: string) => string;
};

const company = { id: 4, name: "Fern & Thistle", slug: "fern-and-thistle", size: "small", link: "https://nbcc.scot/fill/fern-and-thistle", pence: 15000, bags: 3, archived: false, qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' };
const state = (over: Record<string, unknown> = {}) => ({ mayEdit: true, everyone: { pence: 60000, bags: 12 }, workshops: [company], ...over });

let calls: { method: string; path: string; body?: unknown }[];
function serve(answers: Record<string, unknown>) {
  calls = [];
  return vi.fn(async (path: string, opts: { method: string; body?: string }) => {
    calls.push({ method: opts.method, path, body: opts.body ? JSON.parse(opts.body) : undefined });
    const answer = answers[`${opts.method} ${path}`];
    return { ok: true, status: 200, json: async () => answer };
  });
}
function mount(fetch: unknown) {
  document.body.innerHTML = '<section id="view-red-bag"><div id="rbwRoot"></div></section>';
  const win = { fetch, sessionStorage: { getItem: () => "tok" }, location: {}, navigator: {}, URL, setTimeout };
  return screen.initAdminRedBagWorkshops(document, win)!;
}
const text = () => (document.getElementById("rbwRoot")!.textContent ?? "").replace(/\s+/g, " ");

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the Company Workshops screen", () => {
  it("makes the same link from a name as the server does", () => {
    for (const name of ["Brightwater Engineering", "Fern & Thistle Ltd.", "Café Ölm", "  spaced   out  "]) expect(screen.slugFromName(name), name).toBe(serverSlug(name));
  });

  it("lists each company with its link, bags, total, QR code downloads and put away", async () => {
    const s = mount(serve({ "GET /api/admin/red-bag-workshops": state() }));
    await s.open();
    expect(text()).toContain("Fern & Thistle");
    expect(text()).toContain("nbcc.scot/fill/fern-and-thistle");
    expect(text()).toContain("3 bags filled, £150 given since 1 November");
    expect(text()).toContain("Everyone's shelves so far: 12 bags, £600");
    expect(document.querySelectorAll("[data-rbw-qr]").length).toBe(2);
    expect(document.querySelector(".rbw-qr svg")).not.toBeNull();
    expect(document.querySelector("[data-rbw-archive]")?.textContent).toBe("Put it away");
  });

  it("shows view-only staff everything, with nothing that changes anything", async () => {
    const s = mount(serve({ "GET /api/admin/red-bag-workshops": state({ mayEdit: false }) }));
    await s.open();
    expect(document.querySelector("[data-rbw-form]")).toBeNull();
    expect(document.querySelector("[data-rbw-archive]")).toBeNull();
    expect(document.querySelector("[data-rbw-copy]")).not.toBeNull();
  });

  it("adds a company: shows its link as the name is typed, then sends the name and size", async () => {
    const fetch = serve({
      "GET /api/admin/red-bag-workshops": state({ workshops: [] }),
      "POST /api/admin/red-bag-workshops": state(),
    });
    const s = mount(fetch);
    await s.open();
    expect(text()).toContain("No company has its own Workshop yet.");
    const name = document.getElementById("rbwName") as HTMLInputElement;
    name.value = "Fern & Thistle";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.getElementById("rbwPreview")!.textContent).toContain("nbcc.scot/fill/fern-and-thistle");
    const large = document.querySelector('input[name="size"][value="large"]') as HTMLInputElement;
    large.checked = true;
    large.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("[data-rbw-form]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.at(-1)).toEqual({ method: "POST", path: "/api/admin/red-bag-workshops", body: { name: "Fern & Thistle", size: "large" } });
    expect(text()).toContain("Fern & Thistle has its own Workshop: nbcc.scot/fill/fern-and-thistle");
  });

  it("escapes what the server sends", async () => {
    const s = mount(serve({ "GET /api/admin/red-bag-workshops": state({ workshops: [{ ...company, name: '<img src=x onerror="bad()">' }] }) }));
    await s.open();
    expect(document.querySelector(".rbw-card img")).toBeNull();
  });
});
