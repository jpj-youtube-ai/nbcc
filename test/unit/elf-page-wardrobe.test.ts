// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { renderWardrobePage } from "../../src/elf/pages/wardrobe";
import type { WardrobeView } from "../../src/elf/pages/types";
import { OUTFITS, SLOTS, STYLES, usePaint } from "../../src/elf/wardrobe";
import { PAINT_FIXTURE } from "./elf-paint-fixture";
import { wardrobeView } from "./elf-fixtures";

// NBCC Elf Detective School: the wardrobe screen. Every family and detective here is invented (see
// elf-fixtures.ts). The page is one form of choices, so it works with no script: the script only
// shows the elf changing as things are tried on.

const ROOT = resolve(__dirname, "../..");
const page = (v: WardrobeView = wardrobeView()) => new DOMParser().parseFromString(renderWardrobePage(v), "text/html");
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const radios = (doc: Document, name: string) => [...doc.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`)];
const choice = (doc: Document, value: string) => doc.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!;
/** What a screen reader says for a choice: the label's words that are not hidden from it. */
function said(doc: Document, input: HTMLInputElement): string {
  const label = doc.querySelector(`label[for="${input.id}"]`)!.cloneNode(true) as Element;
  label.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove());
  return words(label);
}


beforeEach(() => usePaint(PAINT_FIXTURE));
afterEach(() => usePaint(null));

describe("the wardrobe page", () => {
  it("is a private page that loads the wardrobe before the script that uses it", () => {
    const doc = page();
    expect(words(doc.querySelector("h1"))).toBe("The wardrobe");
    expect(doc.querySelector('meta[name="robots"]')!.getAttribute("content")).toBe("noindex, nofollow");
    const scripts = [...doc.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"));
    expect(scripts).toEqual(["/assets/js/elf-paint.js", "/assets/js/elf-wardrobe.js", "/assets/js/elf-wardrobe-ui.js"]);
    expect(doc.querySelector('.nav-cta[href="/elf/hq"]')).not.toBeNull();
  });

  it("gives nothing on the page the same id as anything else, patterns in the drawings included", () => {
    const ids = [...page().querySelectorAll("[id]")].map((el) => el.id);
    expect(ids.length).toBeGreaterThan(100);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the elf being dressed", () => {
  it("is drawn on the page, and says whose it is", () => {
    const preview = page().querySelector(".elf-wd-preview")!;
    const svg = preview.querySelector(".elf-wd-mirror svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Detective Ruby Tinselfoot's elf");
    expect(words(preview.querySelector("h2"))).toBe("Detective Ruby Tinselfoot");
    expect(words(preview)).toContain("Badge 0427");
    expect(words(preview)).toContain("Junior Detective");
  });

  it("says in words what the elf is wearing", () => {
    expect(words(page().querySelector(".elf-wd-wearing"))).toBe(
      "Wearing: Tan detective's hat, black round glasses, red striped scarf, red elf tunic, brown snow boots and brass magnifying glass.",
    );
    const view = wardrobeView();
    view.look = { ...view.look, outfit: "tree" };
    expect(words(page(view).querySelector(".elf-wd-wearing"))).toBe("Wearing: The Christmas tree outfit.");
  });

  it("is drawn only in what has been earned, whatever the saved look claims", () => {
    const view = wardrobeView();
    view.look = { ...view.look, outfit: "nessie", pieces: { ...view.look.pieces, top: ["coat", "tan"] } };
    const doc = page(view);
    expect(words(doc.querySelector(".elf-wd-wearing"))).toContain("green elf tunic");
    expect(words(doc.querySelector(".elf-wd-wearing"))).not.toContain("Nessie");
    expect(doc.querySelector<HTMLInputElement>('input[name="outfit"][value=""]')!.checked).toBe(true);
    expect(choice(doc, "tunic:green").checked).toBe(true);
    expect(choice(doc, "coat:tan").checked).toBe(false);
  });
});

describe("the form of choices", () => {
  it("posts to the server with no script, and tells the script what the detective has earned", () => {
    const form = page().querySelector<HTMLFormElement>("form.elf-wd")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/elf/hq/wardrobe/d1");
    expect(form.getAttribute("data-api")).toBe("/api/elf/look");
    expect(form.getAttribute("data-doors")).toBe("6");
    expect(form.getAttribute("data-gold")).toBe("0");
    expect(form.getAttribute("data-race")).toBe("0");
    expect(form.querySelector<HTMLInputElement>('input[name="detective"]')!.value).toBe("d1");
    expect(words(form.querySelector('button[type="submit"]'))).toBe("Save this look");
    expect(form.querySelector(".elf-wd-status")!.getAttribute("role")).toBe("status");
  });

  it("counts a silly number of doors as none, so only the starter kit is on offer", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = page(wardrobeView({ state: { doorsDone: "6" as any } }));
    expect(doc.querySelector("form.elf-wd")!.getAttribute("data-doors")).toBe("0");
    expect(radios(doc, "piece-hat").filter((r) => !r.disabled).map((r) => r.value)).toEqual(["elf:red"]);
  });

  it("offers every skin tone, hair colour and hair style, with the saved ones picked", () => {
    const doc = page();
    expect(radios(doc, "skin").map((r) => r.value)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(radios(doc, "skin").map((r) => said(doc, r))[2]).toBe("Skin tone 3");
    expect(radios(doc, "skin").find((r) => r.checked)!.value).toBe("s3");
    expect(radios(doc, "hair").map((r) => said(doc, r))).toEqual(["Dark brown hair", "Brown hair", "Red hair", "Blonde hair", "Black hair"]);
    expect(radios(doc, "hair").find((r) => r.checked)!.value).toBe("ginger");
    expect(radios(doc, "hairStyle").map((r) => said(doc, r))).toEqual(["Short", "Bunches", "Curly"]);
    expect(radios(doc, "hairStyle").find((r) => r.checked)!.value).toBe("bunches");
  });

  it("asks first whether the elf is a sister or a brother, with the saved one picked", () => {
    const doc = page();
    expect(radios(doc, "sibling").map((r) => [r.value, said(doc, r)])).toEqual([
      ["sister", "Sister"],
      ["brother", "Brother"],
    ]);
    expect(radios(doc, "sibling").find((r) => r.checked)!.value).toBe("sister");
    const first = doc.querySelector("form.elf-wd input[type=\"radio\"]") as HTMLInputElement;
    expect(first.name).toBe("sibling");
  });

  it("gives every choice a label, and exactly one picked in every group", () => {
    const doc = page();
    const all = [...doc.querySelectorAll<HTMLInputElement>('form.elf-wd input[type="radio"]')];
    for (const input of all) {
      expect(doc.querySelector(`label[for="${input.id}"]`), input.id).not.toBeNull();
      expect(said(doc, input), input.id).not.toBe("");
    }
    for (const name of new Set(all.map((r) => r.name))) {
      expect(radios(doc, name).filter((r) => r.checked).length, name).toBe(1);
    }
  });
});

describe("the sections", () => {
  it("has a link to every section, in the order they come", () => {
    const doc = page();
    const links = [...doc.querySelectorAll<HTMLAnchorElement>(".elf-wd-tabs a")];
    expect(links.map((a) => words(a).replace(/, new things$/, ""))).toEqual(["Skin and hair", "Outfits", ...SLOTS.map((s) => s.name)]);
    const panels = [...doc.querySelectorAll(".elf-wd-panel")].map((p) => p.id);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(panels.map((id) => `#${id}`));
  });

  it("marks the sections that hold something new", () => {
    const doc = page();
    const marked = [...doc.querySelectorAll(".elf-wd-tabs a")].filter((a) => a.querySelector(".elf-wd-tab__new")).map((a) => words(a));
    expect(marked).toEqual(["Outfits, new things", "Tops, new things", "Shoes, new things"]);
  });
});

