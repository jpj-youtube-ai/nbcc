// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { redBag } from "../../src/red-bag/catalogue";
import { DROP_OFF_LIVE, DROP_OFF_URL, PREVIEW_STRIP, renderRedBagPage } from "../../src/red-bag/render";
import { redBagPageHandler } from "../../src/routes/red-bag";
import { ALL_PAGES, PRIVATE_PAGES, RESERVED_PREFIXES, SITE_PAGES, aliasFromProblem, renderSitemapTree, renderSitemapXml } from "../../src/site/pages";
import { ALL_DONATIONS_WORDING, SINGLE_DONATION_WORDING } from "../../src/declarations/wording";

// Fill a Red Bag: the page as the server draws it (fill-a-red-bag.html, with the list, the themes
// and the details step drawn in by src/red-bag/render.ts), and who is given it
// (src/routes/red-bag.ts). The page is checked AS DRAWN, the way a fundraiser's page is, against the
// same house rules the sitewide guards hold the static pages to: copy-rules, accessibility, footer.
// Nothing here touches a database.

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const template = read("fill-a-red-bag.html");
const css = read("assets/css/red-bag.css");
const rb = redBag();
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const html = renderRedBagPage(template, { preview: false });
const doc = new DOMParser().parseFromString(html, "text/html");
const main = doc.querySelector("main")!;

/** The copy a person reads or hears, as test/unit/copy-rules.test.ts takes it. */
function visibleCopy(source: string, without: string[] = []): string {
  const d = new DOMParser().parseFromString(source, "text/html");
  d.body.querySelectorAll(["script", "style", "svg", "template", ...without].join(",")).forEach((el) => el.remove());
  const parts: string[] = [d.body.textContent ?? ""];
  for (const attr of ["alt", "title", "aria-label", "placeholder"]) {
    for (const el of d.body.querySelectorAll(`[${attr}]`)) parts.push(el.getAttribute(attr) ?? "");
  }
  return parts.join("  ").replace(/\s+/g, " ").trim();
}

describe("the list on the paper", () => {
  it("is in the page itself, so it reads without JavaScript", () => {
    for (const item of rb.items()) {
      const row = main.querySelector(`[data-rb-item="${item.key}"]`);
      expect(row, item.key).not.toBeNull();
      expect(norm(row!.querySelector(".rb-item__name")?.textContent)).toBe(item.name);
      expect(norm(row!.querySelector(".rb-item__price")?.textContent)).toBe(rb.pounds(item.pence));
      expect(row!.getAttribute("data-pence")).toBe(String(item.pence));
    }
    expect(main.querySelectorAll("[data-rb-item]").length).toBe(13);
  });

  it("uses the sheet's own headings, exactly", () => {
    const headings = [...main.querySelectorAll(".rb-group > .rb-group__title")].map((h) => norm(h.textContent));
    expect(headings).toEqual(["Home comforts", "Play & downtime", "Books & creativity", "Clothing"]);
  });

  it("gives every row a labelled number box and two labelled buttons", () => {
    for (const item of rb.items()) {
      const row = main.querySelector(`[data-rb-item="${item.key}"]`)!;
      const input = row.querySelector("input")!;
      expect(input.id).toBe(`rb-qty-${item.key}`);
      expect(input.getAttribute("inputmode")).toBe("numeric");
      expect(input.getAttribute("value")).toBe("0");
      expect(norm(doc.querySelector(`label[for="${input.id}"]`)?.textContent)).toBe(`How many: ${item.name}`);
      const minus = row.querySelector("[data-rb-minus]")!;
      const plus = row.querySelector("[data-rb-plus]")!;
      expect(minus.getAttribute("aria-label")).toBe(`Take one away: ${item.name}`);
      expect(plus.getAttribute("aria-label")).toBe(`Add one: ${item.name}`);
      expect(minus.getAttribute("type")).toBe("button");
      expect(plus.getAttribute("type")).toBe("button");
    }
  });
});

