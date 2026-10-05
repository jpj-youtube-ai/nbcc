// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { DRAFT_OFF_WORDS, DRAFT_STRIP, LIST_DATA_ID, renderRedBagPage, renderRedBagThanksPage } from "../../src/red-bag/render";
import { PREVIEW_LOADER, redBagPageHandler } from "../../src/routes/red-bag";
import { redBagList, type RedBagList } from "../../src/red-bag/list";

// Fill a Red Bag: the PUBLIC page drawn from the list staff published (or, for staff, from the
// draft). With nothing published the page is exactly what it was. With a list: its rows, a block of
// data for the catalogue script saying the same thing, sums that agree with the rows, and nothing
// that can throw for an item the page has never heard of. The draft preview is for staff with the
// section's view access only, never cached, never indexed, and giving is switched off in it.
// Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const L = redBagList();
const template = readFileSync(resolve(ROOT, "fill-a-red-bag.html"), "utf8");
const catalogueSource = readFileSync(resolve(ROOT, "assets/js/red-bag-catalogue.js"), "utf8");
const { initRedBag } = require(resolve(ROOT, "assets/js/red-bag.js")) as {
  initRedBag: (doc: Document, win: unknown, nav?: { assign: (u: string) => void }) => { total: () => number; payload: () => Record<string, unknown> } | null;
};

const NEW_ITEM = "n-selection-box-a1b2c";
const NEW_EXAMPLE = "n-school-bag-9z9z9";

/** A list with one of every kind of change. */
function edited(): RedBagList {
  const l = L.builtIn();
  const item = (key: string) => l.items.find((i) => i.key === key)!;
  const example = (key: string) => l.examples.find((e) => e.key === key)!;
  item("toy").pence = 1200; // a changed price
  item("hat-gloves").hidden = true; // hidden
  item("notebook").group = "home"; // moved
  l.items.push({ key: NEW_ITEM, name: "Selection box", pence: 300, group: "play", art: "present", hidden: false }); // new
  example("crisis-30").pence = 3500; // an edited example
  example("crisis-30").words = "could help with warm bedding for a child";
  example("school-25").hidden = true; // a hidden example
  l.examples.push({ key: NEW_EXAMPLE, theme: "school", pence: 2000, words: "could help with a school bag", art: "present", hidden: false }); // new
  return l;
}

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const rowsOf = (doc: Document) => [...doc.querySelectorAll("[data-rb-item]")].map((r) => [r.getAttribute("data-rb-item"), norm(r.querySelector(".rb-item__name")?.textContent), norm(r.querySelector(".rb-item__price")?.textContent), Number(r.getAttribute("data-pence"))]);
const headingsOf = (doc: Document) => [...doc.querySelectorAll(".rb-group__title")].map((h) => norm(h.textContent)).filter((h) => h !== "Also in your bag");
const blockOf = (doc: Document) => doc.getElementById(LIST_DATA_ID);

