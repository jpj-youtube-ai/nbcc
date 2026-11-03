// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderWardrobePage } from "../../src/elf/pages/wardrobe";
import type { WardrobeView } from "../../src/elf/pages/types";
import { drawElf, drawOutfit } from "../../src/elf/wardrobe";
import { wardrobeView } from "./elf-fixtures";
import { PAINT_FIXTURE } from "./elf-paint-fixture";

// NBCC Elf Detective School: the script on the wardrobe page. It shows the elf changing as things
// are tried on, saves the look without leaving the page, and turns the sections into tabs. It runs
// here against the real page and the real wardrobe file, with a pretend server. Every family and
// detective is invented (see elf-fixtures.ts).

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initWardrobe } = require(resolve(ROOT, "assets/js/elf-wardrobe-ui.js"));
const elf = require(resolve(ROOT, "assets/js/elf-wardrobe.js"));

interface Wardrobe {
  look(): Record<string, unknown>;
  save(): void;
  show(id: string): void;
  stop(): void;
}

let wd: Wardrobe | null = null;
let calls: { url: string; body: Record<string, unknown>; keepalive: unknown }[] = [];
let answer: { status: number; body: unknown } | "offline" = { status: 200, body: { ok: true } };

const SIX = { doorsDone: 6, goldSeal: false, wonRace: false };
const LABEL = "Detective Ruby Tinselfoot's elf";
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const choice = (value: string) => $<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
const outfit = (id: string) => $<HTMLInputElement>(`input[name="outfit"][value="${id}"]`);
const tab = (name: string) => $$<HTMLAnchorElement>(".elf-wd-tab").find((a) => words(a).startsWith(name))!;
const shown = () => $$(".elf-wd-panel").filter((p) => !p.hidden).map((p) => p.id);
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
/** Markup as a page holds it: a browser writes <rect/> back as <rect></rect>. */
function asPage(html: string): string {
  const box = document.createElement("div");
  box.innerHTML = html;
  return box.innerHTML;
}
/** The elf as the page should now be drawing it. */
const drawn = (look: unknown, state = SIX) => asPage(drawElf(look, state, { size: 260, backdrop: false, key: "preview", label: LABEL }));

function load(view: WardrobeView = wardrobeView(), opts: Record<string, unknown> = {}): Wardrobe | null {
  document.documentElement.innerHTML = new DOMParser().parseFromString(renderWardrobePage(view), "text/html").documentElement.innerHTML;
  calls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {}, keepalive: init?.keepalive });
    if (answer === "offline") return Promise.reject(new Error("offline"));
    const a = answer;
    return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
  });
  wd = initWardrobe(document, window, { elf, ...opts }) as Wardrobe | null;
  return wd;
}

afterEach(() => {
  wd?.stop();
  wd = null;
  answer = { status: 200, body: { ok: true } };
  vi.useRealTimers();
  window.location.hash = "";
});


beforeEach(() => elf.usePaint(PAINT_FIXTURE));
afterEach(() => elf.usePaint(null));

