import { describe, it, expect } from "vitest";
import { ballBagsOpen, bagsFromSession, renderBallBagsPage, renderBallBagsThanks } from "../../src/ball/bags-page";
import { SINGLE_DONATION_WORDING } from "../../src/declarations/wording";
import { ALL_PAGES, PRIVATE_PAGES, RESERVED_PREFIXES, aliasFromProblem } from "../../src/site/pages";

// Red bags at the Festive Ball (docs/superpowers/specs/2026-11-02-ball-table-bags-design.md): the
// page a table card's QR code opens, /bag, and the thank you Stripe brings a guest back to. The words
// are NBCC's own (Jaimie, 2 November 2026: "stick with our usual wording"), so they are held here
// word for word. Every name here is invented.

const page = renderBallBagsPage();
// An en or em dash, by code point so this file carries neither.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the window: open until the end of Sunday 8 November 2026 in the UK", () => {
  it("is open from the day it ships, through the Ball, to the last second of the Sunday", () => {
    expect(ballBagsOpen(new Date("2026-11-02T09:00:00Z"))).toBe(true);
    expect(ballBagsOpen(new Date("2026-11-07T22:30:00Z"))).toBe(true);
    // The clocks went back on 25 October, so midnight in the UK is midnight UTC.
    expect(ballBagsOpen(new Date("2026-11-08T23:59:59Z"))).toBe(true);
  });

  it("closes at midnight as Monday 9 November begins in the UK", () => {
    expect(ballBagsOpen(new Date("2026-11-09T00:00:00Z"))).toBe(false);
    expect(ballBagsOpen(new Date("2026-12-01T12:00:00Z"))).toBe(false);
  });
});

describe("the page, /bag", () => {
  it("is a whole page, not for search engines", () => {
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page).toContain('<meta name="robots" content="noindex" />');
    expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
    expect(page).toContain("<title>");
  });

  it("loads only its own small stylesheet and script, and the visit counter", () => {
    expect(page).toContain('<link rel="stylesheet" href="/assets/css/ball-bags.css" />');
    expect(page).toContain('<script defer src="/assets/js/ball-bags.js"></script>');
    expect(page).toContain('<script defer src="/assets/js/pulse.js"></script>');
    for (const heavy of ["main.js", "red-bag.js", "red-bag-catalogue.js", "red-bag-workshop.js", "styles.css", "stripe.com"]) {
      expect(page, heavy).not.toContain(heavy);
    }
  });

  it("welcomes the guest in NBCC's own words", () => {
    const text = words(page);
    expect(text).toContain("NBCC Festive Ball");
    expect(text).toContain("Thank you for being here tonight");
    expect(text).toContain(
      "£50 fills a full red bag for children, young people and vulnerable adults across South West Scotland who would otherwise wake up on Christmas morning with nothing to open.",
    );
    for (const line of ["A cosy blanket and pyjamas", "Hat, gloves and socks", "A toy and a book", "A few treats to unwrap"]) {
      expect(text, line).toContain(line);
    }
    expect(page).toMatch(/<button[^>]*id="bbStart"[^>]*>Fill a bag<\/button>/);
  });

  it("draws the tied red bag with its gift tag and the round £50 tag", () => {
    expect(page).toContain('viewBox="0 0 120 132"');
    expect(page).toContain("rbw-bow");
    expect(page).toContain(">Packed</tspan>");
    expect(page).toContain(">with love</tspan>");
    expect(page).toContain('class="bb-price"');
  });

  it("starts at one bag, with plus and minus as labelled buttons and the count announced", () => {
    expect(page).toMatch(/<button[^>]*id="bbLess"[^>]*aria-label="One bag fewer"/);
    expect(page).toMatch(/<button[^>]*id="bbMore"[^>]*aria-label="One more bag"/);
    expect(page).toContain('aria-live="polite"');
    expect(text1()).toContain("1 full red bag");
    expect(page).toContain(">£50</");
    expect(page).toMatch(/<button[^>]*id="bbGive"[^>]*>Give £50<\/button>/);
  });

  it("asks first name, surname and email, each with the autocomplete a phone fills in one tap", () => {
    expect(page).toMatch(/id="bbFirstName"[^>]*autocomplete="given-name"/);
    expect(page).toMatch(/id="bbSurname"[^>]*autocomplete="family-name"/);
    expect(page).toMatch(/id="bbEmail"[^>]*type="email"[^>]*autocomplete="email"/);
  });

  it("offers Gift Aid closed, with the Ball's donate page's declaration word for word and its fields", () => {
    expect(words(page)).toContain("Add Gift Aid (25% more, at no cost to you)");
    expect(page).toContain(SINGLE_DONATION_WORDING.wording_snapshot);
    expect(page).toMatch(/<input[^>]*id="bbGiftAid"[^>]*type="checkbox"/);
    expect(page).not.toMatch(/id="bbGiftAid"[^>]*checked/);
    expect(page).toMatch(/<fieldset[^>]*id="bbDeclaration"[^>]*hidden/);
    expect(page).toContain('id="bbHouse"');
    expect(page).toMatch(/id="bbAddress"[^>]*autocomplete="street-address"/);
    expect(page).toMatch(/id="bbPostcode"[^>]*autocomplete="postal-code"/);
    expect(page).toContain('id="bbNonUk"');
  });

  it("has a place beside the button for a message, and the charity's number in the footer", () => {
    expect(page).toContain('id="bbStatus"');
    expect(words(page)).toContain("SC047995");
  });

  it("never names a child alone, and has no dashes", () => {
    expect(words(page)).not.toMatch(/\ba child\b/i);
    expect(page).not.toMatch(DASHES);
  });

  function text1() {
    return words(page);
  }
});

