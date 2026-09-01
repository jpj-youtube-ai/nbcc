import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { grossedUpFeePence, SEAT_PRICE_PENCE } from "../../src/ball/pricing";
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

describe("the line-up, announced 31 August (TASK-335)", () => {
  // This block used to assert the OPPOSITE: that none of these names appeared anywhere on the
  // page. The acts are contracted by The Designer Rooms and were theirs to announce, so naming
  // one early would have broken an agreement with a performer. That embargo has now been
  // lifted by NBCC, and the guard is inverted rather than deleted — the page has to keep
  // carrying what it is now advertising.
  const LINE_UP = ["Clanadonia", "The MacDonald Brothers", "The Kilted DJ"];

  it.each(LINE_UP)("names %s", (act) => {
    expect(ballHtml).toContain(act);
  });

  it("still credits Michelle McManus as the host", () => {
    expect(ballHtml).toContain("Michelle McManus");
  });

  // Two places, deliberately: the hero strip under the facts band, and the "Who's playing"
  // column further down. Someone who never scrolls past the fold still sees the line-up.
  it("puts the whole line-up, host included, in the hero strip", () => {
    const strip = ballHtml.slice(
      ballHtml.indexOf('<div class="ball-lineup">'),
      ballHtml.indexOf("</div>", ballHtml.indexOf('<div class="ball-lineup">')),
    );
    expect(strip).not.toBe("");
    expect(strip).toContain("Michelle McManus");
    for (const act of LINE_UP) expect(strip.replace(/\s+/g, " ")).toContain(act);
  });

  it("lists the acts again beside Michelle's card", () => {
    const list = ballHtml.slice(
      ballHtml.indexOf('<ul class="ball-acts">'),
      ballHtml.indexOf("</ul>", ballHtml.indexOf('<ul class="ball-acts">')),
    );
    expect(list).not.toBe("");
    for (const act of LINE_UP) expect(list).toContain(act);
  });

  it("no longer says the line-up is still to be announced", () => {
    expect(ballHtml).not.toMatch(/line-up is being announced/i);
    expect(ballHtml).not.toMatch(/rest of the line-up/i);
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
    // TASK-348: the GROSSED-UP fee, not stripeFeePence. The checkbox promises "the full ticket
    // price reaches NBCC", and the fee on the ticket price alone does not deliver that - Stripe
    // charges its percentage on the total it processes, which includes the fee.
    const expected = grossedUpFeePence(SEAT_PRICE_PENCE);
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

describe("both forms ask for a first name and a surname (TASK-318)", () => {
  // One "Your name" box matched nothing else on the site and left no reliable way back out:
  // splitting on the last space makes "Jo van der Berg" a Berg and "Dr Jo Smith" a Dr.
  it("splits the name on the booking form", () => {
    expect(ballHtml).toContain('name="buyerFirstName"');
    expect(ballHtml).toContain('name="buyerSurname"');
    expect(ballHtml).not.toContain('name="buyerName"');
  });

  it("splits the name on the waiting-list form too", () => {
    expect(ballHtml).toContain('name="firstName"');
    expect(ballHtml).toContain('name="surname"');
  });

  // autocomplete="name" on a half-name box makes a browser offer the WHOLE name for the
  // first field, which is worse than no autofill at all.
  it("tells the browser which half each box is", () => {
    expect(ballHtml).toContain('autocomplete="given-name"');
    expect(ballHtml).toContain('autocomplete="family-name"');
    expect(ballHtml).not.toContain('autocomplete="name"');
  });
});

describe("paying without leaving the site (TASK-319)", () => {
  // The page a stranger reaches from a printed advert is not the place to bounce someone to
  // a different domain at the moment they are deciding whether to trust it. Buyers pay in a
  // modal on nbcc.scot, the way donors already do.
  // Sliced rather than regex-matched: the opening tag spans several lines and the modal
  // nests three divs, which makes a "find the closing tag" pattern quietly capture the
  // wrong span.
  const modalStart = ballHtml.indexOf('id="ballCheckoutModal"');
  const modal = ballHtml.slice(Math.max(0, modalStart - 200), modalStart + 700);

  it("carries a mount for Stripe's inline checkout", () => {
    expect(modal).not.toBe("");
    expect(modal).toContain('id="ballCheckout"');
  });

  it("is a proper dialog, closed until a payment starts", () => {
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    // Closed until a payment actually starts, for CSS and for assistive tech alike.
    // The leading space distinguishes the standalone attribute from aria-hidden, where
    // the character before "hidden" is a dash.
    expect(modal).toContain(" hidden");
    expect(modal).toContain('aria-hidden="true"');
  });

  it("gives a way back out", () => {
    expect(modal).toContain('id="ballCheckoutClose"');
  });

  // main.js's donate-page controller keys off #embeddedCheckout and keeps its mounted
  // instance in a variable ball.js cannot see. Sharing those ids would mean a Close press
  // hid the modal without destroying the iframe, and the next attempt mounted twice.
  it("does not reuse the donate page's element ids", () => {
    expect(ballHtml).not.toContain('id="embeddedCheckout"');
    expect(ballHtml).not.toContain('id="embeddedCheckoutModal"');
  });

  // It reuses the shared .give-embedded-* styles, so this costs no extra CSS.
  it("reuses the shared modal styling rather than shipping its own", () => {
    expect(modal).toContain("give-embedded-modal");
    expect(modal).toContain("give-embedded-mount");
  });
});

describe("agreeing to the ticket terms (TASK-331)", () => {
  // Tickets are NON-REFUNDABLE on purchases up to £1,000 a table. That is an onerous term,
  // and the Consumer Rights Act expects an onerous term to be brought to a buyer's attention
  // rather than merely made findable. A link in the smallprint does not do that; a positive
  // act does.
  const box = ballHtml.match(/<label class="ball-check ball-terms-check">[\s\S]*?<\/label>/)?.[0] ?? "";

  it("asks for a tick before payment", () => {
    expect(box).not.toBe("");
    expect(box).toContain('name="termsAccepted"');
  });

  it("is required, and never pre-ticked", () => {
    // Plain substrings: the leading space distinguishes the standalone `required` attribute
    // from `aria-required`, where the character before it is a dash.
    expect(box).toContain(" required");
    expect(box).toContain("aria-required=\"true\"");
    expect(box).not.toContain(" checked");
  });

  // The point of the box: the buyer sees the onerous term itself, not just a link to it.
  it("names the non-refundable term in the label, not only behind the link", () => {
    expect(box).toMatch(/non-refundable/i);
    expect(box).toContain('href="/ball/terms"');
  });
});
