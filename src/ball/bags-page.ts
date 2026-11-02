import { SINGLE_DONATION_WORDING } from "../declarations/wording";
import { BALL_BAG_PENCE, BALL_BAGS_MAX, BALL_BAGS_PATH } from "./bags";
import { escapeHtml } from "./page";
import { londonDate } from "./sales-report";

// Red bags at the Festive Ball: the page a table card's QR code opens, /bag, and the thank you Stripe
// brings a guest back to, /bag/thank-you (docs/superpowers/specs/2026-11-02-ball-table-bags-design.md).
//
// A guest at a table, on a phone, on a hotel's mobile signal: so each page is drawn whole here, with
// no site header or menu, and loads only its own small stylesheet and script (assets/css/ball-bags.css,
// assets/js/ball-bags.js) and the visit counter. The look is Fill a Red Bag's: its tied red bag with
// the gold bow and the "Packed with love" tag (tiedBag, lifted from assets/js/red-bag-workshop.js and
// coloured by the same rbw classes), and its snow and stars (a seeded plan, as flurryPlan in
// assets/js/red-bag-catalogue.js). Both are drawn by the server, so the page paints at once and the
// big shared scripts are never loaded.
//
// The words are NBCC's own (Jaimie, 2 November 2026: "stick with our usual wording"): never "a child"
// alone. The Gift Aid declaration is word for word the one the site keeps (SINGLE_DONATION_WORDING),
// with the Ball's donate page's fields (src/ball/donate-page.ts).
//
// Pure: no pool, no config, no clock of its own.

/** The last day the page is up, in the UK: Sunday 8 November 2026, the day after the Ball. */
const LAST_DAY = "2026-11-08";

/** Whether /bag and its thank you are up. After the window both forward to /fill. */
export function ballBagsOpen(now: Date): boolean {
  return londonDate(now) <= LAST_DAY;
}

/** How many of a guest's bags are drawn in a row; past this the row says "+N". */
export const BAGS_DRAWN_MAX = 10;