describe("the pieces", () => {
  it("has a group for each slot, with None on offer where a slot can be left empty", () => {
    const doc = page();
    const groups = [...doc.querySelectorAll("fieldset.elf-wd-slot")];
    expect(groups.map((g) => words(g.querySelector("legend")))).toEqual(SLOTS.map((s) => s.name));
    for (const slot of SLOTS) {
      const none = doc.querySelector<HTMLInputElement>(`input[name="piece-${slot.id}"][value=""]`);
      expect(none !== null, slot.id).toBe(slot.optional);
    }
    const noExtra = doc.querySelector<HTMLInputElement>('input[name="piece-extra"][value=""]')!;
    expect(noExtra.checked).toBe(true);
    expect(said(doc, noExtra)).toBe("None");
    expect(doc.querySelector<HTMLInputElement>('input[name="piece-face"][value=""]')!.checked).toBe(false);
  });

  it("offers all 75, named in full for a screen reader, with the saved ones picked", () => {
    const doc = page();
    const all = SLOTS.flatMap((s) => radios(doc, `piece-${s.id}`)).filter((r) => r.value !== "");
    expect(all.length).toBe(75);
    expect(all.map((r) => r.value).sort()).toEqual(STYLES.flatMap((s) => s.colours.map((c) => `${s.id}:${c.id}`)).sort());
    const hat = choice(doc, "deer:tan");
    expect(hat.checked).toBe(true);
    expect(hat.name).toBe("piece-hat");
    expect(said(doc, hat)).toBe("Tan detective's hat");
  });

  it("names every style above its three colours", () => {
    const doc = page();
    const styles = [...doc.querySelectorAll(".elf-wd-style")];
    expect(styles.map((s) => words(s.querySelector(".elf-wd-style__name")))).toEqual(STYLES.map((s) => s.name));
    for (const style of styles) expect(style.querySelectorAll('input[type="radio"]').length).toBe(3);
  });

  it("draws each piece as a small picture that a screen reader skips", () => {
    const doc = page();
    const label = doc.querySelector(`label[for="${choice(doc, "elf:red").id}"]`)!;
    const art = label.querySelector("img")!;
    expect(art.getAttribute("alt")).toBe("");
    expect(art.getAttribute("src")).toBe("/assets/img/elf/tile/piece-elf-red.webp");
  });

  it("locks what has not been earned: it cannot be picked, wears a padlock and says how many doors earn it", () => {
    const doc = page();
    const locked = radios(doc, "piece-hat").filter((r) => r.disabled).map((r) => r.value).sort();
    const expected = STYLES.filter((s) => s.slot === "hat").flatMap((s) => s.colours.filter((c) => c.door > 6).map((c) => `${s.id}:${c.id}`));
    expect(locked).toEqual(expected.sort());
    const bobble = choice(doc, "bobble:red");
    expect(bobble.disabled).toBe(true);
    expect(said(doc, bobble)).toBe("Red bobble hat, locked until you have done 7 doors");
    const tile = bobble.closest(".elf-wd-tile")!;
    expect(tile.classList.contains("is-locked")).toBe(true);
    expect(words(tile.querySelector(".elf-wd-lock"))).toBe("7 doors");
    expect(tile.querySelector(".elf-wd-lock svg")).not.toBeNull();
    expect(choice(doc, "jumper:red").disabled).toBe(false);
    expect(choice(doc, "jumper:red").closest(".elf-wd-tile")!.querySelector(".elf-wd-lock")).toBeNull();
  });

  it("puts New on what has arrived and not been tried on", () => {
    const doc = page();
    const fresh = [...doc.querySelectorAll<HTMLInputElement>(".elf-wd-tile.is-new input")].map((i) => i.value);
    expect(fresh).toEqual(["tree", "jumper:red", "jumper:green", "boots:red"]);
    const jumper = choice(doc, "jumper:red");
    expect(said(doc, jumper)).toBe("Red Christmas jumper, new");
    expect(words(jumper.closest(".elf-wd-tile")!.querySelector(".elf-wd-new"))).toBe("New");
  });

  it("does not call a thing new while it is still locked", () => {
    const doc = page(wardrobeView({ fresh: ["bobble:red", "pudding"] }));
    expect(doc.querySelectorAll(".elf-wd-tile.is-new").length).toBe(0);
    expect(said(doc, choice(doc, "bobble:red"))).toBe("Red bobble hat, locked until you have done 7 doors");
  });
});

