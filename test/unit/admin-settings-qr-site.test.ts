// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mountAdmin, el, q, qa, text, press, type, settle, type Call, type Reply } from "./helpers/admin-settings-harness";

// QR codes and Site pages, in the kit's look (docs/superpowers/specs/2026-11-14-admin-refresh-settings.md).
// Every name, address and figure here is invented.

vi.setConfig({ testTimeout: 20_000 });

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><path d="M0 0h1v1H0z"/></svg>';
const code = (id: number, name: string, total: number, week: number, over: Record<string, unknown> = {}) => ({
  id, name, target: "/donate", targetTitle: "Donate", targetLive: true, hidden: false, link: "https://nbcc.scot/q/c" + id,
  createdAt: "2026-10-0" + (id % 9 || 1) + "T09:00:00.000Z", scans: { total, week, lastDay: total ? "2026-11-01" : null }, svg: SVG, ...over,
});
const PAGES = [
  { path: "/", title: "Home", live: true, link: "https://nbcc.scot/", svg: SVG },
  { path: "/donate", title: "Donate", live: true, link: "https://nbcc.scot/donate", svg: SVG },
  { path: "/contact", title: "Contact", live: true, link: "https://nbcc.scot/contact", svg: SVG },
];
let codes: unknown[] = [];
let imageFails = false;
function route(c: Call): Reply | undefined {
  if (/\/qr-codes\/named\/\d+\/image$/.test(c.path) || c.path === "/api/admin/qr-codes/image") {
    return imageFails ? { status: 500, body: { error: "x" } } : { blob: new Blob(["png"], { type: "image/png" }) };
  }
  if (c.path === "/api/admin/qr-codes/named") return { body: { codes, destinations: [{ value: "/donate", title: "Donate", group: "page", live: true }, { value: "/contact", title: "Contact", group: "page", live: true }] } };
  if (c.path === "/api/admin/qr-codes") return { body: { pages: PAGES } };
  if (c.path === "/api/admin/site-pages") {
    return {
      body: {
        pages: [
          { path: "/donate", title: "Donate", ballGated: false, listedByDefault: true, listed: true, overridden: false },
          { path: "/donor-portal", title: "Donor portal", ballGated: false, listedByDefault: false, listed: false, overridden: false },
          { path: "/contact", title: "Contact", ballGated: false, listedByDefault: true, listed: true, overridden: false },
        ],
        aliases: [{ id: 4, fromPath: "/give", toPath: "/donate", createdBy: "admin:jo@example.com", createdAt: "2026-11-03T10:00:00.000Z" }],
        privatePages: [{ path: "/admin", title: "Admin", reach: "staff", note: "This tool." }],
      },
    };
  }
  if (c.path === "/api/admin/site-seo") return { body: { ok: true } };
  if (c.path.startsWith("/api/admin/site-aliases/")) return { body: { ok: true } };
  return undefined;
}

let saved: string[] = [];
beforeEach(() => {
  codes = [code(1, "Billboard, Main Road", 20, 2), code(2, "Ammo leaflet", 140, 9), code(3, "Zebra poster", 5, 5, { hidden: true })];
  imageFails = false;
  saved = [];
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:qr";
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push(this.download);
  });
  window.alert = vi.fn();
});

async function openView(view: string) {
  const admin = mountAdmin({ role: "admin" }, route);
  await admin.signIn();
  await admin.open(view);
  return admin;
}
const names = () => qa("#qrNamedList .qr-card .qr-title").map((h) => text(h));

