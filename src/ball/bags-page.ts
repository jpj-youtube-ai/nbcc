import { SINGLE_DONATION_WORDING } from "../declarations/wording";
import { redBag } from "../red-bag/catalogue";
import { BALL_BAG_PENCE, BALL_BAGS_MAX, BALL_BAGS_PATH } from "./bags";
import { escapeHtml } from "./page";
import { londonDate } from "./sales-report";

// Red bags at the Festive Ball: the page a table card's QR code opens, /bag, and the thank you Stripe
// brings a guest back to, /bag/thank-you (docs/superpowers/specs/2026-11-02-ball-table-bags-design.md).
//
// A guest at a table, on a phone, on a hotel's mobile signal: so each page is drawn whole here, with
// no site header or menu, and loads only its own small stylesheet and script (assets/css/ball-bags.css,
// assets/js/ball-bags.js) and the visit counter.
//
// The look is NBCC's (Jaimie, 2 November 2026: "use the NBCC design stuff to keep everything in
// line"): the cream page, the red NBCC logo on cream, Playfair Display and Poppins, the brand colours.
// The bag is ONE baked picture (assets/img/ball-bag-hero.webp): a red gift bag with a gold bow,
// presents peeking out of the top and a small "Packed with love" tag, drawn once and baked so the
// phone needs no handwriting font. The same picture, small, is each bag in the row and on the thank
// you. What is in a bag is shown with Fill a Red Bag's own item drawings (art() in
// assets/js/red-bag-catalogue.js, read here on the server, so that script is never loaded).
//
// The words are NBCC's own (Jaimie, 2 November 2026: "stick with our usual wording"): never "a child"
// alone. The Gift Aid declaration is word for word the one the site keeps (SINGLE_DONATION_WORDING),
// with the Ball's donate page's fields (src/ball/donate-page.ts).
//
// Pure apart from reading the catalogue's drawings: no pool, no config, no clock of its own.

/** The last day the page is up, in the UK: Sunday 8 November 2026, the day after the Ball. */
const LAST_DAY = "2026-11-08";

/** Whether /bag and its thank you are up. After the window both forward to /fill. */
export function ballBagsOpen(now: Date): boolean {
  return londonDate(now) <= LAST_DAY;
}

/** How many of a guest's bags are drawn in a row; past this the row says "+N". */
export const BAGS_DRAWN_MAX = 10;

/** The bag: one baked picture, 560 by 616. */
export const HERO_SRC = "/assets/img/ball-bag-hero.webp";
export const HERO_ALT = "A red gift bag full of presents, tied with a gold bow and a gift tag that says Packed with love";

/** NBCC's logo, the red mark, on cream: baked small from assets/img/nbcc-logo-full.svg (198 by 192). */
const LOGO =
  '<img class="bb-logo" src="/assets/img/nbcc-logo-192.webp" width="66" height="64" alt="NBCC, Night Before Christmas Campaign" decoding="async" />';

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

// --- the pictures ---------------------------------------------------------------------------

/** One of Fill a Red Bag's item drawings, or "" if the catalogue cannot be read (the words stay). */
function drawing(key: string): string {
  try {
    return redBag().art(key, "bb-art", 34);
  } catch {
    return "";
  }
}

/** A small copy of the bag for a row, for the eye only. `i` is its place, for the stagger. */
function smallBag(i: number): string {
  return `<span class="bb-bag" style="--i:${i}"><img src="${HERO_SRC}" width="48" height="53" alt="" decoding="async" /></span>`;
}

/** A row of a guest's bags: ten at most, then "+N". Hidden from screen readers; the words say it. */
function bagRow(bags: number, id = ""): string {
  const drawn = Math.min(bags, BAGS_DRAWN_MAX);
  let row = "";
  for (let i = 0; i < drawn; i += 1) row += smallBag(i);
  const more = bags - drawn;
  return (
    `<div class="bb-row${drawn > 6 ? " bb-row--many" : drawn <= 3 ? " bb-row--few" : ""}"${id ? ` id="${id}"` : ""} aria-hidden="true">` +
    row +
    `<span class="bb-row__more"${id ? ` id="${id}More"` : ""}${more > 0 ? "" : " hidden"}>+${more}</span>` +
    "</div>"
  );
}