describe("the outfits", () => {
  it("offers all eleven, and wearing none of them", () => {
    const doc = page();
    const all = radios(doc, "outfit");
    expect(all.map((r) => r.value)).toEqual(["", ...OUTFITS.map((o) => o.id)]);
    expect(all[0].checked).toBe(true);
    expect(said(doc, all[0])).toBe("No outfit: wear my own pieces");
  });

  it("locks an outfit until its door, the gold seal or a race win", () => {
    const doc = page();
    const outfit = (id: string) => doc.querySelector<HTMLInputElement>(`input[name="outfit"][value="${id}"]`)!;
    expect(outfit("tree").disabled).toBe(false);
    expect(said(doc, outfit("tree"))).toBe("Christmas tree outfit, new");
    expect(said(doc, outfit("present"))).toBe("Present outfit");
    expect(outfit("pudding").disabled).toBe(true);
    expect(said(doc, outfit("pudding"))).toBe("Christmas pudding outfit, locked until you have done 9 doors");
    expect(words(outfit("pudding").closest(".elf-wd-tile")!.querySelector(".elf-wd-lock"))).toBe("9 doors");
    expect(said(doc, outfit("golden"))).toBe("Golden detective outfit, locked until you have visited all 24 places");
    expect(words(outfit("golden").closest(".elf-wd-tile")!.querySelector(".elf-wd-lock"))).toBe("Visit all 24 places");
    expect(said(doc, outfit("nessie"))).toBe("Nessie outfit, locked until you win a race");
    expect(words(outfit("nessie").closest(".elf-wd-tile")!.querySelector(".elf-wd-lock"))).toBe("Win a race");
  });

  it("unlocks the golden detective and Nessie for a detective who has earned them", () => {
    const doc = page(wardrobeView({ state: { doorsDone: 24, goldSeal: true, wonRace: true } }));
    expect(radios(doc, "outfit").filter((r) => r.disabled)).toEqual([]);
    expect(doc.querySelectorAll('form.elf-wd input[type="radio"]:disabled').length).toBe(0);
    expect(doc.querySelector("form.elf-wd")!.getAttribute("data-gold")).toBe("1");
    expect(doc.querySelector("form.elf-wd")!.getAttribute("data-race")).toBe("1");
  });

  it("shows the outfit as worn when the saved look has one", () => {
    const view = wardrobeView();
    view.look = { ...view.look, outfit: "present" };
    const doc = page(view);
    expect(radios(doc, "outfit").find((r) => r.checked)!.value).toBe("present");
    expect(choice(doc, "deer:tan").checked).toBe(true);
  });
});