describe("trying things on", () => {
  it("changes the elf in the mirror the moment something is picked", () => {
    load();
    const before = wardrobeView().look;
    expect($(".elf-wd-mirror").innerHTML).toBe(drawn(before));
    choice("elf:green").click();
    const after = { ...before, pieces: { ...before.pieces, hat: ["elf", "green"] } };
    expect($(".elf-wd-mirror").innerHTML).toBe(drawn(after));
    expect($(".elf-wd-mirror").innerHTML).not.toBe(drawn(before));
    expect($(".elf-wd-mirror svg").getAttribute("aria-label")).toBe(LABEL);
  });

  it("keeps the words about what the elf is wearing in step with the picture", () => {
    load();
    choice("elf:green").click();
    $<HTMLInputElement>('input[name="piece-face"][value=""]').click();
    expect(words($(".elf-wd-wearing"))).toBe(
      "Wearing: Green elf hat, red striped scarf, red elf tunic, brown snow boots and brass magnifying glass.",
    );
  });

  it("changes the skin and the hair too", () => {
    load();
    choice("s5").click();
    choice("black").click();
    choice("curly").click();
    const look = { ...wardrobeView().look, skin: "s5", hair: "black", hairStyle: "curly" };
    expect($(".elf-wd-mirror").innerHTML).toBe(drawn(look));
    expect(wd!.look()).toEqual(look);
  });

  it("changes a sister to a brother", () => {
    load();
    choice("brother").click();
    const look = { ...wardrobeView().look, sibling: "brother" };
    expect($(".elf-wd-mirror").innerHTML).toBe(drawn(look));
    expect(wd!.look()).toEqual(look);
  });

  it("puts a whole outfit on, and takes it off again when a piece is picked", () => {
    load();
    outfit("present").click();
    expect(words($(".elf-wd-wearing"))).toBe("Wearing: The present outfit.");
    expect($(".elf-wd-mirror").innerHTML).toBe(drawn({ ...wardrobeView().look, outfit: "present" }));
    choice("elf:green").click();
    expect(outfit("").checked).toBe(true);
    expect(words($(".elf-wd-wearing"))).toContain("Green elf hat");
  });

  it("leaves the outfit on when a slot is only emptied, or the skin is changed", () => {
    load();
    outfit("present").click();
    $<HTMLInputElement>('input[name="piece-face"][value=""]').click();
    choice("s1").click();
    expect(outfit("present").checked).toBe(true);
    expect(words($(".elf-wd-wearing"))).toBe("Wearing: The present outfit.");
  });

  it("draws the outfits on the elf's own face, so their tiles change with the skin and hair", () => {
    load();
    const tile = () => outfit("tree").closest(".elf-wd-tile")!.querySelector(".elf-wd-art")!.innerHTML;
    expect(tile()).toBe(asPage(drawOutfit("tree", wardrobeView().look, 72)));
    choice("s5").click();
    expect(tile()).toBe(asPage(drawOutfit("tree", { ...wardrobeView().look, skin: "s5" }, 72)));
    expect(tile()).not.toBe(asPage(drawOutfit("tree", wardrobeView().look, 72)));
  });
});

describe("what is locked", () => {
  it("stays locked: the script never makes a locked thing pickable", () => {
    load();
    const before = $$<HTMLInputElement>('form.elf-wd input[type="radio"]:disabled').map((i) => i.value);
    expect(before.length).toBeGreaterThan(40);
    choice("elf:green").click();
    wd!.show("wd-slot-hat");
    expect($$<HTMLInputElement>('form.elf-wd input[type="radio"]:disabled').map((i) => i.value)).toEqual(before);
  });

  it("says why when a locked thing is tapped, and changes nothing", () => {
    load();
    const before = $(".elf-wd-mirror").innerHTML;
    const bobble = choice("bobble:red");
    document.querySelector<HTMLElement>(`label[for="${bobble.id}"]`)!.click();
    expect(bobble.checked).toBe(false);
    expect($(".elf-wd-mirror").innerHTML).toBe(before);
    expect(words($(".elf-wd-status"))).toBe("Red bobble hat, locked until you have done 7 doors.");
    expect(bobble.closest(".elf-wd-tile")!.classList.contains("is-rattled")).toBe(true);
    expect(calls).toEqual([]);
  });

  it("is never drawn, even if the page is meddled with", () => {
    load();
    const bobble = choice("bobble:red");
    bobble.disabled = false;
    bobble.click();
    expect($(".elf-wd-mirror").innerHTML).toBe(drawn({ ...wardrobeView().look, pieces: { ...wardrobeView().look.pieces, hat: ["elf", "red"] } }));
    expect(words($(".elf-wd-wearing"))).toContain("Red elf hat");
  });

  it("reads what has been earned as numbers, so a gold seal outfit can be worn once it is earned", () => {
    load(wardrobeView({ state: { doorsDone: 24, goldSeal: true, wonRace: true } }));
    outfit("golden").click();
    expect(words($(".elf-wd-wearing"))).toBe("Wearing: The golden detective outfit.");
    outfit("nessie").click();
    expect(words($(".elf-wd-wearing"))).toBe("Wearing: The Nessie outfit.");
  });
});

