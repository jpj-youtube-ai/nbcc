// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderEntryPage } from "../../src/elf/pages/entry";
import type { EntryView } from "../../src/elf/pages/types";
import { at, entryView } from "./elf-fixtures";

// NBCC Elf Detective School, Christmas Eve and the grand prize (Plan 2c-2, Task 3): the page where a family
// sends in a graduate's picture for the grand prize, from Detective HQ. Every family and detective here is
// invented (see elf-fixtures.ts).

const page = (v: EntryView = entryView()) => new DOMParser().parseFromString(renderEntryPage(v), "text/html");
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
/** Everything the page's own part says, the site's banner and footer left out. */
const said = (v: EntryView) => words(page(v).querySelector("main"));
const SENT = { at: at("2026-12-24T10:45:00.000Z"), pictureUrl: "/elf/hq/entry/11/picture.jpg" };
const CLOSED = entryView({ open: false });

describe("the entry page", () => {
  it("is a private page called Send in your picture, under Detective HQ's label, for the detective by name", () => {
    const doc = page();
    expect(doc.title).toBe("Send in your picture | Night Before Christmas Campaign");
    expect(doc.querySelector('meta[name="robots"]')!.getAttribute("content")).toBe("noindex, nofollow");
    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(words(doc.querySelector(".elf-title h1"))).toBe("Send in your picture");
    expect(words(doc.querySelector(".elf-label"))).toBe("Detective HQ");
    expect(words(doc.querySelector(".elf-entry__for"))).toBe("For Detective Ruby Tinselfoot, for the grand prize: a drawing, or a photo of your naughtiest elf at home.");
  });

  it("loads the picture script, which sends the picture", () => {
    expect(page().querySelector('script[src="/assets/js/elf-entry.js"]')).not.toBeNull();
  });

  it("leads back to Detective HQ, from the strip under the site's banner and from its foot", () => {
    const doc = page();
    expect(words(doc.querySelector('nav.elf-bar a.elf-bar__go[href="/elf/hq"]'))).toBe("Detective HQ");
    expect(words(doc.querySelector('.elf-entry__back a[href="/elf/hq"]'))).toBe("Back to Detective HQ");
  });

  it("promises the picture is made again, seen only by the head elves and deleted at the end of January", () => {
    expect(words(page().querySelector(".elf-entry__promise"))).toBe(
      "We make the picture again, so nothing from the camera is kept: not where, not when, not the phone. Only the head elves see it, and it is deleted at the end of January.",
    );
  });

  it("never asks for an age", () => {
    for (const v of [entryView(), entryView({ askMobile: true }), entryView({ sent: SENT }), CLOSED]) {
      expect(page(v).querySelector("main")!.outerHTML).not.toMatch(/\bage\b/i);
    }
  });
});

describe("the entry page while the entries are open", () => {
  it("has the form, posting to the entry's address, with one field for the picture", () => {
    const doc = page();
    const form = doc.querySelector<HTMLFormElement>("form.elf-entry")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/api/elf/entry/11");
    expect(form.getAttribute("data-api")).toBe("/api/elf/entry/11");
    const file = form.querySelector<HTMLInputElement>('input[type="file"][name="picture"][accept="image/*"]')!;
    expect(file).not.toBeNull();
    expect(file.required).toBe(true);
    expect(words(doc.querySelector(`label[for="${file.id}"]`))).toBe("Your picture");
    expect(form.querySelector(".elf-form-status[role=status]")).not.toBeNull();
  });

  it("says when the entries close, and sends the picture to the head elves", () => {
    const doc = page();
    expect(said(entryView())).toContain("Entries close at 5pm on Christmas Eve.");
    expect(words(doc.querySelector('form.elf-entry button[type="submit"]'))).toBe("Send it to the head elves");
    expect(doc.querySelector("img.elf-entry__pic")).toBeNull();
    expect(said(entryView())).not.toContain("picture is in");
  });

  it("asks for no mobile when the family has one", () => {
    const doc = page();
    expect(doc.querySelector('input[name="mobile"]')).toBeNull();
    expect(said(entryView())).not.toContain("So we can ring you");
  });

  it("asks a family with no mobile for one, with the join form's words", () => {
    const doc = page(entryView({ askMobile: true }));
    const mobile = doc.querySelector<HTMLInputElement>('form.elf-entry input[name="mobile"]')!;
    expect(mobile.type).toBe("tel");
    expect(mobile.required).toBe(true);
    expect(words(doc.querySelector(`label[for="${mobile.id}"]`))).toBe("Mobile number");
    const hint = doc.getElementById(mobile.getAttribute("aria-describedby") ?? "")!;
    expect(words(hint)).toBe("So we can ring you straight away if one of your detectives wins the grand prize on Christmas Eve. We only use it for that.");
  });

  it("shows the picture already in, says it can be changed until the entries close, and sends a new one", () => {
    const doc = page(entryView({ sent: SENT }));
    const img = doc.querySelector<HTMLImageElement>('img.elf-entry__pic[src="/elf/hq/entry/11/picture.jpg"]')!;
    expect(img).not.toBeNull();
    expect(img.getAttribute("alt")).toBe("Detective Ruby Tinselfoot's picture");
    expect(words(doc.querySelector(".elf-entry__in"))).toBe("Detective Ruby Tinselfoot's picture is in. You can change it until 5pm on Christmas Eve.");
    expect(words(doc.querySelector('form.elf-entry button[type="submit"]'))).toBe("Send a new picture");
    // The closing time is said once.
    expect(said(entryView({ sent: SENT })).match(/5pm/g)?.length).toBe(1);
  });

  it("says the time a head elf set", () => {
    expect(said(entryView({ closesAt: at("2026-12-24T18:30:00.000Z") }))).toContain("Entries close at 6:30pm on Christmas Eve.");
  });

  // Fix round 1 (the review's Minor 2): the script shows the new picture as soon as it is sent.
  it("tells its script where the picture shows once one is in, and its words", () => {
    const form = page().querySelector("form.elf-entry")!;
    expect(form.getAttribute("data-picture")).toBe("/elf/hq/entry/11/picture.jpg");
    expect(form.getAttribute("data-picture-alt")).toBe("Detective Ruby Tinselfoot's picture");
  });
});

