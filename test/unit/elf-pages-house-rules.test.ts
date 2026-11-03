// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { renderCalendarPage } from "../../src/elf/pages/calendar";
import { renderHqPage } from "../../src/elf/pages/hq";
import { renderJoinPage } from "../../src/elf/pages/join";
import { renderRulesPage } from "../../src/elf/pages/rules";
import { calendarViewFor } from "../../src/elf/views";
import { renderSignInPage, renderWelcomePage } from "../../src/elf/pages/sign-in";
import { FESTIVE_SURNAMES } from "../../src/elf/names";
import { ELF_DEFAULTS } from "../../src/elf/settings";
import { renderPosterPage } from "../../src/elf/pages/poster";
import { renderWardrobePage } from "../../src/elf/pages/wardrobe";
import { AFTERNOON, at, calendarView, claimWin, hqView, posterView, stampWin, wardrobeView } from "./elf-fixtures";

// NBCC Elf Detective School: the house rules every elf screen must keep.
//
// The site's own page tests (page-shell, accessibility, copy-rules) read the *.html files at the
// root of the repository. These screens are drawn by functions instead, so those tests never see
// them, and the same rules are checked here: over every screen, in every state it can be in.
// Every shop, family and detective is invented (see elf-fixtures.ts).

const ROOT = resolve(__dirname, "../..");
const place = { name: "The Toy Shop", town: "Troon" };
const found = { at: at("2026-12-07T17:47:00.000Z"), by: "Detective Ruby Tinselfoot", elfUrl: "/elf/pic/7.svg", photoUrl: "/elf/photo/7.jpg" };
const opened = { place, counts: { cracked: 31, visited: 4 }, factLine: "NBCC began with a question from a girl aged 12 in Annbank." };
const today = hqView().today!;
const outcome = { place: "The Toy Shop, Troon", by: "Detective Orla Snowsleuth", at: at("2026-12-07T17:47:00.000Z"), cracked: true };
const everyoneStamped = posterView({ open: true, claimable: false, detectives: posterView().detectives.map((d) => ({ ...d, hasStamp: true })) });

