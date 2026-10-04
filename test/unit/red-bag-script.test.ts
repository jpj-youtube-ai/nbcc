// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderRedBagPage } from "../../src/red-bag/render";

// Fill a Red Bag: the page's script (assets/js/red-bag.js), driven in jsdom over the page exactly as
// the server draws it. It makes the steppers and the examples work, keeps the bags, the status line
// and the total in step, opens the details step, and sends the gift to the checkout the donate page
// uses (with the redBag marker). Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const catalogue = require(resolve(ROOT, "assets/js/red-bag-catalogue.js"));
const { initRedBag } = require(resolve(ROOT, "assets/js/red-bag.js")) as {
  initRedBag: (doc: Document, win: unknown, nav?: { assign: (u: string) => void }) => { total: () => number; payload: () => Record<string, unknown> } | null;
};
const template = readFileSync(resolve(ROOT, "fill-a-red-bag.html"), "utf8");

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const text = (sel: string) => ($(sel)?.textContent ?? "").replace(/\s+/g, " ").trim();
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};
const row = (key: string) => $(`[data-rb-item="${key}"]`);
const plus = (key: string, times = 1) => {
  for (let i = 0; i < times; i += 1) (row(key).querySelector("[data-rb-plus]") as HTMLButtonElement).click();
};
const minus = (key: string) => (row(key).querySelector("[data-rb-minus]") as HTMLButtonElement).click();
const type = (id: string, value: string) => {
  const el = document.getElementById(id) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const tick = (id: string, on = true) => {
  const el = document.getElementById(id) as HTMLInputElement;
  el.checked = on;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const example = (key: string) => $<HTMLButtonElement>(`[data-rb-example="${key}"]`);
/** Choose once or monthly with its button. */
const often = (mode: "once" | "monthly") => $<HTMLButtonElement>(`[data-rb-mode="${mode}"]`).click();
const round = () => $<HTMLButtonElement>("[data-rb-round]");
const roundLine = () => $("[data-rb-also-list] [data-rb-round-line]");

type Answer = { status: number; body: unknown };
let fetchMock: ReturnType<typeof vi.fn>;
let nav: { assign: ReturnType<typeof vi.fn> };
let store: Map<string, string>;
let history: { replaceState: ReturnType<typeof vi.fn> };
let api: ReturnType<typeof initRedBag>;
let listeners: Record<string, (e: unknown) => void>;
// The stand in for the browser's IntersectionObserver: what was watched, and a way to say it is on screen.
let watcher: { el: Element | null; say: (onScreen: boolean) => void } | null;
let watchers: Array<{ el: Element | null; say: (onScreen: boolean) => void }>;

function start(opts: { preview?: boolean; search?: string; answer?: Answer; kept?: Record<string, string>; stripe?: unknown; noObserver?: boolean } = {}) {
  const html = renderRedBagPage(template, { preview: !!opts.preview });
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  document.body.classList.remove("rb-bar-on");
  if (opts.preview) document.body.setAttribute("data-rb-preview", "true");
  else document.body.removeAttribute("data-rb-preview");
  const answer = opts.answer ?? { status: 200, body: { url: "https://checkout.stripe.test/pay" } };
  fetchMock = vi.fn(async () => ({ ok: answer.status < 400, status: answer.status, json: async () => answer.body }));
  nav = { assign: vi.fn() };
  store = new Map(Object.entries(opts.kept ?? {}));
  history = { replaceState: vi.fn() };
  listeners = {};
  watcher = null;
  watchers = [];
  class Observer {
    me: { el: Element | null; say: (onScreen: boolean) => void };
    constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
      this.me = { el: null, say: (onScreen) => cb([{ isIntersecting: onScreen }]) };
      watchers.push(this.me);
      if (!watcher) watcher = this.me; // the first is the one on the real total and Donate
    }
    observe(el: Element) {
      this.me.el = el;
    }
  }
  const win = {
    IntersectionObserver: opts.noObserver ? undefined : Observer,
    NBCCRedBag: catalogue,
    Stripe: opts.stripe,
    addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] = fn),
    fetch: fetchMock,
    location: { href: "", pathname: "/fill", search: opts.search ?? "" },
    history,
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    matchMedia: () => ({ matches: false }),
    navigator: {},
  };
  api = initRedBag(document, win, nav);
}

const fillDetails = () => {
  type("rbFirstName", "Alex");
  type("rbSurname", "Example");
  type("rbEmail", "alex@example.com");
};
const donate = () => $<HTMLButtonElement>("[data-rb-donate]").click();
const pay = () => $<HTMLFormElement>("#rbDetailsForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const sent = () => JSON.parse(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1].body);

beforeEach(() => start());

describe("when the script starts", () => {
  it("shows the working parts and hides the line for no JavaScript", () => {
    expect($("[data-needs-js]").hidden).toBe(false);
    expect($("[data-nojs]").hidden).toBe(true);
  });

  it("starts with an empty bag: one bag drawn, nothing in it, nothing to take away", () => {
    expect(api!.total()).toBe(0);
    expect(text("[data-rb-status]")).toBe("Your bag is empty. Pop something in.");
    expect(text("[data-rb-total]")).toBe("£0");
    expect(document.querySelectorAll("[data-rb-bags] .rb-bag").length).toBe(1);
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-rb-minus]")) expect(b.getAttribute("aria-disabled")).toBe("true");
  });

  it("does nothing on a page that is not Fill a Red Bag", () => {
    document.body.innerHTML = "<main></main>";
    expect(initRedBag(document, { NBCCRedBag: catalogue })).toBeNull();
  });
});