describe("the entry page once the entries have closed", () => {
  it("says they closed, with no form", () => {
    const doc = page(CLOSED);
    expect(doc.querySelector("form")).toBeNull();
    expect(doc.querySelector('input[type="file"]')).toBeNull();
    expect(said(CLOSED)).toContain("Grand prize entries closed at 5pm on Christmas Eve.");
    expect(said(CLOSED)).not.toContain("Entries close at");
    expect(said(CLOSED)).not.toContain("We make the picture again");
  });

  it("still shows a picture that is in, with no way to change it", () => {
    const v = entryView({ open: false, sent: SENT });
    const doc = page(v);
    expect(doc.querySelector('img.elf-entry__pic[src="/elf/hq/entry/11/picture.jpg"]')).not.toBeNull();
    expect(words(doc.querySelector(".elf-entry__in"))).toBe("Detective Ruby Tinselfoot's picture is in.");
    expect(said(v)).toContain("Grand prize entries closed at 5pm on Christmas Eve.");
    expect(said(v)).not.toContain("You can change it");
    expect(doc.querySelector("form")).toBeNull();
  });
});

describe("what comes from data", () => {
  it("tells its script of no picture whose address is not on this site", () => {
    const form = page(entryView({ pictureUrl: "https://elsewhere.example/p.jpg" })).querySelector("form.elf-entry")!;
    expect(form.hasAttribute("data-picture")).toBe(false);
    expect(form.hasAttribute("data-picture-alt")).toBe(false);
  });

  it("draws no form when its address is not on this site, and no picture whose address is not", () => {
    const doc = page(entryView({ postUrl: "https://elsewhere.example/entry", sent: { ...SENT, pictureUrl: "https://elsewhere.example/p.jpg" } }));
    expect(doc.querySelector("form")).toBeNull();
    expect(doc.querySelector("img.elf-entry__pic")).toBeNull();
    expect(doc.documentElement.outerHTML).not.toContain("elsewhere");
  });

  it("still says a picture is in, and offers a new one, when the picture's address is not one to draw", () => {
    const v = entryView({ sent: { ...SENT, pictureUrl: "https://elsewhere.example/p.jpg" } });
    const doc = page(v);
    expect(doc.querySelector("img.elf-entry__pic")).toBeNull();
    expect(words(doc.querySelector(".elf-entry__in"))).toBe("Detective Ruby Tinselfoot's picture is in. You can change it until 5pm on Christmas Eve.");
    expect(words(doc.querySelector('form.elf-entry button[type="submit"]'))).toBe("Send a new picture");
    expect(said(v)).not.toContain("Entries close at");
  });

  it("says no time when the closing is not a real time, rather than a sentence with a gap in it", () => {
    const text = said(entryView({ closesAt: new Date(Number.NaN), sent: SENT }));
    expect(text).not.toMatch(/close at\s+on|until\s+on|closed at\s+on/);
    expect(text).toContain("Detective Ruby Tinselfoot's picture is in.");
  });

  it("writes the detective's name as words, never as markup", () => {
    const html = renderEntryPage(entryView({ detective: { id: "11", name: '<img src=x onerror="alert(1)">' } }));
    expect(html).toContain("&lt;img src=x");
    expect(new DOMParser().parseFromString(html, "text/html").querySelector('img[src="x"]')).toBeNull();
  });
});

// The paper look (docs/superpowers/specs/2026-11-04-elf-paper-design.md): the picture fits its box, and nothing
// scrolls inside one.
describe("the entry page, in paper", () => {
  const css = readFileSync(resolve(__dirname, "../../assets/css/elf.css"), "utf8");

  it("sets the page on a taped note, as Detective HQ's case is", () => {
    const note = page().querySelector(".elf-entry-note")!;
    expect(note.classList.contains("elf-note")).toBe(true);
    expect(note.querySelector(":scope > .elf-tape")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("fits the picture inside its note, however big it is", () => {
    expect(css).toMatch(/\.elf-entry__pic \{[^}]*max-width:\s*100%/);
    expect(css).toMatch(/\.elf-entry__pic \{[^}]*height:\s*auto/);
  });

  it("styles the form, the picture and the grand prize section", () => {
    for (const rule of [".elf-prize", ".elf-entry", ".elf-entry__pic"]) expect(css, rule).toContain(`${rule} {`);
  });

  it("sends with a crimson torn paper button, and uses none of the site's own buttons", () => {
    const doc = page();
    expect(doc.querySelector('form.elf-entry button[type="submit"]')!.className).toBe("elf-btn elf-btn--crimson");
    expect(doc.querySelector(".site-main .btn")).toBeNull();
  });
});
