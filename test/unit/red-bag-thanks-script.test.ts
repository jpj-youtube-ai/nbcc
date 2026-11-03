// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderRedBagThanksPage } from "../../src/red-bag/render";

// Fill a Red Bag: the thank you page's script (assets/js/red-bag-thanks.js), driven in jsdom over
// /fill/thank-you exactly as the server draws it. It shows the total this tab remembered before
// leaving for Stripe (for show only; missing or odd, the plain thank you stays), takes the payment's
// id out of the address bar, lands the focus on the heading, and makes the picture to share.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const catalogue = require(resolve(ROOT, "assets/js/red-bag-catalogue.js"));
const { initThanks } = require(resolve(ROOT, "assets/js/red-bag-thanks.js")) as { initThanks: (doc: Document, win: unknown) => unknown };
const template = readFileSync(resolve(ROOT, "fill-thank-you.html"), "utf8");

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const text = (sel: string) => ($(sel)?.textContent ?? "").replace(/\s+/g, " ").trim();
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

let store: Map<string, string>;
let history: { replaceState: ReturnType<typeof vi.fn> };
let clipboard: { writeText: ReturnType<typeof vi.fn> } | undefined;

function start(opts: { search?: string; kept?: Record<string, string>; clipboard?: boolean; noStorage?: boolean } = {}) {
  const parsed = new DOMParser().parseFromString(renderRedBagThanksPage(template, { preview: false }), "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  store = new Map(Object.entries(opts.kept ?? {}));
  history = { replaceState: vi.fn() };
  clipboard = opts.clipboard ? { writeText: vi.fn(async () => undefined) } : undefined;
  const win = {
    NBCCRedBag: catalogue,
    location: { pathname: "/fill/thank-you", search: opts.search ?? "" },
    history,
    get sessionStorage() {
      if (opts.noStorage) throw new Error("blocked");
      return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    },
    navigator: clipboard ? { clipboard } : {},
  };
  return initThanks(document, win);
}
const kept = (gift: unknown) => ({ nbcc_red_bag_gift: JSON.stringify(gift) });

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("arriving back from paying", () => {
  it("says thank you with the total, and lands the focus on the heading", () => {
    start({ search: "?session_id=cs_test_abc", kept: kept({ pence: 5410, giftAid: false, monthly: false }) });
    expect(text("[data-rb-thanks-total]")).toBe("Your donation of £54.10 is on its way to NBCC.");
    expect($("[data-rb-thanks-total]").hidden).toBe(false);
    expect($("[data-rb-thanks-plain]").hidden).toBe(true);
    expect($("[data-rb-thanks-giftaid]").hidden).toBe(true);
    expect(document.activeElement).toBe($("h1"));
    expect(text("h1")).toBe("Thank you for filling a Red Bag");
  });

  it("adds the Gift Aid line when they added Gift Aid: a quarter more", () => {
    start({ kept: kept({ pence: 4000, giftAid: true, monthly: false }) });
    expect($("[data-rb-thanks-giftaid]").hidden).toBe(false);
    expect(text("[data-rb-thanks-giftaid]")).toBe("With Gift Aid, NBCC can claim another £10 at no cost to you.");
  });

  it("says every month for a monthly donation", () => {
    start({ kept: kept({ pence: 3100, giftAid: false, monthly: true }) });
    expect(text("[data-rb-thanks-total]")).toBe("Your donation of £31 every month is on its way to NBCC.");
    expect(document.querySelector("main")!.textContent).not.toMatch(/a month/);
  });

  it("is a plain thank you when the total is not there, or is not a total", () => {
    for (const k of [{}, { nbcc_red_bag_gift: "not json" }, kept({ pence: "lots" }), kept({ pence: -5 }), kept({ pence: 150 }), kept({ pence: 20.5 }), kept(null)]) {
      start({ kept: k as Record<string, string> });
      expect($("[data-rb-thanks-total]").hidden).toBe(true);
      expect($("[data-rb-thanks-plain]").hidden).toBe(false);
      expect(text("[data-rb-thanks-plain]")).toBe("Your donation is on its way to NBCC.");
      expect($("[data-rb-thanks-giftaid]").hidden).toBe(true);
      expect(document.activeElement).toBe($("h1"));
    }
  });

  // The figure is only what the tab remembered, and is for show. An absurd one is not shown.
  it("is a plain thank you when the remembered total is beyond belief: above £100,000", () => {
    start({ kept: kept({ pence: 10000001, giftAid: true, monthly: false }) });
    expect($("[data-rb-thanks-total]").hidden).toBe(true);
    expect($("[data-rb-thanks-plain]").hidden).toBe(false);
    expect($("[data-rb-thanks-giftaid]").hidden).toBe(true);
    start({ kept: kept({ pence: 1e21, giftAid: false, monthly: false }) });
    expect($("[data-rb-thanks-total]").hidden).toBe(true);
    // Exactly £100,000 is still a total.
    start({ kept: kept({ pence: 10000000, giftAid: false, monthly: false }) });
    expect(text("[data-rb-thanks-total]")).toBe("Your donation of £100,000 is on its way to NBCC.");
  });

  it("is a plain thank you where the browser keeps nothing for the tab", () => {
    start({ noStorage: true });
    expect($("[data-rb-thanks-plain]").hidden).toBe(false);
    expect($("[data-rb-thanks-total]").hidden).toBe(true);
  });

  it("takes the payment's id out of the address bar at once, and forgets the total", () => {
    start({ search: "?session_id=cs_test_abc", kept: kept({ pence: 5410, giftAid: false, monthly: false }) });
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/fill/thank-you");
    expect(store.has("nbcc_red_bag_gift")).toBe(false);
  });

  it("tidies an old return address too (the flag the old page used)", () => {
    start({ search: "?thanks=1&session_id=cs_test_abc" });
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/fill/thank-you");
  });

  it("leaves the address alone when there is nothing to take out", () => {
    start();
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it("shows the bag full, and never lists the items", () => {
    start({ kept: kept({ pence: 5410, giftAid: false, monthly: false }) });
    expect($(".rb-thanks__bag .rb-bag").classList.contains("is-full")).toBe(true);
    expect(text("main")).not.toMatch(/Blanket|Socks|Pencil/);
  });

  it("does nothing on a page that is not the thank you", () => {
    document.body.innerHTML = "<main></main>";
    expect(initThanks(document, { NBCCRedBag: catalogue })).toBeNull();
  });
});

describe("sharing", () => {
  it("copies the page's address, nbcc.scot/fill, where copying works", async () => {
    start({ clipboard: true });
    const copy = $<HTMLButtonElement>("[data-rb-copy-link]");
    expect(copy.hidden).toBe(false);
    copy.click();
    await flush();
    expect(clipboard!.writeText).toHaveBeenCalledWith("https://nbcc.scot/fill");
    expect(text("[data-rb-share-status]")).toBe("Link copied. You can paste it anywhere.");
  });

  it("keeps Copy the link away where copying does not work", () => {
    start();
    expect($<HTMLButtonElement>("[data-rb-copy-link]").hidden).toBe(true);
  });

  it("puts the picture away where the browser cannot draw it (as here)", () => {
    start();
    expect($("[data-rb-share-picture]").hidden).toBe(true);
    expect($("[data-rb-share-save]").hidden).toBe(true);
    expect($("[data-rb-share-send]").hidden).toBe(true);
  });

  it("names the page's new address on the picture, and no amount", () => {
    const source = readFileSync(resolve(ROOT, "assets/js/red-bag-thanks.js"), "utf8");
    expect(source).toContain('"Fill one too at nbcc.scot/fill"');
    expect(source).not.toContain("scot/fill-a-red-bag");
    expect(source).toContain('"I filled a Red Bag"');
  });
});