describe("the steppers", () => {
  it("add one with the plus, and take one away with the minus", () => {
    plus("blanket", 2);
    expect((document.getElementById("rb-qty-blanket") as HTMLInputElement).value).toBe("2");
    expect(text("[data-rb-total]")).toBe("£16");
    expect(row("blanket").classList.contains("is-in")).toBe(true);
    minus("blanket");
    minus("blanket");
    expect(text("[data-rb-total]")).toBe("£0");
    expect(row("blanket").classList.contains("is-in")).toBe(false);
    expect(row("blanket").querySelector("[data-rb-minus]")!.getAttribute("aria-disabled")).toBe("true");
  });

  // A button that switched itself off while it had the focus would drop a keyboard user out of
  // the list. So the buttons at 0 and 99 only SAY they are off: they keep the focus and do nothing.
  it("keep the focus on a button that has reached its end, which then does nothing", () => {
    const less = row("blanket").querySelector("[data-rb-minus]") as HTMLButtonElement;
    const more = row("blanket").querySelector("[data-rb-plus]") as HTMLButtonElement;
    plus("blanket");
    expect(less.getAttribute("aria-disabled")).toBe("false");
    less.focus();
    less.click();
    expect(less.getAttribute("aria-disabled")).toBe("true");
    expect(less.disabled).toBe(false);
    expect(document.activeElement).toBe(less);
    less.click();
    expect(api!.total()).toBe(0);
    type("rb-qty-blanket", "99");
    more.focus();
    more.click();
    expect(more.disabled).toBe(false);
    expect(more.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(more);
    expect(api!.total()).toBe(99 * 800);
  });

  it("update the total as a number is typed, with no Enter", () => {
    type("rb-qty-pencil", "7");
    expect(text("[data-rb-total]")).toBe("70p");
    type("rb-qty-pencil", "30");
    expect(text("[data-rb-total]")).toBe("£3");
  });

  it("keep a quantity between 0 and 99", () => {
    type("rb-qty-socks", "250");
    expect(api!.total()).toBe(9900);
    expect(row("socks").querySelector("[data-rb-plus]")!.getAttribute("aria-disabled")).toBe("true");
    type("rb-qty-socks", "abc");
    expect(api!.total()).toBe(0);
    type("rb-qty-socks", "");
    expect(api!.total()).toBe(0);
  });

  it("tidy the box when it is left: what is shown is what is counted", () => {
    const box = document.getElementById("rb-qty-socks") as HTMLInputElement;
    type("rb-qty-socks", "250");
    box.dispatchEvent(new Event("blur"));
    expect(box.value).toBe("99");
    type("rb-qty-socks", "");
    box.dispatchEvent(new Event("blur"));
    expect(box.value).toBe("0");
  });

  it("step with the up and down arrow keys in the box", () => {
    const box = document.getElementById("rb-qty-book") as HTMLInputElement;
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    expect(box.value).toBe("2");
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(box.value).toBe("1");
    expect(text("[data-rb-total]")).toBe("£3");
  });

  it("add up one of everything to £54.10", () => {
    for (const i of catalogue.items()) plus(i.key);
    expect(text("[data-rb-total]")).toBe("£54.10");
    expect(api!.total()).toBe(5410);
  });
});

describe("the examples", () => {
  it("go into the same bag when tapped, as a line under Also in your bag", () => {
    example("hand-20").click();
    expect(example("hand-20").getAttribute("aria-pressed")).toBe("true");
    expect(text("[data-rb-total]")).toBe("£20");
    expect($("[data-rb-also]").hidden).toBe(false);
    const line = $("[data-rb-also-list] li");
    expect(line.textContent).toContain("£20 could help with toiletries and warm clothes in a hard moment");
    expect(line.querySelector("button")?.getAttribute("aria-label")).toBe("Remove from your bag: £20 could help with toiletries and warm clothes in a hard moment");
  });

  it("come out when tapped again", () => {
    example("hand-20").click();
    example("hand-20").click();
    expect(example("hand-20").getAttribute("aria-pressed")).toBe("false");
    expect(api!.total()).toBe(0);
    expect($("[data-rb-also]").hidden).toBe(true);
    expect(document.querySelectorAll("[data-rb-also-list] li").length).toBe(0);
  });

  it("come out with the line's own remove control, and the example is where you land", () => {
    example("crisis-15").click();
    example("school-40").click();
    ($('[data-rb-also-list] [data-rb-remove="crisis-15"]') as HTMLButtonElement).click();
    expect(example("crisis-15").getAttribute("aria-pressed")).toBe("false");
    expect(example("school-40").getAttribute("aria-pressed")).toBe("true");
    expect(api!.total()).toBe(4000);
    expect(document.activeElement).toBe(example("crisis-15"));
  });

  it("add to the items in one running total", () => {
    plus("socks", 2);
    example("hand-150").click();
    expect(text("[data-rb-total]")).toBe("£152");
  });
});

describe("the bags and the status line", () => {
  const bags = () => [...document.querySelectorAll<SVGElement>("[data-rb-bags] .rb-bag")];
  const fills = () => bags().map((b) => Number(b.style.getPropertyValue("--rb-fill")));

  it("fill one bag towards £50, and say how full it is", () => {
    type("rb-qty-toy", "5");
    expect(text("[data-rb-status]")).toBe("Your bag is about half full.");
    expect(bags().length).toBe(1);
    expect(fills()[0]).toBeCloseTo(0.5, 2);
    expect(bags()[0].classList.contains("is-full")).toBe(false);
  });

  it("always show something in the bag once there is something in it", () => {
    plus("pencil");
    expect(fills()[0]).toBeGreaterThan(0.04);
  });

  it("keep a full bag and start the next beside it", () => {
    for (const i of catalogue.items()) plus(i.key);
    expect(bags().length).toBe(2);
    expect($("[data-rb-bags]").getAttribute("data-count")).toBe("2");
    expect(bags()[0].classList.contains("is-full")).toBe(true);
    expect(fills()[1]).toBeCloseTo(0.082, 2);
    expect(text("[data-rb-status]")).toBe("That's around the value of a whole Red Bag Full of Joy. Another one is filling.");
    expect($("[data-rb-more]").hidden).toBe(true);
  });

  it("draw five at most, then say how many more", () => {
    type("rb-qty-headphones", "40"); // £360
    expect(bags().length).toBe(5);
    expect($("[data-rb-more]").hidden).toBe(false);
    expect(text("[data-rb-more]")).toBe("and 2 more");
    expect(text("[data-rb-status]")).toBe("That's around the value of 7 Red Bags Full of Joy. Another one is filling.");
  });

  it("keep the bags for the eye only: the words carry the meaning", () => {
    expect($("[data-rb-bags]").getAttribute("aria-hidden")).toBe("true");
    expect($("[data-rb-status]").closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
  });

  it("are announced once for each change: the status and the total together, not one after the other", () => {
    const regions = document.querySelectorAll("[data-rb-builder] [aria-live]");
    expect(regions.length).toBe(1);
    expect(regions[0].getAttribute("aria-atomic")).toBe("true");
    expect(regions[0].contains($("[data-rb-status]"))).toBe(true);
    expect(regions[0].contains($("[data-rb-total]"))).toBe(true);
    expect($("[data-rb-status]").hasAttribute("aria-live")).toBe(false);
    expect($("[data-rb-status]").hasAttribute("role")).toBe(false);
  });

  it("only write the status when its words change, so it is heard once", () => {
    plus("toy", 5);
    const node = $("[data-rb-status]").firstChild;
    plus("pencil");
    expect($("[data-rb-status]").firstChild).toBe(node);
  });
});

// Once or monthly: two buttons side by side, "Give once" (chosen to begin with) and "Give monthly",
// in place of the tick. What follows from the choice is exactly what the tick did.
describe("once or monthly", () => {
  const pressed = () => [...document.querySelectorAll("[data-rb-mode]")].map((b) => `${b.getAttribute("data-rb-mode")}:${b.getAttribute("aria-pressed")}`);
  const button = () => text("[data-rb-donate]");

  it("starts on Give once", () => {
    expect(pressed()).toEqual(["once:true", "monthly:false"]);
    expect($("[data-rb-per-month]").hidden).toBe(true);
  });

  it("says which is chosen, one at a time", () => {
    often("monthly");
    expect(pressed()).toEqual(["once:false", "monthly:true"]);
    often("monthly"); // pressing the chosen one again changes nothing
    expect(pressed()).toEqual(["once:false", "monthly:true"]);
    often("once");
    expect(pressed()).toEqual(["once:true", "monthly:false"]);
  });

  it("names the amount on the Donate button, and keeps up as the bag changes", () => {
    expect(button()).toBe("Donate");
    plus("blanket");
    expect(button()).toBe("Donate £8");
    plus("pencil");
    expect(button()).toBe("Donate £8.10");
    example("hand-150").click();
    expect(button()).toBe("Donate £158.10");
    minus("blanket");
    minus("pencil");
    example("hand-150").click();
    expect(button()).toBe("Donate");
    plus("pencil", 7);
    expect(button()).toBe("Donate 70p");
  });

  it("says every month on the Donate button for a monthly donation", () => {
    plus("blanket", 3);
    plus("toy");
    plus("socks", 2);
    expect(button()).toBe("Donate £31");
    often("monthly");
    expect(button()).toBe("Donate £31 every month");
    plus("socks");
    expect(button()).toBe("Donate £32 every month");
    often("once");
    expect(button()).toBe("Donate £32");
  });

  it("names no amount on an empty bag, whichever is chosen", () => {
    often("monthly");
    expect(button()).toBe("Donate");
  });

  it("leaves the phone bar's button as it was", () => {
    plus("blanket");
    often("monthly");
    expect(text("[data-rb-bar-donate]")).toBe("Donate");
  });

  // "every month" wherever the monthly amount is worded on this page, never "a month" (Jaimie,
  // 4 October 2026): the total, Donate, the details step's summary, the pay button, the thank you.
  it("says every month on the details step too: its summary and its pay button", () => {
    plus("blanket", 2);
    often("monthly");
    donate();
    expect(text("[data-rb-pay]")).toBe("Donate £16 every month");
    expect(text(".rb-details__sum")).toMatch(/^Your Red Bag donation: £16 every month[.]/);
    expect($("[data-rb-details-monthly]").hidden).toBe(false);
  });

  it("never says a month anywhere a donor reads, once or monthly", () => {
    plus("blanket", 2);
    for (const mode of ["once", "monthly"] as const) {
      often(mode);
      expect(document.querySelector("main")!.textContent).not.toMatch(/a month/);
      donate();
      expect(document.querySelector("main")!.textContent).not.toMatch(/a month/);
      $<HTMLButtonElement>("[data-rb-back]").click();
    }
  });

  it("turns the total into a monthly donation", () => {
    plus("blanket");
    often("monthly");
    expect($("[data-rb-per-month]").hidden).toBe(false);
    expect(text(".rb-total__sum")).toBe("£8 every month");
    often("once");
    expect($("[data-rb-per-month]").hidden).toBe(true);
  });

  it("is kept when they come back from the details step", () => {
    plus("blanket", 2);
    often("monthly");
    donate();
    $<HTMLButtonElement>("[data-rb-back]").click();
    expect(pressed()).toEqual(["once:false", "monthly:true"]);
    expect(button()).toBe("Donate £16 every month");
    expect(text(".rb-total__sum")).toBe("£16 every month");
    donate();
    expect($("[data-rb-age]").hidden).toBe(false);
  });

  it("works from the keyboard: they are ordinary buttons, in the tab order", () => {
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-rb-mode]")) {
      expect(b.tagName).toBe("BUTTON");
      expect(b.disabled).toBe(false);
      expect(b.hasAttribute("tabindex")).toBe(false);
    }
  });
});

