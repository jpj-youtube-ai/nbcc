import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { ballBagsOpen, bagsFromSession, renderBallBagsPage, renderBallBagsThanks } from "../../src/ball/bags-page";
import { SINGLE_DONATION_WORDING } from "../../src/declarations/wording";
import { ALL_PAGES, PRIVATE_PAGES, RESERVED_PREFIXES, aliasFromProblem } from "../../src/site/pages";

// Red bags at the Festive Ball (docs/superpowers/specs/2026-11-02-ball-table-bags-design.md): the
// page a table card's QR code opens, /bag, and the thank you Stripe brings a guest back to. The words
// are NBCC's own (Jaimie, 2 November 2026: "stick with our usual wording"), so they are held here
// word for word. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
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
    expect(text).toContain("Festive Ball");
    expect(text).toContain("Thank you for being here tonight");
    expect(text).toContain(
      "£50 could fill a full red bag for children, young people and vulnerable adults across South West Scotland who would otherwise wake up on Christmas morning with nothing to open.",
    );
    // Jaimie, 2 November 2026: "we can't legally say that it's going to fill a bag". Never a promise.
    expect(page).not.toContain("£50 fills");
    for (const line of ["A cosy blanket and pyjamas", "Hat, gloves and socks", "A toy and a book", "A few treats to unwrap"]) {
      expect(text, line).toContain(line);
    }
    expect(page).toMatch(/<button[^>]*id="bbStart"[^>]*>Fill a bag<\/button>/);
  });

  it("wears NBCC's red logo on the cream page, with the Ball under it", () => {
    expect(page).toContain('<img class="bb-logo" src="/assets/img/nbcc-logo-192.webp" width="66" height="64" alt="NBCC, Night Before Christmas Campaign"');
    expect(page).toContain('<p class="bb-eyebrow">Festive Ball</p>');
    expect(page).toContain('<meta name="theme-color" content="#F8F5EE" />');
    expect(existsSync(resolve(ROOT, "assets/img/nbcc-logo-192.webp"))).toBe(true);
  });

  it("shows the bag as one picture, sized in the page, with words for anyone who cannot see it, and the round £50", () => {
    expect(page).toContain(
      '<img class="bb-hero__bag" src="/assets/img/ball-bag-hero.webp" width="280" height="308" alt="A red gift bag full of presents, tied with a gold bow and a gift tag that says Packed with love"',
    );
    expect(page).toContain('class="bb-price"');
    // The gift tag's words are in the picture, so the phone needs no handwriting font.
    expect(page).not.toContain("<tspan");
    expect(readFileSync(resolve(ROOT, "assets/css/ball-bags.css"), "utf8")).not.toMatch(/caveat/i);
  });

  it("keeps the picture small enough for a hotel's signal", () => {
    expect(statSync(resolve(ROOT, "assets/img/ball-bag-hero.webp")).size).toBeLessThan(60 * 1024);
    expect(statSync(resolve(ROOT, "assets/img/nbcc-logo-192.webp")).size).toBeLessThan(15 * 1024);
  });

  it("shows each thing in a bag with Fill a Red Bag's own drawing, in a soft coloured circle", () => {
    const items = page.match(/<ul class="bb-inside">[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect((items.match(/<svg class="rb-art bb-art"/g) ?? []).length).toBe(4);
    for (const tone of ["tan", "holly", "gold", "crimson"]) expect(items, tone).toContain(`bb-tone--${tone}`);
    expect(items).not.toContain("rb-flake");
  });

  it("welcomes on the new site's quilted band, with the four things in a bag as gift tags on the gold ribbon", () => {
    const welcome = page.match(/<section class="bb-screen bb-welcome"[\s\S]*?<\/section>/)?.[0] ?? "";
    const band = welcome.match(/<div class="bb-band bb-band--welcome">[\s\S]*<svg class="bb-wave"/)?.[0] ?? "";
    expect(band).toContain('id="bbWelcomeTitle"');
    expect(band).toContain('<p class="bb-eyebrow">Festive Ball</p>');
    expect(band).toContain('<div class="bb-ribbon" aria-hidden="true"><svg class="bb-bow"');
    const tags = band.match(/<li class="bb-gift bb-gift--(card|crimson|holly|tan)"/g) ?? [];
    expect(tags.length).toBe(4);
    for (const tag of ["card", "crimson", "holly", "tan"]) expect(band, tag).toContain(`bb-gift--${tag}`);
    // The logo stays on cream, above the band, never on it.
    expect(band).not.toContain("bb-logo");
    // "Fill a bag" is below the band, on cream.
    expect(welcome.indexOf('id="bbStart"')).toBeGreaterThan(welcome.indexOf('class="bb-wave"'));
  });

  it("hangs the tally on a gift tag from the ribbon on How many bags", () => {
    expect(page).toMatch(/<div class="bb-ribbon"[^>]*>[\s\S]*?<\/div><div class="bb-wrap"><div class="bb-tag"><div class="bb-card bb-card--count">/);
  });

  it("points plus and minus at the announced tally, never at the hidden big number", () => {
    expect(page).toMatch(/<button[^>]*id="bbLess"[^>]*aria-controls="bbTally"/);
    expect(page).toMatch(/<button[^>]*id="bbMore"[^>]*aria-controls="bbTally"/);
    expect(page).not.toContain('aria-controls="bbCount"');
    expect(page).toMatch(/<div class="bb-tally" id="bbTally" aria-live="polite"/);
  });

  it("keeps the message line beside the button in the page from the start, so a message in it is announced", () => {
    expect(page).toMatch(/<p class="bb-status" id="bbStatus" role="status" aria-live="polite"><\/p>/);
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

  it("asks for an email with a dot after the @, so a slip shows the field's own message", () => {
    expect(page).toContain('pattern="[^\\s@]+@[^\\s@]+\\.[^\\s@]+"');
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
  it("says what the gift could fill, never that it has filled a bag", () => {
    expect(words(renderBallBagsThanks(3))).toContain("Your £150 could fill 3 red bags");
    expect(words(renderBallBagsThanks(1))).toContain("Your £50 could fill a red bag");
    expect(words(renderBallBagsThanks(20))).toContain("Your £1,000 could fill 20 red bags");
    for (const n of [0, 1, 3, 20]) {
      expect(words(renderBallBagsThanks(n)), String(n)).not.toMatch(/You've filled|will wake/);
    }
  });

  it("thanks the guest in NBCC's words for one bag, and offers another quietly", () => {
    const html = renderBallBagsThanks(1);
    expect(words(html)).toContain(
      "Thank you. It could mean someone who would otherwise have nothing to open has a red bag to open on Christmas morning. Enjoy the rest of your night.",
    );
    expect(html).toMatch(/<a[^>]*href="\/bag"[^>]*>Fill another<\/a>/);
  });

  it("thanks the guest for several bags with the number of people, as a numeral", () => {
    expect(words(renderBallBagsThanks(2))).toContain(
      "Thank you. It could mean 2 people who would otherwise have nothing to open have a red bag to open on Christmas morning. Enjoy the rest of your night.",
    );
    expect(words(renderBallBagsThanks(20))).toContain(
      "Thank you. It could mean 20 people who would otherwise have nothing to open have a red bag to open on Christmas morning.",
    );
    expect(words(renderBallBagsThanks(2))).not.toContain("someone who would");
  });

  it("is a plain thank you, with no number, when the count is not known", () => {
    const html = renderBallBagsThanks(0);
    expect(words(html)).not.toMatch(/could fill/);
    expect(words(html)).toContain("Thank you. It could mean someone who would otherwise have nothing to open");
    expect(words(html)).not.toMatch(/error|wrong/i);
  });

  it("draws the bags, ten at most, then says how many more", () => {
    const count = (html: string) => (html.match(/class="bb-bag"/g) ?? []).length;
    expect(count(renderBallBagsThanks(3))).toBe(3);
    expect(count(renderBallBagsThanks(14))).toBe(10);
    expect(words(renderBallBagsThanks(14))).toContain("+4");
    expect(count(renderBallBagsThanks(0))).toBe(1);
  });

  it("draws each bag as a small copy of the bag's picture, for the eye only, under NBCC's logo, with stars and hearts falling", () => {
    const html = renderBallBagsThanks(3);
    expect((html.match(/<span class="bb-bag" style="--i:\d"><img src="\/assets\/img\/ball-bag-hero\.webp" width="48" height="53" alt=""/g) ?? []).length).toBe(3);
    expect(html).toContain('class="bb-logo"');
    expect(html).toContain("bb-flake--heart");
    expect(html).toContain("bb-flake--star");
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
  const paid = "paid";

  it("reads the bag count the checkout stamped on a paid session", () => {
    expect(bagsFromSession({ payment_status: paid, metadata: { ballBags: "3" }, amount_total: 15000 })).toBe(3);
  });

  it("works it out from the amount when the count is missing", () => {
    expect(bagsFromSession({ payment_status: paid, metadata: {}, amount_total: 10000 })).toBe(2);
    expect(bagsFromSession({ payment_status: paid, amount_total: 5000 })).toBe(1);
  });

  it("counts nothing for a session that is not paid, so the thank you is a plain one", () => {
    expect(bagsFromSession({ payment_status: "unpaid", metadata: { ballBags: "3" }, amount_total: 15000 })).toBe(0);
    expect(bagsFromSession({ payment_status: "no_payment_required", metadata: { ballBags: "3" } })).toBe(0);
    expect(bagsFromSession({ metadata: { ballBags: "3" }, amount_total: 15000 })).toBe(0);
  });

  it("gives up, for a plain thank you, on anything else", () => {
    expect(bagsFromSession(null)).toBe(0);
    expect(bagsFromSession({ payment_status: paid })).toBe(0);
    expect(bagsFromSession({ payment_status: paid, metadata: { ballBags: "lots" } })).toBe(0);
    expect(bagsFromSession({ payment_status: paid, metadata: { ballBags: "21" } })).toBe(0);
    expect(bagsFromSession({ payment_status: paid, amount_total: 7500 })).toBe(0);
    expect(bagsFromSession({ payment_status: paid, amount_total: 0 })).toBe(0);
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