describe("the news that something has arrived", () => {
  it("names what is new, outfits first and then pieces in the order they hang", () => {
    const news = page().querySelector(".elf-wd-news")!;
    expect(words(news)).toContain("4 new things have arrived");
    expect(words(news)).toContain("The Christmas tree outfit, red Christmas jumper, green Christmas jumper and red snow boots.");
  });

  it("says one thing, not one things", () => {
    const news = page(wardrobeView({ fresh: ["boots:red"] })).querySelector(".elf-wd-news");
    expect(words(news)).toContain("1 new thing has arrived");
    expect(words(news)).toContain("Red snow boots.");
  });

  it("names the first few and counts the rest when a lot has arrived at once", () => {
    const fresh = STYLES.flatMap((s) => s.colours.filter((c) => c.door > 0 && c.door <= 6).map((c) => `${s.id}:${c.id}`));
    expect(fresh.length).toBe(18);
    const news = page(wardrobeView({ fresh })).querySelector(".elf-wd-news");
    expect(words(news)).toContain("18 new things have arrived");
    expect(words(news)).toContain("Green elf hat, blue elf hat, tan detective's hat, grey detective's hat, black round glasses and 13 more.");
  });

  it("is not there when nothing is new, or when what is listed is not real", () => {
    expect(page(wardrobeView({ fresh: [] })).querySelector(".elf-wd-news")).toBeNull();
    expect(page(wardrobeView({ fresh: ["<script>", "cape:red", "bobble:red"] })).querySelector(".elf-wd-news")).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(page(wardrobeView({ fresh: "tree" as any })).querySelector(".elf-wd-news")).toBeNull();
  });
});