// A paper snowflake, a gold star and a heart, drawn once and used by every falling piece.
const SHAPES =
  '<svg class="bb-shapes" width="0" height="0" aria-hidden="true" focusable="false"><defs>' +
  '<symbol id="bbSnowShape" viewBox="0 0 24 24"><path d="M12 1.5l2.6 6 6.5-.75-3.9 5.25 3.9 5.25-6.5-.75-2.6 6-2.6-6-6.5.75L6.8 12 2.9 6.75l6.5.75z"/></symbol>' +
  '<symbol id="bbStarShape" viewBox="0 0 24 24"><path d="M12 2.5l2.8 6 6.5.8-4.8 4.5 1.3 6.5L12 17l-5.8 3.3 1.3-6.5-4.8-4.5 6.5-.8z"/></symbol>' +
  '<symbol id="bbHeartShape" viewBox="0 0 24 24"><path d="M12 21s-8.5-5.3-8.5-11.2A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 8.5 3.2C20.5 15.7 12 21 12 21z"/></symbol>' +
  "</defs></svg>";

interface Flurry {
  pieces: number;
  seed: number;
  /** Seconds a piece takes to fall, shortest and longest. */
  fall: [number, number];
  /** "drift": falling gently all the time, part way down when the page opens. "burst": once. */
  kind: "drift" | "burst";
}

