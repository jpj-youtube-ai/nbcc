import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripeFeePence, SEAT_PRICE_PENCE } from "../../src/ball/pricing";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-316: promises the ball page makes that are not ours to change unilaterally.
//
// These are not style assertions. Each one below was wrong on the page at some point and
// had to be corrected by hand, and each would be wrong again the moment someone edits the
// copy without knowing the constraint behind it.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

const ballHtml = read("ball.html");
const termsHtml = read("ball-terms.html");

describe("the line-up is not announced yet", () => {
  // The acts are contracted by The Designer Rooms and announced on THEIR schedule, not
  // ours. Naming one early is not a typo — it breaks an agreement with a performer and
  // spoils someone else's announcement. Michelle McManus is the single exception: she is
  // confirmed and cleared to be named.
  //
  // Deliberately searched across the WHOLE file, comments included: a name parked in a
  // comment is one uncomment away from being published.
  const NOT_YET_ANNOUNCED = ["Clanadonia", "MacDonald Brothers", "Kilted DJ"];

  it.each(NOT_YET_ANNOUNCED)("does not name %s anywhere on the page", (act) => {
    expect(ballHtml).not.toContain(act);
  });

  it("still credits Michelle McManus, who is confirmed and cleared", () => {
    expect(ballHtml).toContain("Michelle McManus");
  });

  it("says the rest of the line-up is still to come, rather than staying silent", () => {
    expect(ballHtml).toMatch(/line-up is being announced/i);
  });
});

describe("The Designer Rooms is credited as organiser AND sponsor", () => {
  // Ryan organises the evening and pays for all of it. "Organised by" alone undersells
  // the second half, which is the reason NBCC keeps the ticket income at all.
  it("says organised and sponsored on the page and in the ticket terms", () => {
    expect(ballHtml).toMatch(/organised and sponsored by/i);
    expect(termsHtml).toMatch(/organised and sponsored by/i);
  });

  it("links the credit to their own site so the thanks is worth something", () => {
    expect(ballHtml).toContain('href="https://thedesignerrooms.com/"');
    expect(termsHtml).toContain('href="https://thedesignerrooms.com/"');
  });

  it("opens that link safely, since it leaves the site", () => {
    const links = ballHtml.match(/<a[^>]*thedesignerrooms\.com[^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toContain('rel="noopener"');
  });

  it("names the sponsor in the standing credit band", () => {
    const band = ballHtml.match(/<p class="ball-sponsor-name">[\s\S]*?<\/p>/)?.[0] ?? "";
    expect(band).toContain("The Designer Rooms");
    expect(band).toContain("thedesignerrooms.com");
  });
});

describe("the header matches every other page", () => {
  const nav = ballHtml.match(/<header[^>]*class="nav"[\s\S]*?<\/header>/i)?.[0] ?? "";

  it("has a nav bar to assert on", () => {
    expect(nav).not.toBe("");
  });

  // The page IS the ticket page and the hero already carries "Book tickets", so a Tickets
  // pill in the bar was a second CTA for the thing you are already reading. Every other
  // page puts Donate there; this one now does too.
  it("puts Donate in the header CTA, like the rest of the site", () => {
    expect(nav).toMatch(/class="nav-cta"[^>]*href="\/donate"/);
  });

  it("does not offer a second Tickets button in the bar", () => {
    expect(nav).not.toMatch(/class="nav-cta"[^>]*href="#tickets"/);
  });
});

describe("the marketing opt-in says what it is", () => {
  // "Keep me posted about NBCC's work" describes a feeling, not a thing you can picture
  // receiving. People consent to a newsletter; name it.
  it("calls the newsletter the newsletter", () => {
    const optIns = ballHtml.match(/name="newsletterOptIn"[\s\S]{0,320}?<\/label>/g) ?? [];
    expect(optIns.length).toBeGreaterThan(0);
    for (const optIn of optIns) expect(optIn).toMatch(/newsletter/i);
  });
});

describe("the ways to book that the form cannot handle", () => {
  // Both of these lived in the last clause of the closing smallprint, which is where
  // reading stops -- and a company taking five tables or needing an invoice is among the
  // largest orders NBCC can take.
  const card = ballHtml.match(/<aside class="ball-invoice[\s\S]*?<\/aside>/)?.[0] ?? "";

  it("gives invoicing and large bookings their own card, not a footnote", () => {
    expect(card).not.toBe("");
    expect(card).toMatch(/invoice/i);
  });

  it("names the per-order limits the form actually enforces", () => {
    // These mirror MAX_TABLES_PER_ORDER / MAX_SEATS_PER_ORDER in src/ball/capacity.ts.
    expect(card).toMatch(/four tables/i);
    expect(card).toMatch(/nine individual tickets/i);
  });

  it("offers a human to contact, both ways", () => {
    expect(card).toContain("mailto:events@nbcc.scot");
    expect(card).toContain("tel:+441292811015");
  });

  it("no longer buries either route in the smallprint", () => {
    const smallprint = ballHtml.match(/<p class="ball-smallprint">[\s\S]*?<\/p>/)?.[0] ?? "";
    expect(smallprint).not.toMatch(/invoice/i);
  });
});

describe("the fee the page quotes before JavaScript runs", () => {
  // ball.html hard-codes a starting figure in the "cover the card fee" checkbox so the form
  // is not blank on first paint. The live rate arrives moments later from
  // /api/ball/availability, but until it does this number is what a buyer reads — so it has
  // to be the fee on ONE seat at the default rate, not a figure left behind by an old one.
  // It was £1.70 (Stripe's 1.5% standard rate) while NBCC was actually on 1.2%.
  it("matches the fee on a single seat at the default rate", () => {
    const expected = stripeFeePence(SEAT_PRICE_PENCE);
    const pounds = "£" + (expected / 100).toFixed(2);
    const checkbox = ballHtml.match(/<b id="ballFee">[^<]*<\/b>/)?.[0] ?? "";
    expect(checkbox).not.toBe("");
    // The file writes the pound sign as an entity.
    expect(checkbox.replace("&pound;", "£")).toContain(pounds);
  });

  it("has somewhere to put the per-ticket breakdown", () => {
    // The 20p is charged once per ORDER, so the fee per ticket falls as the order grows.
    expect(ballHtml).toContain('id="ballFeeEach"');
  });
});
