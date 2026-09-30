import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-479: assets/js/pulse.js, the small script on every public page. It stores nothing on the
// device, does nothing at all under Do Not Track or Global Privacy Control, and sends a view on
// load, a leave when the page is hidden, and the clicks that matter.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FILE = resolve(ROOT, "assets/js/pulse.js");
const script = () => readFileSync(FILE, "utf8");

type Sent = { url: string; body: Record<string, unknown>; via: "beacon" | "fetch" };

function load(opts: {
  url?: string;
  referrer?: string;
  body?: string;
  dnt?: string;
  gpc?: boolean;
  beacon?: boolean | "fails";
  hidden?: boolean;
} = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${opts.body ?? ""}</body></html>`, {
    url: opts.url ?? "https://nbcc.scot/donate",
    referrer: opts.referrer,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window as unknown as Window & typeof globalThis & { eval: (s: string) => unknown };
  const sent: Sent[] = [];
  let clock = 1_000_000;
  (w.Date as unknown as { now: () => number }).now = () => clock;
  if (opts.dnt) Object.defineProperty(w.navigator, "doNotTrack", { value: opts.dnt, configurable: true });
  if (opts.gpc) Object.defineProperty(w.navigator, "globalPrivacyControl", { value: true, configurable: true });
  const beacon = opts.beacon ?? true;
  Object.defineProperty(w.navigator, "sendBeacon", {
    configurable: true,
    value: beacon
      ? (url: string, data: string) => {
          if (beacon === "fails") return false;
          sent.push({ url, body: JSON.parse(data), via: "beacon" });
          return true;
        }
      : undefined,
  });
  (w as unknown as { fetch: unknown }).fetch = (url: string, init: { body: string; keepalive: boolean; method: string }) => {
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe("POST");
    sent.push({ url, body: JSON.parse(init.body), via: "fetch" });
    return Promise.resolve();
  };
  Object.defineProperty(w.document.documentElement, "scrollHeight", { value: 2000, configurable: true });
  let visibility = opts.hidden ? "hidden" : "visible";
  Object.defineProperty(w.document, "visibilityState", { get: () => visibility, configurable: true });
  w.eval(script());
  return {
    w,
    sent,
    tick: (ms: number) => {
      clock += ms;
    },
    hide: () => {
      visibility = "hidden";
      w.document.dispatchEvent(new w.Event("visibilitychange"));
    },
    show: () => {
      visibility = "visible";
      w.document.dispatchEvent(new w.Event("visibilitychange"));
    },
    scrollTo: (y: number) => {
      Object.defineProperty(w, "scrollY", { value: y, configurable: true });
      w.dispatchEvent(new w.Event("scroll"));
    },
    click: (selector: string) => {
      const el = w.document.querySelector(selector)!;
      el.addEventListener("click", (e) => e.preventDefault());
      (el as HTMLElement).click();
    },
  };
}

describe("pulse.js is small and stores nothing", () => {
  it("is under 2 KB", () => {
    expect(existsSync(FILE)).toBe(true);
    expect(statSync(FILE).size).toBeLessThan(2048);
  });

  it("never touches cookies or browser storage", () => {
    expect(script()).not.toMatch(/cookie|localStorage|sessionStorage|indexedDB/i);
    const page = load();
    expect(page.w.document.cookie).toBe("");
    expect(page.w.localStorage.length).toBe(0);
    expect(page.w.sessionStorage.length).toBe(0);
  });
});

describe("Do Not Track and Global Privacy Control", () => {
  it("sends nothing at all under Do Not Track", () => {
    const page = load({ dnt: "1", body: '<a href="tel:+440000000000">Call</a>' });
    page.click("a");
    page.hide();
    expect(page.sent).toEqual([]);
  });

  it("sends nothing at all under Global Privacy Control", () => {
    const page = load({ gpc: true });
    page.hide();
    expect(page.sent).toEqual([]);
  });
});

describe("the view", () => {
  it("is sent on load with the page, the referrer, the tracking words and the screen width", () => {
    const page = load({
      url: "https://nbcc.scot/donate?utm_source=newsletter&utm_medium=email&utm_campaign=12&token=secret",
      referrer: "https://example.com/story",
    });
    expect(page.sent).toHaveLength(1);
    const [{ url, body, via }] = page.sent;
    expect(url).toBe("/api/pulse");
    expect(via).toBe("beacon");
    expect(body).toEqual({
      t: "view",
      v: expect.stringMatching(/^[0-9a-f]{16}$/),
      p: "/donate",
      r: "https://example.com/story",
      u: { s: "newsletter", m: "email", c: "12" },
      w: page.w.screen.width,
    });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("gets a new random id on every page load", () => {
    expect(load().sent[0].body.v).not.toBe(load().sent[0].body.v);
  });

  it("falls back to fetch with keepalive when there is no sendBeacon, or it refuses", () => {
    expect(load({ beacon: false }).sent[0].via).toBe("fetch");
    expect(load({ beacon: "fails" }).sent[0].via).toBe("fetch");
  });
});

describe("the leave", () => {
  let page: ReturnType<typeof load>;
  beforeEach(() => {
    page = load();
  });
  const leaves = () => page.sent.filter((s) => s.body.t === "leave").map((s) => s.body);

  it("says how long the page was visible and how far down it was read", () => {
    page.tick(42_000);
    page.scrollTo(632); // (632 + 768) / 2000 = 70%
    page.hide();
    expect(leaves()).toEqual([{ t: "leave", v: page.sent[0].body.v, a: 42, s: 70 }]);
  });

  it("is sent once, however the page goes away", () => {
    page.tick(5000);
    page.hide();
    page.w.dispatchEvent(new page.w.Event("pagehide"));
    expect(leaves()).toHaveLength(1);
  });

  it("is sent again with the larger values if the page comes back and is hidden again", () => {
    page.tick(10_000);
    page.hide();
    page.tick(60_000); // in a background tab: not counted
    page.show();
    page.tick(5000);
    page.scrollTo(1232);
    page.hide();
    expect(leaves().map((l) => [l.a, l.s])).toEqual([
      [10, 38],
      [15, 100],
    ]);
  });

  it("starts the clock only once a page opened in a background tab is looked at", () => {
    const bg = load({ hidden: true });
    bg.tick(60_000); // opened behind the current tab
    bg.show();
    bg.tick(7000);
    bg.hide();
    expect(bg.sent.filter((s) => s.body.t === "leave").map((s) => s.body.a)).toEqual([7]);
  });

  it("caps the time at 30 minutes", () => {
    page.tick(5 * 60 * 60 * 1000);
    page.hide();
    expect(leaves()[0].a).toBe(1800);
  });
});

describe("the clicks that matter", () => {
  const BODY = `
    <nav><a class="nav-cta" href="/donate">Donate</a><a href="/about-us">About</a></nav>
    <a id="tel" href="tel:+440000000000">0000 000 000</a>
    <a id="mail" href="mailto:hello@example.com">hello@example.com</a>
    <a id="pdf" href="/media/documents/annual-report.pdf">Annual report</a>
    <a id="away" href="https://www.example.org/page?x=1">A friend of ours</a>
    <a id="book" class="btn btn-gold" href="#tickets">Book tickets</a>
    <a id="terms" href="/ball/terms">ticket terms</a>
    <button id="cta" class="btn btn-primary give-cta" type="button">Donate now</button>
    <button id="pay" class="btn primary" data-give-pay type="button">Continue to secure payment</button>
    <button id="mode" class="give-mode" type="button">Donate monthly</button>
    <a id="event" class="btn btn-primary ev-book ev-book--away" href="https://tickets.example.com/e/1">Book your place</a>
  `;
  const clicks = (page: ReturnType<typeof load>) =>
    page.sent.filter((s) => s.body.t === "click").map((s) => [s.body.k, s.body.l]);

  it.each([
    ["nav a.nav-cta", "donate", "Donate"],
    ["#tel", "phone", "0000 000 000"],
    ["#mail", "email", "hello@example.com"],
    ["#pdf", "download", "annual-report.pdf"],
    ["#away", "outbound", "www.example.org"],
    ["#book", "tickets", "Book tickets"],
    ["#cta", "donate", "Donate now"],
    ["#pay", "donate", "Continue to secure payment"],
    ["#event", "tickets", "Book your place"],
  ])("counts %s as %s", (selector, kind, label) => {
    const page = load({ body: BODY });
    page.click(selector);
    expect(clicks(page)).toEqual([[kind, label]]);
    expect(page.sent.at(-1)!.body.v).toBe(page.sent[0].body.v);
  });

  it.each(["nav a[href='/about-us']", "#terms", "#mode"])("does not count %s", (selector) => {
    const page = load({ body: BODY });
    page.click(selector);
    expect(clicks(page)).toEqual([]);
  });

  it("cuts a long label to 80 characters", () => {
    const page = load({ body: `<button class="btn" id="b">Donate ${"now ".repeat(40)}</button>` });
    page.click("#b");
    expect(String(page.sent.at(-1)!.body.l)).toHaveLength(80);
  });
});

describe("which pages carry it", () => {
  const PUBLIC = [
    "index.html", "about.html", "donate.html", "events.html", "ball.html", "ball-terms.html", "gift-aid.html",
    "contact.html", "my-story.html", "supporters.html", "hub.html", "privacy.html", "sitemap.html",
    "thank-you.html", "business-thank-you.html", "404.html",
  ];
  const TAG = '<script defer src="/assets/js/pulse.js"></script>';

  it.each(PUBLIC)("%s loads it, deferred", (page) => {
    const html = readFileSync(resolve(ROOT, page), "utf8");
    expect(html.split(TAG)).toHaveLength(2);
  });

  it.each(["admin.html", "portal.html", "set-password.html"])("%s does not", (page) => {
    expect(readFileSync(resolve(ROOT, page), "utf8")).not.toContain("pulse.js");
  });
});