// The round-up: one button by the total, offering the NEXT milestone only (half a bag, a full bag,
// then the next whole bag). It keeps its target: the extra shrinks and grows so the total stays put.
describe("the round-up", () => {
  const fills = () => [...document.querySelectorAll<SVGElement>("[data-rb-bags] .rb-bag")].map((b) => Number(b.style.getPropertyValue("--rb-fill")));
  const eighteen = () => {
    plus("blanket", 2);
    plus("socks", 2);
  };

  it("is not offered on an empty bag", () => {
    expect(round().hidden).toBe(true);
    plus("socks");
    expect(round().hidden).toBe(false);
    minus("socks");
    expect(round().hidden).toBe(true);
  });

  it("offers half a bag under £25, and says what it adds", () => {
    eighteen();
    expect(text("[data-rb-round]")).toBe("+ £7 Round up to half a bag");
    expect(text("[data-rb-round-amount]")).toBe("+ £7");
    expect(text("[data-rb-round-words]")).toBe("Round up to half a bag");
    plus("pencil", 9);
    expect(text("[data-rb-round]")).toBe("+ £6.10 Round up to half a bag");
  });

  it("offers a full bag from £25, and the next whole bag from £50", () => {
    type("rb-qty-toy", "5"); // £25 exactly, their own items
    expect(text("[data-rb-round]")).toBe("+ £25 Round up to a full bag");
    plus("socks");
    expect(text("[data-rb-round]")).toBe("+ £24 Round up to a full bag");
    type("rb-qty-toy", "10"); // £51
    expect(text("[data-rb-round]")).toBe("+ £49 Round up to 2 full bags");
    for (const i of catalogue.items()) type(`rb-qty-${i.key}`, "1"); // £54.10
    expect(text("[data-rb-round]")).toBe("+ £45.90 Round up to 2 full bags");
    type("rb-qty-headphones", "40"); // £405.10
    expect(text("[data-rb-round]")).toBe("+ £44.90 Round up to 9 full bags");
  });

  it("when pressed, adds a line under Also in your bag, with its amount and a way out", () => {
    eighteen();
    round().click();
    expect(api!.total()).toBe(2500);
    expect(text("[data-rb-total]")).toBe("£25");
    expect($("[data-rb-also]").hidden).toBe(false);
    const line = roundLine();
    expect(line.closest(".rb-paper")).not.toBeNull();
    expect(text("[data-rb-round-line] .rb-also__words")).toBe("A little extra to round up");
    expect(text("[data-rb-round-line] [data-rb-round-sum]")).toBe("£7");
    const remove = line.querySelector("button")!;
    expect(remove.textContent).toBe("Remove");
    expect(remove.getAttribute("aria-label")).toBe("Remove from your bag: A little extra to round up, £7");
    expect(document.querySelectorAll("[data-rb-also-list] li").length).toBe(1);
  });

  it("fills the bag and the status line with it: half a bag is a half full bag", () => {
    eighteen();
    round().click();
    expect(text("[data-rb-status]")).toBe("Your bag is about half full.");
    expect(fills()[0]).toBeCloseTo(0.5, 3);
  });

  it("then offers the next step, and pressing that replaces the round-up, never stacks two", () => {
    eighteen();
    round().click();
    expect(text("[data-rb-round]")).toBe("+ £25 Round up to a full bag");
    round().click();
    expect(api!.total()).toBe(5000);
    expect(document.querySelectorAll("[data-rb-round-line]").length).toBe(1);
    expect(text("[data-rb-round-line] [data-rb-round-sum]")).toBe("£32");
    expect(text("[data-rb-status]")).toBe("That's around the value of a whole Red Bag Full of Joy.");
    expect(fills()).toEqual([1]);
    expect(text("[data-rb-round]")).toBe("+ £50 Round up to 2 full bags");
    round().click();
    expect(api!.total()).toBe(10000);
    expect(text("[data-rb-round-line] [data-rb-round-sum]")).toBe("£82");
    expect(text("[data-rb-round]")).toBe("+ £50 Round up to 3 full bags");
  });

  it("keeps its target: the extra shrinks as items go in, so the total stays where it is", () => {
    eighteen();
    round().click();
    plus("socks");
    expect(api!.total()).toBe(2500);
    expect(text("[data-rb-round-line] [data-rb-round-sum]")).toBe("£6");
    expect(roundLine().querySelector("button")!.getAttribute("aria-label")).toBe("Remove from your bag: A little extra to round up, £6");
    plus("pencil");
    expect(api!.total()).toBe(2500);
    expect(text("[data-rb-round-line] [data-rb-round-sum]")).toBe("£5.90");
    expect(text("[data-rb-total]")).toBe("£25");
  });

  it("keeps its target: the extra grows back as items come out", () => {
    eighteen();
    round().click();
    minus("blanket");
    expect(api!.total()).toBe(2500);
    expect(text("[data-rb-round-line] [data-rb-round-sum]")).toBe("£15");
  });

  it("keeps the same line on the paper while its amount changes, so a Remove in hand is not lost", () => {
    eighteen();
    round().click();
    const line = roundLine();
    plus("socks");
    expect(roundLine()).toBe(line);
  });

  it("goes when their own items reach or pass the target, and the button offers the next step", () => {
    eighteen();
    round().click();
    plus("blanket"); // £26 of their own
    expect(roundLine()).toBeNull();
    expect($("[data-rb-also]").hidden).toBe(true);
    expect(api!.total()).toBe(2600);
    expect(text("[data-rb-round]")).toBe("+ £24 Round up to a full bag");
  });

  it("goes when their own items land exactly on the target", () => {
    eighteen();
    round().click();
    plus("socks", 7); // £25 of their own
    expect(roundLine()).toBeNull();
    expect(api!.total()).toBe(2500);
    expect(text("[data-rb-round]")).toBe("+ £25 Round up to a full bag");
  });

  // Jaimie: "if their items pass £25 on their own, the top-up disappears and the button offers the
  // next step". Passed, the target is forgotten: it does not come back when things are taken out.
  it("is forgotten once passed: taking that item out again does not bring it back", () => {
    eighteen();
    round().click();
    plus("blanket"); // £26 of their own: passed
    minus("blanket");
    expect(api!.total()).toBe(1800);
    expect(roundLine()).toBeNull();
    expect($("[data-rb-also]").hidden).toBe(true);
    expect(text("[data-rb-round]")).toBe("+ £7 Round up to half a bag");
  });

  it("is forgotten once reached exactly, too", () => {
    eighteen();
    round().click();
    plus("socks", 7); // £25 of their own
    minus("socks");
    expect(api!.total()).toBe(2400);
    expect(roundLine()).toBeNull();
  });

  it("is forgotten when an example takes them past it", () => {
    eighteen();
    round().click();
    example("crisis-15").click(); // £33 of their own
    example("crisis-15").click();
    expect(api!.total()).toBe(1800);
    expect(roundLine()).toBeNull();
  });

  // Typing in a number box is not finished until the box is left. A box emptied on the way to a
  // new number, or a number half typed, must not throw the round-up away.
  describe("while a number is being typed", () => {
    const leave = (id: string) => document.getElementById(id)!.dispatchEvent(new Event("blur"));

    it("keeps the round-up when the only box is emptied and a new number typed", () => {
      type("rb-qty-socks", "5"); // £5
      leave("rb-qty-socks");
      round().click();
      expect(api!.total()).toBe(2500);
      type("rb-qty-socks", ""); // mid edit: nothing of their own, so nothing to round up just now
      expect(api!.total()).toBe(0);
      expect(roundLine()).toBeNull();
      type("rb-qty-socks", "3");
      expect(api!.total()).toBe(2500);
      expect(text("[data-rb-round-line] [data-rb-round-sum]")).toBe("£22");
      leave("rb-qty-socks");
      expect(api!.total()).toBe(2500);
    });

    it("clears the round-up when the box is left empty", () => {
      type("rb-qty-socks", "5");
      leave("rb-qty-socks");
      round().click();
      type("rb-qty-socks", "");
      leave("rb-qty-socks");
      expect(api!.total()).toBe(0);
      type("rb-qty-socks", "3");
      leave("rb-qty-socks");
      expect(api!.total()).toBe(300);
      expect(roundLine()).toBeNull();
    });

    it("keeps the round-up from 10 to 20, through the 2 on the way", () => {
      type("rb-qty-socks", "10");
      leave("rb-qty-socks");
      round().click();
      expect(text("[data-rb-round-line] [data-rb-round-sum]")).toBe("£15");
      type("rb-qty-socks", "");
      type("rb-qty-socks", "2");
      type("rb-qty-socks", "20");
      leave("rb-qty-socks");
      expect(api!.total()).toBe(2500);
      expect(text("[data-rb-round-line] [data-rb-round-sum]")).toBe("£5");
    });

    it("keeps the round-up when a number typed too big on the way is put right before leaving", () => {
      type("rb-qty-socks", "3");
      leave("rb-qty-socks");
      round().click();
      type("rb-qty-socks", "30"); // past the target, mid edit
      expect(roundLine()).toBeNull();
      type("rb-qty-socks", "3");
      expect(api!.total()).toBe(2500);
      leave("rb-qty-socks");
      expect(text("[data-rb-round-line] [data-rb-round-sum]")).toBe("£22");
    });

    it("forgets the target when the box is left past it", () => {
      type("rb-qty-socks", "3");
      leave("rb-qty-socks");
      round().click();
      type("rb-qty-socks", "30");
      leave("rb-qty-socks");
      type("rb-qty-socks", "3");
      leave("rb-qty-socks");
      expect(api!.total()).toBe(300);
    });
  });

  it("is cleared by its own Remove, and the round-up button is where you land", () => {
    eighteen();
    round().click();
    (roundLine().querySelector("button") as HTMLButtonElement).click();
    expect(roundLine()).toBeNull();
    expect($("[data-rb-also]").hidden).toBe(true);
    expect(api!.total()).toBe(1800);
    expect(text("[data-rb-round]")).toBe("+ £7 Round up to half a bag");
    expect(document.activeElement).toBe(round());
    // Cleared for good: taking an item out does not bring it back.
    minus("socks");
    expect(api!.total()).toBe(1700);
  });

  // Jaimie, 4 October 2026: a round-up never stands alone. Once the donor's own choices (items and
  // examples) come to nothing, the round-up is cleared, and it does not come back.
  it("is cleared when the bag is emptied: the total is £0, with no line and no offer", () => {
    eighteen();
    round().click();
    minus("blanket");
    minus("blanket");
    minus("socks");
    expect(api!.total()).toBe(2500); // one pair of socks left: still holding its target
    expect(text("[data-rb-round-line] [data-rb-round-sum]")).toBe("£24");
    minus("socks");
    expect(api!.total()).toBe(0);
    expect(text("[data-rb-total]")).toBe("£0");
    expect(roundLine()).toBeNull();
    expect($("[data-rb-also]").hidden).toBe(true);
    expect(round().hidden).toBe(true);
    expect(text("[data-rb-status]")).toBe("Your bag is empty. Pop something in.");
    expect(text("[data-rb-donate]")).toBe("Donate");
    expect($("[data-rb-bar]").hidden).toBe(true);
  });

  it("does not come back after the bag has been emptied", () => {
    eighteen();
    round().click();
    minus("blanket");
    minus("blanket");
    minus("socks");
    minus("socks");
    expect(api!.total()).toBe(0);
    plus("socks");
    expect(api!.total()).toBe(100);
    expect(roundLine()).toBeNull();
    expect(text("[data-rb-round]")).toBe("+ £24 Round up to half a bag");
    plus("blanket", 2);
    expect(api!.total()).toBe(1700);
  });

  it("is cleared when the last thing to go is an example", () => {
    example("crisis-15").click();
    round().click();
    expect(api!.total()).toBe(2500);
    example("crisis-15").click();
    expect(api!.total()).toBe(0);
    expect(roundLine()).toBeNull();
    expect($("[data-rb-also]").hidden).toBe(true);
    example("crisis-15").click();
    expect(api!.total()).toBe(1500);
  });

  it("cannot be sent on its own: an emptied bag gets the nudge, not the details step", () => {
    eighteen();
    round().click();
    minus("blanket");
    minus("blanket");
    minus("socks");
    minus("socks");
    donate();
    expect($("[data-rb-details]").hidden).toBe(true);
    expect($("[data-rb-nudge]").hidden).toBe(false);
    expect(api!.payload().amount).toBe(0);
  });

  it("sits with the examples under Also in your bag, last, and shrinks when an example goes in", () => {
    plus("socks", 3);
    example("crisis-15").click(); // £18
    round().click();
    const lines = [...document.querySelectorAll("[data-rb-also-list] li")];
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe(roundLine());
    expect(text("[data-rb-round-line] [data-rb-round-sum]")).toBe("£7");
    round().click(); // a full bag: £32 extra
    example("hand-20").click();
    expect(api!.total()).toBe(5000);
    expect(text("[data-rb-round-line] [data-rb-round-sum]")).toBe("£12");
    const after = [...document.querySelectorAll("[data-rb-also-list] li")];
    expect(after.length).toBe(3);
    expect(after[2]).toBe(roundLine());
    // Taking an example out with its own Remove leaves the round-up holding its target.
    ($('[data-rb-also-list] [data-rb-remove="crisis-15"]') as HTMLButtonElement).click();
    expect(api!.total()).toBe(5000);
    expect(text("[data-rb-round-line] [data-rb-round-sum]")).toBe("£27");
  });

  it("works from under £2: a round-up from 10p to £25 is fine, and Donate goes on", () => {
    plus("pencil");
    expect(text("[data-rb-status]")).toBe("Add a little more to reach £2. Maybe some socks?");
    expect(text("[data-rb-round]")).toBe("+ £24.90 Round up to half a bag");
    donate();
    expect($("[data-rb-nudge]").hidden).toBe(false);
    round().click();
    expect($("[data-rb-nudge]").hidden).toBe(true);
    expect(text("[data-rb-total]")).toBe("£25");
    donate();
    expect($("[data-rb-details]").hidden).toBe(false);
    expect(text("[data-rb-details-total]")).toBe("£25");
  });

  it("sends exactly the total shown, round-up and all, and still no list of items", async () => {
    eighteen();
    plus("pencil", 9); // £18.90
    round().click();
    expect(text("[data-rb-total]")).toBe("£25");
    donate();
    expect(text("[data-rb-pay]")).toBe("Donate £25");
    fillDetails();
    pay();
    await flush();
    expect(sent()).toEqual({
      mode: "once",
      plan: null,
      amount: 2500,
      giftAid: false,
      coverFee: false,
      donorType: "individual",
      fullName: "Alex Example",
      email: "alex@example.com",
      emailConsent: false,
      redBag: true,
    });
    expect(api!.payload().amount).toBe(api!.total());
    expect(JSON.parse(store.get("nbcc_red_bag_gift")!)).toEqual({ pence: 2500, giftAid: false, monthly: false });
  });

  it("works with monthly: the rounded total is the monthly donation", async () => {
    eighteen();
    round().click();
    often("monthly");
    expect(text("[data-rb-donate]")).toBe("Donate £25 every month");
    expect(text(".rb-total__sum")).toBe("£25 every month");
    donate();
    fillDetails();
    tick("rbAgeConfirmed");
    pay();
    await flush();
    expect(sent()).toMatchObject({ mode: "monthly", amount: 2500, coverFee: false, ageConfirmed: true, redBag: true });
  });

  it("is in the phone bar's total too", () => {
    eighteen();
    expect(text(".rb-bar__total")).toBe("Your bag £18");
    round().click();
    expect(text(".rb-bar__total")).toBe("Your bag £25");
  });

  it("is kept when they come back from the details step", () => {
    eighteen();
    round().click();
    donate();
    $<HTMLButtonElement>("[data-rb-back]").click();
    expect(text("[data-rb-total]")).toBe("£25");
    expect(text("[data-rb-round-line] [data-rb-round-sum]")).toBe("£7");
  });

  it("is said once: by the status line and the total, not by a region of its own", () => {
    eighteen();
    round().click();
    expect(round().closest("[aria-live]")).toBeNull();
    expect(roundLine().closest("[aria-live]")).toBeNull();
    expect(document.querySelectorAll("[data-rb-builder] [aria-live]").length).toBe(1);
    // (The region also holds " every month", hidden unless Give monthly is chosen.)
    expect(text("[data-rb-status]")).toBe("Your bag is about half full.");
    expect(text(".rb-total")).toMatch(/^Your total £25/);
  });

  it("stays a button the keyboard can reach, and is never switched off", () => {
    eighteen();
    expect(round().disabled).toBe(false);
    expect(round().hasAttribute("tabindex")).toBe(false);
    expect(round().getAttribute("type")).toBe("button");
  });
});

