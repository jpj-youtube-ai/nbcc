import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// The night treatment on /fill, as the server draws it: render.ts adds it, only after the Ball's moment
// or for ?at=after-ball, and before that the page is byte for byte what it was. The script and the
// stylesheet are in red-bag-night-script.test.ts. /fill takes real donations, so most of this file is
// about what the night must leave alone. Every name and price here is invented.

const state = vi.hoisted(() => ({
  // /fill's own night switch (FILL_NIGHT_NOW, src/red-bag/switch.ts): off for the tests that show
  // /fill waiting for the Ball's moment, as it does if the switch is ever turned off again.
  fillNightNow: false,
  now: new Date("2026-11-01T12:00:00Z"),
  list: null as unknown,
  draft: null as unknown,
  mayView: false,
}));

vi.mock("../../src/db/ball", () => ({
  getSettings: async () => ({ gateOpen: true, gateOpensAt: null }),
  getPreviewPasswordHash: async () => null,
  // Ticket sales open, as these tests have always assumed (5 November 2026).
  ticketSalesClosed: async () => false,
}));
vi.mock("../../src/db/events", () => ({
  getEventsSettings: async () => ({ pageOn: true }),
  listPageEvents: async () => [],
}));
vi.mock("../../src/db/site-pages", () => ({ resolveAlias: async () => null, getSeoOverrides: async () => new Map() }));
vi.mock("../../src/db/fundraisers", () => ({
  fundraisingIsOn: async () => true,
  listApprovedPublic: async () => [],
  getBySlug: async () => null,
  wallRows: async () => [],
}));
vi.mock("../../src/db/donations", () => ({ listPublicSupporters: async () => ({ bronze: [], silver: [], gold: [], platinum: [] }) }));
vi.mock("../../src/db/fundraising-categories", async () => {
  const c = await import("../../src/fundraising/categories");
  return { loadCategories: async () => c.BUILT_IN_CATEGORIES };
});
vi.mock("../../src/db/red-bag-lists", () => ({
  loadPublishedRedBagList: async () => state.list,
  readRedBagDraft: async () => (state.draft ? { data: state.draft } : null),
}));
vi.mock("../../src/ball/preview-access", () => ({ holdsPreviewCookie: async () => false }));
vi.mock("../../src/red-bag/switch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/red-bag/switch")>()),
  fillNightNow: () => state.fillNightNow,
}));
vi.mock("../../src/red-bag/staff", () => ({
  isStaffRequest: async () => false,
  mayViewRedBagDraft: async () => state.mayView,
}));

import { createSiteRouter } from "../../src/routes/site";
import { renderRedBagPage, renderRedBagThanksPage, DRAFT_STRIP } from "../../src/red-bag/render";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const rules = createRequire(import.meta.url)(resolve(ROOT, "assets/js/red-bag-list.js"));
const template = read("fill-a-red-bag.html");
const thanks = read("fill-thank-you.html");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const sha = (s: string) => createHash("sha256").update(lf(s)).digest("hex");
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const BEFORE = new Date("2026-11-07T19:59:59Z");
const AFTER = new Date("2026-11-07T20:00:00Z");

const STYLES = '<link rel="stylesheet" href="/assets/css/fill-night.css" />';
const SCRIPT = '<script defer src="/assets/js/fill-night.js"></script>';

function moved() {
  const list = rules.builtIn();
  for (const item of list.items) item.pence += 100;
  return list;
}

/** One part of a page, from one mark to the next. */
const between = (html: string, from: string, to: string) => {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(-1);
  return html.slice(a, b);
};

// The renders of commit d17f9856, the page as it stood before any of Stage 2, line endings aside. If
// the page is changed on purpose before the night, take the new hash from the failure, having checked
// that the change is the one meant. After the night, and once the file below is tidied, this can go.
// Re-pinned 6 November 2026 for the paintings (Jaimie): the pictures, the list's pictures and the painted
// bag, checked against main by a tag by tag diff, with not one word of either page changed.
const BASELINE = {
  page: "a8d0aafadbfd7469abceec9098c006f51ec3965e8855ec729210ebf44e0d94d5",
  list: "95b529ceab1b213d2ca3dd09f0ecc3a08a2848f6639624bb86fd4e8b6396a549",
  draft: "6e4a452bd9b81335fb3d0d92270f635794a43c53e213c6633fde31172ce906f1",
  preview: "7f933b771cd54e6f1fdfac80c9172cdc881f84a0948b4acbbc30208c1aed7a2b",
  thanks: "45e899a9685acc205f6b92206829e128f62b6d1435e858a3a0d00a1dcc8883fe",
};