/**
 * The falling pieces, from a fixed sequence (as flurryPlan in red-bag-catalogue.js does) so the page
 * is the same every time: one piece in each strip of the width, visited out of order so neighbours
 * do not set off together. A drift is snowflakes and stars; a burst is stars and hearts. Each is a
 * span the stylesheet moves with transform only.
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
    const star = i % 3 !== 0;
    const big = star && i % 9 === 4;
    const shape = star ? "star" : f.kind === "burst" ? "heart" : "snow";
    const fall = f.fall[0] + next() * (f.fall[1] - f.fall[0]);
    // A drift is already falling: a negative wait puts each piece part way down at the start.
    const wait = f.kind === "drift" ? -next() * fall : i < 4 ? i * 0.05 : next() * 1.1;
    const size = big ? 24 + next() * 8 : star ? 11 + next() * 8 : 12 + next() * 8;
    const vars =
      `--x:${r(((strip + 0.15 + next() * 0.7) / f.pieces) * 100, 10)}%;--d:${r(wait)}s;--t:${r(fall)}s;` +
      `--s:${Math.round((next() * 2 - 1) * 36)}px;--r:${Math.round((60 + next() * 180) * (next() < 0.5 ? -1 : 1))}deg;--w:${Math.round(size)}px`;
    const id = shape === "star" ? "bbStarShape" : shape === "heart" ? "bbHeartShape" : "bbSnowShape";
    out +=
      `<span class="bb-flake bb-flake--${shape}" style="${vars}">` +
      `<svg viewBox="0 0 24 24" focusable="false"><use href="#${id}"/></svg></span>`;
  }
  return `<div class="bb-snow bb-snow--${f.kind}" aria-hidden="true">${out}</div>`;
}

/** Gold sparkles that twinkle round the bag: where (per cent of its box), when, and how big. */
const TWINKLES: readonly [number, number, number, number][] = [
  [6, 20, 0, 18],
  [90, 10, 0.7, 14],
  [96, 50, 1.4, 20],
  [2, 62, 0.4, 12],
  [84, 86, 1.1, 16],
  [14, 92, 1.8, 12],
];
function twinkles(): string {
  return TWINKLES.map(([x, y, d, s]) => `<span class="bb-twinkle" style="--x:${x}%;--y:${y}%;--d:${d}s;--w:${s}px"></span>`).join("");
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
    '<meta name="theme-color" content="#F8F5EE" />\n' +
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

/** The top of every screen: NBCC's logo on cream, and the Ball. */
const TOP = `<header class="bb-top">${LOGO}<p class="bb-eyebrow">Festive Ball</p></header>`;

// The Ball donate page's own (src/ball/donate-page.ts), so a guest is asked exactly the same.
const POSTCODE_PATTERN = "[A-Za-z]{1,2}[0-9][A-Za-z0-9]? ?[0-9][A-Za-z]{2}";

// The plus and minus are drawn, not typed, so no dash is read out or shown (as on Fill a Red Bag).
const MINUS_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M6 12h12"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M6 12h12M12 6v12"/></svg>';

/** What is in a bag: the words, Fill a Red Bag's drawing for each, and the tint of its circle. */
const INSIDE: readonly { words: string; art: string; tone: string }[] = [
  { words: "A cosy blanket and pyjamas", art: "blanket", tone: "tan" },
  { words: "Hat, gloves and socks", art: "hat-gloves", tone: "holly" },
  { words: "A toy and a book", art: "toy", tone: "gold" },
  { words: "A few treats to unwrap", art: "present", tone: "crimson" },
];

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
    '<div class="bb-hero">' +
    `<img class="bb-hero__bag" src="${HERO_SRC}" width="280" height="308" alt="${HERO_ALT}" fetchpriority="high" decoding="async" />` +
    `<span class="bb-price" aria-hidden="true"><span>${pounds(one)}</span></span>` +
    twinkles() +
    "</div>" +
    '<h1 class="bb-title" id="bbWelcomeTitle" tabindex="-1">Thank you for being here tonight</h1>' +
    '<p class="bb-lede">£50 fills a full red bag for children, young people and vulnerable adults across South West Scotland who would otherwise wake up on Christmas morning with nothing to open.</p>' +
    '<ul class="bb-inside">' +
    INSIDE.map(
      (x, i) =>
        `<li style="--i:${i}"><span class="bb-inside__art bb-tone--${x.tone}" aria-hidden="true">${drawing(x.art)}</span>` +
        `<span class="bb-inside__words">${x.words}</span></li>`,
    ).join("") +
    "</ul>" +
    '<button class="bb-btn" id="bbStart" type="button">Fill a bag</button>' +
    '<noscript><p class="bb-note">Giving on this page needs JavaScript switched on. You can still donate on our <a href="/donate">donate page</a>.</p></noscript>' +
    "</section>";

  const howMany =
    '<section class="bb-screen bb-howmany" id="bbHowMany" aria-labelledby="bbHowManyTitle" hidden>' +
    '<button class="bb-back" id="bbBack" type="button">Back</button>' +
    '<h2 class="bb-title" id="bbHowManyTitle" tabindex="-1">How many bags?</h2>' +
    '<div class="bb-card bb-card--count">' +
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
    `<button class="bb-btn bb-btn--shimmer" id="bbGive" type="submit" data-give-pay>Give ${pounds(one)}</button>` +
    // In the page from the start (empty, it takes no room), so what is put in it is announced; a
    // failure turns it into an alert (assets/js/ball-bags.js).
    '<p class="bb-status" id="bbStatus" role="status" aria-live="polite"></p>' +
    '<p class="bb-note">Secure payment by Stripe.</p>' +
    "</div>" +
    "</form>" +
    "</section>";

  return frame({
    title: "Fill a red bag | NBCC Festive Ball",
    description: "£50 fills a full red bag for children, young people and vulnerable adults across South West Scotland.",
    bodyClass: "bb-page--give",
    body: snow({ pieces: 12, seed: 20261107, fall: [10, 16], kind: "drift" }) + `<main class="bb-main" id="main">${TOP}${welcome}${howMany}</main>`,
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
    TOP +
    '<section class="bb-screen bb-thanks" aria-labelledby="bbThanksTitle">' +
    `<div class="bb-celebrate">${bagRow(known ? bags : 1)}${twinkles()}</div>` +
    `<h1 class="bb-title" id="bbThanksTitle" tabindex="-1">${heading}</h1>` +
    '<p class="bb-lede">Thank you. Someone who would otherwise have nothing to open will wake up to it on Christmas morning. Enjoy the rest of your night.</p>' +
    `<p class="bb-again"><a href="${BALL_BAGS_PATH}">Fill another</a></p>` +
    "</section></main>";
  return frame({
    title: "Thank you | NBCC Festive Ball",
    description: "Thank you for filling a red bag at the NBCC Festive Ball.",
    bodyClass: "bb-page--thanks",
    body: snow({ pieces: 28, seed: 20261224, fall: [2.2, 3.4], kind: "burst" }) + body,
  });
}
