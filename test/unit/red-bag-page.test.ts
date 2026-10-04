// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { redBag } from "../../src/red-bag/catalogue";
import { DROP_OFF_LIVE, DROP_OFF_URL, PREVIEW_STRIP, postcodePattern, renderRedBagPage } from "../../src/red-bag/render";
import { UK_POSTCODE_RE } from "../../src/declarations/fields";
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

  // ONE polite region holds both, read whole, so a tap is announced once ("...half full. Your total
  // £31") and not twice over.
  it("says the status and the total out loud as they change, together, once", () => {
    const status = main.querySelector("[data-rb-status]")!;
    const total = main.querySelector("[data-rb-total]")!;
    const region = status.closest("[aria-live]")!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-atomic")).toBe("true");
    expect(total.closest("[aria-live]")).toBe(region);
    expect(main.querySelectorAll("[data-rb-builder] [aria-live]").length).toBe(1);
    expect(norm(status.textContent)).toBe("Your bag is empty. Pop something in.");
    expect(norm(total.textContent)).toBe("£0");
  });

  it("has the monthly tick, one Donate button and the nudge", () => {
    // With nothing in the bag the tick names no amount; the script names it as the bag fills.
    expect(norm(doc.querySelector('label[for="rbMonthly"]')?.textContent)).toBe("Give this amount every month");
    expect(doc.querySelector('label[for="rbMonthly"] [data-rb-monthly-label]')).not.toBeNull();
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

// On a phone the bag and Donate sit below a long list. A slim bar at the foot of the screen keeps
// the total and a Donate button in reach while the list is scrolled (assets/js/red-bag.js shows it).
describe("the phone bar", () => {
  const bar = main.querySelector("[data-rb-bar]")!;

  it("is in the page, hidden until the script shows it", () => {
    expect(bar).not.toBeNull();
    expect(bar.hasAttribute("hidden")).toBe(true);
    expect(norm(bar.querySelector(".rb-bar__total")?.textContent)).toBe("Your bag £0");
    const button = bar.querySelector("button[data-rb-bar-donate]")!;
    expect(norm(button.textContent)).toBe("Donate");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.classList.contains("btn")).toBe(true); // the site's button, with its arrow
  });

  it("is not a live region: the status line already says each change", () => {
    expect(bar.hasAttribute("aria-live")).toBe(false);
    expect(bar.hasAttribute("role")).toBe(false);
    expect(bar.querySelector("[aria-live], [role='status'], [role='alert']")).toBeNull();
    expect(bar.closest("[aria-live]")).toBeNull();
  });

  it("is not a section of its own, so the page's shell is as it was", () => {
    expect(bar.tagName).toBe("DIV");
    expect(bar.parentElement).toBe(main);
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
  it("keeps the drop off address in one constant, live since Jaimie confirmed it (4 October 2026)", () => {
    expect(DROP_OFF_URL).toBe("https://drop.nbcc.scot");
    expect(DROP_OFF_LIVE).toBe(true);
  });

  it("says it in Jaimie's words, with the link on the last sentence", () => {
    const note = main.querySelector(".rb-real")!;
    const link = note.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://drop.nbcc.scot");
    expect(norm(link.firstChild?.textContent)).toBe("Find a drop-off point near you");
    // As seen: the words for a screen reader about the new tab are apart from the sentence.
    const seen = note.cloneNode(true) as Element;
    seen.querySelectorAll(".sr-only").forEach((el) => el.remove());
    expect(norm(seen.textContent)).toBe("Prefer to give the real thing? We would love that. Find a drop-off point near you.");
  });

  it("opens the other site the way the site's other outside links do", () => {
    const link = main.querySelector(".rb-real a")!;
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener");
    expect(norm(link.querySelector(".sr-only")?.textContent)).toBe(", opens in a new tab");
  });

  it("would show the phone number, and no link, if the address went away again", () => {
    const off = renderRedBagPage(template, { preview: false, dropOffLive: false });
    expect(off).not.toContain("drop.nbcc.scot");
    expect(off).toContain('href="tel:+441292811015"');
    expect(read("contact.html")).toContain('href="tel:+441292811015"');
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

  // The page must refuse exactly what the server refuses (src/declarations/fields.ts), or a postcode
  // the page lets through comes back as a bare "something needs another look".
  it("holds the postcode to the server's own rule", () => {
    const pattern = step.querySelector("#rbPostcode")!.getAttribute("pattern")!;
    expect(pattern).toBe(postcodePattern());
    const page = new RegExp(`^(?:${pattern})$`);
    const samples = [
      "KA1 1AA", "ka1 1aa", "KA11AA", "KA6 5EE", "M1 1AE", "SW1A 1AA", "W1A 0AX", "EC1A 1BB", "B33 8TH", "CR2 6XH", "DN55 1PT", "GIR 0AA", "gir0aa",
      "KI1 1AA", "QI1 1AA", "KA1 1A", "KA1  1AA", "1KA 1AA", "KA1 AAA", "K 1AA", "KAA1 1AA", "ABCDE", "12345", "KA1-1AA", "KA1 1AAA", "",
    ];
    for (const s of samples) expect(page.test(s), s).toBe(UK_POSTCODE_RE.test(s));
    expect(page.test("KI1 1AA")).toBe(false);
    expect(page.test("ka1 1aa")).toBe(true);
    // Built from the server's rule, letter for letter: no class of capitals is left without its small letters.
    expect(pattern).not.toMatch(/\[A-Z\]|\[A-HJ-Y\]|GIR/);
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

  it("carries the reassurance line, and says the receipt is coming, in Jaimie's words", () => {
    expect(norm(thanks.textContent)).toContain(rb.WORDS.elves);
    expect(norm(thanks.textContent)).toContain(`${rb.WORDS.elves} Your receipt is on its way to your inbox. Thank you for being part of this.`);
    expect(norm(thanks.textContent)).not.toContain("We have emailed your receipt");
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
    // "drop-off" is Jaimie's own wording for the real items note (4 October 2026): the one hyphen allowed.
    expect(all.replace(/\bdrop-off\b/g, " ").match(/\w-\w/g) ?? []).toEqual([]);
    expect(html).not.toContain("NB4CC");
  });

  it("is plainly all year round, not a Christmas list", () => {
    expect(norm(main.querySelector("#rb-themes-title")?.textContent)).toBe("Whenever the need comes");
    expect(norm(main.querySelector(".rb-need__head p")?.textContent)).toBe(
      "Christmas is our big night, and the need comes all year round. Tap an example to add it to your bag, and tap it again to take it out.",
    );
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

function ask(opts: { live: boolean; staff?: boolean | Error; authorization?: string; template?: () => string; notFound?: () => string; decorate?: () => Promise<string> }) {
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
  const next = vi.fn();
  const handler = redBagPageHandler({
    template: opts.template ?? (() => template),
    notFound: opts.notFound ?? (() => read("404.html")),
    decorate: opts.decorate ?? (async (h) => h.replace("</body>", "<!-- decorated --></body>")),
    live: () => opts.live,
    isStaff,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return handler({ headers: { authorization: opts.authorization, cookie: undefined } } as any, res as any, next).then(() => ({ res, isStaff, next }));
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

// Express 4 does not catch what an async handler throws: the request would hang. Whatever cannot be
// read, the visitor is handed on to the site's own 404 (the router's catch-all), and it is logged.
describe("GET /fill-a-red-bag when something cannot be read", () => {
  const broken = () => {
    throw new Error("ENOENT: no such file");
  };
  const quietly = async (run: () => Promise<Awaited<ReturnType<typeof ask>>>) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await run();
      return { ...out, logged: log.mock.calls.map((c) => c.join(" ")) };
    } finally {
      log.mockRestore();
    }
  };

  it("hands on to the site's 404 when the page's file cannot be read (switched on)", async () => {
    const { res, next, logged } = await quietly(() => ask({ live: true, template: broken }));
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.body).toBe("");
    expect(logged.join(" ")).toMatch(/fill a red bag page failed: ENOENT/);
  });

  it("hands on to the site's 404 when the page's file cannot be read on a staff preview", async () => {
    const { res, next } = await quietly(() => ask({ live: false, staff: true, authorization: "Bearer a-token", template: broken }));
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.body).toBe("");
  });

  it("hands on to the site's 404 when the 404 page itself cannot be read (switched off, the public)", async () => {
    const { res, next } = await quietly(() => ask({ live: false, notFound: broken }));
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.body).toBe("");
  });

  it("hands on to the site's 404 when the menu cannot be added", async () => {
    const { res, next } = await quietly(() => ask({ live: true, decorate: async () => { throw new Error("database down"); } }));
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.body).toBe("");
  });

  it("never calls next when all is well", async () => {
    expect((await ask({ live: true })).next).not.toHaveBeenCalled();
    expect((await ask({ live: false })).next).not.toHaveBeenCalled();
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

  // NBCC's printed sheet is handwritten, so the paper is too: Caveat (SIL Open Font License), kept
  // with the site's other fonts, its licence beside it. Jaimie approved it on 4 October 2026.
  it("carries the handwriting face itself: one file, from our own address, never another site's", () => {
    const faces = rules.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces.length).toBe(1);
    const face = faces[0];
    expect(face).toMatch(/font-family:\s*"Caveat"/);
    expect(face).toMatch(/src:\s*url\(\/assets\/fonts\/caveat-latin\.woff2\)\s*format\("woff2"\)/);
    expect(face).toMatch(/font-weight:\s*400 700/);
    expect(face).toMatch(/font-display:\s*swap/);
    // The Latin subset, as Google publishes it: it has the pound sign (U+00A3) and the ampersand (U+0026).
    expect(face).toMatch(/unicode-range:\s*U\+0000-00FF,/);
    expect(rules.match(/url\(/g)?.length).toBe(1);
    expect(rules).not.toMatch(/@import|https?:/);
  });

  it("ships the font file and its licence together", () => {
    const font = readFileSync(resolve(ROOT, "assets/fonts/caveat-latin.woff2"));
    expect(font.subarray(0, 4).toString("latin1")).toBe("wOF2");
    expect(font.length).toBeGreaterThan(10_000);
    expect(font.length).toBeLessThan(120_000);
    const licence = read("assets/fonts/caveat-OFL.txt");
    expect(licence).toContain("The Caveat Project Authors");
    expect(licence).toContain("SIL Open Font License, Version 1.1");
  });

  it("uses the handwriting only on the paper, with the device's own hands to fall back on", () => {
    const hand = /--rb-hand:([^;]+);/.exec(rules)?.[1] ?? "";
    expect(hand).toMatch(/^"Caveat",/);
    expect(hand).toMatch(/"Segoe Print"/);
    expect(hand).toMatch(/cursive$/);
    const uses = [...rules.matchAll(/([^{}]+)\{[^{}]*font-family\s*:\s*var\(--rb-hand\)[^{}]*\}/g)].map((m) => m[1].trim());
    expect(uses.length).toBeGreaterThan(0);
    for (const selector of uses) {
      for (const part of selector.split(",")) expect(part.trim(), part).toMatch(/^\.rb-paper\b/);
    }
    const families = [...rules.replace(/@font-face\s*\{[^}]*\}/g, "").matchAll(/font-family\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
    for (const f of families) expect(f).toMatch(/^var\(--(rb-hand|font-head|font-body)\)$/);
  });

  it("is loaded by this page alone: no other page, and not the shared stylesheet, knows of it", () => {
    expect(read("assets/css/styles.css")).not.toMatch(/caveat-latin|"Caveat"/i);
    for (const f of readdirSync(ROOT).filter((x) => x.endsWith(".html") && x !== "fill-a-red-bag.html")) {
      expect(read(f), f).not.toMatch(/caveat-latin|"Caveat"|red-bag\.css/i);
    }
    for (const f of readdirSync(resolve(ROOT, "assets/css")).filter((x) => x !== "red-bag.css")) {
      expect(read(`assets/css/${f}`), f).not.toMatch(/caveat-latin|"Caveat"/i);
    }
    // Asked for early here, so the list is not drawn twice.
    expect(template).toContain('<link rel="preload" href="/assets/fonts/caveat-latin.woff2" as="font" type="font/woff2" crossorigin />');
  });

  // Caveat is narrow with a small x-height: at the body's size it reads small. On the paper the
  // item names and prices are set large enough to read as easily as the page's 16px body text.
  it("sets the handwriting large enough to read easily", () => {
    const size = (selector: string) => Number(new RegExp(`[.]${selector.slice(1)}[{][^}]*font-size:([0-9.]+)rem`).exec(rules)?.[1] ?? 0);
    expect(size(".rb-item__name")).toBeGreaterThanOrEqual(1.45);
    expect(size(".rb-item__price")).toBeGreaterThanOrEqual(1.4);
    expect(size(".rb-also__words")).toBeGreaterThanOrEqual(1.4);
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

  it("draws the phone bar only where the bag sits below the list, fixed to the foot, clear of the home bar", () => {
    const outside = rules.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    expect(outside).toMatch(/\.rb-bar\{[^}]*display:none/);
    const stacked = /@media \(max-width:860px\)\{((?:[^{}]*\{[^{}]*\})*)/.exec(rules)?.[1] ?? "";
    const rule = /\.rb-bar\{([^}]*)\}/.exec(stacked)?.[1] ?? "";
    expect(rule).toMatch(/display:flex/);
    expect(rule).toMatch(/position:fixed/);
    expect(rule).toMatch(/bottom:0/);
    expect(rule).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(stacked).toMatch(/\.rb-bar__donate\{[^}]*min-height:44px/);
    // While it shows, the page is longer by its height, so it never sits over the end of the footer.
    expect(stacked).toMatch(/body\.rb-bar-on\{[^}]*padding-bottom:[^}]*env\(safe-area-inset-bottom\)/);
  });

  it("shows a pressed example in holly green", () => {
    expect(rules).toMatch(/\.rb-example\[aria-pressed="true"\]\{[^}]*background(-color)?:var\(--holly\)/);
  });
});