describe("the page as it was, byte for byte against the render from d17f9856", () => {
  it("the giving page", () => {
    expect(sha(renderRedBagPage(template, { preview: false }))).toBe(BASELINE.page);
  });

  it("the giving page with a published list", () => {
    expect(sha(renderRedBagPage(template, { preview: false, list: moved() }))).toBe(BASELINE.list);
  });

  it("a staff draft preview", () => {
    expect(sha(renderRedBagPage(template, { preview: false, list: moved(), draft: true }))).toBe(BASELINE.draft);
  });

  it("a staff preview while the page is switched off", () => {
    expect(sha(renderRedBagPage(template, { preview: true }))).toBe(BASELINE.preview);
  });

  it("the thank you page", () => {
    expect(sha(renderRedBagThanksPage(thanks, { preview: false }))).toBe(BASELINE.thanks);
  });

  it("is the same with the night asked for and refused", () => {
    expect(renderRedBagPage(template, { preview: false, night: false })).toBe(renderRedBagPage(template, { preview: false }));
  });
});

describe("what the night adds", () => {
  const plain = renderRedBagPage(template, { preview: false });
  const night = renderRedBagPage(template, { preview: false, night: true });

  it("brings its stylesheet, after the page's own", () => {
    expect(count(night, STYLES)).toBe(1);
    expect(night.indexOf('href="/assets/css/red-bag.css"')).toBeLessThan(night.indexOf(STYLES));
    expect(night.indexOf(STYLES)).toBeLessThan(night.indexOf("</head>"));
  });

  it("brings its script after the catalogue and before the page's own, so it hears the first total", () => {
    expect(count(night, SCRIPT)).toBe(1);
    expect(night.indexOf('src="/assets/js/red-bag-catalogue.js"')).toBeLessThan(night.indexOf(SCRIPT));
    expect(night.indexOf(SCRIPT)).toBeLessThan(night.indexOf('src="/assets/js/red-bag.js"'));
  });

  it("wraps the heading and the list in the night, and nothing below them", () => {
    const open = night.indexOf('id="fnNight"');
    expect(open).toBeGreaterThan(-1);
    expect(open).toBeLessThan(night.indexOf('id="rb-title"'));
    expect(night.indexOf("data-rb-builder")).toBeGreaterThan(open);
    const sky = between(night, 'id="fnNight"', "<!-- After Donate");
    expect(sky).toContain("data-rb-builder");
    expect(sky).not.toContain("data-rb-details");
    expect(sky).not.toContain("data-rb-bar");
    expect(sky).not.toContain("rbBagTemplate");
    expect(night.indexOf('class="fn-ground"')).toBeLessThan(night.indexOf("rb-details-step"));
  });

  it("has the sky, ten lights, the sum, the elf and Pause the snow", () => {
    expect(night).toContain('<canvas class="fn-sky" aria-hidden="true"></canvas>');
    expect(count(night, 'class="bulb"')).toBe(10);
    expect(night).toContain('id="fnSum"');
    expect(night).toContain('id="fnPause"');
    expect(night).toContain(">Pause the snow</button>");
    expect(night).toContain('class="fn-elf"');
  });

  it("keeps the sum for the script to show, so a page that lost its script never shows a wrong one", () => {
    expect(night).toMatch(/<p class="fn-sum" id="fnSum" aria-hidden="true" hidden>/);
  });

  it("keeps Pause the snow out of sight until there is snow to pause", () => {
    expect(night).toMatch(/<button[^>]*id="fnPause"[^>]*hidden/);
    expect(night).not.toMatch(/id="fnPause"[^>]*aria-pressed/);
  });

  // The logo's own elf peeking over the workbench (Jaimie, 6 November 2026): never a new painting.
  it("gives the elf no words of its own, with its size set: the logo's own elf", () => {
    const elf = night.match(/<img class="fn-elf"[^>]*>/)![0];
    expect(elf).toContain('alt=""');
    expect(elf).toContain('src="/assets/img/red-bag/elf-peek.webp"');
    expect(elf).toContain('width="482"');
    expect(elf).toContain('height="331"');
  });

  it("lets the elf speak for the eye only: its bubble is hidden from screen readers", () => {
    expect(night).toMatch(/<p class="fn-says" aria-hidden="true">/);
  });

  it("underlines the heading without changing its words", () => {
    const h1 = night.match(/<h1 id="rb-title">([\s\S]*?)<\/h1>/)![1];
    expect(h1.replace(/<svg[\s\S]*?<\/svg>/, "").replace(/<[^>]+>/g, "")).toBe("Fill a Red Bag");
    expect(count(night, "<h1")).toBe(1);
  });

  it("sits inside <main>, and the skip link and the menu are as they were", () => {
    expect(night.indexOf('<main class="site-main"')).toBeLessThan(night.indexOf('id="fnNight"'));
    expect(between(night, "<body", "<main")).toBe(between(plain, "<body", "<main"));
  });

  it("uses no id twice", () => {
    const ids = [...night.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).filter((id) => !id.startsWith("rb-qty"));
    // The bag's drawing is in the page twice, and carries no ids.
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the money parts are the same in every state", () => {
  const plain = renderRedBagPage(template, { preview: false });
  const night = renderRedBagPage(template, { preview: false, night: true });
  // the elf, what it says (6 November 2026) and the sum are the night's own
  const bare = (html: string) =>
    html.replace(/<img class="fn-elf"[^>]*>/, "").replace(/<p class="fn-says"[\s\S]*?<\/p>/, "").replace(/<p class="fn-sum"[\s\S]*?<\/p>/, "");

  it("the paper, the steppers and Also in your bag", () => {
    expect(between(night, '<div class="rb-paper">', '<div class="rb-need"')).toBe(between(plain, '<div class="rb-paper">', '<div class="rb-need"'));
  });

  it("the examples", () => {
    expect(between(night, '<div class="rb-need"', '<div class="rb-panel"')).toBe(between(plain, '<div class="rb-need"', '<div class="rb-panel"'));
  });

  it("the panel, with its bags, once or monthly, the round-up and Donate, but for the elf and the sum", () => {
    const end = '<p class="rb-real">';
    expect(bare(between(night, '<div class="rb-panel"', end))).toBe(between(plain, '<div class="rb-panel"', end));
  });

  it("the details step, the bottom bar, the template, the payment window and the footer", () => {
    const from = '<section class="section flush-top rb-details-step"';
    expect(night.slice(night.indexOf(from))).toBe(plain.slice(plain.indexOf(from)));
  });

  it("the head, but for the one line", () => {
    const head = (s: string) => s.slice(0, s.indexOf("</head>"));
    expect(lf(head(night)).replace(`    ${STYLES}\n`, "").replace(`${SCRIPT}\n    `, "")).toBe(lf(head(plain)));
  });

  it("the same with a published list", () => {
    const list = moved();
    const a = renderRedBagPage(template, { preview: false, list });
    const b = renderRedBagPage(template, { preview: false, list, night: true });
    expect(between(b, '<div class="rb-paper">', '<div class="rb-panel"')).toBe(between(a, '<div class="rb-paper">', '<div class="rb-panel"'));
    expect(b).toContain('id="rb-list-data"');
    expect(b.indexOf('id="rb-list-data"')).toBeLessThan(b.indexOf('src="/assets/js/red-bag-catalogue.js"'));
  });
});

describe("a page the night cannot find its places on", () => {
  it("is drawn as the plain page, not half dressed", () => {
    const odd = template.replace('<section class="section flush-top rb-details-step"', '<section class="rb-details-step"');
    expect(renderRedBagPage(odd, { preview: false, night: true })).toBe(renderRedBagPage(odd, { preview: false }));
  });

  it("does not read a replacement pattern in anything drawn in", () => {
    const list = moved();
    list.items[0].name = "A $& B $' C";
    expect(renderRedBagPage(template, { preview: false, list, night: true })).toContain("A $&amp; B $&#39; C");
  });
});

describe("through the real site router, either side of the moment", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    const app = express();
    app.use(createSiteRouter(ROOT, { now: () => state.now }));
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  beforeEach(() => {
    state.now = BEFORE;
    state.list = null;
    state.draft = null;
    state.mayView = false;
    state.fillNightNow = false;
  });

  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { redirect: "manual", headers });

  // Jaimie, 6 November 2026: /fill goes out at night (the Workshop, companies' own links) at once,
  // ahead of the rest of the site, which still waits for the Ball's moment.
  describe("with /fill's own night switch on, before the moment", () => {
    beforeEach(() => {
      state.fillNightNow = true;
    });

    it("/fill is the night, with the Workshop, and may still be listed", async () => {
      const res = await get("/fill");
      const html = await res.text();
      expect(html).toContain('id="fnNight"');
      expect(html).toContain('class="fn-workshop"');
      expect(res.status).toBe(200);
      expect(res.headers.get("x-robots-tag")).toBeNull();
    });

    it("leaves the rest of the site waiting: no Fill a Red Bag stage on the home page yet", async () => {
      const home = await body("/");
      state.fillNightNow = false;
      expect(home).toBe(await body("/"));
    });

    it("leaves the thank you page as it is", async () => {
      const on = await body("/fill/thank-you");
      state.fillNightNow = false;
      expect(on).toBe(await body("/fill/thank-you"));
      expect(on).not.toContain("fnNight");
    });
  });
  const body = async (path: string, headers?: Record<string, string>) => (await get(path, headers)).text();
  const heads = (res: Response) => {
    const out: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (!["date", "etag", "content-length", "keep-alive", "connection", "x-powered-by"].includes(k)) out[k] = v;
    });
    return out;
  };

  it("/fill at 19:59:59Z is the plain page, with the headers it always had", async () => {
    const res = await get("/fill");
    const html = await res.text();
    expect(html).not.toContain("fnNight");
    expect(html).not.toContain("fill-night");
    expect(heads(res)).toEqual({ "content-type": "text/html; charset=utf-8" });
  });

  it("/fill at 19:59:59Z is that same page with the menu, and nothing else", async () => {
    const html = lf(await body("/fill"));
    const file = lf(renderRedBagPage(template, { preview: false }));
    // Only the menu's items and the footer's fundraising link are added to it, as on every page.
    const strip = (s: string) => s.replace(/<ul class="nav-links"[\s\S]*?<\/ul>/, "").replace(/<footer[\s\S]*?<\/footer>/, "").replace(/<body[^>]*>/, "").replace(/<style[\s\S]*?<\/style>\s*/g, "");
    expect(strip(html)).toBe(strip(file));
  });

  it("/fill at 20:00:00Z is the night, and may still be listed", async () => {
    state.now = AFTER;
    const res = await get("/fill");
    const html = await res.text();
    expect(html).toContain('id="fnNight"');
    expect(res.status).toBe(200);
    expect(heads(res)).toEqual({ "content-type": "text/html; charset=utf-8" });
  });

  it("is the night on 8 November too", async () => {
    state.now = new Date("2026-11-08T09:00:00Z");
    expect(await body("/fill")).toContain('id="fnNight"');
  });

  it("?at=after-ball shows the night for that view, unlisted and unkept", async () => {
    const res = await get("/fill?at=after-ball");
    expect(await res.text()).toContain('id="fnNight"');
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await body("/fill")).not.toContain("fnNight");
  });

  it("only that exact value counts", async () => {
    for (const q of ["?at=after-ball&at=after-ball", "?at[]=after-ball", "?at=later", "?at="]) {
      expect(await body(`/fill${q}`), q).not.toContain("fnNight");
    }
  });

  it("uses the list published last on the night page", async () => {
    state.now = AFTER;
    state.list = moved();
    const html = await body("/fill");
    expect(html).toContain('id="rb-list-data"');
    expect(html).toContain('id="fnNight"');
  });

  it("a bag in the address changes nothing the server draws", async () => {
    expect(await body("/fill?bag=toy:2,%3Cscript%3E:1")).toBe(await body("/fill"));
  });

  describe("/fill/thank-you", () => {
    it.each([
      ["before the moment", BEFORE, "/fill/thank-you"],
      ["after the moment", AFTER, "/fill/thank-you"],
      ["with ?at=after-ball", BEFORE, "/fill/thank-you?at=after-ball"],
    ])("is left as it is, %s", async (_name, now, path) => {
      state.now = BEFORE;
      const before = await get("/fill/thank-you");
      const was = await before.text();
      state.now = now;
      const res = await get(path);
      const html = await res.text();
      expect(html).not.toContain("fnNight");
      expect(html).not.toContain("fill-night");
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(res.headers.get("cache-control")).toBe(before.headers.get("cache-control"));
      // What the moment does to every page the router draws: the menu's Festive Ball, the footer's link.
      const lines = (s: string) => s.replace(/<ul class="nav-links"[\s\S]*?<\/ul>/, "").replace(/<footer[\s\S]*?<\/footer>/, "");
      expect(lines(html)).toBe(lines(was));
    });
  });

  describe("?preview=draft", () => {
    const AUTH = { Authorization: "Bearer invented-session" };

    it("keeps working before the moment: the draft, never kept and never listed", async () => {
      state.mayView = true;
      const list = moved();
      list.items.find((i: { key: string }) => i.key === "toy").pence = 7777;
      state.draft = list;
      const res = await get("/fill?preview=draft", AUTH);
      const html = await res.text();
      expect(html).toContain(DRAFT_STRIP);
      expect(html).toContain("£77.77");
      expect(html).toContain('data-rb-draft="true"');
      expect(html).not.toContain("fnNight");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    });

    it("keeps working after it, drawn at night, with giving still off", async () => {
      state.now = AFTER;
      state.mayView = true;
      state.draft = moved();
      const res = await get("/fill?preview=draft", AUTH);
      const html = await res.text();
      expect(html).toContain(DRAFT_STRIP);
      expect(html).toContain('id="fnNight"');
      expect(html).not.toContain('id="rbDetailsForm"');
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    });

    it("takes ?at=after-ball alongside it", async () => {
      state.mayView = true;
      state.draft = moved();
      const res = await get("/fill?preview=draft&at=after-ball", AUTH);
      expect(await res.text()).toContain('id="fnNight"');
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    });

    it("keeps the loader on a plain visit, after the moment too", async () => {
      state.now = AFTER;
      expect(await body("/fill?preview=draft")).toContain("/assets/js/red-bag-preview.js");
    });
  });
});