describe("pressing Donate", () => {
  it("is never disabled", () => {
    expect($<HTMLButtonElement>("[data-rb-donate]").disabled).toBe(false);
  });

  it("under £2, shows the friendly nudge and goes nowhere", () => {
    plus("socks");
    donate();
    expect($("[data-rb-nudge]").hidden).toBe(false);
    expect(text("[data-rb-nudge]")).toBe("Add a little more to reach £2. Maybe some socks?");
    expect($("[data-rb-details]").hidden).toBe(true);
    expect($("[data-rb-builder]").hidden).toBe(false);
  });

  it("with an empty bag, nudges too", () => {
    donate();
    expect($("[data-rb-nudge]").hidden).toBe(false);
    expect($("[data-rb-details]").hidden).toBe(true);
  });

  it("puts the nudge away as soon as the bag reaches £2", () => {
    plus("socks");
    donate();
    plus("socks");
    expect($("[data-rb-nudge]").hidden).toBe(true);
  });

  it("from £2, opens the details step with the total, and moves there", () => {
    plus("socks", 2);
    donate();
    expect($("[data-rb-details]").hidden).toBe(false);
    expect($("[data-rb-builder]").hidden).toBe(true);
    // The themes are part of the bag's own section now, so they go with it.
    expect($("[data-rb-need]").closest("[data-rb-builder]")).toBe($("[data-rb-builder]"));
    expect(text("[data-rb-details-total]")).toBe("£2");
    expect(document.activeElement).toBe(document.getElementById("rb-details-title"));
  });

  it("lets them go back to the bag, which is as they left it", () => {
    plus("book", 3);
    donate();
    $<HTMLButtonElement>("[data-rb-back]").click();
    expect($("[data-rb-details]").hidden).toBe(true);
    expect($("[data-rb-builder]").hidden).toBe(false);
    expect($("[data-rb-need]").hidden).toBe(false);
    expect(text("[data-rb-total]")).toBe("£9");
    expect(document.activeElement).toBe($("[data-rb-donate]"));
  });
});