/** Every screen in every state, as [what it is, the page]. */
const PAGES: [string, string][] = [
  ["calendar, before December", renderCalendarPage(calendarView(at("2026-11-08T09:00:00.000Z")))],
  ["calendar, today's door shut", renderCalendarPage(calendarView(AFTERNOON))],
  ["calendar, the hunt on", renderCalendarPage(calendarView(at("2026-12-07T17:40:00.000Z"), { state: "hunting" }))],
  ["calendar, today's elf found", renderCalendarPage(calendarView(at("2026-12-07T18:10:00.000Z"), { state: "found", found, ...opened }))],
  ["calendar, today's place shown", renderCalendarPage(calendarView(at("2026-12-07T21:30:00.000Z"), { state: "revealed", ...opened }))],
  ["calendar, all done", renderCalendarPage(calendarView(at("2026-12-25T10:00:00.000Z")))],
  ["HQ, before the clue", renderHqPage(hqView({ today: { ...today, state: "shut", clue: null, options: [] } }))],
  ["HQ, the hunt on", renderHqPage(hqView())],
  ["HQ, a guess locked in", renderHqPage(hqView({ today: { ...today, guess: today.options[1] } }))],
  ["HQ, found and cracked", renderHqPage(hqView({ today: { ...today, state: "found", options: [], guess: today.options[0], outcome } }))],
  ["HQ, place shown", renderHqPage(hqView({ today: { ...today, state: "revealed", options: [], outcome: { ...outcome, by: null, at: null, cracked: false } } }))],
  ["HQ, no door today", renderHqPage(hqView({ now: at("2026-11-20T10:00:00.000Z"), today: null, nextClueAt: at("2026-12-01T17:30:00.000Z") }))],
  ["HQ, all over", renderHqPage(hqView({ now: at("2026-12-26T10:00:00.000Z"), today: null, nextClueAt: null }))],
  ["join", renderJoinPage({ settings: { ...ELF_DEFAULTS, schoolOn: true }, captchaSiteKey: null, surnames: FESTIVE_SURNAMES })],
  ["join, refused", renderJoinPage({ settings: { ...ELF_DEFAULTS, schoolOn: true }, captchaSiteKey: "1x00000000000000000000AA", surnames: FESTIVE_SURNAMES, errors: ["Please pick a surname from the list for each detective."], values: { grownUpName: "Sam Example" } })],
  ["rules", renderRulesPage({ settings: { ...ELF_DEFAULTS, schoolOn: true } })],
  ["calendar, live before December", renderCalendarPage(calendarViewFor({ settings: { ...ELF_DEFAULTS, schoolOn: true }, now: at("2026-11-13T09:00:00.000Z") }))],
  ["sign in, the email", renderSignInPage({ stage: "email" })],
  ["sign in, the code", renderSignInPage({ stage: "code", email: "sam@example.com", message: "If that email has detectives enrolled, we have sent a sign in code to it." })],
  ["sign in, a wrong code", renderSignInPage({ stage: "code", email: "sam@example.com", message: "That code does not work. Check it, or ask for a new one.", error: true })],
  ["welcome, checking the payment", renderWelcomePage({ state: "checking" })],
  ["welcome, done", renderWelcomePage({ state: "done" })],
  ["wardrobe", renderWardrobePage(wardrobeView())],
  ["wardrobe, everything earned", renderWardrobePage(wardrobeView({ state: { doorsDone: 24, goldSeal: true, wonRace: true }, fresh: ["golden", "nessie", "bow:gold"] }))],
  ["wardrobe, nothing earned", renderWardrobePage(wardrobeView({ state: { doorsDone: 0 }, fresh: [] }))],
  ["poster, not signed in", renderPosterPage(posterView({ signedIn: false, detectives: [] }))],
  ["poster, door not open", renderPosterPage(posterView())],
  ["poster, place shown and elf waiting", renderPosterPage(posterView({ open: true, claimable: true }))],
  ["poster, elf found", renderPosterPage(posterView({ open: true, claimable: false }))],
  ["poster, everyone has the candy cane", renderPosterPage(everyoneStamped)],
  ["poster, a claim that won", renderPosterPage(posterView({ open: true, claimable: false }), { form: "claim", ok: true, win: claimWin() })],
  ["poster, a claim refused", renderPosterPage(posterView(), { form: "claim", ok: false, reason: "wrong-word", triesLeft: 2 })],
  ["poster, a check in that counted", renderPosterPage(everyoneStamped, { form: "stamp", ok: true, win: stampWin() })],
  ["poster, a check in refused", renderPosterPage(posterView({ open: true, claimable: false }), { form: "stamp", ok: false, reason: "too-far" })],
];

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

/** Everything on a page that a person reads or a screen reader says. */
function readWords(doc: Document): string[] {
  const out: string[] = [doc.title, doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? ""];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("script, style")) continue;
    const text = (node.textContent ?? "").trim();
    if (text) out.push(text);
  }
  for (const el of doc.querySelectorAll("[alt], [title], [aria-label], [placeholder]")) {
    for (const name of ["alt", "title", "aria-label", "placeholder"]) {
      const value = el.getAttribute(name);
      if (value) out.push(value);
    }
  }
  return out;
}

/** Words that break the house style: a dash, or a hyphen between two word characters. */
function badWords(doc: Document): string[] {
  return readWords(doc).filter((said) => /[–—]/.test(said) || /[A-Za-z0-9]-[A-Za-z0-9]/.test(said));
}

/** Pictures without their words or size, and form controls without a label. */
function unlabelled(doc: Document): string[] {
  const out: string[] = [];
  for (const img of doc.querySelectorAll("img")) {
    if (!img.hasAttribute("alt") || !/^\d+$/.test(img.getAttribute("width") ?? "") || !/^\d+$/.test(img.getAttribute("height") ?? "")) out.push(img.outerHTML);
  }
  for (const control of doc.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea')) {
    if (!control.id || !doc.querySelector(`label[for="${control.id}"]`)) out.push(control.outerHTML);
  }
  for (const svg of doc.querySelectorAll("svg")) {
    const named = svg.getAttribute("role") === "img" && !!svg.getAttribute("aria-label");
    if (!named && svg.getAttribute("aria-hidden") !== "true" && !svg.closest('[aria-hidden="true"]')) out.push(svg.outerHTML.slice(0, 80));
  }
  return out;
}

