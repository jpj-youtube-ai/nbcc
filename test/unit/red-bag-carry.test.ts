// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderRedBagPage } from "../../src/red-bag/render";
import type { RedBagList } from "../../src/red-bag/list";

// A bag carried from the stage to /fill (assets/js/red-bag.js): the address /fill?bag=toy:2,socks:1
// sets those quantities on the rows the page drew, through the same path the plus button uses, one
// thing at a time, and nothing else. /fill takes real donations, so most of this file is about what
// must NOT happen: a hostile address changing anything, or the checkout seeing any difference at all
// between a bag that was carried and a bag that was tapped. Every name and price here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const rules = require(resolve(ROOT, "assets/js/red-bag-list.js"));
const catalogue = require(resolve(ROOT, "assets/js/red-bag-catalogue.js"));
const { initRedBag } = require(resolve(ROOT, "assets/js/red-bag.js")) as {
  initRedBag: (doc: Document, win: unknown, nav?: { assign: (u: string) => void }) => { total: () => number; payload: () => Record<string, unknown> } | null;
};
const template = readFileSync(resolve(ROOT, "fill-a-red-bag.html"), "utf8");

const GAP = 380;

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string) => ($(sel)?.textContent ?? "").replace(/\s+/g, " ").trim();
const row = (key: string) => $(`[data-rb-item="${key}"]`);
const box = (key: string) => document.getElementById(`rb-qty-${key}`) as HTMLInputElement;
const qty = (key: string) => box(key).value;
const plus = (key: string, times = 1) => {
  for (let i = 0; i < times; i += 1) (row(key).querySelector("[data-rb-plus]") as HTMLButtonElement).click();
};
const minus = (key: string) => (row(key).querySelector("[data-rb-minus]") as HTMLButtonElement).click();
const type = (id: string, value: string) => {
  const el = document.getElementById(id) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const tick = (id: string) => {
  const el = document.getElementById(id) as HTMLInputElement;
  el.checked = true;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};

/** The invented list: these items at these prices, and everything else on the built-in list hidden. */
const PRICES: Record<string, number> = { toy: 1000, socks: 300, blanket: 700, pencil: 10, book: 450 };
function invented(prices: Record<string, number> = PRICES): RedBagList {
  const list = rules.builtIn() as RedBagList;
  for (const item of list.items) {
    item.hidden = !(item.key in prices);
    if (item.key in prices) item.pence = prices[item.key];
  }
  return list;
}

let api: ReturnType<typeof initRedBag>;
let fetchMock: ReturnType<typeof vi.fn>;
let win: { location: { href: string; pathname: string; search: string; hash: string }; history: unknown; [k: string]: unknown };
let replaced: Array<[unknown, string, string]>;
let bar: { say: (onScreen: boolean) => void } | null;

interface Start {
  search?: string;
  hash?: string;
  reduce?: boolean;
  list?: RedBagList;
  draft?: boolean;
  history?: unknown;
  noLocation?: boolean;
  loader?: HTMLScriptElement;
  token?: string;
}

function start(opts: Start = {}) {
  const html = renderRedBagPage(template, { preview: false, list: opts.list ?? invented(), ...(opts.draft ? { draft: true } : {}) });
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  document.body.classList.remove("rb-bar-on");
  document.body.removeAttribute("data-rb-draft");
  if (opts.draft) document.body.setAttribute("data-rb-draft", "true");
  document.getElementById("stripe-js-sdk")?.remove();
  if (opts.loader) document.body.appendChild(opts.loader);
  // The list's block of data is in the page's head; the catalogue is told to read it again here.
  expect(catalogue.useListFrom(parsed)).toBe(true);
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ url: "https://checkout.stripe.test/pay" }) }));
  replaced = [];
  bar = null;
  class Observer {
    me: { say: (onScreen: boolean) => void };
    constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
      this.me = { say: (onScreen) => cb([{ isIntersecting: onScreen }]) };
      if (!bar) bar = this.me;
    }
    observe() {}
  }
  win = {
    IntersectionObserver: Observer,
    NBCCRedBag: catalogue,
    addEventListener: () => undefined,
    fetch: fetchMock,
    location: { href: "", pathname: "/fill", search: opts.search ?? "", hash: opts.hash ?? "" },
    history: {
      state: null,
      replaceState: (state: unknown, title: string, url: string) => {
        replaced.push([state, title, url]);
        const [path] = url.split("#");
        const at = path.indexOf("?");
        win.location.search = at === -1 ? "" : path.slice(at);
      },
    },
    sessionStorage: { getItem: (k: string) => (k === "nbcc_admin_token" ? (opts.token ?? null) : null), setItem: () => undefined },
    matchMedia: (q: string) => ({ matches: opts.reduce === true && q.includes("reduce") }),
    navigator: {},
  };
  if (opts.history !== undefined) win.history = opts.history;
  if (opts.noLocation) delete (win as Partial<typeof win>).location;
  api = initRedBag(document, win, { assign: vi.fn() });
}