describe("saving", () => {
  it("saves the look by itself once the changes settle, in one go", async () => {
    vi.useFakeTimers();
    load();
    choice("elf:green").click();
    choice("s5").click();
    vi.advanceTimersByTime(300);
    choice("black").click();
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(900);
    await flush();
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/elf/look");
    const look = { ...wardrobeView().look, skin: "s5", hair: "black", pieces: { ...wardrobeView().look.pieces, hat: ["elf", "green"] } };
    expect(calls[0].body).toEqual({ detectiveId: "d1", look, tried: [] });
    expect(words($(".elf-wd-status"))).toBe("Saved");
    expect($(".elf-wd-status").classList.contains("is-error")).toBe(false);
  });

  it("hides the Save button, because the look saves itself", () => {
    load();
    expect($<HTMLButtonElement>('form.elf-wd button[type="submit"]').hidden).toBe(true);
  });

  it("says plainly when the look could not be saved, and offers the Save button", async () => {
    answer = { status: 500, body: { ok: false } };
    load();
    choice("elf:green").click();
    wd!.save();
    await flush();
    expect(words($(".elf-wd-status"))).toBe("We could not save this look. Check your signal and try again.");
    expect($(".elf-wd-status").classList.contains("is-error")).toBe(true);
    const button = $<HTMLButtonElement>('form.elf-wd button[type="submit"]');
    expect(button.hidden).toBe(false);

    answer = { status: 200, body: { ok: true } };
    const event = new Event("submit", { bubbles: true, cancelable: true });
    $("form.elf-wd").dispatchEvent(event);
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(calls.length).toBe(2);
    expect(words($(".elf-wd-status"))).toBe("Saved");
    expect(button.hidden).toBe(true);
  });

  it("says the same when there is no signal at all, or the server answers no", async () => {
    answer = "offline";
    load();
    choice("elf:green").click();
    wd!.save();
    await flush();
    expect(words($(".elf-wd-status"))).toBe("We could not save this look. Check your signal and try again.");
    answer = { status: 200, body: { ok: false, reason: "unknown-detective" } };
    wd!.save();
    await flush();
    expect($(".elf-wd-status").classList.contains("is-error")).toBe(true);
  });

  it("sends a change made while a save is on its way, straight after", async () => {
    load();
    choice("elf:green").click();
    wd!.save();
    choice("elf:blue").click();
    wd!.save();
    expect(calls.length).toBe(1);
    await flush();
    await flush();
    expect(calls.length).toBe(2);
    expect((calls[1].body.look as { pieces: { hat: string[] } }).pieces.hat).toEqual(["elf", "blue"]);
  });

  it("saves a change that is still waiting when the page is left", () => {
    vi.useFakeTimers();
    load();
    choice("elf:green").click();
    expect(calls).toEqual([]);
    window.dispatchEvent(new Event("pagehide"));
    expect(calls.length).toBe(1);
    expect(calls[0].keepalive).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(calls.length).toBe(1);
  });

  it("sends the latest change straight away when the page is left while an earlier save is on its way", () => {
    load();
    choice("elf:green").click();
    wd!.save();
    choice("elf:blue").click();
    wd!.save();
    expect(calls.length).toBe(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(calls.length).toBe(2);
    expect((calls[1].body.look as { pieces: { hat: string[] } }).pieces.hat).toEqual(["elf", "blue"]);
    expect(calls[1].keepalive).toBe(true);
  });

  it("saves when the page is hidden too, which is all a phone says when an app is swiped away", () => {
    vi.useFakeTimers();
    load();
    choice("elf:green").click();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(calls.length).toBe(1);
  });

  it("treats an answer that is not JSON as not saved", async () => {
    load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error("not json")) }));
    choice("elf:green").click();
    wd!.save();
    await flush();
    expect($(".elf-wd-status").classList.contains("is-error")).toBe(true);
  });

  it("keeps the warning about a failed save when a locked thing is tapped", async () => {
    answer = { status: 500, body: {} };
    load();
    choice("elf:green").click();
    wd!.save();
    await flush();
    document.querySelector<HTMLElement>(`label[for="${choice("bobble:red").id}"]`)!.click();
    expect(words($(".elf-wd-status"))).toBe("We could not save this look. Check your signal and try again.");
  });

  it("draws and saves choices the browser put back that the mirror does not show", () => {
    vi.useFakeTimers();
    const html = renderWardrobePage(wardrobeView());
    document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
    choice("elf:green").checked = true;
    calls = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)), keepalive: init?.keepalive });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    });
    wd = initWardrobe(document, window, { elf }) as Wardrobe;
    expect(words($(".elf-wd-wearing"))).toContain("Green elf hat");
    vi.advanceTimersByTime(1000);
    expect(calls.length).toBe(1);
  });

  it("sends nothing when the page is left with nothing changed", () => {
    load();
    window.dispatchEvent(new Event("pagehide"));
    expect(calls).toEqual([]);
  });
});