/** Anything that would run from the page itself rather than from a script file. */
function runsInPage(doc: Document): string[] {
  const out: string[] = [];
  for (const script of doc.querySelectorAll("script")) {
    if (!/^\/assets\/js\/elf-[a-z-]+\.js$/.test(script.getAttribute("src") ?? "") || !script.hasAttribute("defer")) out.push(script.outerHTML.slice(0, 80));
  }
  for (const el of doc.querySelectorAll("*")) {
    for (const attr of el.getAttributeNames()) if (attr.startsWith("on")) out.push(`${el.tagName} ${attr}`);
  }
  for (const style of doc.querySelectorAll("style")) out.push(style.outerHTML.slice(0, 80));
  return out;
}

/** Links, forms and pictures that point anywhere but this site. */
function offSite(doc: Document): string[] {
  const out: string[] = [];
  for (const a of doc.querySelectorAll("a")) if (!/^(\/(?!\/)|#)/.test(a.getAttribute("href") ?? "")) out.push(a.outerHTML);
  for (const form of doc.querySelectorAll("form")) if (!/^\/(?!\/)/.test(form.getAttribute("action") ?? "")) out.push(`form ${form.getAttribute("action")}`);
  for (const img of doc.querySelectorAll("img")) if (!/^\/(?!\/)/.test(img.getAttribute("src") ?? "")) out.push(img.outerHTML);
  return out;
}

describe("the checks themselves", () => {
  it("catch a page that breaks the rules, so a clean result means something", () => {
    const bad = parse(
      "<html><head><title>A well-known shop</title></head><body><main>" +
        '<p>Open 9–5</p><p aria-label="A first-class prize">x</p>' +
        '<img src="//elsewhere.example/a.png"><input id="word"><svg></svg>' +
        '<a href="https://elsewhere.example">out</a><form action="//elsewhere.example"></form>' +
        '<button onclick="go()">Go</button><script>go()</script><style>p{}</style>' +
        "</main></body></html>",
    );
    expect(badWords(bad)).toEqual(["A well-known shop", "Open 9–5", "A first-class prize"]);
    expect(unlabelled(bad).length).toBe(3);
    expect(runsInPage(bad).length).toBe(3);
    expect(offSite(bad).length).toBe(3);
  });
});

describe.each(PAGES)("%s", (_name, html) => {
  const doc = parse(html);

  it("is one page with one main, a skip link first, and a name for the tab and for search", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(doc.documentElement.getAttribute("lang")).toBe("en");
    expect(doc.querySelectorAll("main").length).toBe(1);
    expect(doc.querySelector("main.site-main#main")).not.toBeNull();
    const first = doc.body.firstElementChild!;
    expect(first.matches('a.skip-link[href="#main"]')).toBe(true);
    expect(doc.title).toMatch(/ \| Night Before Christmas Campaign$/);
    expect((doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? "").length).toBeGreaterThan(40);
    expect(doc.querySelector('meta[name="viewport"]')).not.toBeNull();
  });

  it("keeps every section inside the page's margins, and gives it a name", () => {
    const sections = [...doc.querySelectorAll("main > section")];
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0].classList.contains("page-top")).toBe(true);
    for (const section of sections) {
      expect(section.querySelector(":scope > .wrap"), section.className).not.toBeNull();
      const by = section.getAttribute("aria-labelledby");
      if (by) expect(doc.getElementById(by), `${section.className} is named by #${by}`).not.toBeNull();
      else expect(section.getAttribute("aria-label"), section.className).toBeTruthy();
    }
  });

  it("has one main heading, and no heading skips a level", () => {
    const levels = [...doc.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1]));
    expect(levels.filter((l) => l === 1).length).toBe(1);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `heading ${i + 1} of ${levels.join(" ")}`).toBeLessThanOrEqual(1);
  });

  it("gives every picture its words and its size, and every form control a label", () => {
    expect(unlabelled(doc)).toEqual([]);
  });

  it("gives nothing the same id as anything else", () => {
    const ids = [...doc.querySelectorAll("[id]")].map((el) => el.id);
    const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(twice).toEqual([]);
  });

  it("carries no script in the page itself: scripts are files, and nothing runs from an attribute", () => {
    expect(runsInPage(doc)).toEqual([]);
  });

  it("links and posts only to this site", () => {
    expect(offSite(doc)).toEqual([]);
    for (const form of doc.querySelectorAll("form")) expect(form.getAttribute("method")).toBe("post");
  });

  it("uses no dashes and no hyphenated words in anything people read", () => {
    expect(badWords(doc)).toEqual([]);
  });

  it('says what money "could" do, never what it does', () => {
    for (const said of readWords(doc)) {
      // HMRC's model Gift Aid declaration (src/declarations/wording.ts) must be shown word for word.
      if (said.includes("I am a UK taxpayer")) continue;
      if (/\b(pounds?|pennies|penny|donations?|gifts?)\b[^.]*\b(helps?|pays?|buys?|gives?|will)\b/i.test(said)) expect(said).toMatch(/\bcould\b/);
    }
  });

  it("spells the building one way, and never names the other elf", () => {
    // One piece of text at a time: "Workshop elf" next to "Workshop elf outfit" is not the building.
    for (const said of readWords(doc)) {
      for (const match of said.match(/\bel(?:f|ve)[^\s<>]{0,12}\s+workshop/gi) ?? []) expect(match).toBe("Elves' Workshop");
      expect(said).not.toMatch(/elf on the shelf/i);
    }
  });
});