describe("the details step", () => {
  beforeEach(() => {
    plus("blanket", 5); // £40
  });

  it("for a one off: offers to cover the card fee, shows this donation's declaration, asks no age", () => {
    donate();
    expect($("[data-rb-fee]").hidden).toBe(false);
    expect(text("[data-rb-fee-amount]")).toBe("68p");
    expect($("[data-rb-age]").hidden).toBe(true);
    expect((document.getElementById("rbAgeConfirmed") as HTMLInputElement).disabled).toBe(true);
    expect($('[data-rb-wording="once"]').hidden).toBe(false);
    expect($('[data-rb-wording="monthly"]').hidden).toBe(true);
    expect(text("[data-rb-giftaid-headline]")).toBe("Make your £40 worth £50");
    expect(text("[data-rb-pay]")).toBe("Donate £40");
  });

  it("for a monthly one: no fee offer, the all donations declaration, and the 18 or over tick", () => {
    often("monthly");
    donate();
    expect($("[data-rb-fee]").hidden).toBe(true);
    expect($("[data-rb-age]").hidden).toBe(false);
    expect((document.getElementById("rbAgeConfirmed") as HTMLInputElement).disabled).toBe(false);
    expect($('[data-rb-wording="once"]').hidden).toBe(true);
    expect($('[data-rb-wording="monthly"]').hidden).toBe(false);
    expect($("[data-rb-details-monthly]").hidden).toBe(false);
    expect(text("[data-rb-pay]")).toBe("Donate £40 every month");
  });

  it("shows the home address only when Gift Aid is ticked, and no postcode for an address abroad", () => {
    donate();
    expect($("#rbDeclaration").hidden).toBe(true);
    tick("rbGiftAid");
    expect($("#rbDeclaration").hidden).toBe(false);
    tick("rbNonUk");
    expect($("#rbPostcodeField").hidden).toBe(true);
    expect((document.getElementById("rbPostcode") as HTMLInputElement).disabled).toBe(true);
  });

  it("will not send without a name and an email", async () => {
    donate();
    pay();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect($("[data-rb-error]").hidden).toBe(false);
  });
});