describe("what is new", () => {
  it("loses its New tag once it is tried on, and the server is told", async () => {
    load();
    const jumper = choice("jumper:red");
    const tile = jumper.closest(".elf-wd-tile")!;
    jumper.click();
    expect(tile.classList.contains("is-new")).toBe(false);
    expect(tile.querySelector(".elf-wd-new")).toBeNull();
    expect(words(tile.querySelector(".sr-only"))).toBe("Red Christmas jumper");
    wd!.save();
    await flush();
    expect(calls[0].body.tried).toEqual(["jumper:red"]);
  });

  it("tells the server once: a thing already told is not sent again", async () => {
    load();
    choice("jumper:red").click();
    wd!.save();
    await flush();
    outfit("tree").click();
    wd!.save();
    await flush();
    expect(calls[1].body.tried).toEqual(["tree"]);
  });

  it("keeps what was tried for the next save when a save fails", async () => {
    answer = { status: 500, body: {} };
    load();
    choice("jumper:red").click();
    wd!.save();
    await flush();
    answer = { status: 200, body: { ok: true } };
    wd!.save();
    await flush();
    expect(calls[1].body.tried).toEqual(["jumper:red"]);
  });

  it("takes the mark off a section once nothing in it is new", () => {
    load();
    expect(tab("Tops").querySelector(".elf-wd-tab__new")).not.toBeNull();
    choice("jumper:red").click();
    expect(tab("Tops").querySelector(".elf-wd-tab__new")).not.toBeNull();
    choice("jumper:green").click();
    expect(tab("Tops").querySelector(".elf-wd-tab__new")).toBeNull();
    expect(words(tab("Tops"))).toBe("Tops");
    expect(tab("Shoes").querySelector(".elf-wd-tab__new")).not.toBeNull();
  });
});

describe("the sections as tabs", () => {
  it("shows one section at a time, starting with the first that holds something new", () => {
    load();
    expect($(".elf-wd-tabs").getAttribute("role")).toBe("tablist");
    expect(shown()).toEqual(["wd-outfits"]);
    expect(tab("Outfits").getAttribute("aria-selected")).toBe("true");
    expect($$(".elf-wd-tab").filter((t) => t.getAttribute("aria-selected") === "true").length).toBe(1);
    expect($("form.elf-wd").classList.contains("is-live")).toBe(true);
  });

  it("starts at the first section when nothing is new", () => {
    load(wardrobeView({ fresh: [] }));
    expect(shown()).toEqual(["wd-look"]);
  });

  it("opens a section when its tab is pressed, without jumping down the page", () => {
    load();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    tab("Hats").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(shown()).toEqual(["wd-slot-hat"]);
    expect(tab("Hats").getAttribute("aria-selected")).toBe("true");
    expect(tab("Outfits").getAttribute("aria-selected")).toBe("false");
  });

  it("is a real set of tabs to a screen reader and a keyboard", () => {
    load();
    const tabs = $$(".elf-wd-tab");
    for (const t of tabs) {
      expect(t.getAttribute("role")).toBe("tab");
      const panel = document.getElementById(t.getAttribute("aria-controls")!)!;
      expect(panel.getAttribute("role")).toBe("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(t.id);
      expect(t.parentElement!.getAttribute("role")).toBe("presentation");
    }
    expect(tabs.filter((t) => t.getAttribute("tabindex") === "0").length).toBe(1);
    expect(tab("Outfits").getAttribute("tabindex")).toBe("0");

    tab("Outfits").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(shown()).toEqual(["wd-slot-hat"]);
    expect(document.activeElement).toBe(tab("Hats"));
    tab("Hats").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    tab("Outfits").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    expect(shown()).toEqual(["wd-look"]);
    tab("Skin and hair").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    expect(shown()).toEqual(["wd-slot-extra"]);
    tab("Extras").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    expect(shown()).toEqual(["wd-look"]);
    tab("Skin and hair").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(shown()).toEqual(["wd-slot-extra"]);
  });

  it("opens the section named in the address, if there is one", () => {
    window.location.hash = "#wd-slot-feet";
    load();
    expect(shown()).toEqual(["wd-slot-feet"]);
    window.location.hash = "#somewhere-else";
    load();
    expect(shown()).toEqual(["wd-outfits"]);
  });
});

describe("without the wardrobe file", () => {
  it("leaves the page as it was: every section showing and the Save button there", () => {
    const got = load(wardrobeView(), { elf: null });
    expect(got).toBeNull();
    expect(shown().length).toBe(9);
    expect($<HTMLButtonElement>('form.elf-wd button[type="submit"]').hidden).toBe(false);
    expect($(".elf-wd-tabs").getAttribute("role")).toBeNull();
  });
});