describe("the style sheet", () => {
  // Found by tapping a real tile: the label moves a little while it is pressed, which lifted it
  // above the invisible radio button halfway through the tap. The press landed on one, the release
  // on the other, and the browser threw the tap away. No test of the page's HTML can see that.
  it("keeps the invisible radio button above its label, so a tap is never lost", () => {
    const css = readFileSync(resolve(__dirname, "../../assets/css/elf.css"), "utf8");
    const rule = /\.elf-wd-tile input \{([^}]*)\}/.exec(css);
    expect(rule, "the rule for .elf-wd-tile input").not.toBeNull();
    expect(rule![1]).toMatch(/position:\s*absolute/);
    expect(rule![1]).toMatch(/z-index:\s*1\b/);
    expect(css).toMatch(/\.elf-wd-tile input:disabled \{[^}]*pointer-events:\s*none/);
  });
});

describe("the painted pictures on the page", () => {
  it("loads the list of painted layers before the wardrobe script", () => {
    const html = renderWardrobePage(wardrobeView());
    const order = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1].replace(/^.*\//, "").replace(/\?.*$/, ""));
    expect(order.indexOf("elf-paint.js")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("elf-paint.js")).toBeLessThan(order.indexOf("elf-wardrobe.js"));
    expect(order.indexOf("elf-wardrobe.js")).toBeLessThan(order.indexOf("elf-wardrobe-ui.js"));
  });

  it("never puts a large picture on the wardrobe page", () => {
    expect(renderWardrobePage(wardrobeView())).not.toContain("/assets/img/elf/lg/");
  });

  it("keeps every tile on the page, together, under 600 KB, so it is quick on a phone", () => {
    usePaint(null);
    const html = renderWardrobePage(wardrobeView({ state: { doorsDone: 24, goldSeal: true, wonRace: true } }));
    const files = [...new Set([...html.matchAll(/\/assets\/img\/elf\/tile\/[a-z0-9-]+\.webp/g)].map((m) => m[0]))];
    const bytes = files.reduce((sum, f) => sum + (existsSync(resolve(ROOT, f.slice(1))) ? statSync(resolve(ROOT, f.slice(1))).size : 0), 0);
    expect(bytes).toBeLessThan(600 * 1024);
  });
});

describe("what comes from data", () => {
  it("is escaped wherever it is shown", () => {
    const view = wardrobeView();
    view.detective = { ...view.detective, id: '"><script>x</script>', name: '<img src=x onerror="alert(1)">', badgeNumber: "<i>1</i>" };
    const doc = page(view);
    // The only pictures are the painted tiles (the injected <img> must not be one of them).
    expect(doc.querySelector('script:not([src]), main img:not([src^="/assets/img/elf/tile/"]), main i, [onerror]')).toBeNull();
    expect(doc.querySelector<HTMLInputElement>('input[name="detective"]')!.value).toBe('"><script>x</script>');
    expect(words(doc.querySelector(".elf-wd-preview h2"))).toBe('<img src=x onerror="alert(1)">');
  });

  it("keeps the form and its links on this site", () => {
    const doc = page(wardrobeView({ saveUrl: "https://example.com/steal", hqUrl: "//example.com" }));
    expect(doc.querySelector("form.elf-wd")!.getAttribute("action")).toBe("/");
    for (const a of doc.querySelectorAll("main a")) expect(a.getAttribute("href")).toMatch(/^[/#]/);
    expect(doc.querySelector(".nav-cta")!.getAttribute("href")).toBe("/");
  });
});