describe("what is sent to the checkout", () => {
  it("is the donate page's body with the Red Bag marker, and never a list of items", async () => {
    plus("blanket", 5);
    example("crisis-15").click();
    donate();
    fillDetails();
    tick("rbEmailConsent");
    pay();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/checkout-session");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(sent()).toEqual({
      mode: "once",
      plan: null,
      amount: 5500,
      giftAid: false,
      coverFee: false,
      donorType: "individual",
      fullName: "Alex Example",
      email: "alex@example.com",
      emailConsent: true,
      redBag: true,
    });
  });

  it("carries the Gift Aid declaration and the fee choice for a one off", async () => {
    plus("blanket", 5);
    donate();
    fillDetails();
    tick("rbGiftAid");
    type("rbHouse", "12");
    type("rbAddress", "Example Street, Exampleton");
    type("rbPostcode", "KA1 1AA");
    tick("rbCoverFee");
    pay();
    await flush();
    expect(sent()).toMatchObject({
      giftAid: true,
      coverFee: true,
      declaration: { firstName: "Alex", lastName: "Example", houseNameNumber: "12", address: "Example Street, Exampleton", postcode: "KA1 1AA", nonUk: false, scope: "this_donation" },
    });
  });

  it("is monthly when Give monthly is chosen: the 18 or over answer, and never a fee cover", async () => {
    plus("blanket", 5);
    tick("rbCoverFee");
    often("monthly");
    donate();
    fillDetails();
    pay();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled(); // 18 or over not ticked yet
    tick("rbAgeConfirmed");
    pay();
    await flush();
    expect(sent()).toMatchObject({ mode: "monthly", amount: 4000, coverFee: false, ageConfirmed: true, redBag: true });
    expect(sent().declaration).toBeUndefined();
  });

  it("sends nothing about who is signed in, on the public page", async () => {
    start({ kept: { nbcc_admin_token: "a-staff-token" } });
    plus("blanket", 5);
    donate();
    fillDetails();
    pay();
    await flush();
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("sends the staff session with it on a staff preview, so the checkout lets it through", async () => {
    start({ preview: true, kept: { nbcc_admin_token: "a-staff-token" } });
    plus("blanket", 5);
    donate();
    fillDetails();
    pay();
    await flush();
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer a-staff-token" });
  });
});