/** The catalogue script, run as the browser would run it on this page. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rb = Record<string, any>;
function catalogueFor(doc: Document): Rb {
  const window: Record<string, unknown> = {};
  vm.runInNewContext(catalogueSource, { window, document: { getElementById: (id: string) => doc.getElementById(id) } });
  return window.NBCCRedBag as Rb;
}

describe("with nothing published", () => {
  const today = renderRedBagPage(template, { preview: false });

  // The page as the renderer drew it BEFORE staff could edit the list: main at f8ce4522, rendered
  // from that commit's own src/red-bag/render.ts, catalogue and fill-a-red-bag.html (not from the
  // code under test), with line endings as the repository stores them (LF). Pinned by length and
  // SHA-256, so any change to the no-list path, however small, is caught here.
  // IF THIS FAILS because the page's template, the built-in list or the fixed wording was changed
  // on purpose: check that nothing else moved, then re-pin both from the new output.
  const AS_IT_WAS = {
    public: { bytes: 42784, sha256: "1b78a4f3eb7513aea917760677a5420d5cdf216261c767f3ae6814b37744c97d" },
    staffPreview: { bytes: 42931, sha256: "1438acb71763712193f0259119a933f934edb56c47f0066e6d508780f60d66a0" },
  };
  const measure = (html: string) => ({ bytes: Buffer.byteLength(html, "utf8"), sha256: createHash("sha256").update(html, "utf8").digest("hex") });
  const stored = template.replace(/\r\n/g, "\n");

  it("is byte for byte the page main drew before any of this: the public page", () => {
    expect(measure(renderRedBagPage(stored, { preview: false }))).toEqual(AS_IT_WAS.public);
    expect(measure(renderRedBagPage(stored, { preview: false, list: null }))).toEqual(AS_IT_WAS.public);
    expect(measure(renderRedBagPage(stored, { preview: false, list: undefined, draft: false }))).toEqual(AS_IT_WAS.public);
  });

  it("is byte for byte the page main drew before any of this: the staff preview while switched off", () => {
    expect(measure(renderRedBagPage(stored, { preview: true }))).toEqual(AS_IT_WAS.staffPreview);
    expect(measure(renderRedBagPage(stored, { preview: true, list: null }))).toEqual(AS_IT_WAS.staffPreview);
  });

  it("is the same page whether no list is handed over or none is named, with no block of data", () => {
    expect(renderRedBagPage(template, { preview: false, list: null })).toBe(today);
    expect(renderRedBagPage(template, { preview: false, list: undefined })).toBe(today);
    expect(today).not.toContain(LIST_DATA_ID);
    expect(today).not.toContain("Draft preview");
    expect(rowsOf(parse(today)).length).toBe(13);
  });

  it("the thank you page takes no list and is unchanged", () => {
    const thanks = readFileSync(resolve(ROOT, "fill-thank-you.html"), "utf8");
    const html = renderRedBagThanksPage(thanks, { preview: false });
    expect(html).not.toContain(LIST_DATA_ID);
    // It uses the catalogue's constants only: the script it loads still has every one of them.
    expect(html).toContain("/assets/js/red-bag-catalogue.js");
  });
});

describe("with an edited list published", () => {
  const html = renderRedBagPage(template, { preview: false, list: edited() });
  const doc = parse(html);

  it("draws the list's rows: the new price, the new item, the moved item under its new heading, and not the hidden one", () => {
    expect(rowsOf(doc)).toEqual([
      ["blanket", "Blanket", "£8", 800],
      ["insulated-cup", "Insulated cup", "£7", 700],
      ["toiletry-set", "Toiletry & fragrance gift set", "£5", 500],
      ["notebook", "Notebook", "£1", 100],
      ["toy", "Toy", "£12", 1200],
      ["soft-toy", "Soft toy", "£4", 400],
      ["headphones", "Headphones", "£9", 900],
      [NEW_ITEM, "Selection box", "£3", 300],
      ["book", "Book", "£3", 300],
      ["colouring-book", "Colouring book", "£2", 200],
      ["pencil", "Pencil", "10p", 10],
      ["pyjamas", "Pyjamas (ages 13 & under)", "£5", 500],
      ["socks", "Socks (pair)", "£1", 100],
    ]);
    const home = doc.getElementById("rb-group-home")!.parentElement!;
    expect([...home.querySelectorAll("[data-rb-item]")].map((r) => r.getAttribute("data-rb-item"))).toContain("notebook");
    expect(html).not.toContain("Hat &amp; gloves");
  });

  it("gives the new item's row everything a row has: a labelled stepper and a number box", () => {
    const row = doc.querySelector(`[data-rb-item="${NEW_ITEM}"]`)!;
    expect(row.querySelector("[data-rb-minus]")!.getAttribute("aria-label")).toBe("Take one away: Selection box");
    expect(row.querySelector("[data-rb-plus]")!.getAttribute("aria-label")).toBe("Add one: Selection box");
    const box = row.querySelector("input.rb-qty")!;
    expect(doc.querySelector(`label[for="${box.id}"]`)!.textContent).toBe("How many: Selection box");
  });

  it("draws the examples: the edited one, the new one with its picture, and not the hidden one", () => {
    const buttons = [...doc.querySelectorAll("[data-rb-example]")];
    expect(buttons.map((b) => [b.getAttribute("data-rb-example"), Number(b.getAttribute("data-pence")), norm(b.textContent)])).toEqual([
      ["crisis-15", 1500, "£15 could help replace a child's favourite cuddly toy"],
      ["crisis-30", 3500, "£35 could help with warm bedding for a child"],
      ["crisis-60", 6000, "£60 could help a family with kitchen basics to start again"],
      ["school-35", 3500, "£35 could help keep a child warm with a winter coat"],
      ["school-40", 4000, "£40 could help a child start school in a uniform that fits"],
      [NEW_EXAMPLE, 2000, "£20 could help with a school bag"],
      ["hand-20", 2000, "£20 could help with toiletries and warm clothes in a hard moment"],
      ["hand-75", 7500, "£75 could help a young person take their first step into their own business"],
      ["hand-150", 15000, "£150 could help towards a bed or cooker for someone moving into a home with nothing"],
    ]);
    const fresh = doc.querySelector(`[data-rb-example="${NEW_EXAMPLE}"]`)!;
    expect(fresh.querySelector("svg.rb-example__icon")).toBeTruthy();
    for (const b of buttons) expect(norm(b.textContent)).toMatch(/^(£[\d,.]+|\d+p) could help \S/);
  });

  it("keeps the four headings and three themes as they are written, in their order", () => {
    expect(headingsOf(doc)).toEqual(["Home comforts", "Play & downtime", "Books & creativity", "Clothing"]);
    expect([...doc.querySelectorAll(".rb-theme h3")].map((h) => norm(h.textContent))).toEqual(["After a crisis", "Clothing & school", "A hand at rock bottom"]);
    expect([...doc.querySelectorAll(".rb-theme__sub")].map((h) => norm(h.textContent))).toEqual(["Helping families start again", "When families can't stretch to it", "When it matters most"]);
  });

  it("is the public page in every other way: no strip, indexable, the checkout's form in place", () => {
    expect(html).not.toContain("rb-preview");
    expect(html).not.toContain("noindex");
    expect(doc.body.hasAttribute("data-rb-draft")).toBe(false);
    expect(doc.body.hasAttribute("data-rb-preview")).toBe(false);
    expect(doc.getElementById("rbDetailsForm")).toBeTruthy();
    expect(doc.querySelectorAll("h1").length).toBe(1);
  });

  it("carries the list as a block of data that is not a script to run, and cannot end early", () => {
    const block = blockOf(doc)!;
    expect(block.tagName).toBe("SCRIPT");
    expect(block.getAttribute("type")).toBe("application/json");
    expect(JSON.parse(block.textContent ?? "")).toEqual(L.toCatalogue(edited()));
    expect(html.match(new RegExp(`id="${LIST_DATA_ID}"`, "g"))).toHaveLength(1);
    // Before the catalogue script that reads it.
    expect(html.indexOf(`id="${LIST_DATA_ID}"`)).toBeLessThan(html.indexOf("/assets/js/red-bag-catalogue.js"));
  });

  it("the catalogue script, reading that block, agrees with every row on the page", () => {
    const rb = catalogueFor(doc);
    expect(rb.items().map((i: { key: string; pence: number }) => [i.key, i.pence])).toEqual(rowsOf(doc).map((r) => [r[0], r[3]]));
    expect(rb.examples().map((e: { key: string; pence: number }) => [e.key, e.pence])).toEqual(
      [...doc.querySelectorAll("[data-rb-example]")].map((b) => [b.getAttribute("data-rb-example"), Number(b.getAttribute("data-pence"))]),
    );
  });

  it("keeps totals, the round-up and the bags right with the new prices", () => {
    const rb = catalogueFor(doc);
    const one = Object.fromEntries(rb.items().map((i: { key: string }) => [i.key, 1]));
    // One of everything showing: £64.10 as built in, less £3 off the toy, less the £4 hat, plus the £3 box.
    expect(rb.totalPence(one, [])).toBe(6410 - 300 - 400 + 300);
    expect(rb.totalPence({ toy: 2, [NEW_ITEM]: 1, "hat-gloves": 5 }, ["crisis-30", NEW_EXAMPLE, "school-25"])).toBe(2400 + 300 + 3500 + 2000);
    expect(rb.roundUpOffer(2400)).toEqual({ target: 2500, add: 100, words: "Round up to half a bag" });
    expect(rb.roundUpPence(2400, 2500)).toBe(100);
    expect(rb.bags(rb.totalPence({ toy: 5 }, [])).drawn).toEqual([1, 0.2]);
    expect(rb.statusLine(rb.totalPence({ toy: 5 }, []))).toBe("That's around the value of a whole Red Bag Full of Joy. Another one is filling.");
  });
});

describe("a heading or a theme with nothing showing", () => {
  it("is not drawn, and the rest are", () => {
    const l = edited();
    for (const i of l.items) if (i.group === "clothing") i.hidden = true;
    for (const e of l.examples) if (e.theme === "hand") e.hidden = true;
    const doc = parse(renderRedBagPage(template, { preview: false, list: l }));
    expect(headingsOf(doc)).toEqual(["Home comforts", "Play & downtime", "Books & creativity"]);
    expect(doc.getElementById("rb-group-clothing")).toBeNull();
    expect([...doc.querySelectorAll(".rb-theme h3")].map((h) => norm(h.textContent))).toEqual(["After a crisis", "Clothing & school"]);
    expect(catalogueFor(doc).GROUPS.length).toBe(3);
  });

  it("with no example showing at all, the whole Whenever the need comes part is put away", () => {
    const l = edited();
    for (const e of l.examples) e.hidden = true;
    const doc = parse(renderRedBagPage(template, { preview: false, list: l }));
    expect(doc.querySelectorAll("[data-rb-example]").length).toBe(0);
    expect(doc.querySelector("[data-rb-need]")!.hasAttribute("hidden")).toBe(true);
    // And it is there, as ever, when there are examples.
    expect(parse(renderRedBagPage(template, { preview: false, list: edited() })).querySelector("[data-rb-need]")!.hasAttribute("hidden")).toBe(false);
  });
});

describe("whatever a list holds, nothing in it is ever markup", () => {
  it("escapes a name and an example's words (the rules refuse these; the page would be safe anyway)", () => {
    const l = edited();
    l.items[0].name = 'Blanket"><img src=x onerror=alert(1)>';
    l.examples[0].words = "could help </script><script>alert(1)</script>";
    const html = renderRedBagPage(template, { preview: false, list: l });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(1)");
    const doc = parse(html);
    expect(doc.querySelectorAll("img[src=x]").length).toBe(0);
    expect(JSON.parse(blockOf(doc)!.textContent ?? "").groups[0].items[0].name).toBe('Blanket"><img src=x onerror=alert(1)>');
  });
});

// --- the page's own script, on a page drawn from the edited list ----------------------------------

function start(html: string, kept: Record<string, string> = {}) {
  const parsed = parse(html);
  document.body.innerHTML = parsed.body.innerHTML;
  for (const name of ["data-rb-preview", "data-rb-draft"]) {
    const v = parsed.body.getAttribute(name);
    if (v === null) document.body.removeAttribute(name);
    else document.body.setAttribute(name, v);
  }
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ url: "https://checkout.stripe.test/pay" }) }));
  const nav = { assign: vi.fn() };
  const store = new Map(Object.entries(kept));
  const win = {
    NBCCRedBag: catalogueFor(parsed),
    addEventListener: () => undefined,
    fetch: fetchMock,
    location: { href: "", pathname: "/fill", search: "" },
    history: { replaceState: vi.fn() },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    matchMedia: () => ({ matches: false }),
    navigator: {},
  };
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const api = initRedBag(document, win, nav);
  return { api: api!, fetchMock, nav, errors };
}
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const plus = (key: string, times = 1) => {
  for (let i = 0; i < times; i += 1) ($(`[data-rb-item="${key}"] [data-rb-plus]`) as HTMLButtonElement).click();
};
const text = (sel: string) => norm($(sel)?.textContent);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the page's script on the edited list", () => {
  it("adds up the new item and the new price, and names the total on Donate", () => {
    const { api } = start(renderRedBagPage(template, { preview: false, list: edited() }));
    plus(NEW_ITEM, 2);
    plus("toy");
    expect(api.total()).toBe(600 + 1200);
    expect(text("[data-rb-total]")).toBe("£18");
    expect(text("[data-rb-donate]")).toBe("Donate £18");
    ($(`[data-rb-example="${NEW_EXAMPLE}"]`) as HTMLButtonElement).click();
    expect(api.total()).toBe(600 + 1200 + 2000);
    expect(text("[data-rb-also-list]")).toContain("£20 could help with a school bag");
  });

  it("the feel good layer never throws for an item it has never heard of: drops, peeks and notes carry on", () => {
    vi.useFakeTimers();
    const { api, errors } = start(renderRedBagPage(template, { preview: false, list: edited() }));
    expect(() => {
      plus(NEW_ITEM, 12);
      vi.advanceTimersByTime(5000);
      ($(`[data-rb-item="${NEW_ITEM}"] [data-rb-minus]`) as HTMLButtonElement).click();
      plus("toy", 3);
      ($(`[data-rb-example="${NEW_EXAMPLE}"]`) as HTMLButtonElement).click();
      vi.advanceTimersByTime(5000);
    }).not.toThrow();
    expect(api.total()).toBe(11 * 300 + 3 * 1200 + 2000);
    // Nothing went wrong quietly either: the layer says so in the console when it swallows a fault.
    expect(errors).not.toHaveBeenCalled();
  });

  it("the new item peeks from the bag as its chosen picture", () => {
    const { api } = start(renderRedBagPage(template, { preview: false, list: edited() }));
    plus(NEW_ITEM, 3);
    expect(api.total()).toBe(900);
    const peek = document.querySelector(`[data-rb-peek="${NEW_ITEM}"]`);
    expect(peek).toBeTruthy();
    expect(peek!.innerHTML).toContain("<svg");
  });

  it("sends the checkout the total and no items, exactly as before", async () => {
    const { api, fetchMock } = start(renderRedBagPage(template, { preview: false, list: edited() }));
    plus(NEW_ITEM, 1);
    plus("toy", 1);
    ($("[data-rb-donate]") as HTMLButtonElement).click();
    const payload = api.payload();
    expect(payload.amount).toBe(1500);
    expect(JSON.stringify(payload)).not.toContain(NEW_ITEM);
    expect(JSON.stringify(payload)).not.toContain("Selection box");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// --- the draft preview -----------------------------------------------------------------------------

describe("the draft preview, as it is drawn", () => {
  const html = renderRedBagPage(template, { preview: false, list: edited(), draft: true });
  const doc = parse(html);

  it("has a plain strip saying what it is", () => {
    expect(DRAFT_STRIP).toBe('<p class="rb-preview" role="note">Draft preview: not on the website yet</p>');
    expect(norm(doc.querySelector(".rb-preview")?.textContent)).toBe("Draft preview: not on the website yet");
    expect(html).not.toContain("Staff preview: not public yet");
  });

  it("shows the draft's list", () => {
    expect(rowsOf(doc).some((r) => r[0] === NEW_ITEM)).toBe(true);
    expect(JSON.parse(blockOf(doc)!.textContent ?? "")).toEqual(L.toCatalogue(edited()));
  });

  it("is never indexed", () => {
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
  });

  it("is marked as a draft, and NOT as the staff preview that may take a gift", () => {
    expect(doc.body.getAttribute("data-rb-draft")).toBe("true");
    expect(doc.body.hasAttribute("data-rb-preview")).toBe(false);
  });

  it("has no details form at all: there is nothing to send a gift with", () => {
    expect(doc.getElementById("rbDetailsForm")).toBeNull();
    expect(doc.querySelector("[data-rb-pay]")).toBeNull();
    expect(html).not.toContain("rbFirstName");
    expect(norm(doc.querySelector("[data-rb-details]")?.textContent)).toContain(DRAFT_OFF_WORDS);
    expect(DRAFT_OFF_WORDS).toBe("This is a preview. Giving is switched off here.");
  });

  it("draws the website's list under the strip when there is no draft to show", () => {
    const none = parse(renderRedBagPage(template, { preview: false, list: null, draft: true }));
    expect(norm(none.querySelector(".rb-preview")?.textContent)).toBe("Draft preview: not on the website yet");
    expect(rowsOf(none).length).toBe(13);
    expect(none.getElementById("rbDetailsForm")).toBeNull();
  });
});

describe("giving is switched off in the draft preview", () => {
  const draftPage = () => start(renderRedBagPage(template, { preview: false, list: edited(), draft: true }), { nbcc_admin_token: "a.staff.token" });

  it("Donate does nothing but say so, however much is in the bag", () => {
    const { fetchMock, nav } = draftPage();
    plus("toy", 3);
    ($("[data-rb-donate]") as HTMLButtonElement).click();
    const said = $("[data-rb-nudge]");
    expect(said.hidden).toBe(false);
    expect(norm(said.textContent)).toBe("This is a preview. Giving is switched off here.");
    expect($("[data-rb-details]").hidden).toBe(true);
    expect($("[data-rb-builder]").hidden).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(nav.assign).not.toHaveBeenCalled();
  });

  it("says the same with an empty bag, and from the bottom bar's Donate", () => {
    const { fetchMock } = draftPage();
    ($("[data-rb-donate]") as HTMLButtonElement).click();
    expect(norm($("[data-rb-nudge]").textContent)).toBe("This is a preview. Giving is switched off here.");
    plus("toy", 1);
    ($("[data-rb-bar-donate]") as HTMLButtonElement).click();
    expect($("[data-rb-nudge]").hidden).toBe(false);
    expect($("[data-rb-details]").hidden).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps saying it: adding more to the bag does not put the message away for good", () => {
    draftPage();
    plus("toy", 3);
    ($("[data-rb-donate]") as HTMLButtonElement).click();
    plus("toy", 1);
    ($("[data-rb-donate]") as HTMLButtonElement).click();
    expect($("[data-rb-nudge]").hidden).toBe(false);
    expect(norm($("[data-rb-nudge]").textContent)).toBe("This is a preview. Giving is switched off here.");
  });

  it("everything else works, so the list can be tried: the total, the bags, the examples", () => {
    const { api } = draftPage();
    plus(NEW_ITEM, 2);
    ($(`[data-rb-example="${NEW_EXAMPLE}"]`) as HTMLButtonElement).click();
    expect(api.total()).toBe(2600);
    expect(text("[data-rb-total]")).toBe("£26");
  });

  it("the public page, and the page with nothing published, still go on to the details step", () => {
    start(renderRedBagPage(template, { preview: false, list: edited() }));
    plus("toy", 1);
    ($("[data-rb-donate]") as HTMLButtonElement).click();
    expect($("[data-rb-details]").hidden).toBe(false);
    start(renderRedBagPage(template, { preview: false }));
    plus("toy", 1);
    ($("[data-rb-donate]") as HTMLButtonElement).click();
    expect($("[data-rb-details]").hidden).toBe(false);
  });
});

// --- who is given which list ----------------------------------------------------------------------

type Asked = { query?: Record<string, string>; authorization?: string; published?: RedBagList | null | Error; draft?: RedBagList | null | Error; mayView?: boolean | Error; live?: boolean; staff?: boolean };
async function ask(o: Asked = {}) {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    status(c: number) { this.statusCode = c; return this; },
    setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; return this; },
    type() { return this; },
    send(b: string) { this.body = b; return this; },
  };
  const give = <T,>(v: T | Error) => async () => {
    if (v instanceof Error) throw v;
    return v;
  };
  const list = vi.fn(give(o.published ?? null));
  const draft = vi.fn(give(o.draft === undefined ? edited() : o.draft));
  const mayViewDraft = vi.fn(give(o.mayView ?? false));
  const next = vi.fn();
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const handler = redBagPageHandler({
    template: () => template,
    notFound: () => "<html><head></head><body>We cannot find that page</body></html>",
    decorate: async (h) => h,
    live: () => o.live ?? true,
    isStaff: async () => o.staff === true,
    indexable: true,
    list,
    draft,
    mayViewDraft,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await handler({ headers: { authorization: o.authorization }, query: o.query ?? {} } as any, res as any, next);
  const logged = log.mock.calls.length;
  log.mockRestore();
  return { res, doc: parse(res.body), list, draft, mayViewDraft, next, logged };
}
const DRAFT = { preview: "draft" };
const published = () => {
  const l = L.builtIn();
  l.items.find((i) => i.key === "toy")!.pence = 1000;
  return l;
};
const toyPrice = (doc: Document) => norm(doc.querySelector('[data-rb-item="toy"] .rb-item__price')?.textContent);

describe("GET /fill and the list", () => {
  it("draws the built-in list when nothing is published, with nothing added to the page", async () => {
    const { res, draft, mayViewDraft } = await ask();
    expect(res.body).toBe(renderRedBagPage(template, { preview: false }));
    expect(res.headers["cache-control"]).toBeUndefined();
    expect(res.headers["x-robots-tag"]).toBeUndefined();
    expect(draft).not.toHaveBeenCalled();
    expect(mayViewDraft).not.toHaveBeenCalled();
  });

  it("draws the published list for everyone", async () => {
    const { res, doc } = await ask({ published: published() });
    expect(toyPrice(doc)).toBe("£10");
    expect(res.body).not.toContain("rb-preview");
    expect(res.body).not.toContain("red-bag-preview.js");
    expect(res.headers["x-robots-tag"]).toBeUndefined();
  });

  it("still answers, with the built-in list, if the list cannot be read at all", async () => {
    const { res, next } = await ask({ published: new Error("database down") });
    expect(res.statusCode).toBe(200);
    expect(rowsOf(parse(res.body)).length).toBe(13);
    expect(next).not.toHaveBeenCalled();
  });

  it("works for a request with no query at all (as the page was asked for before)", async () => {
    const res = { statusCode: 200, headers: {} as Record<string, string>, body: "", status(c: number) { this.statusCode = c; return this; }, setHeader() { return this; }, type() { return this; }, send(b: string) { this.body = b; return this; } };
    const handler = redBagPageHandler({ template: () => template, notFound: () => "", decorate: async (h) => h, live: () => true, indexable: true, list: async () => null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({ headers: {} } as any, res as any, vi.fn());
    expect(res.body).toContain("Pop these in the bag");
  });
});

describe("GET /fill?preview=draft", () => {
  it("a plain visit gets the ordinary published page, plus the small loader, and nobody is asked who they are", async () => {
    const { res, doc, draft, mayViewDraft } = await ask({ query: DRAFT, published: published() });
    expect(toyPrice(doc)).toBe("£10");
    expect(res.body).not.toContain("Draft preview");
    expect(res.body).toContain(PREVIEW_LOADER.trim());
    expect(doc.getElementById("rbDetailsForm")).toBeTruthy();
    expect(doc.body.hasAttribute("data-rb-draft")).toBe(false);
    expect(draft).not.toHaveBeenCalled();
    expect(mayViewDraft).not.toHaveBeenCalled();
  });

  it("is never cached and never indexed, plain visit or not, because one address answers two ways", async () => {
    for (const o of [{ query: DRAFT }, { query: DRAFT, authorization: "Bearer t", mayView: true }, { query: DRAFT, authorization: "Bearer t", mayView: false }]) {
      const { res } = await ask(o);
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(res.headers.vary).toBe("Authorization");
      expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    }
  });

  it("staff with view access to the section get the draft, under the strip, with giving switched off", async () => {
    const { res, doc, mayViewDraft } = await ask({ query: DRAFT, authorization: "Bearer good", mayView: true, published: published() });
    expect(mayViewDraft).toHaveBeenCalledWith("Bearer good");
    expect(norm(doc.querySelector(".rb-preview")?.textContent)).toBe("Draft preview: not on the website yet");
    expect(toyPrice(doc)).toBe("£12");
    expect(rowsOf(doc).some((r) => r[0] === NEW_ITEM)).toBe(true);
    expect(doc.body.getAttribute("data-rb-draft")).toBe("true");
    expect(doc.getElementById("rbDetailsForm")).toBeNull();
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
    // Never the loader again: the page it brings in must not go and fetch itself.
    expect(res.body).not.toContain("red-bag-preview.js");
  });

  it("someone signed in WITHOUT the section gets the published page, no draft, and is not looped", async () => {
    const { res, doc, draft } = await ask({ query: DRAFT, authorization: "Bearer other", mayView: false, published: published() });
    expect(toyPrice(doc)).toBe("£10");
    expect(res.body).not.toContain("Draft preview");
    expect(res.body).not.toContain(NEW_ITEM);
    expect(res.body).not.toContain("red-bag-preview.js");
    expect(draft).not.toHaveBeenCalled();
  });

  it("fails closed if it cannot tell who is asking", async () => {
    const { res, doc, draft } = await ask({ query: DRAFT, authorization: "Bearer good", mayView: new Error("database down"), published: published() });
    expect(res.statusCode).toBe(200);
    expect(toyPrice(doc)).toBe("£10");
    expect(res.body).not.toContain("Draft preview");
    expect(draft).not.toHaveBeenCalled();
  });

  it("shows the website's list under the strip when there is no draft", async () => {
    const { doc } = await ask({ query: DRAFT, authorization: "Bearer good", mayView: true, published: published(), draft: null });
    expect(norm(doc.querySelector(".rb-preview")?.textContent)).toBe("Draft preview: not on the website yet");
    expect(toyPrice(doc)).toBe("£10");
    expect(doc.getElementById("rbDetailsForm")).toBeNull();
  });

  it("falls back to the published page, with no strip, if the draft cannot be read or fails the rules", async () => {
    const bad = edited();
    bad.items[0].pence = 1;
    for (const draft of [new Error("database down"), bad]) {
      const { res, doc } = await ask({ query: DRAFT, authorization: "Bearer good", mayView: true, published: published(), draft });
      expect(res.statusCode).toBe(200);
      expect(toyPrice(doc)).toBe("£10");
      expect(res.body).not.toContain("Draft preview");
      expect(res.body).not.toContain("red-bag-preview.js");
    }
  });

  it("any other value of preview is just the public page", async () => {
    const { res, mayViewDraft } = await ask({ query: { preview: "yes" }, authorization: "Bearer good", mayView: true, published: published() });
    expect(res.body).not.toContain("Draft preview");
    expect(res.headers["cache-control"]).toBeUndefined();
    expect(mayViewDraft).not.toHaveBeenCalled();
  });

  it("an Authorization header on the ordinary address changes nothing", async () => {
    const { res, mayViewDraft } = await ask({ authorization: "Bearer good", mayView: true, published: published() });
    expect(res.body).not.toContain("Draft preview");
    expect(mayViewDraft).not.toHaveBeenCalled();
  });

  it("while the page is switched off, the public still gets the 404 at this address", async () => {
    const { res } = await ask({ query: DRAFT, live: false, staff: false });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("We cannot find that page");
  });
});