describe("beside the list", () => {
  it("draws one empty bag, for the eye only", () => {
    const bags = main.querySelector("[data-rb-bags]")!;
    expect(bags.getAttribute("aria-hidden")).toBe("true");
    expect(bags.querySelectorAll("svg.rb-bag").length).toBe(1);
    expect(doc.querySelector("template#rbBagTemplate")).not.toBeNull();
  });

  it("says the status and the total out loud as they change", () => {
    const status = main.querySelector("[data-rb-status]")!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(norm(status.textContent)).toBe("Your bag is empty. Pop something in.");
    const total = main.querySelector("[data-rb-total]")!;
    expect(total.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
    expect(norm(total.textContent)).toBe("£0");
  });

  it("has the monthly tick, one Donate button and the nudge", () => {
    expect(norm(doc.querySelector('label[for="rbMonthly"]')?.textContent)).toBe("Fill this bag every month");
    const buttons = main.querySelectorAll("[data-rb-donate]");
    expect(buttons.length).toBe(1);
    expect(norm(buttons[0].textContent)).toBe("Donate");
    expect(buttons[0].hasAttribute("disabled")).toBe(false);
    const nudge = main.querySelector("[data-rb-nudge]")!;
    expect(norm(nudge.textContent)).toBe("Add a little more to reach £2. Maybe some socks?");
    expect(nudge.hasAttribute("hidden")).toBe(true);
  });

  it("has the elves line word for word, near the Donate button", () => {
    const panel = main.querySelector(".rb-panel")!;
    expect(norm(panel.querySelector(".rb-elves")?.textContent)).toBe(
      "Our elves use your gift wherever it's needed most, so the items are a taste of what it could do, not a shopping list.",
    );
    expect(panel.querySelector("[data-rb-donate]")).not.toBeNull();
  });

  it("points to the donate page when JavaScript is off, and keeps the working parts hidden until it is on", () => {
    const nojs = main.querySelector("[data-nojs]")!;
    expect(nojs.querySelector('a[href="/donate"]')).not.toBeNull();
    expect(main.querySelector("[data-rb-donate]")!.closest("[data-needs-js]")?.hasAttribute("hidden")).toBe(true);
  });
});

describe("whenever the need comes", () => {
  it("has the four themes as plain groups, three examples each", () => {
    const themes = [...main.querySelectorAll(".rb-theme")];
    expect(themes.map((t) => norm(t.querySelector("h3")?.textContent))).toEqual(rb.THEMES.map((t) => t.title));
    expect(themes.map((t) => norm(t.querySelector(".rb-theme__sub")?.textContent))).toEqual(rb.THEMES.map((t) => t.sub));
    for (const t of themes) {
      expect(t.querySelectorAll("button[data-rb-example]").length).toBe(3);
      expect(t.getAttribute("role")).toBe("group");
      expect(doc.getElementById(t.getAttribute("aria-labelledby") ?? "")).toBe(t.querySelector("h3"));
    }
  });

  it("makes each example a button that says whether it is in the bag", () => {
    for (const e of rb.examples()) {
      const b = main.querySelector(`button[data-rb-example="${e.key}"]`)!;
      expect(b.getAttribute("aria-pressed")).toBe("false");
      expect(b.getAttribute("type")).toBe("button");
      expect(norm(b.textContent)).toBe(`${rb.pounds(e.pence)} ${e.words}`);
    }
  });

  it("keeps a place on the paper for what is tapped: Also in your bag", () => {
    const also = main.querySelector("[data-rb-also]")!;
    expect(also.closest(".rb-paper")).not.toBeNull();
    expect(also.hasAttribute("hidden")).toBe(true);
    expect(norm(also.querySelector("h3")?.textContent)).toBe("Also in your bag");
  });
});

describe("prefer to give the real thing", () => {
  it("keeps the drop off address in one constant, not yet live", () => {
    expect(DROP_OFF_URL).toBe("https://drop.nbcc.scot");
    expect(DROP_OFF_LIVE).toBe(false);
  });

  it("shows the note without the link until it is, with the phone number the site prints", () => {
    const note = main.querySelector(".rb-real")!;
    expect(norm(note.textContent)).toContain("Prefer to give the real thing?");
    expect(html).not.toContain("drop.nbcc.scot");
    expect(note.querySelector('a[href="tel:+441292811015"]')?.textContent).toBe("01292 811 015");
    expect(read("contact.html")).toContain('href="tel:+441292811015"');
  });

  it("links to it once it is", () => {
    const live = renderRedBagPage(template, { preview: false, dropOffLive: true });
    expect(live).toContain('href="https://drop.nbcc.scot"');
  });
});

describe("the details step", () => {
  const step = main.querySelector("[data-rb-details]")!;

  it("waits, hidden, until Donate is pressed", () => {
    expect(step.hasAttribute("hidden")).toBe(true);
    expect(step.querySelector("form#rbDetailsForm")).not.toBeNull();
  });

  it("asks what the fundraiser page's give form asks", () => {
    for (const id of ["rbFirstName", "rbSurname", "rbEmail", "rbEmailConsent", "rbGiftAid", "rbHouse", "rbAddress", "rbPostcode", "rbNonUk", "rbCoverFee"]) {
      expect(step.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(norm(step.textContent)).toContain("Add me to our donor newsletter.");
    expect(norm(step.textContent)).toContain("to cover the card fee.");
    expect(norm(step.textContent)).toContain("Yes, add Gift Aid. I am a UK taxpayer.");
  });

  it("shows HMRC's declaration word for word: this donation for a one off, all donations for monthly", () => {
    expect(norm(step.querySelector('[data-rb-wording="once"]')?.textContent)).toBe(SINGLE_DONATION_WORDING.wording_snapshot);
    const monthly = step.querySelector('[data-rb-wording="monthly"]')!;
    expect(norm(monthly.textContent)).toBe(ALL_DONATIONS_WORDING.wording_snapshot);
    expect(monthly.hasAttribute("hidden")).toBe(true);
  });

  it("asks a monthly giver to confirm they are 18 or over, in the donate page's words", () => {
    const age = step.querySelector("[data-rb-age]")!;
    expect(age.hasAttribute("hidden")).toBe(true);
    expect(norm(age.textContent)).toBe("I confirm I am aged 18 or over. Monthly giving is set up by adults.");
    expect(norm(read("donate.html"))).toContain("I confirm I am aged 18 or over. Monthly giving is set up by adults.");
  });

  it("has a way back to the bag, and a place for Stripe to open on the page", () => {
    expect(step.querySelector("[data-rb-back]")).not.toBeNull();
    expect(doc.getElementById("rbEmbeddedCheckout")).not.toBeNull();
    expect(doc.getElementById("rbCheckoutModal")?.hasAttribute("hidden")).toBe(true);
  });
});

describe("the thank you", () => {
  const thanks = main.querySelector("[data-rb-thanks]")!;

  it("waits, hidden, for the return from paying", () => {
    expect(thanks.hasAttribute("hidden")).toBe(true);
    expect(norm(thanks.querySelector("h2")?.textContent)).toBe("Thank you for filling a Red Bag");
  });

  it("has a total line, a Gift Aid line and a plain line, each shown only when it applies", () => {
    expect(thanks.querySelector("[data-rb-thanks-total]")?.hasAttribute("hidden")).toBe(true);
    expect(thanks.querySelector("[data-rb-thanks-giftaid]")?.hasAttribute("hidden")).toBe(true);
    expect(thanks.querySelector("[data-rb-thanks-plain]")?.hasAttribute("hidden")).toBe(false);
  });

  it("carries the reassurance line", () => {
    expect(norm(thanks.textContent)).toContain(rb.WORDS.elves);
  });

  it("offers a picture to share that names no amount, and never a list of items", () => {
    const share = thanks.querySelector("[data-rb-share]")!;
    expect(norm(share.querySelector("h3")?.textContent)).toBe("Share: I filled a Red Bag");
    expect(share.querySelector("canvas[data-rb-share-picture]")).not.toBeNull();
    expect(norm(share.textContent)).not.toMatch(/£/);
    expect(thanks.querySelector("ul, ol, table")).toBeNull();
  });
});

describe("the wording rules", () => {
  // HMRC's declaration is verbatim law, not our copy; everything else is ours.
  const copy = visibleCopy(html, [".giftaid-statement"]);

  it("says could, never will", () => {
    expect(copy).not.toMatch(/\bwill\b/i);
    expect(copy).toMatch(/\bcould\b/);
  });

  it("names who it is for, word for word, and never a shortened version", () => {
    const lower = copy.toLowerCase();
    expect(lower).toContain("children, young people and vulnerable adults");
    expect(lower.split("young people").length).toBe(lower.split("children, young people and vulnerable adults").length);
    expect(lower.split("vulnerable adults").length).toBe(lower.split("children, young people and vulnerable adults").length);
  });

  it("has no en dash or em dash, and no hyphenated words", () => {
    const all = visibleCopy(html);
    expect(all.match(/[–—]/g) ?? []).toEqual([]);
    expect(all.match(/\w-\w/g) ?? []).toEqual([]);
    expect(html).not.toContain("NB4CC");
  });

  it("is plainly all year round, not a Christmas list", () => {
    expect(norm(main.querySelector("#rb-themes-title")?.textContent)).toBe("Whenever the need comes");
    expect(copy).not.toMatch(/santa/i);
    expect(copy).toContain("all year round");
  });

  it("is British", () => {
    expect(copy).not.toMatch(/\b(color|favorite|pajamas|center)\b/i);
  });
});

describe("the site's shell and its accessibility floor", () => {
  it("has the skip link first, one main, and the header, nav and footer", () => {
    const first = doc.body.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    expect(first?.classList.contains("skip-link")).toBe(true);
    expect(first?.getAttribute("href")).toBe("#main");
    expect(doc.querySelectorAll("main").length).toBe(1);
    expect(doc.querySelector("header nav")).not.toBeNull();
    expect(doc.querySelector("footer")).not.toBeNull();
  });

  it("wears the same header and footer as the other public pages", () => {
    const other = new DOMParser().parseFromString(read("fundraise-help.html"), "text/html");
    expect(norm(doc.querySelector("header")!.outerHTML)).toBe(norm(other.querySelector("header")!.outerHTML));
    expect(norm(doc.querySelector("footer")!.outerHTML)).toBe(norm(other.querySelector("footer")!.outerHTML));
  });

  it("carries the charity statement", () => {
    const legal = norm(doc.querySelector("footer .legal")?.textContent);
    expect(legal).toContain("Scottish Charitable Incorporated Organisation");
    expect(legal).toContain("SC047995");
  });

  it("labels every form control, and marks the required ones both ways", () => {
    const controls = [...doc.querySelectorAll("input, textarea, select")].filter((el) => el.getAttribute("type") !== "hidden");
    expect(controls.length).toBeGreaterThan(20);
    for (const el of controls) {
      const id = el.getAttribute("id");
      expect(id, el.outerHTML).toBeTruthy();
      expect(norm(doc.querySelector(`label[for="${id}"]`)?.textContent).length, `label for ${id}`).toBeGreaterThan(0);
      if (el.hasAttribute("required")) expect(el.getAttribute("aria-required"), id!).toBe("true");
    }
  });

  it("gives every button words, seen or heard", () => {
    for (const b of doc.querySelectorAll("button")) {
      expect(norm(b.textContent).length + norm(b.getAttribute("aria-label")).length, b.outerHTML).toBeGreaterThan(0);
    }
  });

  it("loads the catalogue before the page's script, and no font or script from anywhere else", () => {
    const scripts = [...doc.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"));
    expect(scripts).toEqual(["/assets/js/main.js", "/assets/js/red-bag-catalogue.js", "/assets/js/red-bag.js", "/assets/js/pulse.js"]);
    for (const l of doc.querySelectorAll("link[href]")) expect(l.getAttribute("href")).toMatch(/^\/assets\//);
  });
});

describe("hidden from the world until it goes live", () => {
  it("tells search engines to leave it alone", () => {
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
    expect(doc.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("is on no site map", () => {
    expect(ALL_PAGES.some((p) => p.path === "/fill-a-red-bag")).toBe(false);
    expect(renderSitemapTree(SITE_PAGES, true, true, true)).not.toContain("fill-a-red-bag");
    expect(renderSitemapXml(SITE_PAGES, "https://nbcc.scot", new Map(), true, true, true)).not.toContain("fill-a-red-bag");
  });

  it("is linked from no page, the donate page included", () => {
    const pages = readdirSync(ROOT).filter((f) => f.endsWith(".html") && f !== "fill-a-red-bag.html" && f !== "admin.html");
    expect(pages).toContain("donate.html");
    for (const f of pages) expect(read(f), f).not.toMatch(/fill-a-red-bag/);
  });

  it("is remembered in the staff's own list of pages, as staff only", () => {
    const entry = PRIVATE_PAGES.find((p) => p.path === "/fill-a-red-bag");
    expect(entry?.reach).toBe("staff");
    expect(entry?.note).toMatch(/not public yet/i);
  });

  it("cannot be taken by a spare address", () => {
    expect(RESERVED_PREFIXES).toContain("/fill-a-red-bag");
    expect(aliasFromProblem("/fill-a-red-bag")).not.toBeNull();
  });
});

describe("the staff preview strip", () => {
  it("is not on the public page", () => {
    expect(html).not.toContain("Staff preview");
  });

  it("is plain, and says it is not public yet", () => {
    expect(PREVIEW_STRIP).toContain("Staff preview: not public yet");
    const d = new DOMParser().parseFromString(renderRedBagPage(template, { preview: true }), "text/html");
    const strip = d.querySelector(".rb-preview")!;
    expect(norm(strip.textContent)).toBe("Staff preview: not public yet");
    expect(d.body.getAttribute("data-rb-preview")).toBe("true");
  });
});

// --- who is given the page -----------------------------------------------------------------------

function ask(opts: { live: boolean; staff?: boolean | Error; authorization?: string }) {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    kind: "",
    status(c: number) { this.statusCode = c; return this; },
    setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; return this; },
    type(t: string) { this.kind = t; return this; },
    send(b: string) { this.body = b; return this; },
  };
  const isStaff = vi.fn(async () => {
    if (opts.staff instanceof Error) throw opts.staff;
    return opts.staff === true;
  });
  const handler = redBagPageHandler({
    template: () => template,
    notFound: () => read("404.html"),
    decorate: async (h) => h.replace("</body>", "<!-- decorated --></body>"),
    live: () => opts.live,
    isStaff,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return handler({ headers: { authorization: opts.authorization, cookie: undefined } } as any, res as any).then(() => ({ res, isStaff }));
}

describe("GET /fill-a-red-bag", () => {
  it("switched off, is the site's own 404 to the public: a real 404, never indexed, nothing of the page in it", async () => {
    const { res } = await ask({ live: false });
    expect(res.statusCode).toBe(404);
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(res.body).toContain("We cannot find that page");
    expect(res.body).not.toContain("Fill a Red Bag");
    expect(res.body).not.toContain("rb-paper");
    expect(res.body).not.toContain("decorated");
  });

  it("switched off, the 404 carries only the small script that lets a signed in member of staff through", async () => {
    const { res } = await ask({ live: false });
    const plain = read("404.html");
    expect(res.body.replace('<script defer src="/assets/js/red-bag-preview.js"></script>\n', "")).toBe(plain);
  });

  it("switched off, is the page with the strip to a signed in member of staff, and is never kept", async () => {
    const { res, isStaff } = await ask({ live: false, staff: true, authorization: "Bearer a-token" });
    expect(isStaff).toHaveBeenCalledWith("Bearer a-token");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Staff preview: not public yet");
    expect(res.body).toContain("rb-paper");
    expect(res.body).toContain("decorated");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["vary"]).toBe("Authorization");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("switched off, is the 404 when it cannot tell who is asking", async () => {
    const { res } = await ask({ live: false, staff: new Error("database down"), authorization: "Bearer a-token" });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("rb-paper");
  });

  it("switched on, is the page for everyone, with no strip, and asks nobody who they are", async () => {
    const { res, isStaff } = await ask({ live: true, staff: true, authorization: "Bearer a-token" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("rb-paper");
    expect(res.body).not.toContain("Staff preview");
    expect(res.body).toContain("decorated");
    expect(isStaff).not.toHaveBeenCalled();
  });
});

describe("the page's own stylesheet", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("is its own file, so the shared bundle the donate page's budget counts does not grow", () => {
    expect(template).toContain('href="/assets/css/red-bag.css"');
    expect(read("assets/css/styles.css")).not.toMatch(/\.rb-/);
  });

  it("has no scrollbar inside anything: the page grows", () => {
    expect(rules).not.toMatch(/overflow(-[xy])?\s*:\s*(auto|scroll)/);
    expect(rules).not.toMatch(/max-height/);
  });

  it("has no thick stripe down one side, and no gradient text", () => {
    for (const m of rules.matchAll(/border-(left|right|inline-start|inline-end)\s*:\s*([^;}]+)/g)) {
      const width = /(\d*\.?\d+)px/.exec(m[2]);
      expect(width ? Number(width[1]) : 0, m[0]).toBeLessThanOrEqual(1);
    }
    expect(rules).not.toMatch(/background-clip\s*:\s*text/);
  });

  it("takes every colour from the site's tokens", () => {
    expect(rules.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(rules).not.toMatch(/\brgba?\(/);
  });

  it("uses the handwriting only on the paper, from faces already on the device", () => {
    expect(rules).not.toMatch(/@font-face|@import|url\(/);
    const uses = [...rules.matchAll(/([^{}]+)\{[^{}]*font-family\s*:\s*var\(--rb-hand\)[^{}]*\}/g)].map((m) => m[1].trim());
    expect(uses.length).toBeGreaterThan(0);
    for (const selector of uses) {
      for (const part of selector.split(",")) expect(part.trim(), part).toMatch(/^\.rb-paper\b/);
    }
    const families = [...rules.matchAll(/font-family\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
    for (const f of families) expect(f).toMatch(/^var\(--(rb-hand|font-head|font-body)\)$/);
  });

  it("keeps tap targets at 44px or more", () => {
    expect(rules).toMatch(/\.rb-step\{[^}]*min-width:44px[^}]*min-height:44px/);
    expect(rules).toMatch(/\.rb-qty\{[^}]*min-height:44px/);
    expect(rules).toMatch(/\.rb-example\{[^}]*min-height:44px/);
    expect(rules).toMatch(/\.rb-remove\{[^}]*min-height:44px/);
  });

  it("moves with transform and opacity only, and not at all for someone who asked for less motion", () => {
    for (const m of rules.matchAll(/transition\s*:\s*([^;}]+)/g)) {
      for (const part of m[1].replace(/\([^)]*\)/g, "").split(",")) expect(part.trim(), m[0]).toMatch(/^(transform|opacity|background-color|color|border-color|box-shadow)\b|^none$/);
    }
    for (const frames of rules.matchAll(/@keyframes[^{]+\{((?:[^{}]*\{[^{}]*\})+)\s*\}/g)) {
      for (const d of frames[1].matchAll(/([a-z-]+)\s*:/g)) expect(["transform", "opacity"], frames[0]).toContain(d[1]);
    }
    const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\})\s*\}/.exec(rules)?.[1] ?? "";
    expect(reduced).toMatch(/animation:none/);
    expect(reduced).toMatch(/transition:none/);
  });

  it("shows a pressed example in holly green", () => {
    expect(rules).toMatch(/\.rb-example\[aria-pressed="true"\]\{[^}]*background(-color)?:var\(--holly\)/);
  });
});
