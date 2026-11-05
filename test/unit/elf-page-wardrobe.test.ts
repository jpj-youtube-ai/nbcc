// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { doorChip, renderWardrobePage } from "../../src/elf/pages/wardrobe";
import type { WardrobeView } from "../../src/elf/pages/types";
import { BOWS, COSTUMES, FRAMES, FRIENDS, GLASSES, SCENES } from "../../src/elf/wardrobe";
import { wardrobeView } from "./elf-fixtures";

// NBCC Elf Detective School: the wardrobe screen. Every family and detective here is invented (see
// elf-fixtures.ts). The page is one form of choices, so it works with no script: pick, press Save,
// and the server keeps the look. The script only changes the stage as things are tried on, and saves.

const ROOT = resolve(__dirname, "../..");
const page = (v: WardrobeView = wardrobeView()) => new DOMParser().parseFromString(renderWardrobePage(v), "text/html");
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const radios = (doc: Document, name: string) => [...doc.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`)];
const choice = (doc: Document, name: string, value: string) => doc.querySelector<HTMLInputElement>(`input[type="radio"][name="${name}"][value="${value}"]`)!;
/** What a screen reader says for a choice: the label's words that are not hidden from it. */
function said(doc: Document, input: HTMLInputElement): string {
  const label = doc.querySelector(`label[for="${input.id}"]`)!.cloneNode(true) as Element;
  label.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove());
  return words(label);
}

describe("the wardrobe page", () => {
  it("is a private page that loads the wardrobe before the script that uses it", () => {
    const doc = page();
    expect(words(doc.querySelector("h1"))).toBe("The wardrobe");
    expect(doc.querySelector('meta[name="robots"]')!.getAttribute("content")).toBe("noindex, nofollow");
    const scripts = [...doc.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"));
    expect(scripts).toEqual(["/assets/js/elf-wardrobe.js", "/assets/js/elf-wardrobe-ui.js"]);
    expect(doc.querySelector('.nav-cta[href="/elf/hq"]')).not.toBeNull();
  });

  it("gives nothing on the page the same id as anything else", () => {
    const ids = [...page().querySelectorAll("[id]")].map((el) => el.id);
    expect(ids.length).toBeGreaterThan(100);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the elf on the stage", () => {
  it("lays the look's pictures on the stage in order, in its frame, and says whose elf it is", () => {
    const stage = page().querySelector(".elf-wd-stage")!;
    expect([...stage.querySelectorAll("img")].map((i) => [i.getAttribute("data-picture"), i.getAttribute("src")])).toEqual([
      ["scene", "/assets/img/elf/paper/scenes/largs.webp"],
      ["body", "/assets/img/elf/paper/costumes/reindeer-s3.webp"],
      ["glasses", "/assets/img/elf/paper/pieces/specs-gold--reindeer.webp"],
      ["friend", "/assets/img/elf/paper/friends/robin.webp"],
    ]);
    // The frame is a paper frame round the stage, not a class on it.
    expect(stage.parentElement!.classList.contains("elf-wd-frame")).toBe(true);
    expect(stage.parentElement!.classList.contains("elf-frame--candy")).toBe(true);
    expect([...stage.classList].filter((c) => c.startsWith("elf-frame"))).toEqual([]);
    expect(stage.getAttribute("role")).toBe("img");
    expect(stage.getAttribute("aria-label")).toBe("Detective Ruby Tinselfoot's elf");
    for (const img of stage.querySelectorAll("img")) expect(img.getAttribute("alt")).toBe("");
  });

  it("says in words what the elf is wearing and where it is", () => {
    expect(words(page().querySelector(".elf-wd-wearing"))).toBe("Reindeer costume and gold glasses, with a robin. The Pencil, Largs, in a candy cane frame.");
  });

  it("draws only what is unlocked, whatever the saved look claims", () => {
    // The Santa suit comes with door 24, and Ruby has done doors 1 to 6.
    const doc = page(wardrobeView({ look: { ...wardrobeView().look, costume: "santa" } }));
    expect(doc.querySelector('.elf-wd-stage img[data-picture="body"]')!.getAttribute("src")).toBe("/assets/img/elf/paper/elves/elf-sister-s3-bunches-ginger.webp");
    expect(choice(doc, "costume", "santa").checked).toBe(false);
    expect(choice(doc, "costume", "").checked).toBe(true);
  });

  it("names the detective, with the badge and the rank", () => {
    const doc = page();
    expect(words(doc.querySelector(".elf-wd-preview h2"))).toBe("Detective Ruby Tinselfoot");
    expect(words(doc.querySelector(".elf-wd-preview"))).toContain("Badge 0427");
    expect(words(doc.querySelector(".elf-wd-preview"))).toContain("Junior Detective");
  });
});

describe("the form of choices", () => {
  it("works with no script: every choice is a radio, one picked in every group, and Save posts the look", () => {
    const doc = page();
    const form = doc.querySelector("form.elf-wd")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/elf/hq/wardrobe/d1");
    expect(doc.querySelector<HTMLInputElement>('input[type="hidden"][name="detective"]')!.value).toBe("d1");
    expect(doc.querySelector('form.elf-wd button[type="submit"]')).not.toBeNull();
    for (const name of ["sibling", "skin", "hair", "hairStyle", "costume", "scene", "friend", "frame", "glasses", "bow"]) {
      expect(radios(doc, name).length, name).toBeGreaterThan(1);
      expect(radios(doc, name).filter((r) => r.checked).length, name).toBe(1);
    }
    for (const r of doc.querySelectorAll<HTMLInputElement>('input[type="radio"]')) expect(doc.querySelector(`label[for="${r.id}"]`), r.id).not.toBeNull();
  });

  it("tells the script which doors are done", () => {
    expect(page().querySelector("form.elf-wd")!.getAttribute("data-doors")).toBe("1,2,3,4,5,6");
  });

  it("offers every costume and extra, with none on offer wherever it can be left off", () => {
    const doc = page();
    expect(radios(doc, "costume").map((r) => r.value)).toEqual(["", ...COSTUMES.map((c) => c.id)]);
    expect(radios(doc, "scene").map((r) => r.value)).toEqual(SCENES.map((s) => s.id));
    expect(radios(doc, "friend").map((r) => r.value)).toEqual(["", ...FRIENDS.map((f) => f.id)]);
    expect(radios(doc, "frame").map((r) => r.value)).toEqual(["", ...FRAMES.map((f) => f.id)]);
    expect(radios(doc, "glasses").map((r) => r.value)).toEqual(["", ...GLASSES.map((g) => g.id)]);
    expect(radios(doc, "bow").map((r) => r.value)).toEqual(["", ...BOWS.map((b) => b.id)]);
  });

  it("has the saved choices picked", () => {
    const doc = page();
    for (const [name, value] of [["costume", "reindeer"], ["scene", "largs"], ["friend", "robin"], ["frame", "candy"], ["glasses", "specs-gold"], ["bow", ""], ["skin", "s3"], ["hair", "ginger"], ["hairStyle", "bunches"], ["sibling", "sister"]]) {
      expect(choice(doc, name, value).checked, `${name} ${value}`).toBe(true);
    }
  });

  it("locks a costume until its door is done: it cannot be picked, wears a padlock and says which door opens it", () => {
    const doc = page();
    const santa = choice(doc, "costume", "santa");
    expect(santa.disabled).toBe(true);
    expect(santa.closest(".elf-wd-tile")!.classList.contains("is-locked")).toBe(true);
    expect(santa.closest(".elf-wd-tile")!.querySelector('.elf-wd-lock img[src="/assets/img/elf/paper/icons/icon-lock.webp"]')).not.toBeNull();
    expect(said(doc, santa)).toBe("Santa suit, opens with door 24");
    expect(choice(doc, "costume", "tree").disabled).toBe(false);
    // Doors 7 to 24 hold 36 costumes; the three from the start and doors 1 to 6 are open.
    expect(radios(doc, "costume").filter((r) => r.disabled).length).toBe(36);
  });

  it("wraps the costumes that have just arrived as presents to open", () => {
    const doc = page();
    for (const id of ["snowglobe", "puffin"]) {
      const tile = choice(doc, "costume", id).closest(".elf-wd-tile")!;
      expect(tile.classList.contains("is-new"), id).toBe(true);
      expect(tile.querySelector(".elf-wd-present img")!.getAttribute("src")).toMatch(/^\/assets\/img\/elf\/paper\/deco\/present-(crimson|holly|cream)\.webp$/);
      expect(said(doc, choice(doc, "costume", id))).toMatch(/, a present to open$/);
    }
    expect(choice(doc, "costume", "tree").closest(".elf-wd-tile")!.classList.contains("is-new")).toBe(false);
  });

  it("does not call a costume new while it is still locked, or one that is not real", () => {
    const doc = page(wardrobeView({ fresh: ["santa", "dragon"] }));
    expect(doc.querySelectorAll(".elf-wd-tile.is-new").length).toBe(0);
  });

  it("groups the costumes by door, the three from the start first", () => {
    const names = [...page().querySelectorAll(".elf-wd-door__name")].map((el) => words(el));
    expect(names).toEqual(["From the start", ...Array.from({ length: 24 }, (_, i) => `Door ${i + 1}`)]);
  });

  it("shows each costume's tile in the detective's own skin, loaded only when it comes near but the first row", () => {
    const tiles = [...page(wardrobeView({ look: { ...wardrobeView().look, skin: "s5" } })).querySelectorAll("img[data-costume]")];
    expect(tiles.length).toBe(51);
    for (const t of tiles) {
      expect(t.getAttribute("src")).toBe(`/assets/img/elf/paper/tiles/costumes/${t.getAttribute("data-costume")}-s5.webp`);
    }
    // The open tab's first row, the three from the start, comes at once; the rest when near.
    expect(tiles.filter((t) => t.getAttribute("loading") !== "lazy").map((t) => t.getAttribute("data-costume"))).toEqual(["workshop", "reindeer", "snowman"]);
  });
});

describe("the sections", () => {
  it("has a link to every section, in the order they come", () => {
    const doc = page();
    const tabs = [...doc.querySelectorAll(".elf-wd-tab")];
    // The words of each tab, without the mark a tab holding something new carries for a screen reader.
    expect(tabs.map((a) => words(a).replace(/, new things$/, ""))).toEqual(["Costumes", "Scenes", "Friends", "Frames", "Glasses and bow ties"]);
    expect(tabs.map((a) => a.getAttribute("href"))).toEqual([...doc.querySelectorAll(".elf-wd-panel")].map((p) => `#${p.id}`));
  });

  it("marks the section that holds something new", () => {
    const marked = [...page().querySelectorAll(".elf-wd-tab")].filter((a) => a.querySelector(".elf-wd-tab__new")).map((a) => a.getAttribute("href"));
    expect(marked).toEqual(["#wd-costumes"]);
  });
});