/** Let everything still to come arrive. */
const settle = () => vi.advanceTimersByTime(600000);

const fillDetails = () => {
  type("rbFirstName", "Alex");
  type("rbSurname", "Example");
  type("rbEmail", "alex@example.com");
};
const donate = () => $<HTMLButtonElement>("[data-rb-donate]").click();
const pay = () => $<HTMLFormElement>("#rbDetailsForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const body = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  expect(fetchMock).toHaveBeenCalled();
  return fetchMock.mock.calls[0][1].body as string;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("a bag carried in the address", () => {
  it("gives those quantities and the right total", () => {
    start({ search: "?bag=toy:2,socks:1" });
    settle();
    expect(qty("toy")).toBe("2");
    expect(qty("socks")).toBe("1");
    expect(qty("blanket")).toBe("0");
    expect(api!.total()).toBe(2300);
    expect(text("[data-rb-total]")).toBe("£23");
    expect(text("[data-rb-donate]")).toBe("Donate £23");
    expect(row("toy").classList.contains("is-in")).toBe(true);
    expect(row("toy").querySelector("[data-rb-minus]")!.getAttribute("aria-disabled")).toBe("false");
  });

  it("drops in one thing at a time, 380ms apart, and never two together", () => {
    start({ search: "?bag=toy:2,socks:1" });
    expect(api!.total()).toBe(1000);
    vi.advanceTimersByTime(GAP - 1);
    expect(api!.total()).toBe(1000);
    vi.advanceTimersByTime(1);
    expect(api!.total()).toBe(2000);
    vi.advanceTimersByTime(GAP);
    expect(api!.total()).toBe(2300);
    vi.advanceTimersByTime(GAP * 5);
    expect(api!.total()).toBe(2300);
  });

  it("keeps a long bag to one timer at a time, so it can never flood", () => {
    start({ search: "?bag=toy:99,socks:99,blanket:99,book:99" });
    const before = api!.total();
    vi.advanceTimersByTime(GAP);
    const one = api!.total() - before;
    expect(one).toBe(1000);
    settle();
    expect(api!.total()).toBe(99 * (1000 + 300 + 700 + 450));
  });

  it("all appears at once for someone who has asked for less motion", () => {
    start({ search: "?bag=toy:2,socks:1,blanket:3", reduce: true });
    expect(qty("toy")).toBe("2");
    expect(qty("socks")).toBe("1");
    expect(qty("blanket")).toBe("3");
    expect(api!.total()).toBe(4400);
  });

  it("is read through a percent encoded address too", () => {
    start({ search: "?bag=toy%3A2%2Csocks%3A1" });
    settle();
    expect(api!.total()).toBe(2300);
  });

  it("works with no address to read at all", () => {
    start({ noLocation: true });
    expect(api!.total()).toBe(0);
  });
});

describe("nothing but the rows on the page", () => {
  it("ignores a key that is not on the list, and keeps the ones that are", () => {
    start({ search: "?bag=nothing-here:4,toy:1" });
    settle();
    expect(api!.total()).toBe(1000);
  });

  it("ignores an item staff have hidden, because it has no row", () => {
    start({ search: "?bag=headphones:2" });
    settle();
    expect(document.getElementById("rb-qty-headphones")).toBeNull();
    expect(api!.total()).toBe(0);
  });

  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "prototype"])("ignores %s, which every plain object already has", (key) => {
    start({ search: `?bag=${key}:5,toy:1` });
    settle();
    expect(api!.total()).toBe(1000);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("ignores an example's key: only the list's rows can be carried", () => {
    start({ search: "?bag=crisis-15:1" });
    settle();
    expect(api!.total()).toBe(0);
    expect($("[data-rb-example]").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("numbers", () => {
  it("clamps a huge number through clampQuantity", () => {
    start({ search: "?bag=toy:999999" });
    settle();
    expect(qty("toy")).toBe(String(catalogue.MAX_QUANTITY));
    expect(row("toy").querySelector("[data-rb-plus]")!.getAttribute("aria-disabled")).toBe("true");
  });

  it("adds a key given twice, and no more than the clamp allows", () => {
    start({ search: "?bag=toy:2,socks:1,toy:3" });
    settle();
    expect(qty("toy")).toBe("5");
    start({ search: "?bag=toy:60,toy:60,toy:60" });
    settle();
    expect(qty("toy")).toBe(String(catalogue.MAX_QUANTITY));
  });

  it("does not pass 99 however the visitor helps", () => {
    start({ search: "?bag=toy:99" });
    vi.advanceTimersByTime(GAP * 3);
    plus("toy", 5);
    settle();
    expect(qty("toy")).toBe("99");
  });
});

describe("an address that makes no sense", () => {
  const HOSTILE = [
    "?bag=",
    "?bag",
    "?bag=toy",
    "?bag=toy:",
    "?bag=:3",
    "?bag=:",
    "?bag=,,,",
    "?bag=toy:-1",
    "?bag=toy:abc",
    "?bag=toy:0",
    "?bag=toy:2.5",
    "?bag=toy:1e2",
    "?bag=toy:0x10",
    "?bag=toy:Infinity",
    "?bag=toy:NaN",
    "?bag=toy:null",
    "?bag=toy:%20",
    "?bag=toy:1:2",
    "?bag=toy:%3Cscript%3Ealert(1)%3C/script%3E",
    "?bag=%3Cscript%3Ealert(1)%3C/script%3E:2",
    "?bag=%3Cimg%20src=x%20onerror=alert(1)%3E:1",
    '?bag=%22%3E%3Csvg%20onload=alert(1)%3E:1',
    "?bag=toy%22%5D,%5Bdata-rb-item:1",
    "?bag=%E0%A4%A",
  ];

  it.each(HOSTILE)("%s is the ordinary page, and nothing is set", (search) => {
    start();
    const ordinary = document.body.innerHTML;
    start({ search });
    settle();
    expect(document.body.innerHTML).toBe(ordinary);
    expect(api!.total()).toBe(0);
    expect(text("[data-rb-status]")).toBe("Your bag is empty. Pop something in.");
    for (const key of Object.keys(PRICES)) expect(qty(key)).toBe("0");
  });

  it("never writes the raw value into the page, even beside a good one", () => {
    start({ search: "?bag=%3Cb%3Ehello%3C/b%3E:1,toy:1" });
    settle();
    expect(api!.total()).toBe(1000);
    expect(document.body.innerHTML).not.toContain("hello");
  });
});

describe("the address is tidied", () => {
  it("takes the bag out with replaceState once it has been read", () => {
    start({ search: "?bag=toy:2" });
    expect(replaced).toHaveLength(1);
    expect(replaced[0][2]).toBe("/fill");
  });

  it("keeps everything else: utm tags, a preview, a check of the night, and any hash", () => {
    start({ search: "?utm_source=flyer&bag=toy:1&preview=draft&at=after-ball", hash: "#top" });
    expect(replaced[0][2]).toBe("/fill?utm_source=flyer&preview=draft&at=after-ball#top");
    expect(new URLSearchParams(win.location.search).get("bag")).toBeNull();
  });

  it("takes out a bag that made no sense too, so it is not read again", () => {
    start({ search: "?bag=%3Cscript%3E:1&utm_medium=post" });
    expect(replaced[0][2]).toBe("/fill?utm_medium=post");
  });

  it("does not touch an address with no bag in it", () => {
    start({ search: "?utm_source=flyer" });
    expect(replaced).toHaveLength(0);
  });

  it("does not add things twice on a refresh", () => {
    start({ search: "?bag=toy:2&utm_source=flyer" });
    settle();
    const after = win.location.search;
    expect(after).toBe("?utm_source=flyer");
    start({ search: after });
    settle();
    expect(api!.total()).toBe(0);
  });

  it.each([
    ["no history", null],
    ["a history that throws", { replaceState: () => { throw new Error("blocked"); } }],
  ])("still fills the bag with %s", (_name, history) => {
    start({ search: "?bag=toy:1", history });
    settle();
    expect(api!.total()).toBe(1000);
  });
});

describe("the checkout sees no difference at all", () => {
  async function tappedBody(setUp: () => void) {
    start();
    plus("toy", 2);
    plus("socks", 1);
    setUp();
    donate();
    fillDetails();
    pay();
    return body();
  }
  async function carriedBody(setUp: () => void) {
    start({ search: "?bag=toy:2,socks:1" });
    settle();
    setUp();
    donate();
    fillDetails();
    pay();
    return body();
  }

  it("a carried bag and a tapped bag post the same bytes", async () => {
    const tapped = await tappedBody(() => undefined);
    const carried = await carriedBody(() => undefined);
    expect(carried).toBe(tapped);
    expect(JSON.parse(carried)).toMatchObject({ amount: 2300, mode: "once", redBag: true });
  });

  it("the same for a monthly gift", async () => {
    const monthly = () => {
      $<HTMLButtonElement>('[data-rb-mode="monthly"]').click();
      tick("rbAgeConfirmed");
    };
    const tapped = await tappedBody(monthly);
    const carried = await carriedBody(monthly);
    expect(carried).toBe(tapped);
    expect(JSON.parse(carried).mode).toBe("monthly");
  });

  it("the same with Gift Aid and the card fee", async () => {
    const extras = () => {
      tick("rbCoverFee");
      tick("rbGiftAid");
      type("rbHouse", "12");
      type("rbAddress", "Example Street, Exampletown");
      type("rbPostcode", "KA1 1AA");
    };
    const tapped = await tappedBody(extras);
    const carried = await carriedBody(extras);
    expect(carried).toBe(tapped);
    expect(JSON.parse(carried).giftAid).toBe(true);
    expect(JSON.parse(carried).coverFee).toBe(true);
  });

  it("the same with a round-up", async () => {
    const round = () => $<HTMLButtonElement>("[data-rb-round]").click();
    const tapped = await tappedBody(round);
    const carried = await carriedBody(round);
    expect(carried).toBe(tapped);
    expect(JSON.parse(carried).amount).toBe(2500);
  });

  it("sends nothing about the bag: only the total goes, as ever", async () => {
    const carried = JSON.parse(await carriedBody(() => undefined));
    expect(Object.keys(carried).sort()).toEqual(["amount", "coverFee", "donorType", "email", "emailConsent", "fullName", "giftAid", "mode", "plan", "redBag"]);
    expect(JSON.stringify(carried)).not.toContain("toy");
  });

  it("keeps the £2 floor: a carried 10p bag gets the nudge and goes no further", () => {
    start({ search: "?bag=pencil:1" });
    settle();
    donate();
    expect($("[data-rb-nudge]").hidden).toBe(false);
    expect($("[data-rb-details]").hidden).toBe(true);
  });
});

describe("tapping while it pours", () => {
  it("adds a plus to what was carried, and loses and doubles nothing", () => {
    start({ search: "?bag=toy:3,socks:2" });
    vi.advanceTimersByTime(GAP);
    plus("toy");
    settle();
    expect(qty("toy")).toBe("4");
    expect(qty("socks")).toBe("2");
    expect(api!.total()).toBe(4600);
  });

  it("counts a plus on something still to come", () => {
    start({ search: "?bag=toy:2,socks:2" });
    plus("socks");
    settle();
    expect(qty("toy")).toBe("2");
    expect(qty("socks")).toBe("3");
  });

  it("takes a minus off what was carried", () => {
    start({ search: "?bag=toy:3" });
    minus("toy");
    settle();
    expect(qty("toy")).toBe("2");
  });

  it("counts an example, and stops nothing", () => {
    start({ search: "?bag=toy:2" });
    $<HTMLButtonElement>("[data-rb-example]").click();
    settle();
    expect(qty("toy")).toBe("2");
    expect($("[data-rb-example]").getAttribute("aria-pressed")).toBe("true");
  });

  it("never writes over a number being typed", () => {
    start({ search: "?bag=toy:9" });
    vi.advanceTimersByTime(GAP);
    box("toy").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    box("toy").value = "1";
    box("toy").dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(GAP * 3);
    expect(box("toy").value).toBe("1");
    box("toy").value = "12";
    box("toy").dispatchEvent(new Event("input", { bubbles: true }));
    settle();
    expect(box("toy").value).toBe("12");
    expect(api!.total()).toBe(12000);
  });

  it("finishes pouring before Donate is weighed, so nobody pays for half a bag", () => {
    start({ search: "?bag=toy:3" });
    donate();
    expect(api!.total()).toBe(3000);
    expect(text("[data-rb-details-total]")).toBe("£30");
    settle();
    expect(api!.total()).toBe(3000);
    expect(text("[data-rb-details-total]")).toBe("£30");
  });

  it("gives a small bag time to reach £2 before the floor is asked", () => {
    start({ search: "?bag=pencil:50" });
    donate();
    expect(api!.total()).toBe(500);
    expect($("[data-rb-details]").hidden).toBe(false);
  });

  it("does the same from the bottom bar", () => {
    start({ search: "?bag=toy:3" });
    bar!.say(false);
    $<HTMLButtonElement>("[data-rb-bar-donate]").click();
    expect(api!.total()).toBe(3000);
    expect($("[data-rb-details]").hidden).toBe(false);
  });

  it("leaves a click on bare paper alone: only a control ends the pour", () => {
    start({ search: "?bag=toy:3" });
    $(".rb-paper__title").click();
    expect(api!.total()).toBe(1000);
    settle();
    expect(api!.total()).toBe(3000);
  });
});

describe("a staff draft preview", () => {
  const draftList = () => {
    const list = invented({ toy: 1500, book: 250 });
    list.items.push({ key: "n-sledge", name: "Sledge", pence: 900, group: "play", art: "toy", hidden: false } as RedBagList["items"][number]);
    return list;
  };

  it("takes its keys from the draft's rows", () => {
    start({ search: "?preview=draft&bag=n-sledge:2,socks:1,book:1", list: draftList(), draft: true });
    settle();
    expect(api!.total()).toBe(2050);
    expect(document.getElementById("rb-qty-socks")).toBeNull();
    expect(replaced[0][2]).toBe("/fill?preview=draft");
  });

  it("keeps giving switched off", () => {
    start({ search: "?preview=draft&bag=toy:2", list: draftList(), draft: true });
    donate();
    expect(text("[data-rb-nudge]")).toContain("Giving is switched off here");
    expect($("[data-rb-details]").hidden).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A plain visit to the draft's address is the published page, carrying the loader that asks again
  // with the tab's session (assets/js/red-bag-preview.js), and it runs after this page's script.
  describe("on the published page that comes first", () => {
    const loader = () => {
      const s = document.createElement("script");
      s.setAttribute("type", "text/plain");
      s.setAttribute("src", "/assets/js/red-bag-preview.js");
      return s;
    };

    it("leaves the bag in the address for the draft, in a tab signed in to the admin", () => {
      start({ search: "?preview=draft&bag=toy:2", loader: loader(), token: "invented-session" });
      settle();
      expect(replaced).toHaveLength(0);
      expect(api!.total()).toBe(0);
    });

    it("reads it as usual in a tab with no session: this page is the one that stays", () => {
      start({ search: "?preview=draft&bag=toy:2", loader: loader() });
      settle();
      expect(api!.total()).toBe(2000);
      expect(replaced[0][2]).toBe("/fill?preview=draft");
    });
  });
});

describe("the elf and the snow on a big carried bag", () => {
  it("never shows two notes, and leaves each one its moment", () => {
    const search = "?bag=toy:6,socks:6,blanket:6,book:6,pencil:6";
    start({ search });
    const seen = new Set<string>();
    let most = 0;
    let changes = 0;
    let last = "";
    for (let i = 0; i < 40; i += 1) {
      most = Math.max(most, $$(".rb-note").length);
      const words = text(".rb-note");
      if (words && words !== last) {
        seen.add(words);
        changes += 1;
        last = words;
      }
      vi.advanceTimersByTime(GAP);
    }
    expect(most).toBe(1);
    expect(changes).toBeGreaterThan(0);
    // 30 things go in over about 11 seconds, and a note stays up for over 3.
    expect(changes).toBeLessThanOrEqual(5);
  });

  it("runs the full screen snow no more than the page's own cooldown allows", () => {
    start({ search: "?bag=toy:99" });
    const cooldown = catalogue.FLURRY_COOLDOWN_MS as number;
    const fulls = new Set<Element>();
    const halves = new Set<Element>();
    let ms = 0;
    while (ms < 99 * GAP + 4000) {
      $$(".rb-flurry--full").forEach((f) => fulls.add(f));
      $$(".rb-flurry--half").forEach((f) => halves.add(f));
      vi.advanceTimersByTime(100);
      ms += 100;
    }
    expect(halves.size).toBeLessThanOrEqual(1);
    expect(fulls.size).toBeGreaterThanOrEqual(1);
    expect(fulls.size).toBeLessThanOrEqual(Math.ceil((99 * GAP) / cooldown) + 1);
  });

  it("gives a small carried bag its big moment at £50", () => {
    start({ search: "?bag=toy:6" });
    const seen = new Set<Element>();
    for (let i = 0; i < 10; i += 1) {
      $$(".rb-flurry--full").forEach((f) => seen.add(f));
      vi.advanceTimersByTime(GAP);
    }
    expect(seen.size).toBe(1);
  });

  it("keeps a bag tapped afterwards as it always was: notes come straight back", () => {
    start({ search: "?bag=toy:1" });
    settle();
    plus("socks");
    expect(text(".rb-note")).not.toBe("");
  });
});