describe("going to pay", () => {
  beforeEach(() => {
    plus("blanket", 5);
  });

  it("goes to Stripe's page, and remembers the total for the thank you (for show only)", async () => {
    donate();
    fillDetails();
    tick("rbGiftAid");
    type("rbHouse", "12");
    type("rbAddress", "Example Street, Exampleton");
    type("rbPostcode", "KA1 1AA");
    pay();
    await flush();
    expect(nav.assign).toHaveBeenCalledWith("https://checkout.stripe.test/pay");
    expect(JSON.parse(store.get("nbcc_red_bag_gift")!)).toEqual({ pence: 4000, giftAid: true, monthly: false });
  });

  it("says so plainly when the checkout refuses the form", async () => {
    start({ answer: { status: 400, body: { error: "Invalid checkout request" } } });
    plus("blanket", 5);
    donate();
    fillDetails();
    pay();
    await flush();
    expect(nav.assign).not.toHaveBeenCalled();
    expect(text("[data-rb-error]")).toBe("Something in the form needs another look. Please check it and try again.");
    expect($<HTMLButtonElement>("[data-rb-pay]").disabled).toBe(false);
  });

  it("points to the donate page when payment is not working", async () => {
    start({ answer: { status: 502, body: {} } });
    plus("blanket", 5);
    donate();
    fillDetails();
    pay();
    await flush();
    expect(text("[data-rb-error]")).toBe("Payment is not working just now. Please try again in a few minutes, or give on our donate page.");
  });

  // Switched off, the checkout takes a Red Bag donation only from signed in staff. A session that
  // has run out is not "payment is broken": say what to do.
  it("tells staff to sign in again when the checkout says it is not open (their session ran out)", async () => {
    start({ preview: true, answer: { status: 403, body: { error: "Fill a Red Bag is not open yet" } } });
    plus("blanket", 5);
    donate();
    fillDetails();
    pay();
    await flush();
    expect(nav.assign).not.toHaveBeenCalled();
    expect(text("[data-rb-error]")).toBe("Fill a Red Bag is not open yet. If you are staff, please sign in again at /admin, then come back to this page.");
    expect($<HTMLButtonElement>("[data-rb-pay]").disabled).toBe(false);
    expect(store.has("nbcc_red_bag_gift")).toBe(false);
  });

  // Going to Stripe's page leaves the button saying "Opening secure payment". Pressing Back brings
  // this page out of the browser's back and forward cache exactly as it was left: stuck.
  it("is ready again when they come back from Stripe's page with the Back button", async () => {
    donate();
    fillDetails();
    pay();
    await flush();
    const button = $<HTMLButtonElement>("[data-rb-pay]");
    expect(button.disabled).toBe(true);
    listeners.pageshow({ persisted: false });
    expect(button.disabled).toBe(true); // an ordinary first showing changes nothing
    listeners.pageshow({ persisted: true });
    expect(button.disabled).toBe(false);
    expect(text("[data-rb-pay]")).toBe("Donate £40");
    pay();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cannot be sent twice while it is opening", async () => {
    donate();
    fillDetails();
    pay();
    pay();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// Back from paying, the donor lands on a page of its own, /fill/thank-you
// (assets/js/red-bag-thanks.js; test/unit/red-bag-thanks-script.test.ts). This page has no thank you.
describe("the thank you is not here", () => {
  it("has no thank you step, with or without the old flag in the address", () => {
    for (const search of ["", "?thanks=1", "?thanks=1&session_id=cs_test_abc"]) {
      start({ search, kept: { nbcc_red_bag_gift: JSON.stringify({ pence: 5410, giftAid: false, monthly: false }) } });
      expect($("[data-rb-thanks]")).toBeNull();
      expect($("[data-rb-builder]").hidden).toBe(false);
      expect($("[data-rb-lede]").hidden).toBe(false);
      // What the tab remembered is left for the thank you page to read.
      expect(store.has("nbcc_red_bag_gift")).toBe(true);
      expect(history.replaceState).not.toHaveBeenCalled();
    }
  });
});

describe("Stripe opening on the page", () => {
  const embeddedAnswer = { status: 200, body: { clientSecret: "cs_test_secret_abc", publishableKey: "pk_test_dummy_pk" } };
  function stripeThat(init: () => Promise<unknown>) {
    const checkout = { mount: vi.fn(), destroy: vi.fn() };
    const initEmbeddedCheckout = vi.fn(init === undefined ? async () => checkout : init);
    const Stripe = vi.fn(() => ({ initEmbeddedCheckout }));
    return { Stripe, initEmbeddedCheckout, checkout };
  }
  const ready = () => {
    plus("blanket", 5);
    donate();
    fillDetails();
    pay();
  };
  const modal = () => $("#rbCheckoutModal");

  it("asks for the on page checkout, opens the panel and puts Stripe in it", async () => {
    const s = stripeThat(undefined as never);
    s.initEmbeddedCheckout.mockImplementation(async () => s.checkout);
    start({ stripe: s.Stripe, answer: embeddedAnswer });
    ready();
    await flush();
    expect(sent()).toMatchObject({ uiMode: "embedded", redBag: true, amount: 4000 });
    expect(s.Stripe).toHaveBeenCalledWith("pk_test_dummy_pk");
    expect(s.initEmbeddedCheckout).toHaveBeenCalledWith({ clientSecret: "cs_test_secret_abc" });
    expect(modal().hidden).toBe(false);
    expect(modal().getAttribute("aria-hidden")).toBe("false");
    expect(document.body.classList.contains("give-embedded-open")).toBe(true);
    expect(s.checkout.mount).toHaveBeenCalledWith(document.getElementById("rbEmbeddedCheckout"));
    expect(document.activeElement).toBe(document.getElementById("rbCheckoutClose"));
    expect(nav.assign).not.toHaveBeenCalled();
    // The total is remembered for the thank you, and the button is ready again behind the panel.
    expect(JSON.parse(store.get("nbcc_red_bag_gift")!)).toEqual({ pence: 4000, giftAid: false, monthly: false });
    expect($<HTMLButtonElement>("[data-rb-pay]").disabled).toBe(false);
  });

  it("closes with the Close button: Stripe is taken down and the focus goes back to the pay button", async () => {
    const s = stripeThat(undefined as never);
    s.initEmbeddedCheckout.mockImplementation(async () => s.checkout);
    start({ stripe: s.Stripe, answer: embeddedAnswer });
    ready();
    await flush();
    document.getElementById("rbEmbeddedCheckout")!.innerHTML = "<iframe></iframe>";
    (document.getElementById("rbCheckoutClose") as HTMLButtonElement).click();
    expect(modal().hidden).toBe(true);
    expect(modal().getAttribute("aria-hidden")).toBe("true");
    expect(document.body.classList.contains("give-embedded-open")).toBe(false);
    expect(s.checkout.destroy).toHaveBeenCalledTimes(1);
    expect(document.getElementById("rbEmbeddedCheckout")!.innerHTML).toBe("");
    expect(document.activeElement).toBe($("[data-rb-pay]"));
  });

  it("closes with the Escape key, and Escape does nothing while it is shut", async () => {
    const s = stripeThat(undefined as never);
    s.initEmbeddedCheckout.mockImplementation(async () => s.checkout);
    start({ stripe: s.Stripe, answer: embeddedAnswer });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(s.checkout.destroy).not.toHaveBeenCalled();
    ready();
    await flush();
    expect(modal().hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(modal().hidden).toBe(true);
    expect(s.checkout.destroy).toHaveBeenCalledTimes(1);
  });

  it("goes to Stripe's own page when the server does not offer the on page checkout", async () => {
    const s = stripeThat(undefined as never);
    start({ stripe: s.Stripe, answer: { status: 200, body: { url: "https://checkout.stripe.test/pay" } } });
    ready();
    await flush();
    expect(s.Stripe).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent().uiMode).toBeUndefined();
    expect(nav.assign).toHaveBeenCalledWith("https://checkout.stripe.test/pay");
    expect(modal().hidden).toBe(true);
  });

  it("goes to Stripe's own page when Stripe cannot start on the page", async () => {
    const s = stripeThat(undefined as never);
    s.initEmbeddedCheckout.mockImplementation(async () => {
      throw new Error("blocked");
    });
    start({ stripe: s.Stripe, answer: embeddedAnswer });
    ready();
    await flush();
    await flush();
    expect(modal().hidden).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent().uiMode).toBeUndefined();
  });

  it("says what is wrong, and opens nothing, when the checkout refuses the form", async () => {
    const s = stripeThat(undefined as never);
    start({ stripe: s.Stripe, answer: { status: 400, body: {} } });
    ready();
    await flush();
    expect(s.Stripe).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(modal().hidden).toBe(true);
    expect(text("[data-rb-error]")).toBe("Something in the form needs another look. Please check it and try again.");
  });
});

describe("the postcode", () => {
  it("is held to the server's rule on the page, so nothing the page lets through is refused later", async () => {
    plus("blanket", 5);
    donate();
    fillDetails();
    tick("rbGiftAid");
    type("rbHouse", "12");
    type("rbAddress", "Example Street, Exampleton");
    type("rbPostcode", "KI1 1AA"); // I is never the second letter of a UK postcode
    pay();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    type("rbPostcode", "ka1 1aa");
    pay();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// The total and Donate are in the bag's panel, which a long list soon scrolls out of sight, on a
// phone and on a computer alike. A slim bar fixed to the foot of the screen carries the total and a
// Donate button while they are out of sight, at every width (Jaimie, 4 October 2026), and goes the
// moment the real ones come on screen, so nothing is ever shown twice.
describe("the bottom bar", () => {
  const bar = () => $("[data-rb-bar]");
  const barDonate = () => $<HTMLButtonElement>("[data-rb-bar-donate]").click();
  const padded = () => document.body.classList.contains("rb-bar-on");

  it("stays away while the bag is empty", () => {
    expect(bar().hidden).toBe(true);
    expect(padded()).toBe(false);
  });

  it("shows the total once there is something in the bag, and keeps up with it", () => {
    plus("blanket", 2);
    expect(bar().hidden).toBe(false);
    expect(text(".rb-bar__total")).toBe("Your bag £16");
    plus("socks", 2);
    expect(text(".rb-bar__total")).toBe("Your bag £18");
    expect(padded()).toBe(true);
  });

  it("goes when the bag is emptied again", () => {
    plus("blanket");
    minus("blanket");
    expect(bar().hidden).toBe(true);
    expect(padded()).toBe(false);
  });

  it("watches the real total and Donate, and hides while they are on screen", () => {
    expect(watcher!.el).toBe($("[data-rb-watch]"));
    expect(watcher!.el!.contains($("[data-rb-total]"))).toBe(true);
    expect(watcher!.el!.contains($("[data-rb-donate]"))).toBe(true);
    plus("blanket");
    watcher!.say(true);
    expect(bar().hidden).toBe(true);
    expect(padded()).toBe(false);
    watcher!.say(false);
    expect(bar().hidden).toBe(false);
  });

  it("goes while the footer is on screen, so it never sits over the charity's details", () => {
    const foot = watchers.find((w) => w.el === document.querySelector("footer"))!;
    expect(foot).toBeTruthy();
    plus("blanket");
    expect(bar().hidden).toBe(false);
    foot.say(true);
    expect(bar().hidden).toBe(true);
    expect(padded()).toBe(false);
    foot.say(false);
    expect(bar().hidden).toBe(false);
  });

  it("does what the real Donate does: from £2, on to the details step, and it goes", () => {
    plus("blanket");
    barDonate();
    expect($("[data-rb-details]").hidden).toBe(false);
    expect(document.activeElement).toBe(document.getElementById("rb-details-title"));
    expect(bar().hidden).toBe(true);
    expect(padded()).toBe(false);
    $<HTMLButtonElement>("[data-rb-back]").click();
    expect(bar().hidden).toBe(false);
  });

  it("does what the real Donate does: under £2, the nudge, brought into view", () => {
    const nudge = $("[data-rb-nudge]");
    const seen = vi.fn();
    (nudge as unknown as { scrollIntoView: unknown }).scrollIntoView = seen;
    plus("socks");
    barDonate();
    expect(nudge.hidden).toBe(false);
    expect(seen).toHaveBeenCalledWith({ block: "center" });
    expect($("[data-rb-details]").hidden).toBe(true);
  });

  // The bar hides the moment the real Donate is on screen, and its button with it: the focus must
  // not be left on a button that has gone.
  it("under £2, hands the focus to the real Donate button, beside the nudge", () => {
    ($("[data-rb-nudge]") as unknown as { scrollIntoView: unknown }).scrollIntoView = vi.fn();
    plus("socks");
    $<HTMLButtonElement>("[data-rb-bar-donate]").focus();
    barDonate();
    expect(document.activeElement).toBe($("[data-rb-donate]"));
  });

  it("does not bring the nudge into view for the real Donate, which is beside it already", () => {
    const seen = vi.fn();
    ($("[data-rb-nudge]") as unknown as { scrollIntoView: unknown }).scrollIntoView = seen;
    plus("socks");
    donate();
    expect(seen).not.toHaveBeenCalled();
  });

  it("never shows where the browser cannot tell what is on screen", () => {
    start({ noObserver: true });
    plus("blanket", 3);
    expect(bar().hidden).toBe(true);
    expect(padded()).toBe(false);
  });
});
