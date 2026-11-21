import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { addFillStageToHome } from "../../src/red-bag/stage";

// Freddie's film at the top of the home page (Jaimie, 21 November 2026;
// docs/superpowers/specs/2026-11-21-home-freddie-film-design.md). The markup, as index.html carries it.

const ROOT = resolve(__dirname, "../..");
const home = readFileSync(resolve(ROOT, "index.html"), "utf8");
const section = home.slice(home.indexOf("data-home-film"), home.indexOf("</section>", home.indexOf("data-home-film")));
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&rsquo;/g, "’").replace(/\s+/g, " ");

describe("the film section", () => {
  it("is the first thing in the page, above the hero", () => {
    expect(home.indexOf("data-home-film")).toBeGreaterThan(-1);
    expect(home.indexOf("data-home-film")).toBeLessThan(home.indexOf('class="hero"'));
    expect(home.indexOf("data-home-film")).toBeGreaterThan(home.indexOf('<main'));
  });

  it("says what it is, in Jaimie's words", () => {
    const w = words(section);
    expect(w).toContain("Our new animated film");
    expect(w).toContain("Watch Freddie’s story");
    expect(w).toContain("Based on a true story.");
  });

  it("has a silent, inline film that loads little until asked, with its still and captions", () => {
    const video = section.match(/<video\b[^>]*>/)![0];
    expect(video).toMatch(/\bmuted\b/);
    expect(video).toMatch(/\bplaysinline\b/);
    expect(video).toContain('preload="metadata"');
    expect(video).toContain('poster="/assets/video/freddie-film-poster.jpg"');
    expect(video).not.toMatch(/\bautoplay\b/); // the script decides, so reduced motion and Save-Data are respected
    expect(video).not.toMatch(/\bloop\b/);
    expect(section).toContain('<source src="/assets/video/freddie-film.mp4" type="video/mp4" />');
    expect(section).toMatch(/<track kind="captions" srclang="en" label="English" src="\/assets\/video\/freddie-film.en.vtt" default \/>/);
  });

  it("has Tap for sound, pause, play, captions, and the ending's Fill a bag and Watch again", () => {
    expect(section).toMatch(/data-hf-sound[^>]*>[\s\S]*?Tap for sound/);
    expect(section).toContain("data-hf-pause");
    expect(section).toContain("data-hf-play");
    expect(section).toContain("data-hf-captions");
    // In the file the ending offers Donate; the server makes it Fill a bag while Fill a Red Bag is on.
    expect(section).toMatch(/<a class="btn[^"]*" href="\/donate"[^>]*data-hf-fill[^>]*>Donate<\/a>/);
    expect(section).toMatch(/data-hf-again[^>]*>[\s\S]*?Watch again/);
    expect(section).toMatch(/data-hf-end[^>]*hidden/);
  });

  it("loads its own script without holding the page up, and its own styles", () => {
    expect(home).toContain('<script defer src="/assets/js/home-film.js"></script>');
    expect(home).toContain('<link rel="stylesheet" href="/assets/css/home-film.css" />');
  });

  it("keeps the house style: no dashes between words", () => {
    expect(words(section)).not.toMatch(/[–—]/);
  });
});

describe("the film files", () => {
  it("are all there, the film small enough for a phone", () => {
    expect(statSync(resolve(ROOT, "assets/video/freddie-film.mp4")).size).toBeLessThan(20 * 1024 * 1024);
    expect(statSync(resolve(ROOT, "assets/video/freddie-film-poster.jpg")).size).toBeLessThan(200 * 1024);
  });

  it("captions say it as NBCC says it", () => {
    const vtt = readFileSync(resolve(ROOT, "assets/video/freddie-film.en.vtt"), "utf8");
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    for (const w of ["Big tyres, big roars.", "wee boy", "Night Before Christmas Campaign", "A Red Bag Full of Joy."]) expect(vtt).toContain(w);
    expect(vtt).not.toMatch(/\bwe boy\b/);
    expect(vtt).not.toContain("Big for you");
  });
});

describe("the ending's button, as the page goes out", () => {
  it("is Fill a bag, to /fill, while Fill a Red Bag is on (the stage is drawn)", () => {
    const out = addFillStageToHome(home, "<section class=\"fb\"></section>");
    expect(out).toContain('<a class="btn hf-fill" href="/fill" data-hf-fill>Fill a bag</a>');
    expect(out).not.toContain('data-hf-fill>Donate</a>');
  });

  it("stays Donate while Fill a Red Bag is off, so it never sends anyone to a page that is not there", () => {
    expect(addFillStageToHome(home, "")).toContain('<a class="btn hf-fill" href="/donate" data-hf-fill>Donate</a>');
  });
});