describe("the thank you, /bag/thank-you", () => {
  it("says how many red bags were filled", () => {
    expect(words(renderBallBagsThanks(3))).toContain("You've filled 3 red bags");
    expect(words(renderBallBagsThanks(1))).toContain("You've filled a red bag");
    expect(words(renderBallBagsThanks(20))).toContain("You've filled 20 red bags");
  });

  it("thanks the guest in NBCC's words, and offers another quietly", () => {
    const html = renderBallBagsThanks(2);
    expect(words(html)).toContain(
      "Thank you. Someone who would otherwise have nothing to open will wake up to it on Christmas morning. Enjoy the rest of your night.",
    );
    expect(html).toMatch(/<a[^>]*href="\/bag"[^>]*>Fill another<\/a>/);
  });

  it("is a plain thank you, with no number, when the count is not known", () => {
    const html = renderBallBagsThanks(0);
    expect(words(html)).not.toMatch(/You've filled/);
    expect(words(html)).toContain("Thank you. Someone who would otherwise have nothing to open");
    expect(words(html)).not.toMatch(/error|wrong/i);
  });

  it("draws the bags, ten at most, then says how many more", () => {
    const count = (html: string) => (html.match(/class="bb-bag"/g) ?? []).length;
    expect(count(renderBallBagsThanks(3))).toBe(3);
    expect(count(renderBallBagsThanks(14))).toBe(10);
    expect(words(renderBallBagsThanks(14))).toContain("+4");
    expect(count(renderBallBagsThanks(0))).toBe(1);
  });

  it("is not for search engines, and has no dashes", () => {
    const html = renderBallBagsThanks(3);
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).toContain("data-bb-thanks");
    expect(html).not.toMatch(DASHES);
    expect(words(html)).not.toMatch(/\ba child\b/i);
  });
});

describe("how many bags a Stripe session paid for", () => {
  it("reads the bag count the checkout stamped on it", () => {
    expect(bagsFromSession({ metadata: { ballBags: "3" }, amount_total: 15000 })).toBe(3);
  });

  it("works it out from the amount when the count is missing", () => {
    expect(bagsFromSession({ metadata: {}, amount_total: 10000 })).toBe(2);
    expect(bagsFromSession({ amount_total: 5000 })).toBe(1);
  });

  it("gives up, for a plain thank you, on anything else", () => {
    expect(bagsFromSession(null)).toBe(0);
    expect(bagsFromSession({})).toBe(0);
    expect(bagsFromSession({ metadata: { ballBags: "lots" } })).toBe(0);
    expect(bagsFromSession({ metadata: { ballBags: "21" } })).toBe(0);
    expect(bagsFromSession({ amount_total: 7500 })).toBe(0);
    expect(bagsFromSession({ amount_total: 0 })).toBe(0);
  });
});

describe("the site's page lists", () => {
  it("reserves /bag, so no spare address can shadow it or its thank you", () => {
    expect(RESERVED_PREFIXES).toContain("/bag");
    expect(aliasFromProblem("/bag")).not.toBeNull();
    expect(aliasFromProblem("/bag/thank-you")).not.toBeNull();
  });

  it("lists both as private pages, never on the public map", () => {
    for (const path of ["/bag", "/bag/thank-you"]) {
      expect(PRIVATE_PAGES.some((p) => p.path === path), path).toBe(true);
      expect(ALL_PAGES.some((p) => p.path === path), path).toBe(false);
    }
  });
});