describe("the style sheet", () => {
  // Found by tapping a real tile: the label moves a little while it is pressed, which lifted it
  // above the invisible radio button halfway through the tap. The press landed on one, the release
  // on the other, and the browser threw the tap away. No test of the page's HTML can see that.
  it("keeps the invisible radio button above its label, so a tap is never lost", () => {
    const css = readFileSync(resolve(ROOT, "assets/css/elf.css"), "utf8");
    const rule = /\.elf-wd-tile input \{([^}]*)\}/.exec(css);
    expect(rule, "the rule for .elf-wd-tile input").not.toBeNull();
    expect(rule![1]).toMatch(/position:\s*absolute/);
    expect(rule![1]).toMatch(/z-index:\s*1\b/);
    expect(css).toMatch(/\.elf-wd-tile input:disabled \{[^}]*pointer-events:\s*none/);
  });
});

describe("the pictures on the page", () => {
  it("writes only paper pictures, and never an old painted layer", () => {
    const html = renderWardrobePage(wardrobeView());
    expect(html).not.toMatch(/\/assets\/img\/elf\/(lg|sm|tile)\//);
    for (const img of page().querySelectorAll("main img")) expect(img.getAttribute("src"), img.outerHTML).toMatch(/^\/assets\/img\/elf\/paper\//);
  });

  it("keeps the costume tiles for one skin, together, under 600 KB, so it is quick on a phone", () => {
    const tiles = [...page().querySelectorAll("img[data-costume]")].map((t) => t.getAttribute("src")!.slice(1));
    const bytes = tiles.reduce((sum, f) => sum + (existsSync(resolve(ROOT, f)) ? statSync(resolve(ROOT, f)).size : 600 * 1024), 0);
    expect(bytes).toBeLessThan(600 * 1024);
  });
});

describe("what comes from data", () => {
  it("is escaped wherever it is shown", () => {
    const view = wardrobeView();
    view.detective = { ...view.detective, id: '"><script>x</script>', name: '<img src=x onerror="alert(1)">', badgeNumber: "<i>1</i>" };
    const doc = page(view);
    // The only pictures are the paper ones (the injected <img> must not be one of them).
    expect(doc.querySelector('script:not([src]), main img:not([src^="/assets/img/elf/paper/"]), main i, [onerror]')).toBeNull();
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

// The paper wardrobe (docs/superpowers/specs/2026-11-04-elf-paper-design.md, mockup 6).
describe("the paper wardrobe", () => {
  const at = (iso: string) => new Date(iso);
  const chips = (v: WardrobeView, doors: number[]) => doors.map((n) => doorChip(n, v));

  it("gives each door's costumes the right chip", () => {
    // 2 December: doors 1 and 2 done, door 2's Christmas tree still wrapped.
    const v = wardrobeView({ now: at("2026-12-02T10:00:00.000Z"), state: { doors: [1, 2] }, fresh: ["tree"] });
    expect(chips(v, [0, 1, 2, 3])).toEqual([
      { kind: "start", words: "From the start" },
      { kind: "done", words: "Done" },
      { kind: "presents", words: "A present" },
      { kind: "soon", words: "Thu 3 Dec" },
    ]);
    expect(doorChip(2, wardrobeView({ now: at("2026-12-02T10:00:00.000Z"), state: { doors: [1, 2] }, fresh: ["tree", "polarbear"] }))).toEqual({ kind: "presents", words: "Two presents" });
    expect(doorChip(3, wardrobeView({ ...v, now: at("2026-12-03T09:00:00.000Z") })).kind).toBe("today");
    expect(doorChip(3, wardrobeView({ ...v, now: at("2026-12-05T09:00:00.000Z") })).kind).toBe("missed");
  });

  it("says why a locked costume is locked, on its note", () => {
    const note = (v: WardrobeView, id: string) => words(page(v).querySelector(`#wd-costume-${id}`)!.closest(".elf-wd-tile")!.querySelector(".elf-wd-why"));
    expect(note(wardrobeView(), "cracker")).toBe("Crack today's door to open it");
    expect(note(wardrobeView(), "santa")).toBe("Opens with door 24");
    expect(note(wardrobeView({ now: at("2026-12-09T09:00:00.000Z") }), "cracker")).toBe("Visit the place to catch up");
    expect(page().querySelector("#wd-costume-tree")!.closest(".elf-wd-tile")!.querySelector(".elf-wd-why")).toBeNull();
  });

  it("puts each door's costumes on a card sheet, its number on a rosette, with its chip", () => {
    const doc = page();
    const doors = [...doc.querySelectorAll("#wd-costumes .elf-wd-door")];
    expect(doors.length).toBe(25);
    for (const d of doors) expect(d.classList.contains("elf-card")).toBe(true);
    const door = (n: number) => doors[n];
    expect(door(7).querySelector(".elf-wd-door__num svg.elf-rosette")).not.toBeNull();
    expect(words(door(7).querySelector(".elf-wd-door__num"))).toBe("7");
    expect(words(door(7).querySelector(".elf-wd-door__chip"))).toBe("Today");
    expect(words(door(6).querySelector(".elf-wd-door__chip"))).toBe("Two presents");
    expect(words(door(1).querySelector(".elf-wd-door__chip"))).toBe("Done");
    expect(words(door(8).querySelector(".elf-wd-door__chip"))).toBe("Tue 8 Dec");
    expect(door(0).querySelector(".elf-wd-door__chip")).toBeNull();
    expect(words(doc.querySelector("#wd-costumes .elf-wd-haul"))).toBe("13 of 51 costumes are yours");
  });

  it("has its title on a torn strip under the school's name", () => {
    const doc = page();
    expect(words(doc.querySelector(".elf-wd-top .elf-label"))).toBe("Elf Detective School");
    expect(words(doc.querySelector(".elf-title h1#elf-wd-heading"))).toBe("The wardrobe");
  });

  it("dresses the stage for Christmas: a paper frame, fairy lights, baubles and the count on a rosette", () => {
    const doc = page();
    expect(doc.querySelectorAll(".elf-wd-stage .elf-wd-glows span").length).toBe(13);
    expect(doc.querySelector(".elf-wd-stage")!.getAttribute("data-scene")).toBe("largs");
    expect(doc.querySelectorAll('img.elf-wd-hang[src="/assets/img/elf/paper/deco/bauble.webp"]').length).toBe(2);
    const seal = doc.querySelector(".elf-wd-seal")!;
    expect(seal.getAttribute("aria-hidden")).toBe("true");
    expect(seal.querySelector("svg.elf-rosette")).not.toBeNull();
    expect(words(seal)).toBe("13 of 51");
  });

  it("makes step 1 a sheet torn off a pad, with paper circles for the colours, ready to fold away", () => {
    const doc = page();
    expect(words(doc.querySelector(".elf-wd-step--elf h2#wd-step1"))).toBe("Your elf");
    const fold = doc.querySelector(".elf-wd-fold#wd-elf")!;
    expect(fold.querySelector(".elf-paper .elf-tape")).not.toBeNull();
    for (const name of ["skin", "hair"]) {
      for (const r of radios(doc, name)) expect(r.closest(".elf-wd-tile")!.querySelector("svg.elf-circle"), `${name} ${r.value}`).not.toBeNull();
    }
    const change = doc.querySelector<HTMLButtonElement>("button.elf-wd-change")!;
    expect(change.getAttribute("aria-controls")).toBe("wd-elf");
    expect(change.getAttribute("aria-expanded")).toBe("true");
    expect(change.hidden).toBe(true);
    expect(doc.querySelector("form.elf-wd")!.getAttribute("data-made")).toBe("true");
    expect(page(wardrobeView({ made: false })).querySelector("form.elf-wd")!.getAttribute("data-made")).toBe("false");
  });

  it("names step 2's sections on gift tags, each with its painted icon", () => {
    const tags = [...page().querySelectorAll(".elf-wd-tab")];
    expect(tags.length).toBe(5);
    for (const t of tags) {
      expect(t.querySelector("svg.elf-tag__card")).not.toBeNull();
      expect(t.querySelector("img")!.getAttribute("src")).toMatch(/^\/assets\/img\/elf\/paper\/icons\/icon-[a-z]+\.webp$/);
    }
  });

  it("keeps the tools the script brings to life hidden until it does", () => {
    const doc = page();
    const tools = doc.querySelector<HTMLElement>(".elf-wd-tools")!;
    expect(tools.hidden).toBe(true);
    expect(words(tools.querySelector(".elf-wd-surprise"))).toBe("Surprise me");
    expect(words(tools.querySelector(".elf-wd-snap"))).toBe("Snap a photo");
    const sound = doc.querySelector<HTMLButtonElement>(".elf-wd-sound")!;
    expect([sound.hidden, sound.getAttribute("aria-pressed"), words(sound)]).toEqual([true, "false", "Sounds off"]);
    expect(doc.querySelector<HTMLButtonElement>(".elf-wd-peek")!.hidden).toBe(true);
  });

  it("pegs the favourite looks on a string, each a button that wears it again", () => {
    const look = wardrobeView().look;
    const doc = page(wardrobeView({ favourites: [{ ...look, costume: "snowman" }, { ...look, costume: null }] }));
    const photos = [...doc.querySelectorAll<HTMLButtonElement>(".elf-wd-looks .elf-wd-polaroid")];
    expect(photos.map((p) => p.getAttribute("aria-label"))).toEqual(["Wear this look again: Snowman", "Wear this look again: My elf"]);
    expect(doc.querySelector(".elf-wd-looks__empty")).toBeNull();
    expect(words(page().querySelector(".elf-wd-looks__empty"))).toBe("Snap a photo to peg your look here");
  });

  it("asks for under 1 MB of pictures before anything is tapped", () => {
    const eager = [...page().querySelectorAll("img")].filter((img) => img.getAttribute("loading") !== "lazy").map((img) => img.getAttribute("src")!);
    const bytes = [...new Set(eager)].reduce((sum, src) => sum + (existsSync(resolve(ROOT, src.slice(1))) ? statSync(resolve(ROOT, src.slice(1))).size : 0), 0);
    expect(eager.length).toBeGreaterThan(10);
    expect(bytes).toBeLessThan(1024 * 1024);
  });
});

// The final review (5 November 2026): what a person at a laptop, or in a narrow column, would meet.
describe("the paper wardrobe at every width", () => {
  const css = readFileSync(resolve(ROOT, "assets/css/elf.css"), "utf8");

  it("keeps the stage and its two tools in view together on a laptop, the stage sized to the screen's height", () => {
    // Measured at 1366 by 657: the whole sticky plate was 1205px tall, so Snap a photo sat below the screen.
    const stick = page().querySelector(".elf-wd-stick")!;
    expect(stick.querySelector(".elf-wd-stage")).not.toBeNull();
    expect(stick.querySelector(".elf-wd-surprise")).not.toBeNull();
    expect(stick.querySelector(".elf-wd-snap")).not.toBeNull();
    expect(css).toMatch(/\.elf-wd-stick \{[^}]*position:\s*sticky/);
    expect(css).not.toMatch(/\.elf-wd-preview \{[^}]*position:\s*sticky/);
    expect(css).toMatch(/\.elf-wd-show \{[^}]*width:\s*min\(100%, 360px, calc\(\(100vh/);
  });

  it("hangs the gift tags three over two whenever the dress up column is narrow, not only on a phone", () => {
    // Measured at 920: "Glasses and bow ties" hung 30px below its tag.
    expect(css).toMatch(/\.elf-wd-step--dress \{[^}]*container-type:\s*inline-size/);
    expect(css).toMatch(/@container \(max-width: 640px\) \{[^@]*\.elf-wd-tabs li:nth-child\(4\) \{ grid-column: 2 \/ span 2; \}/);
  });
});