// ---- hostile data ------------------------------------------------------------------------------

const POISON = `<img src=x onerror="alert(1)"><script>alert(2)</script>"'&`;
// Fields that choose between fixed answers. They are looked up or switched on, never written out.
const CHOICES = new Set(["state", "skin", "hair", "hairStyle", "outfit", "pieces", "form", "reason", "fresh"]);

/** The same view with every word swapped for markup, and every address pointed off the site. */
function poisoned<T>(value: T, key = ""): T {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => poisoned(item, key)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, CHOICES.has(k) ? v : poisoned(v, k)])) as T;
  }
  if (typeof value !== "string") return value;
  return (/Url$/.test(key) ? "javascript:alert(3)" : POISON) as T;
}

describe("data that tries to break out of the page", () => {
  const hostile: [string, string][] = [
    ["calendar", renderCalendarPage(poisoned(calendarView(at("2026-12-07T18:10:00.000Z"), { state: "found", found, ...opened, shapeUrl: "/elf/shape/teddy.svg" })))],
    ["HQ", renderHqPage(poisoned(hqView({ today: { ...today, guess: today.options[1] } })))],
    ["HQ, found", renderHqPage(poisoned(hqView({ today: { ...today, state: "found", options: [], guess: today.options[0], outcome } })))],
    ["wardrobe", renderWardrobePage(poisoned(wardrobeView()))],
    ["poster", renderPosterPage(poisoned(posterView({ open: true, claimable: true })))],
    ["poster, a claim that won", renderPosterPage(poisoned(posterView({ open: true, claimable: false })), { form: "claim", ok: true, win: poisoned(claimWin()) })],
    ["poster, a check in that counted", renderPosterPage(poisoned(everyoneStamped), { form: "stamp", ok: true, win: poisoned(stampWin()) })],
  ];

  it.each(hostile)("%s: is shown as words, never run", (_name, html) => {
    const doc = parse(html);
    expect(html).toContain("&lt;img src=x");
    expect(doc.querySelector('img[src="x"]')).toBeNull();
    expect(runsInPage(doc)).toEqual([]);
    expect(offSite(doc)).toEqual([]);
    expect(html).not.toContain("javascript:");
    for (const el of doc.querySelectorAll("[style]")) expect(el.getAttribute("style"), "a style from data").not.toMatch(/javascript|expression|</i);
  });
});

// ---- the style sheet -----------------------------------------------------------------------------

/** Every declaration in a style sheet with the at-rules and selectors it sits inside. */
function declarations(css: string): { text: string; inside: string[] }[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/url\("[^"]*"\)/g, "url()");
  const out: { text: string; inside: string[] }[] = [];
  const inside: string[] = [];
  let buffer = "";
  for (const ch of plain) {
    if (ch === "{") {
      inside.push(buffer.trim());
      buffer = "";
    } else if (ch === "}" || ch === ";") {
      if (buffer.trim()) out.push({ text: buffer.trim(), inside: [...inside] });
      if (ch === "}") inside.pop();
      buffer = "";
    } else {
      buffer += ch;
    }
  }
  return out;
}