/** "£50", "£1,000", "£12.50": pence shown only when there are some. */
function pounds(pence: number): string {
  const whole = Math.floor(pence / 100);
  const rest = Math.round(pence % 100);
  return `£${whole.toLocaleString("en-GB")}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

/**
 * How many bags a paid Stripe session was for: the count the checkout stamped on it (metadata
 * ballBags), else the amount over £50. 0 when the session is not paid, or neither is a whole number
 * of bags from 1 to 20, and the thank you is then a plain one.
 */
export function bagsFromSession(
  session: { payment_status?: string | null; metadata?: Record<string, string> | null; amount_total?: number | null } | null,
): number {
  if (!session || session.payment_status !== "paid") return 0;
  const ok = (n: number) => (Number.isInteger(n) && n >= 1 && n <= BALL_BAGS_MAX ? n : 0);
  const stamped = session.metadata?.ballBags;
  if (typeof stamped === "string" && stamped !== "") return /^\d+$/.test(stamped) ? ok(Number(stamped)) : 0;
  const total = session.amount_total;
  return typeof total === "number" && total > 0 ? ok(total / BALL_BAG_PENCE) : 0;
}

// --- the drawings ---------------------------------------------------------------------------

/**
 * One tied red bag, the inside of a 120 by 132 picture: Fill a Red Bag's own (tiedBag in
 * assets/js/red-bag-workshop.js), the same paths and classes. `tag: false` leaves off the gift tag;
 * `words` writes "Packed with love" on it.
 */
function tiedBag(opts: { tag?: boolean; words?: boolean } = {}): string {
  const tag =
    opts.tag === false
      ? ""
      : '<g class="rbw-tag"><path class="rbw-string" d="M60 20c-3 9 3 21 0 31"/>' +
        '<path class="rbw-card" d="M41 44h38l11 11v35a4 4 0 0 1-4 4H34a4 4 0 0 1-4-4V55z"/>' +
        '<circle class="rbw-hole" cx="60" cy="51.5" r="2.6"/>' +
        // Each line is fitted to the tag, so it fits whatever handwriting font the phone has.
        (opts.words
          ? '<text class="rbw-words"><tspan x="60" y="73" textLength="50" lengthAdjust="spacingAndGlyphs">Packed</tspan> ' +
            '<tspan x="60" y="88" textLength="50" lengthAdjust="spacingAndGlyphs">with love</tspan></text>'
          : "") +
        "</g>";
  return (
    '<path class="rbw-cord rbw-cord--back" d="M44 36C44 10 88 10 88 36"/>' +
    '<path class="rbw-tissue" d="M22 38l9-13 8 9 9-14 9 13 9-12 8 11 9-9 7 15z"/>' +
    '<path class="rbw-paper" d="M12 36h96v88a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z"/>' +
    '<path class="rbw-gusset" d="M92 36h16v88a4 4 0 0 1-4 4H92z"/>' +
    '<path class="rbw-fold" d="M12 36h96v10H12z"/>' +
    '<path class="rbw-crease" d="M12 46h96M92 46v82"/>' +
    '<path class="rbw-cord" d="M32 40C32 12 76 12 76 40"/>' +
    '<circle class="rbw-eyelet" cx="32" cy="41" r="2.2"/><circle class="rbw-eyelet" cx="76" cy="41" r="2.2"/>' +
    tag +
    '<g class="rbw-bow"><path class="rbw-ribbon" d="M57.5 20l-8 12 5.5-.5 2 4.5 3.5-15zM62.5 20l8 12-5.5-.5-2 4.5-3.5-15z"/>' +
    '<path class="rbw-ribbon" d="M60 18c-5-8-17-9-17-1s12 6 17 1zM60 18c5-8 17-9 17-1s-12 6-17 1z"/>' +
    '<rect class="rbw-knot" x="56" y="14" width="8" height="8" rx="2.5"/></g>'
  );
}

/** A small tied bag for a row, for the eye only. `i` is its place, for the stagger. */
function smallBag(i: number): string {
  return (
    `<span class="bb-bag" style="--i:${i}"><svg class="rbw" viewBox="0 0 120 132" aria-hidden="true" focusable="false">` +
    tiedBag({ tag: false }) +
    "</svg></span>"
  );
}

/** A row of a guest's bags: ten at most, then "+N". Hidden from screen readers; the words say it. */
function bagRow(bags: number, id = ""): string {
  const drawn = Math.min(bags, BAGS_DRAWN_MAX);
  let row = "";
  for (let i = 0; i < drawn; i += 1) row += smallBag(i);
  const more = bags - drawn;
  return (
    `<div class="bb-row${drawn > 6 ? " bb-row--many" : ""}"${id ? ` id="${id}"` : ""} aria-hidden="true">` +
    row +
    `<span class="bb-row__more"${id ? ` id="${id}More"` : ""}${more > 0 ? "" : " hidden"}>+${more}</span>` +
    "</div>"
  );
}

// The snow and stars: a paper snowflake and a gold star, drawn once and used by every piece.
const SHAPES =
  '<svg class="bb-shapes" width="0" height="0" aria-hidden="true" focusable="false"><defs>' +
  '<symbol id="bbSnowShape" viewBox="0 0 24 24"><path d="M12 1.5l2.6 6 6.5-.75-3.9 5.25 3.9 5.25-6.5-.75-2.6 6-2.6-6-6.5.75L6.8 12 2.9 6.75l6.5.75z"/></symbol>' +
  '<symbol id="bbStarShape" viewBox="0 0 24 24"><path d="M12 2.5l2.8 6 6.5.8-4.8 4.5 1.3 6.5L12 17l-5.8 3.3 1.3-6.5-4.8-4.5 6.5-.8z"/></symbol>' +
  "</defs></svg>";

interface Flurry {
  pieces: number;
  seed: number;
  /** Seconds a piece takes to fall, shortest and longest. */
  fall: [number, number];
  /** "drift": falling all the time, already part way down when the page opens. "burst": once. */
  kind: "drift" | "burst";
}

/**
 * The pieces of snow and stars, from a fixed sequence (as flurryPlan does) so the page is the same
 * every time: one piece in each strip of the width, visited out of order so neighbours do not set
 * off together. Each is a span the stylesheet moves with transform only.
 */
function snow(f: Flurry): string {
  let seed = f.seed;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const r = (v: number, to = 100) => Math.round(v * to) / to;
  let out = "";
  for (let i = 0; i < f.pieces; i += 1) {
    const strip = (i * 5 + 3) % f.pieces;
    const star = i % 3 === 1;
    const big = star && i % 9 === 4;
    const fall = f.fall[0] + next() * (f.fall[1] - f.fall[0]);
    // A drift is already falling: a negative wait puts each piece part way down at the start.
    const wait = f.kind === "drift" ? -next() * fall : i < 4 ? i * 0.05 : next() * 1.1;
    const size = big ? 26 + next() * 8 : star ? 12 + next() * 8 : 9 + next() * 9;
    const vars =
      `--x:${r(((strip + 0.15 + next() * 0.7) / f.pieces) * 100, 10)}%;--d:${r(wait)}s;--t:${r(fall)}s;` +
      `--s:${Math.round((next() * 2 - 1) * 36)}px;--r:${Math.round((60 + next() * 180) * (next() < 0.5 ? -1 : 1))}deg;--w:${Math.round(size)}px`;
    out +=
      `<span class="bb-flake bb-flake--${star ? "star" : "snow"}" style="${vars}">` +
      `<svg viewBox="0 0 24 24" focusable="false"><use href="#${star ? "bbStarShape" : "bbSnowShape"}"/></svg></span>`;
  }
  return `<div class="bb-snow bb-snow--${f.kind}" aria-hidden="true">${out}</div>`;
}

// --- the page's frame ----------------------------------------------------------------------

function frame(o: { title: string; description: string; body: string; bodyClass: string }): string {
  return (
    "<!doctype html>\n" +
    '<html lang="en">\n<head>\n' +
    '<meta charset="utf-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    `<title>${escapeHtml(o.title)}</title>\n` +
    `<meta name="description" content="${escapeHtml(o.description)}" />\n` +
    "<!-- For guests at the Festive Ball's tables, from the QR code on each card: not for search engines. -->\n" +
    '<meta name="robots" content="noindex" />\n' +
    '<meta name="theme-color" content="#5E0000" />\n' +
    '<link rel="preload" href="/assets/fonts/playfair-var.woff2" as="font" type="font/woff2" crossorigin />\n' +
    '<link rel="preload" href="/assets/fonts/poppins-400.woff2" as="font" type="font/woff2" crossorigin />\n' +
    '<link rel="stylesheet" href="/assets/css/ball-bags.css" />\n' +
    '<script defer src="/assets/js/ball-bags.js"></script>\n' +
    '<script defer src="/assets/js/pulse.js"></script>\n' +
    "</head>\n" +
    `<body class="bb-page ${o.bodyClass}">\n` +
    SHAPES +
    o.body +
    '\n<footer class="bb-foot">' +
    "<p>Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation.</p>" +
    "<p>Scottish Charity Number SC047995. Regulated by the Scottish Charity Regulator, OSCR.</p>" +
    '<p><a href="/">nbcc.scot</a></p>' +
    "</footer>\n</body>\n</html>\n"
  );
}

// The Ball donate page's own (src/ball/donate-page.ts), so a guest is asked exactly the same.
const POSTCODE_PATTERN = "[A-Za-z]{1,2}[0-9][A-Za-z0-9]? ?[0-9][A-Za-z]{2}";

// The plus and minus are drawn, not typed, so no dash is read out or shown (as on Fill a Red Bag).
const MINUS_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M6 12h12"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M6 12h12M12 6v12"/></svg>';

const INSIDE = ["A cosy blanket and pyjamas", "Hat, gloves and socks", "A toy and a book", "A few treats to unwrap"];

function field(id: string, label: string, attrs: string, message: string): string {
  return (
    `<div class="bb-field" id="${id}Field"><label for="${id}">${label}</label>` +
    `<input id="${id}" name="${id}" ${attrs} data-invalid-message="${escapeHtml(message)}" />` +
    `<p class="bb-field__error" id="${id}Error" hidden></p></div>`
  );
}

/** The page, /bag: the welcome, then how many bags and who is giving. */
export function renderBallBagsPage(): string {
  const one = BALL_BAG_PENCE;
  const welcome =
    '<section class="bb-screen bb-welcome" id="bbWelcome" aria-labelledby="bbWelcomeTitle">' +
    '<div class="bb-stage">' +
    '<p class="bb-eyebrow">NBCC Festive Ball</p>' +
    '<div class="bb-hero">' +
    `<svg class="rbw bb-hero__bag" viewBox="0 0 120 132" aria-hidden="true" focusable="false">${tiedBag({ words: true })}</svg>` +
    `<span class="bb-price" aria-hidden="true"><span>${pounds(one)}</span></span>` +
    '<span class="bb-hero__shadow" aria-hidden="true"></span>' +
    "</div></div>" +
    '<div class="bb-sheet">' +
    '<h1 class="bb-title" id="bbWelcomeTitle" tabindex="-1">Thank you for being here tonight</h1>' +
    '<p class="bb-lede">£50 fills a full red bag for children, young people and vulnerable adults across South West Scotland who would otherwise wake up on Christmas morning with nothing to open.</p>' +
    `<ul class="bb-inside">${INSIDE.map((line) => `<li>${line}</li>`).join("")}</ul>` +
    '<button class="bb-btn" id="bbStart" type="button">Fill a bag</button>' +
    '<noscript><p class="bb-note">Giving on this page needs JavaScript switched on. You can still donate on our <a href="/donate">donate page</a>.</p></noscript>' +
    "</div></section>";

  const howMany =
    '<section class="bb-screen bb-howmany" id="bbHowMany" aria-labelledby="bbHowManyTitle" hidden>' +
    '<div class="bb-stage bb-stage--slim"><p class="bb-eyebrow">NBCC Festive Ball</p></div>' +
    '<div class="bb-sheet">' +
    '<button class="bb-back" id="bbBack" type="button">Back</button>' +
    '<h2 class="bb-title" id="bbHowManyTitle" tabindex="-1">How many bags?</h2>' +
    '<div class="bb-counter">' +
    `<button class="bb-step" id="bbLess" type="button" aria-label="One bag fewer" aria-controls="bbTally">${MINUS_ICON}</button>` +
    '<span class="bb-count" id="bbCount" aria-hidden="true">1</span>' +
    `<button class="bb-step" id="bbMore" type="button" aria-label="One more bag" aria-controls="bbTally">${PLUS_ICON}</button>` +
    "</div>" +
    bagRow(1, "bbRow") +
    '<div class="bb-tally" id="bbTally" aria-live="polite" aria-atomic="true">' +
    '<p class="bb-tally__words" id="bbWords">1 full red bag</p>' +
    `<p class="bb-tally__total" id="bbTotal">${pounds(one)}</p>` +
    "</div>" +
    // The template every new bag in the row is copied from.
    `<template id="bbBagArt">${smallBag(0)}</template>` +
    '<form class="bb-form" id="bbForm" novalidate>' +
    '<fieldset class="bb-group"><legend>Your details</legend>' +
    '<div class="bb-names">' +
    field("bbFirstName", "First name", 'type="text" autocomplete="given-name" required', "Please tell us your first name") +
    field("bbSurname", "Surname", 'type="text" autocomplete="family-name" required', "Please tell us your surname") +
    "</div>" +
    // The pattern asks for a dot after the @ too, which type="email" alone does not.
    field(
      "bbEmail",
      "Email",
      'type="email" autocomplete="email" inputmode="email" required pattern="[^\\s@]+@[^\\s@]+\\.[^\\s@]+"',
      "Please give an email address for your receipt",
    ) +
    '<p class="bb-help">We only use this to send your receipt and a thank you. We never share it.</p>' +
    "</fieldset>" +
    '<div class="bb-giftaid">' +
    '<input class="bb-giftaid__box" id="bbGiftAid" name="bbGiftAid" type="checkbox" />' +
    '<label class="bb-giftaid__label" for="bbGiftAid"><strong>Add Gift Aid (25% more, at no cost to you)</strong>' +
    `<span class="bb-giftaid__statement">${escapeHtml(SINGLE_DONATION_WORDING.wording_snapshot)}</span></label>` +
    "</div>" +
    '<fieldset class="bb-group bb-declaration" id="bbDeclaration" hidden>' +
    '<legend>Your home address for Gift Aid</legend>' +
    `<p class="bb-help"><span id="bbGiftAidAdds">Gift Aid adds ${pounds(one / 4)} to your ${pounds(one)}.</span> HMRC needs these to match your donation to your tax record.</p>` +
    field("bbHouse", "House name or number", 'type="text" required disabled placeholder="e.g. 12 or Rose Cottage"', "Please give your house name or number") +
    field("bbAddress", "Home address", 'type="text" autocomplete="street-address" required disabled placeholder="Street and town"', "Please give your street and town") +
    field("bbPostcode", "Postcode", `type="text" autocomplete="postal-code" required disabled placeholder="e.g. KA1 1AA" pattern="${POSTCODE_PATTERN}"`, "Please give a UK postcode, like KA1 1AA") +
    '<label class="bb-check" for="bbNonUk"><input id="bbNonUk" name="bbNonUk" type="checkbox" disabled />' +
    "<span>My home address is outside the UK</span></label>" +
    "</fieldset>" +
    '<div class="bb-give">' +
    // data-give-pay: the visit counter counts a tap on it as a donate click (assets/js/pulse.js).
    `<button class="bb-btn" id="bbGive" type="submit" data-give-pay>Give ${pounds(one)}</button>` +
    // In the page from the start (empty, it takes no room), so what is put in it is announced; a
    // failure turns it into an alert (assets/js/ball-bags.js).
    '<p class="bb-status" id="bbStatus" role="status" aria-live="polite"></p>' +
    '<p class="bb-note">Secure payment by Stripe.</p>' +
    "</div>" +
    "</form>" +
    "</div></section>";

  return frame({
    title: "Fill a red bag | NBCC Festive Ball",
    description: "£50 fills a full red bag for children, young people and vulnerable adults across South West Scotland.",
    bodyClass: "bb-page--give",
    body: snow({ pieces: 18, seed: 20261107, fall: [9, 15], kind: "drift" }) + `<main class="bb-main" id="main">${welcome}${howMany}</main>`,
  });
}

/**
 * The thank you, /bag/thank-you. `bags` is how many the guest gave (bagsFromSession); 0 when that
 * could not be read, and the thank you is a plain one: never an error.
 */
export function renderBallBagsThanks(bags: number): string {
  const known = Number.isInteger(bags) && bags >= 1 && bags <= BALL_BAGS_MAX;
  const heading = !known ? "Your gift is in the bag" : bags === 1 ? "You've filled a red bag" : `You've filled ${bags} red bags`;
  const body =
    `<main class="bb-main" id="main" data-bb-thanks data-bags="${known ? bags : 0}">` +
    '<section class="bb-screen bb-thanks" aria-labelledby="bbThanksTitle">' +
    '<div class="bb-stage bb-stage--thanks">' +
    '<p class="bb-eyebrow">NBCC Festive Ball</p>' +
    bagRow(known ? bags : 1) +
    "</div>" +
    '<div class="bb-sheet">' +
    `<h1 class="bb-title" id="bbThanksTitle" tabindex="-1">${heading}</h1>` +
    '<p class="bb-lede">Thank you. Someone who would otherwise have nothing to open will wake up to it on Christmas morning. Enjoy the rest of your night.</p>' +
    `<p class="bb-again"><a href="${BALL_BAGS_PATH}">Fill another</a></p>` +
    "</div></section></main>";
  return frame({
    title: "Thank you | NBCC Festive Ball",
    description: "Thank you for filling a red bag at the NBCC Festive Ball.",
    bodyClass: "bb-page--thanks",
    body: snow({ pieces: 30, seed: 20261224, fall: [2.2, 3.4], kind: "burst" }) + body,
  });
}
