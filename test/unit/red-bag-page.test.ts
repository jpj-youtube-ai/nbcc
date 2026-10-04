// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { redBag } from "../../src/red-bag/catalogue";
import { DROP_OFF_LIVE, DROP_OFF_URL, PREVIEW_STRIP, postcodePattern, renderRedBagPage, renderRedBagThanksPage } from "../../src/red-bag/render";
import { RED_BAG_PATH } from "../../src/red-bag/switch";
import { UK_POSTCODE_RE } from "../../src/declarations/fields";
import { RED_BAG_FORWARDS, addRedBagPageRoutes, redBagPageHandler } from "../../src/routes/red-bag";
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

// The thank you page, /fill/thank-you, as drawn.
const thanksTemplate = read("fill-thank-you.html");
const thanksHtml = renderRedBagThanksPage(thanksTemplate, { preview: false });
const tdoc = new DOMParser().parseFromString(thanksHtml, "text/html");
/** The two pages that are Fill a Red Bag's own. */
const OWN_PAGES = ["fill-a-red-bag.html", "fill-thank-you.html"];

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

  // Once or monthly is two buttons side by side, as on the donate page (its .give-toggle), not a
  // tick: a named group, each button saying whether it is pressed.
  it("asks how often with two buttons: Give once, chosen to begin with, and Give monthly", () => {
    const group = main.querySelector(".rb-toggle")!;
    expect(group.getAttribute("role")).toBe("group");
    const label = doc.getElementById(group.getAttribute("aria-labelledby") ?? "")!;
    expect(norm(label.textContent)).toBe("How often?");
    const modes = [...group.querySelectorAll("button[data-rb-mode]")];
    expect(modes.map((b) => [b.getAttribute("data-rb-mode"), norm(b.textContent), b.getAttribute("aria-pressed"), b.getAttribute("type")])).toEqual([
      ["once", "Give once", "true", "button"],
      ["monthly", "Give monthly", "false", "button"],
    ]);
    // The tick it replaces is gone, and so is its label.
    expect(doc.getElementById("rbMonthly")).toBeNull();
    expect(main.querySelector(".rb-panel input")).toBeNull();
    expect(norm(main.querySelector(".rb-panel")!.textContent)).not.toContain("Give this amount every month");
  });

  // Jaimie's idea (4 October 2026): one button by the total, offering the next milestone only.
  it("has one round-up button, hidden until there is something to round up", () => {
    const rounds = main.querySelectorAll("[data-rb-round]");
    expect(rounds.length).toBe(1);
    const round = rounds[0];
    expect(round.tagName).toBe("BUTTON");
    expect(round.getAttribute("type")).toBe("button");
    expect(round.hasAttribute("hidden")).toBe(true);
    expect(round.querySelector("[data-rb-round-amount]")).not.toBeNull();
    expect(round.querySelector("[data-rb-round-words]")).not.toBeNull();
    expect(round.closest(".rb-panel")).not.toBeNull();
    // Not in the live region: the status line and the total say what pressing it did.
    expect(round.closest("[aria-live]")).toBeNull();
  });

  it("puts them in order: the total, the round-up, how often, Donate, the nudge", () => {
    const order = [...main.querySelectorAll("[data-rb-total], [data-rb-round], .rb-toggle, [data-rb-donate], [data-rb-nudge]")].map(
      (el) => (el.hasAttribute("data-rb-total") ? "total" : el.hasAttribute("data-rb-round") ? "round" : el.classList.contains("rb-toggle") ? "often" : el.hasAttribute("data-rb-donate") ? "donate" : "nudge"),
    );
    expect(order).toEqual(["total", "round", "often", "donate", "nudge"]);
    // All of it is what the phone bar watches for, and all of it needs the script.
    for (const sel of ["[data-rb-round]", ".rb-toggle", "[data-rb-donate]"]) {
      expect(main.querySelector(sel)!.closest("[data-rb-watch]"), sel).not.toBeNull();
      expect(main.querySelector(sel)!.closest("[data-needs-js]"), sel).not.toBeNull();
    }
  });

  it("has one Donate button and the nudge", () => {
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

// The bag and Donate scroll out of sight down a long list. A slim bar at the foot of the screen keeps
// the total and a Donate button in reach, at every width (assets/js/red-bag.js shows it).
describe("the bottom bar", () => {
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
  it("has the three themes as plain groups, three examples each", () => {
    const themes = [...main.querySelectorAll(".rb-theme")];
    expect(themes.map((t) => norm(t.querySelector("h3")?.textContent))).toEqual(["After a crisis", "Clothing & school", "A hand at rock bottom"]);
    expect(main.querySelectorAll("button[data-rb-example]").length).toBe(9);
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

  it("no longer has the Red Bags Full of Joy theme", () => {
    const need = norm(main.querySelector("[data-rb-need]")?.textContent);
    expect(need).not.toContain("Red Bags Full of Joy");
    expect(need).not.toContain("For those going without at Christmas");
    expect(main.querySelector('[data-rb-example^="joy"]')).toBeNull();
  });

  // The themes used to be a section of their own far below the bag. They are now in the bag's own
  // section: on a phone the list, then the themes, then the bag and Donate; on a desktop the
  // stylesheet lifts the bag to the top of the right hand column with the themes under it.
  it("sits between the list and the bag in the page, with the real items note last", () => {
    const layout = main.querySelector("[data-rb-builder] .rb-layout")!;
    const kids = [...layout.children].map((el) => el.className.split(" ")[0]);
    expect(kids).toEqual(["rb-paper", "rb-need", "rb-panel", "rb-real"]);
    expect(main.querySelectorAll("[data-rb-need]").length).toBe(1);
  });

  it("is a named part of the page, with its heading and its own words above the themes", () => {
    const need = main.querySelector("[data-rb-need]")!;
    expect(need.tagName).toBe("DIV");
    expect(need.getAttribute("role")).toBe("region");
    expect(doc.getElementById(need.getAttribute("aria-labelledby") ?? "")).toBe(need.querySelector("h2"));
    expect(norm(need.querySelector("h2")?.textContent)).toBe("Whenever the need comes");
    const parts = [...need.children].map((el) => el.className.split(" ")[0]);
    expect(parts).toEqual(["rb-need__head", "rb-themes"]);
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

  it("words a monthly amount as every month, never a month", () => {
    expect(norm(main.querySelector("[data-rb-per-month]")?.textContent)).toBe("every month");
    expect(norm(step.querySelector("[data-rb-details-monthly]")?.textContent)).toBe("every month");
    expect(visibleCopy(html, [".giftaid-statement"])).not.toMatch(/a month/);
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

// The thank you is a page of its own, /fill/thank-you (Jaimie, 4 October 2026: "surely there should
// be a thank you page"): fill-thank-you.html, drawn by renderRedBagThanksPage. Stripe returns here.
describe("the thank you page", () => {
  const tmain = tdoc.querySelector("main")!;
  const thanks = tmain.querySelector("[data-rb-thanks]")!;

  it("is its own page: one big heading, which IS the thank you, under the eyebrow Thank you", () => {
    expect(tdoc.querySelectorAll("h1").length).toBe(1);
    const h1 = tdoc.querySelector("h1")!;
    expect(norm(h1.textContent)).toBe("Thank you for filling a Red Bag");
    expect(h1.id).toBe("rb-thanks-title");
    expect(h1.getAttribute("tabindex")).toBe("-1"); // the focus lands here on arrival
    expect(norm(tmain.querySelector(".eyebrow")?.textContent)).toBe("Thank you");
    expect(norm(tdoc.querySelector("title")?.textContent)).toBe("Thank you for filling a Red Bag | Night Before Christmas Campaign");
  });

  it("has nothing of the giving page in it: no list, no bag panel, no themes, no invitation", () => {
    for (const sel of ["[data-rb-builder]", ".rb-paper", ".rb-panel", "[data-rb-need]", "[data-rb-details]", "[data-rb-bar]", "[data-rb-item]", "[data-rb-example]", "form", "#rbCheckoutModal"]) {
      expect(tdoc.querySelector(sel), sel).toBeNull();
    }
    const words = norm(tmain.textContent);
    expect(words).not.toContain("A new way to give");
    expect(words).not.toContain("Pop a few things in the bag");
    expect(words).not.toContain("Pop these in the bag");
    expect(tmain.querySelector("ul, ol, table")).toBeNull();
  });

  it("says it in this order: the bag, the donation, Gift Aid, the elves line, the receipt, the share, Fill another bag", () => {
    const order = [...tmain.querySelectorAll(".rb-thanks__bag, [data-rb-thanks-total], [data-rb-thanks-plain], [data-rb-thanks-giftaid], [data-rb-thanks-elves], [data-rb-thanks-receipt], [data-rb-share], [data-rb-again]")].map((el) =>
      el.classList.contains("rb-thanks__bag") ? "bag" : [...el.attributes].find((a) => a.name.startsWith("data-rb-"))!.name.replace("data-rb-", ""),
    );
    expect(order).toEqual(["bag", "thanks-total", "thanks-plain", "thanks-giftaid", "thanks-elves", "thanks-receipt", "share", "again"]);
  });

  it("draws the tied red bag, full, for the eye only", () => {
    const bag = thanks.querySelector(".rb-thanks__bag")!;
    expect(bag.getAttribute("aria-hidden")).toBe("true");
    expect(bag.querySelectorAll("svg.rb-bag").length).toBe(1);
    expect(thanksHtml).not.toContain("<!-- red-bag:");
  });

  it("has a total line, a Gift Aid line and a plain line, each shown only when it applies", () => {
    expect(thanks.querySelector("[data-rb-thanks-total]")?.hasAttribute("hidden")).toBe(true);
    expect(thanks.querySelector("[data-rb-thanks-giftaid]")?.hasAttribute("hidden")).toBe(true);
    const plain = thanks.querySelector("[data-rb-thanks-plain]")!;
    expect(plain.hasAttribute("hidden")).toBe(false);
    // Opened without paying, or with JavaScript off, this is what it says.
    expect(norm(plain.textContent)).toBe("Your donation is on its way to NBCC.");
  });

  it("carries the elves line word for word, and says the receipt is coming, in Jaimie's words", () => {
    expect(norm(thanks.querySelector("[data-rb-thanks-elves]")?.textContent)).toBe(rb.WORDS.elves);
    expect(norm(thanks.querySelector("[data-rb-thanks-receipt]")?.textContent)).toBe("Your receipt is on its way to your inbox. Thank you for being part of this.");
  });

  it("offers a picture to share that names no amount, with every control labelled", () => {
    const share = tmain.querySelector("[data-rb-share]")!;
    expect(norm(share.querySelector("h2")?.textContent)).toBe("Share: I filled a Red Bag");
    const canvas = share.querySelector("canvas[data-rb-share-picture]")!;
    expect(canvas.getAttribute("role")).toBe("img");
    expect(canvas.getAttribute("aria-label")).toContain("I filled a Red Bag");
    expect(norm(share.textContent)).not.toMatch(/£/);
    for (const b of share.querySelectorAll("button, a")) expect(norm(b.textContent).length, b.outerHTML).toBeGreaterThan(0);
    expect(share.querySelector("[role='status'][aria-live='polite']")).not.toBeNull();
  });

  it("shares the page's new address, nbcc.scot/fill, and never the old one", () => {
    const hrefs = [...tmain.querySelectorAll("[data-rb-share] a[target='_blank']")].map((a) => decodeURIComponent(a.getAttribute("href") ?? ""));
    expect(hrefs.length).toBe(2);
    expect(hrefs[0]).toBe("https://www.facebook.com/sharer/sharer.php?u=https://nbcc.scot/fill");
    expect(hrefs[1]).toBe("https://wa.me/?text=I filled a Red Bag with NBCC. You can fill one too: https://nbcc.scot/fill");
    expect(thanksHtml).not.toContain("fill-a-red-bag");
    for (const a of tmain.querySelectorAll("[data-rb-share] a[target='_blank']")) {
      expect(a.getAttribute("rel")).toBe("noopener");
      expect(norm(a.querySelector(".sr-only")?.textContent)).toBe(", opens in a new tab");
    }
  });

  it("ends with a way back: Fill another bag, quieter than the share", () => {
    const again = tmain.querySelector("[data-rb-again] a")!;
    expect(norm(again.textContent)).toBe("Fill another bag");
    expect(again.getAttribute("href")).toBe("/fill");
    expect(again.classList.contains("btn-ghost")).toBe(true);
    expect(again.classList.contains("btn-primary")).toBe(false);
    expect(tmain.querySelector("[data-rb-share-send]")!.classList.contains("btn-primary")).toBe(true);
  });

  it("is never indexed, and has no canonical address or share card", () => {
    expect(tdoc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
    expect(tdoc.querySelector('link[rel="canonical"]')).toBeNull();
    expect(tdoc.querySelector('meta[property^="og:"]')).toBeNull();
  });

  it("wears the same header and footer as the other public pages, skip link first", () => {
    const other = new DOMParser().parseFromString(read("fundraise-help.html"), "text/html");
    expect(norm(tdoc.querySelector("header")!.outerHTML)).toBe(norm(other.querySelector("header")!.outerHTML));
    expect(norm(tdoc.querySelector("footer")!.outerHTML)).toBe(norm(other.querySelector("footer")!.outerHTML));
    const first = tdoc.body.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    expect(first?.classList.contains("skip-link")).toBe(true);
    expect(tdoc.querySelectorAll("main").length).toBe(1);
    expect(norm(tdoc.querySelector("footer .legal")?.textContent)).toContain("SC047995");
  });

  it("loads the catalogue, then its own small script, and not the giving page's", () => {
    const scripts = [...tdoc.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"));
    expect(scripts).toEqual(["/assets/js/main.js", "/assets/js/red-bag-catalogue.js", "/assets/js/red-bag-workshop.js", "/assets/js/red-bag-thanks.js", "/assets/js/pulse.js"]);
    for (const l of tdoc.querySelectorAll("link[href]")) expect(l.getAttribute("href")).toMatch(/^\/assets\//);
    // The Workshop's line is in the paper's hand (test/unit/red-bag-thanks-page.test.ts), so the
    // handwriting face is asked for early, as on the giving page.
    expect(thanksTemplate).toContain('<link rel="preload" href="/assets/fonts/caveat-latin.woff2" as="font" type="font/woff2" crossorigin />');
  });

  it("keeps the wording rules: could, never will; no dashes; British", () => {
    // One line is the owner's own, word for word (5 October 2026), and is about the elves, not about
    // what the money buys: "Bag packed. The elves will take it from here." It is the only "will".
    const line = "Bag packed. The elves will take it from here.";
    const whole = visibleCopy(thanksHtml);
    expect(whole.split(line).length - 1).toBe(1);
    const copy = whole.replace(line, "");
    expect(copy).not.toMatch(/\bwill\b/i);
    expect(copy.match(/[–—]/g) ?? []).toEqual([]);
    expect(copy.match(/\w-\w/g) ?? []).toEqual([]);
    expect(copy).not.toMatch(/a month/);
  });

  it("shows the staff strip on a preview, and only then", () => {
    expect(thanksHtml).not.toContain("Staff preview");
    const d = new DOMParser().parseFromString(renderRedBagThanksPage(thanksTemplate, { preview: true }), "text/html");
    expect(norm(d.querySelector(".rb-preview")?.textContent)).toBe("Staff preview: not public yet");
    expect(d.body.getAttribute("data-rb-preview")).toBe("true");
  });
});

describe("the giving page no longer carries a thank you", () => {
  it("has no thank you step and no share: there is one thank you, on its own page", () => {
    expect(main.querySelector("[data-rb-thanks]")).toBeNull();
    expect(main.querySelector("[data-rb-share]")).toBeNull();
    expect(html).not.toContain("Thank you for filling a Red Bag");
    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(norm(doc.querySelector("h1")?.textContent)).toBe("Fill a Red Bag");
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
    // (The canonical address names the page itself; everything that is LOADED is ours.)
    for (const l of doc.querySelectorAll('link[href]:not([rel="canonical"])')) expect(l.getAttribute("href")).toMatch(/^\/assets\//);
  });
});

// The page's one address is /fill (Jaimie, 4 October 2026). Search engines may list it from the day
// it is live ("once it's pushed and live I don't mind if Google crawls it"), so it is on the site
// map and carries what an indexable page here carries. It is still LINKED from nowhere: not the
// Donate page, not the menu, not the footer. These pin that, so a link cannot creep in unnoticed.
describe("listed for search engines, but linked from nowhere", () => {
  const head = (key: string) => doc.querySelector(`meta[name="${key}"], meta[property="${key}"]`)?.getAttribute("content");
  const TITLE = "Fill a Red Bag | Night Before Christmas Campaign";
  const DESCRIPTION = "Pop a few things in a Red Bag and watch it fill. A new way to give to NBCC, showing what your donation could do for children, young people and vulnerable adults, all year round.";

  it("does not tell search engines to stay away", () => {
    expect(doc.querySelector('meta[name="robots"]')).toBeNull();
    expect(html).not.toMatch(/noindex/);
  });

  it("has a title and a plain, honest description that says could", () => {
    expect(norm(doc.querySelector("title")?.textContent)).toBe(TITLE);
    expect(head("description")).toBe(DESCRIPTION);
    expect(DESCRIPTION).toMatch(/\bcould\b/);
    expect(DESCRIPTION).not.toMatch(/\bwill\b/i);
    expect(DESCRIPTION).toContain("children, young people and vulnerable adults");
  });

  it("has its canonical address, https://nbcc.scot/fill, and the share card the other pages carry", () => {
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://nbcc.scot/fill");
    expect(head("og:type")).toBe("website");
    expect(head("og:site_name")).toBe("Night Before Christmas Campaign");
    expect(head("og:title")).toBe(TITLE);
    expect(head("og:description")).toBe(DESCRIPTION);
    expect(head("og:url")).toBe("https://nbcc.scot/fill");
    expect(head("twitter:card")).toBe("summary_large_image");
    expect(head("twitter:title")).toBe(TITLE);
    expect(head("twitter:description")).toBe(DESCRIPTION);
    // The site's one share picture, the one the donate page uses: no new image.
    const donate = new DOMParser().parseFromString(read("donate.html"), "text/html");
    const picture = donate.querySelector('meta[property="og:image"]')!.getAttribute("content");
    expect(picture).toBe("https://nbcc.scot/assets/img/og-image.png");
    expect(head("og:image")).toBe(picture);
    expect(head("twitter:image")).toBe(picture);
  });

  it("has a title, description and address no other page has", () => {
    for (const f of readdirSync(ROOT).filter((x) => x.endsWith(".html") && x !== "fill-a-red-bag.html")) {
      const other = read(f);
      expect(other, f).not.toContain(`<title>${TITLE}</title>`);
      expect(other, f).not.toContain(DESCRIPTION);
      expect(other, f).not.toMatch(/rel="canonical"[^>]*href="https:\/\/nbcc\.scot\/fill"|href="https:\/\/nbcc\.scot\/fill"[^>]*rel="canonical"/);
    }
  });

  it("is on the site map, and the thank you and the old addresses are not", () => {
    expect(RED_BAG_PATH).toBe("/fill");
    const page = ALL_PAGES.find((p) => p.path === "/fill");
    expect(page).toEqual({ path: "/fill", title: "Fill a Red Bag", listedByDefault: true });
    const xml = renderSitemapXml(SITE_PAGES, "https://nbcc.scot", new Map(), true, true, true);
    expect(xml).toContain("<loc>https://nbcc.scot/fill</loc>");
    const tree = renderSitemapTree(SITE_PAGES, true, true, true);
    expect(tree).toContain('href="/fill"');
    for (const text of [xml, tree]) {
      expect(text).not.toContain("/fill/thank-you");
      expect(text).not.toContain("fill-a-red-bag");
      expect(text).not.toContain("fill-a-bag");
    }
    for (const p of ["/fill/thank-you", "/fill-a-red-bag", "/fill-a-bag"]) expect(ALL_PAGES.some((x) => x.path === p), p).toBe(false);
  });

  it("can be hidden from search engines by staff, like any listed page", () => {
    const hidden = renderSitemapXml(SITE_PAGES, "https://nbcc.scot", new Map([["/fill", false]]), true, true, true);
    expect(hidden).not.toContain("<loc>https://nbcc.scot/fill</loc>");
  });

  it("is linked from no other page, the donate page included", () => {
    const pages = readdirSync(ROOT).filter((f) => f.endsWith(".html") && !OWN_PAGES.includes(f));
    expect(pages).toContain("donate.html");
    expect(pages).toContain("index.html");
    expect(pages.length).toBeGreaterThan(20);
    for (const f of pages) {
      expect(read(f), f).not.toMatch(/fill-a-red-bag|fill-a-bag|fill-thank-you/);
      expect(read(f), f).not.toMatch(/["'=(]\/fill(["'?#/]|$)/m);
      expect(read(f), f).not.toMatch(/nbcc\.scot\/fill\b/);
    }
  });

  it("is in no menu, no footer and nothing a page is drawn from", () => {
    // What adds links to pages as they are served, and what draws the pages the server builds.
    const sources = [
      "src/ball/nav-link.ts",
      "src/events/nav-link.ts",
      "src/fundraising/footer-link.ts",
      "src/ball/home-promo.ts",
      "src/events/render.ts",
      "src/fundraising/render.ts",
      "src/fundraising/impact-render.ts",
      "src/pledges/render.ts",
      "src/tickets/render.ts",
      "assets/js/main.js",
      "assets/js/fundraiser.js",
      "assets/js/events.js",
    ];
    for (const f of sources) {
      expect(read(f), f).not.toMatch(/fill-a-red-bag|fill-a-bag/);
      expect(read(f), f).not.toMatch(/["'`]\/fill(["'`?#/])/);
    }
  });

  it("does not link to itself from its own menu or footer, on either page", () => {
    for (const d of [doc, tdoc]) {
      for (const a of d.querySelectorAll("header a, footer a")) expect(a.getAttribute("href")).not.toMatch(/\/fill/);
    }
    // The giving page links to itself nowhere in what a visitor sees.
    expect([...doc.querySelectorAll("body a[href]")].filter((a) => /\/fill/.test(a.getAttribute("href") ?? ""))).toEqual([]);
    // The thank you links to it only to share it, and to fill another bag.
    const own = [...tdoc.querySelectorAll("body a[href]")].filter((a) => /\/fill|%2Ffill/.test(a.getAttribute("href") ?? ""));
    expect(own.length).toBe(3);
    for (const a of own) expect(a.closest("[data-rb-share], [data-rb-again]"), a.outerHTML).not.toBeNull();
  });

  it("keeps the thank you in the staff's own list of pages, in plain words, and not the giving page", () => {
    expect(PRIVATE_PAGES.some((p) => p.path === "/fill")).toBe(false);
    expect(PRIVATE_PAGES.some((p) => p.path === "/fill-a-red-bag")).toBe(false);
    const entry = PRIVATE_PAGES.find((p) => p.path === "/fill/thank-you");
    expect(entry?.title).toBe("Fill a Red Bag: thank you");
    expect(entry?.reach).toBe("link-only");
    expect(entry?.note).toBe("Where a donor lands after giving on Fill a Red Bag. Nothing links to it and search engines are told to skip it.");
  });

  it("cannot be taken by a spare address, nor can its thank you or its old addresses", () => {
    for (const p of ["/fill", "/fill/thank-you", "/fill-a-red-bag", "/fill-a-bag"]) expect(aliasFromProblem(p), p).not.toBeNull();
    for (const p of ["/fill", "/fill-a-red-bag", "/fill-a-bag"]) expect(RESERVED_PREFIXES, p).toContain(p);
    // Reserving /fill takes /fill and what sits under it, not every address that begins "fill".
    expect(aliasFromProblem("/fill-the-van")).toBeNull();
    expect(aliasFromProblem("/filling")).toBeNull();
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

  it("tells search engines to leave a preview alone, in the page itself", () => {
    const d = new DOMParser().parseFromString(renderRedBagPage(template, { preview: true }), "text/html");
    expect(d.querySelector('head meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
    expect(doc.querySelector('meta[name="robots"]')).toBeNull();
  });
});

// --- who is given the page -----------------------------------------------------------------------

function ask(opts: { live: boolean; indexable?: boolean; staff?: boolean | Error; authorization?: string; template?: () => string; notFound?: () => string; decorate?: () => Promise<string> }) {
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
    indexable: opts.indexable ?? true,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return handler({ headers: { authorization: opts.authorization, cookie: undefined } } as any, res as any, next).then(() => ({ res, isStaff, next }));
}

// The real Express router, with the site's catch-all 404 behind it, so that exact matching, case
// and a trailing slash are checked as Express does them.
describe("the addresses, through the router", () => {
  let server: Server | null = null;
  afterEach(() => {
    if (server) server.close();
    server = null;
  });
  async function site(live: boolean | undefined, staffToken?: string) {
    const app = express();
    const router = express.Router();
    addRedBagPageRoutes(router, ROOT, {
      decorate: async (h) => h,
      ...(live === undefined ? {} : { live: () => live }),
      isStaff: async (authorization) => !!staffToken && authorization === `Bearer ${staffToken}`,
    });
    // What the site's own catch-all does with anything not taken: the 404.
    router.use((_req, res) => void res.status(404).type("html").send("We cannot find that page"));
    app.use(router);
    server = app.listen(0);
    await new Promise((r) => server!.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { redirect: "manual", headers });
  }

  describe("GET /fill, the giving page", () => {
    it("is the page, for anyone, and search engines may list it", async () => {
      const res = await (await site(true))("/fill");
      expect(res.status).toBe(200);
      expect(res.headers.get("x-robots-tag")).toBeNull();
      const body = await res.text();
      expect(body).toContain("Pop these in the bag");
      expect(body).not.toMatch(/noindex/);
      expect(body).not.toContain("Staff preview");
      expect(body).not.toContain("red-bag-preview.js");
    });

    it("is the same page in any case, with or without a trailing slash, and with a query", async () => {
      const get = await site(true);
      for (const path of ["/Fill", "/fill/", "/fill?utm_source=poster"]) {
        const res = await get(path);
        expect(res.status, path).toBe(200);
        expect(await res.text(), path).toContain("Pop these in the bag");
      }
    });

    it("is exact: it takes nothing else that begins the same way", async () => {
      const get = await site(true);
      for (const other of ["/filling", "/fillanything", "/fill-a", "/fills", "/fill/anything", "/fill/thank-you/more", "/fill-a-bag-now", "/fill-a-red-bag/more"]) {
        const res = await get(other);
        expect(res.status, other).toBe(404);
        expect(res.headers.get("location"), other).toBeNull();
      }
    });

    it("as it ships now (the real switch): the page, listable", async () => {
      const res = await (await site(undefined))("/fill");
      expect(res.status).toBe(200);
      expect(res.headers.get("x-robots-tag")).toBeNull();
    });
  });

  describe("GET /fill/thank-you", () => {
    it("is the thank you page, for anyone, and never indexed", async () => {
      const res = await (await site(true))("/fill/thank-you?session_id=cs_test_abc");
      expect(res.status).toBe(200);
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      const body = await res.text();
      expect(body).toContain("<h1");
      expect(body).toContain("Thank you for filling a Red Bag");
      expect(body).toContain('<meta name="robots" content="noindex, nofollow" />');
      expect(body).not.toContain("Pop these in the bag");
      expect(body).not.toContain("Staff preview");
    });

    it("opened without paying, is the plain thank you", async () => {
      const res = await (await site(true))("/fill/thank-you");
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Your donation is on its way to NBCC.");
    });

    it("switched off, is the site's 404 to the public and the page under the strip to staff", async () => {
      const get = await site(false, "a-token");
      const pub = await get("/fill/thank-you");
      expect(pub.status).toBe(404);
      expect(pub.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      const pubBody = await pub.text();
      expect(pubBody).toContain("We cannot find that page");
      expect(pubBody).not.toContain("Thank you for filling a Red Bag");
      const staff = await get("/fill/thank-you", { Authorization: "Bearer a-token" });
      expect(staff.status).toBe(200);
      expect(staff.headers.get("cache-control")).toBe("private, no-store");
      expect(staff.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      const staffBody = await staff.text();
      expect(staffBody).toContain("Staff preview: not public yet");
      expect(staffBody).toContain("Thank you for filling a Red Bag");
    });
  });

  // The address the page first had, and the other way people type it. Both forward for good, as
  // /getinvolved and /involved do to Get involved (TASK-496).
  describe("the old and the other address, /fill-a-red-bag and /fill-a-bag", () => {
    it("are these two, and only these", () => {
      expect(RED_BAG_FORWARDS).toEqual(["/fill-a-red-bag", "/fill-a-bag"]);
    });

    for (const path of ["/fill-a-red-bag", "/fill-a-bag", "/Fill-A-Red-Bag", "/FILL-A-BAG", "/fill-a-red-bag/", "/fill-a-bag/"]) {
      it(`${path} goes to /fill for good`, async () => {
        const res = await (await site(true))(path);
        expect(res.status).toBe(301);
        expect(res.headers.get("location")).toBe("/fill");
      });
    }

    it("keep the query string, so a poster's or an email's tags still count", async () => {
      const get = await site(true);
      const a = await get("/fill-a-red-bag?utm_source=poster&utm_medium=qr");
      expect(a.status).toBe(301);
      expect(a.headers.get("location")).toBe("/fill?utm_source=poster&utm_medium=qr");
      const b = await get("/fill-a-bag/?utm_source=radio");
      expect(b.status).toBe(301);
      expect(b.headers.get("location")).toBe("/fill?utm_source=radio");
    });

    // A donor who paid while the thank you was still part of the old page comes back to
    // /fill-a-red-bag?thanks=1&session_id=...: they must still land on a thank you.
    it("send an old return from paying to the thank you page, query kept", async () => {
      const get = await site(true);
      const res = await get("/fill-a-red-bag?thanks=1&session_id=cs_test_abc");
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("/fill/thank-you?thanks=1&session_id=cs_test_abc");
      const bare = await get("/fill-a-red-bag?thanks=1");
      expect(bare.headers.get("location")).toBe("/fill/thank-you?thanks=1");
      // Only the flag the old page used: anything else is an ordinary visit.
      expect((await get("/fill-a-red-bag?thanks=0")).headers.get("location")).toBe("/fill?thanks=0");
      expect((await get("/fill-a-red-bag?session_id=cs_test_abc")).headers.get("location")).toBe("/fill?session_id=cs_test_abc");
    });

    // They follow the switch. Switched off the page is the 404 to the public, so these are too: a
    // forward would say there is a page there.
    it("switched off, are the site's ordinary 404, and send nobody anywhere", async () => {
      const get = await site(false);
      for (const path of ["/fill-a-red-bag", "/fill-a-bag", "/fill-a-red-bag?thanks=1&session_id=cs_test_abc"]) {
        const res = await get(path);
        expect(res.status, path).toBe(404);
        expect(res.headers.get("location"), path).toBeNull();
        const body = await res.text();
        expect(body, path).toContain("We cannot find that page");
        expect(body, path).not.toContain("red-bag");
      }
    });

    it("as it ships now (the real switch), forward", async () => {
      const res = await (await site(undefined))("/fill-a-red-bag");
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("/fill");
    });
  });
});

describe("GET /fill, who is given the page", () => {
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

  it("switched off, is the page with the strip to a signed in member of staff, never kept and never indexed", async () => {
    const { res, isStaff } = await ask({ live: false, staff: true, authorization: "Bearer a-token" });
    expect(isStaff).toHaveBeenCalledWith("Bearer a-token");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Staff preview: not public yet");
    expect(res.body).toContain("rb-paper");
    expect(res.body).toContain("decorated");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["vary"]).toBe("Authorization");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    // The page itself says so too, on a preview only.
    expect(res.body).toContain('<meta name="robots" content="noindex, nofollow" />');
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
    expect(res.body).not.toContain("data-rb-preview");
    expect(res.body).not.toContain("red-bag-preview.js");
    expect(res.body).toContain("decorated");
    expect(isStaff).not.toHaveBeenCalled();
    // An ordinary public page: it may be kept like any other.
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  // Jaimie, 4 October 2026: "once it's pushed and live I don't mind if Google crawls it".
  it("switched on, lets search engines list it: no noindex, in the header or in the page", async () => {
    const { res } = await ask({ live: true });
    expect(res.headers["x-robots-tag"]).toBeUndefined();
    expect(res.body).not.toMatch(/noindex/);
  });

  it("a page that is not for listing (the thank you) keeps its noindex header when switched on", async () => {
    const { res } = await ask({ live: true, indexable: false });
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("as it ships now (the real switch): the page, for anyone, with no strip and no 404", async () => {
    const res = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: "",
      status(c: number) { this.statusCode = c; return this; },
      setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; return this; },
      type() { return this; },
      send(b: string) { this.body = b; return this; },
    };
    const isStaff = vi.fn(async () => false);
    const handler = redBagPageHandler({ template: () => template, notFound: () => read("404.html"), decorate: async (h) => h, isStaff, indexable: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({ headers: {} } as any, res as any, vi.fn());
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Pop these in the bag");
    expect(res.body).not.toContain("Staff preview");
    expect(res.body).not.toContain("We cannot find that page");
    expect(res.body).not.toContain("red-bag-preview.js");
    expect(isStaff).not.toHaveBeenCalled();
  });
});

// Express 4 does not catch what an async handler throws: the request would hang. Whatever cannot be
// read, the visitor is handed on to the site's own 404 (the router's catch-all), and it is logged.
describe("GET /fill when something cannot be read", () => {
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
      // The one place off the paper: the gift tag on a full bag, "Packed with love" (4 October 2026).
      for (const part of selector.split(",")) expect(part.trim(), part).toMatch(/^\.rb-(paper|bag__tag-words)\b/);
    }
    const families = [...rules.replace(/@font-face\s*\{[^}]*\}/g, "").matchAll(/font-family\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
    for (const f of families) expect(f).toMatch(/^var\(--(rb-hand|font-head|font-body)\)$/);
  });

  it("is loaded by this page alone: no other page, and not the shared stylesheet, knows of it", () => {
    expect(read("assets/css/styles.css")).not.toMatch(/caveat-latin|"Caveat"/i);
    // Fill a Red Bag's two pages only: the giving page's paper, and (since 5 October 2026) the line
    // under the Workshop on the thank you, which has a stylesheet of its own beside this one.
    for (const f of readdirSync(ROOT).filter((x) => x.endsWith(".html") && !OWN_PAGES.includes(x))) {
      expect(read(f), f).not.toMatch(/caveat-latin|"Caveat"/i);
      expect(read(f), f).not.toMatch(/red-bag\.css/i);
    }
    // The thank you wears the same stylesheet, and has no paper on it.
    expect(thanksTemplate).toContain('href="/assets/css/red-bag.css"');
    expect(tdoc.querySelector(".rb-paper")).toBeNull();
    for (const f of readdirSync(resolve(ROOT, "assets/css")).filter((x) => x !== "red-bag.css" && x !== "red-bag-thanks.css")) {
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

  // Desktop: the list on the left; on the right the bag at the top and the themes under it, in the
  // space beside the long paper. The page's order is the phone's (list, themes, bag), so the
  // stylesheet places them; nothing is moved by script.
  const desktopRules = () => /@media \(min-width:861px\)\{((?:[^{}]*\{[^{}]*\})*)/.exec(rules)?.[1] ?? "";

  it("places the bag at the top of the right hand column on a desktop, with the themes under it", () => {
    const desktop = desktopRules();
    expect(desktop).toMatch(/\.rb-layout\{[^}]*grid-template-columns:minmax\(0,1\.2fr\) minmax\(0,\.8fr\)/);
    // The second row takes what is left, so the themes start straight under the bag.
    expect(desktop).toMatch(/\.rb-layout\{[^}]*grid-template-rows:auto 1fr/);
    expect(desktop).toMatch(/\.rb-paper\{[^}]*grid-column:1;grid-row:1 \/ span 2/);
    expect(desktop).toMatch(/\.rb-panel\{[^}]*grid-column:2;grid-row:1/);
    expect(desktop).toMatch(/\.rb-need\{[^}]*grid-column:2;grid-row:2/);
    expect(desktop).toMatch(/\.rb-real\{[^}]*grid-column:1 \/ -1/);
  });

  it("stacks the themes one under another in that column, each example the column's full width", () => {
    expect(desktopRules()).toMatch(/\.rb-themes\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
    expect(rules).toMatch(/\.rb-example\{[^}]*width:100%/);
  });

  it("is one column when stacked: the list, the themes, then the bag", () => {
    const outside = rules.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    expect(outside).toMatch(/\.rb-layout\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
    expect(outside).not.toMatch(/grid-row|grid-column:[12]/);
  });

  it("has no sticky panel: nothing follows the reader down the page but the bottom bar", () => {
    expect(rules).not.toMatch(/position:\s*sticky/);
    // Two things are fixed to the screen: the bottom bar, and the layer the snow and stars fall in
    // for a couple of seconds at a milestone (decoration only: it takes no tap and is then removed).
    const fixed = [...rules.matchAll(/([^{}]+)\{[^}]*position:fixed/g)].map((m) => m[1].trim());
    expect(fixed).toEqual([".rb-bar", ".rb-flurry"]);
  });

  it("shows which of once and monthly is chosen by more than colour: a tick as well", () => {
    expect(rules).toMatch(/\.rb-mode\[aria-pressed="true"\]\{[^}]*background(-color)?:var\(--holly\)/);
    expect(rules).toMatch(/\.rb-mode\[aria-pressed="true"\]::before\{[^}]*content:"\\2713"/);
  });

  it("keeps tap targets at 44px or more", () => {
    expect(rules).toMatch(/\.rb-mode\{[^}]*min-height:44px/);
    expect(rules).toMatch(/\.rb-round\{[^}]*min-height:44px/);
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

  // The bar is at EVERY width (Jaimie, 4 October 2026): on a computer too the total and Donate
  // scroll out of sight down a long list.
  it("draws the bottom bar at every width, fixed to the foot, clear of the home bar", () => {
    const outside = rules.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const rule = /\.rb-bar\{([^}]*)\}/.exec(outside)?.[1] ?? "";
    expect(rule).toMatch(/display:flex/);
    expect(rule).toMatch(/position:fixed/);
    expect(rule).toMatch(/bottom:0/);
    expect(rule).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(rules).not.toMatch(/\.rb-bar\{[^}]*display:none/);
    expect(outside).toMatch(/\.rb-bar__donate\{[^}]*min-height:44px/);
    // While it shows, the page is longer by its height, so it never sits over the end of the footer.
    expect(outside).toMatch(/body\.rb-bar-on\{[^}]*padding-bottom:[^}]*env\(safe-area-inset-bottom\)/);
  });

  // The bar is fixed over the foot of the screen. A keyboard user tabbing down the list must not
  // have the control they are on brought to rest underneath it.
  it("keeps the foot of the screen clear when the browser scrolls to a focused control", () => {
    const outside = rules.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    expect(outside).toMatch(/html\{[^}]*scroll-padding-bottom:calc\(72px \+ env\(safe-area-inset-bottom\)\)/);
  });

  it("keeps the bar's contents within the page's width, in line with the page, not edge to edge", () => {
    const outside = rules.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const rule = /\.rb-bar\{([^}]*)\}/.exec(outside)?.[1] ?? "";
    // The strip itself spans the screen; its padding is the page's own gutter, growing with the
    // screen beyond the page's widest, so the total and the button sit under the page's content.
    expect(rule).toMatch(/left:0;right:0/);
    expect(rule).toMatch(/padding-inline:max\(var\(--pad\),calc\(\(100% - var\(--maxw\)\) \/ 2 \+ var\(--pad\)\)\)/);
    // On a computer the total sits beside its button, under the bag's column, not far across the page.
    expect(desktopRules()).toMatch(/\.rb-bar\{[^}]*justify-content:flex-end/);
  });

  it("shows a pressed example in holly green", () => {
    expect(rules).toMatch(/\.rb-example\[aria-pressed="true"\]\{[^}]*background(-color)?:var\(--holly\)/);
  });
});
