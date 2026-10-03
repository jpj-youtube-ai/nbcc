// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiserPage, renderGiveForm } from "../../src/fundraising/render";
import { showsImpact } from "../../src/fundraising/impact-render";
import { meter, type PublicPage } from "../../src/fundraising/model";
import { STARTING_EXAMPLES, type ImpactExample } from "../../src/impact/examples";

// What gifts could do (Jaimie, 2026-10-03) on a fundraiser's page: under each give amount that has an
// example, its line, small; under your own amount, the line for the largest example at or below it
// (nothing below £5); under the meter, how many Red Bags Full of Joy the total could fill (and, from
// £400, school uniforms); and the footnote once wherever any of it shows. Every name and number here
// is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initGiveForm } = require(resolve(ROOT, "assets/js/fundraiser.js"));
const template = readFileSync(resolve(ROOT, "fundraiser.html"), "utf8");

const examples = (): ImpactExample[] => STARTING_EXAMPLES.map((e, i) => ({ ...e, id: i + 1 }));

const page = (raisedPence = 0, over: Partial<PublicPage> = {}): PublicPage => ({
  id: 41,
  slug: "robins-santa-dash",
  path: "raising",
  kind: "santa_dash",
  kindLabel: "Santa dash",
  title: "Robin's Santa Dash",
  description: "Five kilometres in a red suit.",
  eventDate: null,
  startTime: null,
  venue: "",
  town: "Exampleton",
  imageSrc: null,
  organisedBy: "Robin Q.",
  url: "/fundraise/robins-santa-dash",
  meter: meter({ onlinePence: raisedPence, cashPence: 0, targetPence: 100000 }),
  wall: [],
  giving: { fundraiserId: 41, minimumPence: 200 },
  finished: false,
  ...over,
});

function render(p: PublicPage, impact?: ImpactExample[]): string {
  return renderFundraiserPage(template, p, { pageUrl: "https://nbcc.test/fundraise/robins-santa-dash", now: new Date(Date.UTC(2026, 9, 2)), impact });
}
function load(html: string) {
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
}
const text = (n: Element | null) => ((n && n.textContent) || "").replace(/\s+/g, " ").trim();
const $ = (sel: string) => document.querySelector(sel);
const $$ = (sel: string) => Array.from(document.querySelectorAll(sel));
const FOOTNOTE = "These show what gifts could do. Every gift goes where it's needed most.";

describe("under the give amounts", () => {
  it("shows each preset's example, small, under the amount; £20 has none", () => {
    load(render(page(), examples()));
    const amounts = $$(".fr-amount").map((l) => [text(l.querySelector(".fr-amount__face")), text(l.querySelector(".fr-amount__could"))]);
    expect(amounts).toEqual([
      ["£5", "could help put a cosy pair of pyjamas in a Red Bag"],
      ["£10", "could help put pyjamas, socks, a hat and gloves in a Red Bag"],
      ["£20", ""],
      ["£50", "could help fill a whole Red Bag Full of Joy"],
    ]);
    // Inside the label, so a screen reader hears "£5 could help put ..." as the choice.
    expect(text($(".fr-amount"))).toBe("£5 could help put a cosy pair of pyjamas in a Red Bag");
  });

  it("never shows the £40 uniform, which is for big totals only", () => {
    expect(render(page(), examples())).not.toContain("could help a child start school");
  });

  it("shows nothing without the list, as before", () => {
    const html = render(page());
    expect(html).not.toContain("fr-amount__could");
    expect(html).not.toContain(FOOTNOTE);
    expect(html).not.toContain("data-could");
  });
});