describe("reading a style sheet", () => {
  it("finds a movement that is not kept for visitors who are happy with motion", () => {
    const sample = declarations(
      ".a { transition: transform 1s; } @media (prefers-reduced-motion: no-preference) { .b { animation: go 1s; } @keyframes go { from { opacity: 0; } } }",
    );
    const calmOf = (d: { inside: string[] }) => d.inside.some((rule) => /prefers-reduced-motion:\s*no-preference/.test(rule));
    expect(sample.map((d) => [d.text, calmOf(d)])).toEqual([
      ["transition: transform 1s", false],
      ["animation: go 1s", true],
      ["opacity: 0", true],
    ]);
  });
});

describe("the style sheet for the elf screens", () => {
  const css = readFileSync(resolve(ROOT, "assets/css/elf.css"), "utf8");
  const all = declarations(css);
  const calm = (inside: string[]) => inside.some((rule) => /prefers-reduced-motion:\s*no-preference/.test(rule));

  it("never scrolls inside a box: content wraps and the page grows", () => {
    expect(all.length).toBeGreaterThan(300);
    for (const d of all) {
      if (/^overflow(-[xy])?\s*:/.test(d.text)) expect(d.text, d.inside.join(" > ")).not.toMatch(/auto|scroll/);
    }
    expect(css).not.toMatch(/-webkit-overflow-scrolling/);
  });

  it("moves nothing for a visitor who has asked for less motion", () => {
    const moving = all.filter((d) => /^(animation|transition)(-[a-z-]+)?\s*:/.test(d.text));
    expect(moving.length).toBeGreaterThan(8);
    for (const d of moving) expect(calm(d.inside), `${d.inside.join(" > ")} { ${d.text} }`).toBe(true);
    const frames = all.filter((d) => d.inside.some((rule) => rule.startsWith("@keyframes")));
    expect(frames.length).toBeGreaterThan(5);
    for (const d of frames) expect(calm(d.inside), d.inside.join(" > ")).toBe(true);
  });

  it("animates only what a phone can move cheaply", () => {
    const frames = all.filter((d) => d.inside.some((rule) => rule.startsWith("@keyframes")));
    for (const d of frames) expect(d.text, d.inside.join(" > ")).toMatch(/^(transform|opacity)\s*:/);
  });

  it("forces nothing with !important, and touches only the elf screens", () => {
    expect(css).not.toMatch(/!important/);
    const selectors = new Set(all.flatMap((d) => d.inside.filter((rule) => !rule.startsWith("@"))));
    for (const selector of selectors) {
      for (const part of selector.split(",")) {
        expect(part.trim(), part).toMatch(/^(\.elf-|form\.elf-|from$|to$|\d+%$)/);
      }
    }
  });
});

// ---- the scripts ---------------------------------------------------------------------------------

describe("the scripts for the elf screens", () => {
  const dir = resolve(ROOT, "assets/js");
  const scripts = readdirSync(dir).filter((name) => /^elf-.*\.js$/.test(name));

  it("are the six expected", () => {
    expect(scripts.sort()).toEqual(["elf-calendar.js", "elf-hq.js", "elf-join.js", "elf-poster.js", "elf-wardrobe-ui.js", "elf-wardrobe.js"]);
  });

  it.each(scripts)("%s is written the way the site's other scripts are, so it runs with no build step", (name) => {
    const source = readFileSync(resolve(dir, name), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code.trimStart().startsWith("(function () {")).toBe(true);
    expect(code).toContain('"use strict";');
    expect(code).toMatch(/typeof module !== "undefined" && module\.exports/);
    expect(code.trimEnd().endsWith("})();")).toBe(true);
    expect(code, "const or let").not.toMatch(/\b(const|let)\s+[A-Za-z_$]/);
    expect(code, "an arrow function").not.toMatch(/=>/);
    expect(code, "a template literal").not.toMatch(/`/);
    expect(code, "a class").not.toMatch(/\bclass\s+[A-Z]/);
    expect(code, "eval").not.toMatch(/\beval\(|new Function\(/);
    expect(code, "document.write").not.toMatch(/document\.write/);
  });
});
