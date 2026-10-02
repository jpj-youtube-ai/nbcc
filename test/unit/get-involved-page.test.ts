// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderGetInvolvedPage } from "../../src/fundraising/render";
import { meter, type PublicCard } from "../../src/fundraising/model";
import { SEED_EVENTS } from "./helpers/events-seed";

// TASK-494: Get involved's chips. All, Events and Fundraisers filter the cards on the page without
// reloading it. Without JavaScript the chips stay hidden and every card shows, so nothing is ever
// out of reach. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initChips } = require(resolve(ROOT, "assets/js/events.js"));
const eventsCss = readFileSync(resolve(ROOT, "assets/css/events.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const template = readFileSync(resolve(ROOT, "events.html"), "utf8");

const fundraiser = (slug: string, title: string): PublicCard => ({
  id: slug.length,
  slug,
  path: "raising",
  kind: "run_walk",
  kindLabel: "A run or walk",
  title,
  description: "Ten miles for NBCC.",
  eventDate: null,
  startTime: null,
  venue: "",
  town: "Exampleton",
  imageSrc: null,
  organisedBy: "Jo Example",
  url: `/fundraise/${slug}`,
  meter: meter({ onlinePence: 1000, cashPence: 0, targetPence: 10000 }),
});

function load(fundraisers: PublicCard[]) {
  const html = renderGetInvolvedPage(template, { events: SEED_EVENTS, fundraisers, fundraisingOn: true, today: "2026-10-02" });
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
  return initChips(document, window);
}

const cards = () => [...document.querySelectorAll<HTMLElement>(".deck > .ev-card")];
const shown = () => cards().filter((c) => !c.hidden);
const chip = (show: string) => document.querySelector<HTMLButtonElement>(`[data-chips] [data-show="${show}"]`)!;

describe("the chips", () => {
  beforeEach(() => {
    load([fundraiser("jos-walk", "Jo's Walk"), fundraiser("pats-swim", "Pat's Swim")]);
  });

  it("appear once the script is running, with All pressed", () => {
    expect(document.querySelector("[data-chips]")?.hasAttribute("hidden")).toBe(false);
    expect(chip("all").getAttribute("aria-pressed")).toBe("true");
    expect(shown()).toHaveLength(cards().length);
  });

  it("Fundraisers shows only the fundraisers", () => {
    chip("fundraiser").click();
    expect(shown().map((c) => c.getAttribute("data-kind"))).toEqual(["fundraiser", "fundraiser"]);
    expect(chip("fundraiser").getAttribute("aria-pressed")).toBe("true");
    expect(chip("all").getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector("[data-chips-status]")?.textContent).toBe("Showing 2 fundraisers");
  });

  it("Events shows the events and the face down card, and no fundraisers", () => {
    chip("event").click();
    expect(shown().every((c) => c.getAttribute("data-kind") === "event")).toBe(true);
    expect(shown().some((c) => c.classList.contains("ev-card--more"))).toBe(true);
    expect(document.querySelector("[data-chips-status]")?.textContent).toBe(`Showing ${SEED_EVENTS.length} events`);
  });

  it("All brings everything back", () => {
    chip("fundraiser").click();
    chip("all").click();
    expect(shown()).toHaveLength(cards().length);
    expect(document.querySelector("[data-chips-status]")?.textContent).toBe("Showing everything");
  });

  it("does not reload the page or follow anything", () => {
    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    chip("event").dispatchEvent(evt);
    // Buttons, not links: nothing to follow, so nothing to prevent.
    expect(chip("event").tagName).toBe("BUTTON");
    expect(chip("event").getAttribute("type")).toBe("button");
  });
});

describe("with no fundraisers yet", () => {
  it("Fundraisers says so kindly, and points to the sign up", () => {
    load([]);
    chip("fundraiser").click();
    expect(shown()).toHaveLength(0);
    const empty = document.querySelector<HTMLElement>('[data-chips-empty="fundraiser"]')!;
    expect(empty.hidden).toBe(false);
    expect(empty.querySelector("a")?.getAttribute("href")).toBe("/fundraise");
    chip("all").click();
    expect(empty.hidden).toBe(true);
  });
});

describe("without the chips (fundraising switched off)", () => {
  it("does nothing at all", () => {
    const html = renderGetInvolvedPage(template, { events: SEED_EVENTS, fundraisers: [], fundraisingOn: false, today: "2026-10-02" });
    document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
    expect(initChips(document, window)).toBeNull();
    expect(shown()).toHaveLength(cards().length);
  });
});

describe("the styles", () => {
  it("never scroll inside a card, a chip or the panel", () => {
    expect(eventsCss).not.toMatch(/overflow(-[xy])?\s*:\s*(auto|scroll)/);
  });

  it("give the chips a finger sized target and a visible pressed state", () => {
    const rule = eventsCss.match(/\.gi-chip\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/min-height:\s*(4[4-9]|[5-9]\d)px/);
    expect(eventsCss).toMatch(/\.gi-chip\[aria-pressed="true"\]/);
  });

  it("let a fundraiser card's whole face take a tap, without turning it over", () => {
    expect(eventsCss).toMatch(/\.fr-card__go::before\s*\{[^}]*inset:\s*0/);
    expect(eventsCss).toMatch(/\.ev-card--fundraiser \.ev-face\s*\{[^}]*cursor:\s*auto/);
  });
});