describe("under your own amount", () => {
  const typeOwn = (value: string) => {
    const own = document.getElementById("frOwnAmount") as HTMLInputElement;
    own.value = value;
    own.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const ownLine = () => $("[data-own-could]") as HTMLElement;

  it("shows the line for the largest example at or below it, and nothing below £5", () => {
    load(render(page(), examples()));
    initGiveForm(document, window, { assign: () => undefined });
    expect(text(ownLine())).toBe("");
    typeOwn("4.99");
    expect(text(ownLine())).toBe("");
    typeOwn("5");
    expect(text(ownLine())).toBe("£5 could help put a cosy pair of pyjamas in a Red Bag");
    typeOwn("30");
    expect(text(ownLine())).toBe("£25 could help buy a pair of school shoes");
    typeOwn("45");
    expect(text(ownLine())).toBe("£25 could help buy a pair of school shoes");
    typeOwn("250");
    expect(text(ownLine())).toBe("£50 could help fill a whole Red Bag Full of Joy");
    typeOwn("");
    expect(text(ownLine())).toBe("");
  });

  it("says nothing for an amount below the page's minimum", () => {
    const list = [...examples(), { ...examples()[0], id: 9, amountPence: 100, wording: "could help put a candy cane in a stocking" }];
    load(render(page(), list));
    initGiveForm(document, window, { assign: () => undefined });
    typeOwn("1.50");
    expect(text(ownLine())).toBe("");
    typeOwn("2");
    expect(text(ownLine())).toBe("£1 could help put a candy cane in a stocking");
  });

  it("is a live region that is always there, tied to the box, and spoken only when it changes", () => {
    load(render(page(), examples()));
    initGiveForm(document, window, { assign: () => undefined });
    const line = ownLine();
    expect(line.hidden).toBe(false);
    expect(line.getAttribute("aria-live")).toBe("polite");
    expect(document.getElementById("frOwnAmount")!.getAttribute("aria-describedby")).toBe(line.id);
    const watch = new MutationObserver(() => undefined);
    watch.observe(line, { childList: true, characterData: true, subtree: true });
    typeOwn("30");
    expect(watch.takeRecords().length).toBeGreaterThan(0);
    typeOwn("31");
    typeOwn("32");
    expect(watch.takeRecords()).toHaveLength(0);
    watch.disconnect();
  });

  it("goes when a preset is chosen instead", () => {
    load(render(page(), examples()));
    initGiveForm(document, window, { assign: () => undefined });
    typeOwn("30");
    const preset = document.querySelector('input[name="frAmount"][value="1000"]') as HTMLInputElement;
    preset.checked = true;
    preset.dispatchEvent(new Event("change", { bubbles: true }));
    expect(text(ownLine())).toBe("");
  });

  it("is never there without the list", () => {
    load(render(page()));
    initGiveForm(document, window, { assign: () => undefined });
    expect($("[data-own-could]")).toBeNull();
    expect(document.getElementById("frOwnAmount")!.hasAttribute("aria-describedby")).toBe(false);
  });

  it("reads the words safely, whatever staff typed", () => {
    const tricky = [{ ...examples()[0], wording: `could help buy "socks" & <b>gloves</b> for 'everyone'` }];
    load(render(page(), tricky));
    initGiveForm(document, window, { assign: () => undefined });
    typeOwn("6");
    expect(ownLine().innerHTML).not.toContain("<b>");
    expect(text(ownLine())).toBe(`£5 could help buy "socks" & <b>gloves</b> for 'everyone'`);
  });
});

describe("under the meter", () => {
  const meterLine = () => text($(".fr-summary .fr-meter__could"));

  it("says every pound could help below £50", () => {
    load(render(page(1200), examples()));
    expect(meterLine()).toBe("Every pound could help fill a Red Bag Full of Joy");
  });

  it("counts the Red Bags from £50, and adds the uniforms from £400", () => {
    load(render(page(15000), examples()));
    expect(meterLine()).toBe("What's been raised so far could fill around 3 Red Bags Full of Joy");
    load(render(page(48000), examples()));
    expect(meterLine()).toBe("What's been raised so far could fill around 9 Red Bags Full of Joy, or help 12 children start school in a uniform that fits");
  });

  it("sits right under the meter, before the Give button", () => {
    const html = render(page(15000), examples());
    const at = html.indexOf("fr-meter__could");
    expect(at).toBeGreaterThan(html.indexOf("fr-meter__bar"));
    expect(at).toBeLessThan(html.indexOf("fr-summary__give"));
  });

  it("is not there when the Red Bag example is switched off", () => {
    const list = examples().map((e) => (e.meterLine === "red_bags" ? { ...e, active: false } : e));
    load(render(page(15000), list));
    expect($(".fr-meter__could")).toBeNull();
  });
});

describe("the footnote", () => {
  // Shown means not hidden, and not inside anything hidden (the give form is hidden without JavaScript).
  const shown = () => $$(".fr-could-note").filter((n) => !(n as HTMLElement).closest("[hidden]"));

  it("shows exactly once with JavaScript: under the give amounts", () => {
    load(render(page(15000), examples()));
    initGiveForm(document, window, { assign: () => undefined });
    expect(shown()).toHaveLength(1);
    expect(shown()[0].closest("#frGiveForm")).not.toBeNull();
    expect(text(shown()[0])).toBe(FOOTNOTE);
  });

  it("shows exactly once without JavaScript: under the meter line, as the give form is hidden", () => {
    load(render(page(15000), examples()));
    expect(shown()).toHaveLength(1);
    expect(shown()[0].closest(".fr-summary")).not.toBeNull();
  });

  it("shows under the meter when only the meter line shows", () => {
    const list = examples().map((e) => ({ ...e, onGiveForm: false }));
    load(render(page(15000), list));
    initGiveForm(document, window, { assign: () => undefined });
    expect($$(".fr-could-note")).toHaveLength(1);
    expect(shown()).toHaveLength(1);
    expect(text($(".fr-summary .fr-could-note"))).toBe(FOOTNOTE);
    expect($(".fr-amount__could")).toBeNull();
  });

  it("is not there when nothing is", () => {
    const list = examples().map((e) => ({ ...e, active: false }));
    expect(render(page(15000), list)).not.toContain("fr-could-note");
  });
});

describe("event and team pages", () => {
  it("show them too, from the same renderer", () => {
    load(render(page(15000, { path: "event", eventDate: "2026-12-05", url: "/event/robins-santa-dash" }), examples()));
    expect(text($(".fr-meter__could"))).toContain("3 Red Bags");
    expect($$(".fr-amount__could")).toHaveLength(3);
    // A team page's meter is the team's combined total (the route passes it), so the line counts that.
    load(render(page(60000, { teamName: "Exampleton Juniors" }), examples()));
    expect(text($(".fr-meter__could"))).toContain("12 Red Bags Full of Joy, or help 15 children");
  });
});

describe("where the examples never show", () => {
  it("is an in memory page, by its flag, and a category that mentions memory", () => {
    expect(showsImpact({ kind: "santa_dash", inMemory: true })).toBe(false);
    expect(showsImpact({ kind: "in_memory" })).toBe(false);
    expect(showsImpact({ kind: "santa_dash", inMemory: false })).toBe(true);
    expect(showsImpact({ kind: "santa_dash" })).toBe(true);
  });

  it("is a give form drawn without them, as the in memory page draws it", () => {
    const html = renderGiveForm(page(), { heading: "Give in memory", sub: "Every gift goes to NBCC." });
    expect(html).not.toContain("could");
    expect(html).not.toContain("aria-describedby=\"frOwnCould\"");
  });
});

describe("an event's page", () => {
  const event = (over: Partial<PublicPage> = {}) => page(15000, { path: "event", eventDate: "2026-12-05", url: "/event/robins-santa-dash", booking: "door", ...over } as Partial<PublicPage>);

  it("keeps its own give box wording, with the examples under the amounts", () => {
    load(render(event(), examples()));
    expect(text($("#fr-give-heading"))).toBe("Make a donation");
    expect(text($(".fr-give .give-step-sub"))).toContain("This is a donation to NBCC, not a ticket.");
    expect($$(".fr-amount__could")).toHaveLength(3);
  });

  it("keeps the paid in line and the entry line in the summary, with the meter line between them", () => {
    const html = render(event(), examples());
    const paidIn = html.indexOf("Includes any money the organiser has paid in.");
    const could = html.indexOf("fr-meter__could");
    const entry = html.indexOf("fr-summary__entry");
    expect(paidIn).toBeGreaterThan(-1);
    expect(could).toBeGreaterThan(paidIn);
    expect(entry).toBeGreaterThan(could);
  });
});