describe("QR codes", () => {
  it("counts the named codes and their scans in tiles", async () => {
    await openView("qr");
    const tiles = qa("#qrTiles .ak-tile").map((t) => text(t));
    expect(tiles[0]).toContain("3");
    expect(tiles[0]).toContain("Named codes");
    expect(tiles[1]).toContain("16");
    expect(tiles[1]).toContain("Scans in the last 7 days");
    expect(tiles[2]).toContain("165");
  });

  it("sorts the named codes by most scanned, A to Z, and back to newest", async () => {
    await openView("qr");
    expect(names()).toEqual(["Billboard, Main Road", "Ammo leaflet"]);
    press(q('[data-qr-sort="scans"]'));
    expect(names()).toEqual(["Ammo leaflet", "Billboard, Main Road"]);
    expect(q('[data-qr-sort="scans"]')!.getAttribute("aria-pressed")).toBe("true");
    press(q('[data-qr-sort="name"]'));
    expect(names()).toEqual(["Ammo leaflet", "Billboard, Main Road"]);
    press(q('[data-qr-sort="newest"]'));
    expect(names()).toEqual(["Billboard, Main Road", "Ammo leaflet"]);
  });

  it("folds the quick code for every page shut, with a search inside", async () => {
    await openView("qr");
    expect((el("qrQuick") as HTMLDetailsElement).open).toBe(false);
    expect(el("qrQuick").contains(el("qrList"))).toBe(true);
    type(el("qrSearch"), "don");
    const shown = qa("#qrList .qr-card").filter((c) => !c.hidden).map((c) => text(q(".qr-title", c)));
    expect(shown).toEqual(["Donate"]);
    expect(text(el("qrSearchCount"))).toBe("Showing 1 of 3 pages.");
  });

  it("says which download is for what, under the buttons, which keep their words", async () => {
    await openView("qr");
    const first = q("#qrNamedList .qr-card") as HTMLElement;
    expect(qa(".qr-actions button[data-qr-format]", first).map((b) => text(b))).toEqual(["Download SVG", "Download PNG"]);
    expect(text(first)).toContain("SVG for anything printed. PNG for slides, posts and documents.");
  });

  it("copies a code's link, and says so in its card", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
    await openView("qr");
    press(q('[data-qr-copy="1"]'));
    await settle();
    expect(writeText).toHaveBeenCalledWith("https://nbcc.scot/q/c1");
    expect(text(q('[data-qr-card-status="1"]'))).toContain("Copied");
  });

  it("offers Share only where the browser can hand over a picture", async () => {
    await openView("qr");
    expect(q('[data-qr-share="1"]')!.hidden).toBe(true);
    const share = vi.fn(() => Promise.resolve());
    Object.assign(window.navigator, { share, canShare: () => true });
    await openView("qr");
    expect(q('[data-qr-share="1"]')!.hidden).toBe(false);
    press(q('[data-qr-share="1"]'));
    await settle();
    expect(share).toHaveBeenCalledTimes(1);
    const arg = (share.mock.calls[0] as unknown[])[0] as { files: File[] };
    expect(arg.files[0].name).toBe("nbcc-qr-billboard-main-road.png");
    delete (window.navigator as unknown as { share?: unknown }).share;
    delete (window.navigator as unknown as { canShare?: unknown }).canShare;
  });

  it("says a failed download in the card, never in a browser alert, and hands over no file", async () => {
    imageFails = true;
    await openView("qr");
    press(q('#qrNamedList [data-qr-named="1"][data-qr-format="png"]'));
    await settle();
    expect(window.alert).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(text(q('[data-qr-card-status="1"]'))).toBe("Could not download that QR code. Try again.");
    expect(q('[data-qr-card-status="1"]')!.className).toContain("is-error");
  });
});

describe("Site pages", () => {
  it("draws one card a page, with its spare addresses, its search engine switch and who added a spare address", async () => {
    await openView("site");
    const donate = q('#siteAllTable [data-site-page="/donate"]') as HTMLElement;
    expect(text(donate)).toContain("On the site map");
    expect(text(donate)).toContain("Spare addresses that lead here: /give");
    expect(q("[data-site-seo]", donate)).not.toBeNull();
    expect(q("#siteSeoTable")).toBeNull();
    expect(text(el("siteAliasTable"))).toContain("Jo on 3 November");
  });

  it("filters by the tiles and the search box", async () => {
    await openView("site");
    const shown = () => qa("#siteAllTable [data-site-page]").map((c) => c.getAttribute("data-site-page"));
    expect(shown()).toHaveLength(4);
    press(q('[data-site-filter="staff"]'));
    expect(shown()).toEqual(["/admin"]);
    press(q('[data-site-filter="hidden"]'));
    expect(shown()).toEqual(["/donor-portal"]);
    press(q('[data-site-filter="all"]'));
    type(el("siteSearch"), "give");
    expect(shown()).toEqual(["/donate"]);
  });

  it("says a search engine change in the card that was pressed", async () => {
    await openView("site");
    const box = q('[data-site-seo="/contact"]') as HTMLInputElement;
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(text(q('[data-site-said="/contact"]'))).toContain("Saved.");
    expect(text(q('[data-site-filter="hidden"]'))).toContain("2");
  });

  it("asks before removing a spare address, saying what will stop working", async () => {
    const admin = await openView("site");
    press(q('[data-site-alias-remove="4"]'));
    await settle();
    expect(text(el("siteAliasAsk"))).toContain("It stops working at once");
    expect(text(el("siteAliasAsk"))).toContain("Donate");
    expect(admin.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    press(q("#siteAliasAsk [data-ask-yes]"));
    await settle();
    expect(admin.calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["/api/admin/site-aliases/4"]);
  });

  it("goes through to QR codes with the page chosen", async () => {
    await openView("site");
    press(q('[data-site-qr="/contact"]'));
    await settle();
    expect(el("view-qr").hidden).toBe(false);
    expect((el("qrNewTarget") as HTMLSelectElement).value).toBe("/contact");
  });
});
