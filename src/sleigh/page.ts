import { SINGLE_DONATION_WORDING } from "../declarations/wording";
import { ABOUT_NBCC_SHORT } from "../email/brand";
import { escapeHtml } from "../ball/page";
import { SLEIGH_PATH, dayLabel, pounds, timesLabel, type SleighNight, type SleighPhase } from "./model";

// The Kilmarnock Santa Sleigh page, /sleigh, and its thank you (docs/superpowers/specs/
// 2026-11-10-santa-sleigh-design.md). Drawn whole here, as /bag is (src/ball/bags-page.ts): its own
// small stylesheet and script (assets/css/sleigh.css, assets/js/sleigh.js) and the visit counter,
// nothing from the shared bundle, so the site's other pages stay inside their performance budget.
//
// Most people arrive from a QR card handed out on the night or from the poster, on a phone, and for
// many it is the first time they have heard of NBCC (Jaimie, 10 November 2026). So the page says who
// NBCC is in its own words (ABOUT_NBCC_SHORT, never paraphrased) and keeps every other line short:
// "as little text as possible ... as clear and as impactful as possible".
//
// The look is the mockup Jaimie saw on 10 November, in the same order: a night sky over Kilmarnock's
// rooftops with the sleigh picture (made in ChatGPT in the elf's thick outlines, NBCC in the logo's
// own white letters on a Deep Crimson sleigh), the year's total over a road with one house per
// night, the give form, who is behind the sleigh, other ways in, and one last ask.
//
// Pure: no pool, no config, no clock. The route hands in the nights, the phase and the total.

export interface SleighPageInput {
  nights: readonly SleighNight[];
  phase: Exclude<SleighPhase, "off">;
  /** The house the sleigh is at (roadStop): tonight's, the next one, or nights.length afterwards. */
  stop: number;
  /** The year's total so far in pence, or null when it could not be read (the number is left out). */
  totalPence: number | null;
}

const ART_ALT = "Santa and an NBCC elf waving from a red sleigh full of presents";
const LOGO =
  '<img class="sl-logo" src="/assets/img/nbcc-logo-192.webp" width="62" height="60" alt="NBCC, Night Before Christmas Campaign" decoding="async" />';

// The shapes every falling piece and every house is drawn from, once.
const SHAPES =
  '<svg class="sl-shapes" width="0" height="0" aria-hidden="true" focusable="false"><defs>' +
  '<symbol id="slFlake" viewBox="0 0 24 24"><path d="M12 1.5l2.6 6 6.5-.75-3.9 5.25 3.9 5.25-6.5-.75-2.6 6-2.6-6-6.5.75L6.8 12 2.9 6.75l6.5.75z"/></symbol>' +
  '<symbol id="slStar" viewBox="0 0 24 24"><path d="M12 2.5l2.8 6 6.5.8-4.8 4.5 1.3 6.5L12 17l-5.8 3.3 1.3-6.5-4.8-4.5 6.5-.8z"/></symbol>' +
  // A little house: thick maroon outline, crimson roof with snow, a lit window and a door.
  '<symbol id="slHouse" viewBox="0 0 64 60"><g stroke="#5E2427" stroke-width="3.5" stroke-linejoin="round">' +
  '<path d="M8 28 L32 8 L56 28 V56 H8 Z" fill="#FFFDFA"/>' +
  '<path d="M3 30 L32 5 L61 30" fill="none" stroke-width="7" stroke="#C02238"/>' +
  '<path d="M3 30 L32 5 L61 30" fill="none"/>' +
  '<rect x="15" y="33" width="12" height="11" rx="1.5" fill="#E8B54A"/>' +
  '<path d="M37 56 V40 a5 5 0 0 1 10 0 V56" fill="#1A531A"/>' +
  '<rect x="42" y="10" width="7" height="12" fill="#C02238"/></g></symbol>' +
  "</defs></svg>";

/** Falling snow, from a fixed sequence so the page is the same every time; moved by transform only. */
function snow(pieces: number, seed: number, depth: "far" | "near"): string {
  let s = seed;
  const next = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const r = (v: number) => Math.round(v * 100) / 100;
  let out = "";
  for (let i = 0; i < pieces; i += 1) {
    const strip = (i * 7 + 3) % pieces;
    const fall = depth === "far" ? 16 + next() * 10 : 9 + next() * 6;
    const size = depth === "far" ? 6 + next() * 6 : 12 + next() * 10;
    const star = depth === "near" && i % 5 === 2;
    const vars =
      `--x:${r(((strip + 0.2 + next() * 0.6) / pieces) * 100)}%;--d:${r(-next() * fall)}s;--t:${r(fall)}s;` +
      `--s:${Math.round((next() * 2 - 1) * 40)}px;--r:${Math.round(90 + next() * 200)}deg;--w:${Math.round(size)}px`;
    out += `<span class="sl-flake${star ? " sl-flake--star" : ""}" style="${vars}"><svg viewBox="0 0 24 24" focusable="false"><use href="#${star ? "slStar" : "slFlake"}"/></svg></span>`;
  }
  return `<div class="sl-snow sl-snow--${depth}" aria-hidden="true">${out}</div>`;
}

// Kilmarnock's rooftops along the bottom of the sky, with windows that come on one by one.
const ROOFS =
  '<svg class="sl-roofs" viewBox="0 0 1440 150" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
  '<path class="sl-roofs__back" d="M0 150V92h40V70l46-34 46 34v22h44V60h34V44h16v16h30v32h70V74l54-36 54 36v18h56V56l40-28 40 28v36h60V68l50-34 50 34v24h66V62h30V46h16v16h30v30h74V76l56-40 56 40v16h60V60l40-26 40 26v32h48V150z"/>' +
  '<path class="sl-roofs__front" d="M0 150V112h90V96l40-26 40 26v16h120v-8l36-24 36 24v8h150V98l44-30 44 30v14h140v-10l38-26 38 26v10h150V96l42-28 42 28v16h130V100l38-24 38 24v12h68V150z"/>' +
  [96, 248, 470, 690, 905, 1120, 1310]
    .map((x, i) => `<rect class="sl-window" style="--i:${i}" x="${x}" y="${i % 2 ? 78 : 70}" width="14" height="14" rx="2"/>`)
    .join("") +
  '<path class="sl-roofs__snow" d="M0 132C240 116 480 146 720 128S1200 116 1440 126V150H0z"/>' +
  "</svg>";

function house(n: SleighNight, i: number, stop: number, phase: SleighPageInput["phase"]): string {
  const d = dayLabel(n.nightOn);
  const tonight = phase === "on" && i === stop;
  const gone = i < stop;
  const cls = `sl-house${tonight ? " is-tonight" : gone ? " is-gone" : ""}`;
  return (
    `<li class="${cls}" style="--i:${i}" data-night="${n.nightOn}">` +
    '<svg class="sl-house__art" viewBox="0 0 64 60" aria-hidden="true" focusable="false"><use href="#slHouse"/></svg>' +
    `<p class="sl-house__when"><span>${d.day} ${d.date} ${d.month}</span></p>` +
    `<p class="sl-house__where">${escapeHtml(n.areas)}</p>` +
    `<p class="sl-house__time">${escapeHtml(timesLabel(n))}</p>` +
    (tonight ? '<p class="sl-house__flag">Tonight</p>' : "") +
    "</li>"
  );
}

// The Ball's donate page's own pattern (src/ball/donate-page.ts), so a giver is asked exactly the same.
const POSTCODE_PATTERN = "[A-Za-z]{1,2}[0-9][A-Za-z0-9]? ?[0-9][A-Za-z]{2}";

function field(id: string, label: string, attrs: string, message: string): string {
  return (
    `<div class="sl-field" id="${id}Field"><label for="${id}">${label}</label>` +
    `<input id="${id}" name="${id}" ${attrs} data-invalid-message="${escapeHtml(message)}" />` +
    `<p class="sl-field__error" id="${id}Error" hidden></p></div>`
  );
}

const AMOUNTS = [500, 1000, 2000, 5000];
const START_AMOUNT = 1000;

function giveForm(): string {
  return (
    '<form class="sl-form" id="slGive" novalidate>' +
    '<fieldset class="sl-amounts"><legend class="sl-label">How much?</legend><div class="sl-keys">' +
    AMOUNTS.map(
      (p) =>
        `<button class="sl-key${p === START_AMOUNT ? " is-on" : ""}" type="button" data-amount="${p}" aria-pressed="${p === START_AMOUNT}">${pounds(p)}</button>`,
    ).join("") +
    "</div>" +
    '<div class="sl-field sl-other" id="slOtherField"><label for="slOther">Or your own amount</label>' +
    '<span class="sl-other__box"><span class="sl-other__pound" aria-hidden="true">£</span>' +
    '<input id="slOther" name="slOther" type="text" inputmode="decimal" autocomplete="off" placeholder="25" data-invalid-message="Please give £2 or more" /></span>' +
    '<p class="sl-field__error" id="slOtherError" hidden></p></div>' +
    "</fieldset>" +
    '<fieldset class="sl-group"><legend class="sl-label">Your details</legend><div class="sl-names">' +
    field("slFirstName", "First name", 'type="text" autocomplete="given-name" required', "Please tell us your first name") +
    field("slSurname", "Surname", 'type="text" autocomplete="family-name" required', "Please tell us your surname") +
    "</div>" +
    field(
      "slEmail",
      "Email",
      'type="email" autocomplete="email" inputmode="email" required pattern="[^\\s@]+@[^\\s@]+\\.[^\\s@]+"',
      "Please give an email address for your receipt",
    ) +
    '<p class="sl-help">For your receipt and a thank you. We never share it.</p>' +
    "</fieldset>" +
    '<div class="sl-giftaid">' +
    '<input class="sl-giftaid__box" id="slGiftAid" name="slGiftAid" type="checkbox" />' +
    '<label class="sl-giftaid__label" for="slGiftAid"><strong>Add Gift Aid: 25% more, at no cost to you</strong>' +
    `<span class="sl-giftaid__statement">${escapeHtml(SINGLE_DONATION_WORDING.wording_snapshot)}</span></label>` +
    "</div>" +
    '<fieldset class="sl-group sl-declaration" id="slDeclaration" hidden>' +
    '<legend class="sl-label">Your home address for Gift Aid</legend>' +
    '<p class="sl-help">HMRC needs these to match your gift to your tax record.</p>' +
    field("slHouse", "House name or number", 'type="text" required disabled placeholder="e.g. 12 or Rose Cottage"', "Please give your house name or number") +
    field("slAddress", "Home address", 'type="text" autocomplete="street-address" required disabled placeholder="Street and town"', "Please give your street and town") +
    field("slPostcode", "Postcode", `type="text" autocomplete="postal-code" required disabled placeholder="e.g. KA1 1AA" pattern="${POSTCODE_PATTERN}"`, "Please give a UK postcode, like KA1 1AA") +
    '<label class="sl-check" for="slNonUk"><input id="slNonUk" name="slNonUk" type="checkbox" disabled /><span>My home address is outside the UK</span></label>' +
    "</fieldset>" +
    // data-give-pay: the visit counter counts a tap on it as a donate click (assets/js/pulse.js).
    `<button class="sl-btn sl-btn--give" id="slPay" type="submit" data-give-pay><span class="sl-bell" aria-hidden="true"></span><span id="slPayWords">Give ${pounds(START_AMOUNT)}</span></button>` +
    '<p class="sl-status" id="slStatus" role="status" aria-live="polite"></p>' +
    '<p class="sl-note">Secure payment by Stripe. Card, Apple Pay or Google Pay.</p>' +
    '<noscript><p class="sl-note">Giving here needs JavaScript switched on. You can still give on our <a href="/donate">donate page</a>.</p></noscript>' +
    "</form>"
  );
}

function frame(o: { title: string; description: string; body: string; bodyClass: string; index: boolean; giveHref?: string }): string {
  return (
    "<!doctype html>\n" +
    '<html lang="en">\n<head>\n' +
    '<meta charset="utf-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    `<title>${escapeHtml(o.title)}</title>\n` +
    `<meta name="description" content="${escapeHtml(o.description)}" />\n` +
    (o.index ? "" : '<meta name="robots" content="noindex" />\n') +
    '<meta name="theme-color" content="#F8F5EE" />\n' +
    `<meta property="og:title" content="${escapeHtml(o.title)}" />\n` +
    `<meta property="og:description" content="${escapeHtml(o.description)}" />\n` +
    '<meta property="og:image" content="https://nbcc.scot/assets/img/santa-sleigh-1340.webp" />\n' +
    '<link rel="preload" href="/assets/fonts/playfair-var.woff2" as="font" type="font/woff2" crossorigin />\n' +
    '<link rel="preload" href="/assets/fonts/poppins-400.woff2" as="font" type="font/woff2" crossorigin />\n' +
    '<link rel="stylesheet" href="/assets/css/sleigh.css" />\n' +
    '<script defer src="/assets/js/sleigh.js"></script>\n' +
    '<script defer src="/assets/js/pulse.js"></script>\n' +
    "</head>\n" +
    `<body class="sl-page ${o.bodyClass}">\n` +
    '<a class="sl-skip" href="#main">Skip to the page</a>\n' +
    SHAPES +
    `<header class="sl-top"><a class="sl-top__home" href="/">${LOGO}</a><a class="sl-top__give" href="${o.giveHref ?? "#give"}">Give</a></header>\n` +
    o.body +
    '\n<footer class="sl-foot">' +
    "<p>Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation.</p>" +
    "<p>Scottish Charity Number SC047995. Regulated by the Scottish Charity Regulator, OSCR.</p>" +
    '<p><a href="/">nbcc.scot</a> · <a href="/privacy">Privacy</a></p>' +
    "</footer>\n</body>\n</html>\n"
  );
}

/** The page, /sleigh. */
export function renderSleighPage(o: SleighPageInput): string {
  const after = o.phase === "after";
  const sorted = [...o.nights].sort((a, b) => a.nightOn.localeCompare(b.nightOn));
  const total =
    // Nothing raised yet (until the first night): no number, rather than "£0" on a giving page.
    o.totalPence === null || o.totalPence <= 0
      ? ""
      : `<p class="sl-total" data-total="${o.totalPence}"><span class="sl-total__num" id="slTotal">${pounds(o.totalPence)}</span>` +
        `<span class="sl-total__words">${after ? "raised by the sleigh this year. Thank you." : "raised by the sleigh so far this year"}</span></p>`;

  const hero =
    '<section class="sl-sky" aria-labelledby="slTitle">' +
    snow(18, 20261215, "far") +
    '<span class="sl-moon" aria-hidden="true"></span>' +
    '<div class="sl-hero">' +
    '<div class="sl-hero__words">' +
    '<p class="sl-eyebrow">Kilmarnock Santa Sleigh 2026</p>' +
    (after
      ? '<h1 class="sl-title" id="slTitle">Thank you, <em>Kilmarnock.</em></h1>' +
        '<p class="sl-lede">Every wave, every bell and every pound in the buckets. You can still give below.</p>'
      : '<h1 class="sl-title" id="slTitle">Santa’s coming down <em>your street.</em></h1>' +
        '<p class="sl-lede">Give now, even if you can’t make it out on the night.</p>') +
    '<div class="sl-ctas"><a class="sl-btn sl-btn--give" href="#give"><span class="sl-bell" aria-hidden="true"></span>Give to the sleigh</a>' +
    `<a class="sl-link" href="#nights">${after ? "See where we went" : "When’s it near me?"}</a></div>` +
    "</div>" +
    '<figure class="sl-hero__art">' +
    '<img class="sl-hero__img" src="/assets/img/santa-sleigh-1340.webp" srcset="/assets/img/santa-sleigh-720.webp 720w, /assets/img/santa-sleigh-1340.webp 1340w" ' +
    `sizes="(max-width: 760px) 92vw, 560px" width="1340" height="927" alt="${ART_ALT}" fetchpriority="high" decoding="async" />` +
    '<span class="sl-trail" aria-hidden="true"></span>' +
    "</figure>" +
    "</div>" +
    snow(14, 20261222, "near") +
    ROOFS +
    "</section>";

  const road =
    '<section class="sl-road" id="nights" aria-labelledby="slRoadTitle">' +
    `<div class="sl-card">${total}` +
    `<h2 class="sl-h2" id="slRoadTitle">${after ? "Where the sleigh went" : "Where’s the sleigh?"}</h2>` +
    `<ol class="sl-houses" data-stop="${o.stop}" style="--n:${sorted.length}">` +
    sorted.map((n, i) => house(n, i, o.stop, o.phase)).join("") +
    "</ol>" +
    `<img class="sl-mini" id="slMini" src="/assets/img/santa-sleigh-240.webp" width="240" height="166" alt="" decoding="async" />` +
    '<p class="sl-road__note">A different route every night. Streets and times go up here once they are planned.</p>' +
    "</div></section>";

  const give =
    '<section class="sl-give" id="give" aria-labelledby="slGiveTitle">' +
    '<div class="sl-give__words">' +
    '<h2 class="sl-h2" id="slGiveTitle">Put something in Santa’s bucket</h2>' +
    '<p class="sl-give__lede">It all goes the same way as the buckets: a full red bag on Christmas morning for someone who would otherwise have nothing to open.</p>' +
    "</div>" +
    giveForm() +
    "</section>";

  const who =
    '<section class="sl-who" aria-labelledby="slWhoTitle">' +
    '<figure class="sl-who__photo"><img src="/assets/img/home-red-bags-handover.jpg" width="1400" height="732" alt="NBCC volunteers handing over red bags" loading="lazy" decoding="async" /></figure>' +
    '<div class="sl-who__words">' +
    '<h2 class="sl-h2" id="slWhoTitle">Who’s behind the sleigh?</h2>' +
    `<p class="sl-who__big">${escapeHtml(ABOUT_NBCC_SHORT)}</p>` +
    '<ul class="sl-facts">' +
    '<li><b>7,657</b><span>red bags in 2025</span></li>' +
    "<li><b>All year</b><span>school clothing and crisis support</span></li>" +
    "<li><b>Volunteers</b><span>on every sleigh night</span></li>" +
    "</ul>" +
    '<a class="sl-link sl-link--dark" href="/about-us">Find out more about NBCC</a>' +
    "</div></section>";

  // Jaimie, 10 November 2026: the sleigh is run with the Kilmarnock Santa Sleigh team, whose
  // volunteers build it and give their time for free; the page takes a moment to thank them.
  const partner =
    '<section class="sl-partner" aria-labelledby="slPartnerTitle">' +
    '<img class="sl-partner__logo" src="/assets/img/kilmarnock-santa-sleigh-logo.webp" width="640" height="360" alt="Kilmarnock Santa Sleigh" loading="lazy" decoding="async" />' +
    '<div class="sl-partner__words">' +
    '<h2 class="sl-h2" id="slPartnerTitle">With the Kilmarnock Santa Sleigh team</h2>' +
    "<p>Their volunteers build the sleigh, plan every route and walk the streets alongside ours, all giving their time for free. Thank you.</p>" +
    "</div></section>";

  const more =
    '<nav class="sl-more" aria-label="More ways to help">' +
    '<a href="/fill"><b>Fill a Red Bag</b><span>Choose what goes in, one gift at a time.</span></a>' +
    '<a href="/get-involved/volunteer"><b>Walk with the sleigh</b><span>Shake a bucket, ring a bell. 16 or over.</span></a>' +
    '<a href="/newsletter"><b>Hear from us</b><span>A few emails a year, next year’s sleigh dates too.</span></a>' +
    "</nav>";

  const last =
    '<section class="sl-last" aria-labelledby="slLastTitle">' +
    `<h2 class="sl-h2" id="slLastTitle">${after ? "One more for the sleigh?" : "Can’t wait for the bells?"}</h2>` +
    '<a class="sl-btn sl-btn--cream" href="#give"><span class="sl-bell" aria-hidden="true"></span>Give to the sleigh</a>' +
    "</section>";

  return frame({
    title: "Kilmarnock Santa Sleigh 2026 | NBCC",
    description: "Santa’s sleigh is coming round Kilmarnock this December. See the nights and give to NBCC before it reaches your street.",
    bodyClass: after ? "sl-page--after" : `sl-page--${o.phase}`,
    index: true,
    body: `<main class="sl-main" id="main" data-phase="${o.phase}">${hero}${road}${give}${who}${partner}${more}${last}</main>`,
  });
}

/** How much a paid Santa Sleigh session gave, in pence, or null for anything else. */
export function amountFromSession(
  session: { payment_status?: string | null; amount_total?: number | null; metadata?: Record<string, string> | null } | null,
): number | null {
  if (!session || session.payment_status !== "paid" || session.metadata?.sleigh !== "true") return null;
  const t = session.amount_total;
  return typeof t === "number" && Number.isInteger(t) && t > 0 ? t : null;
}

/** The thank you, /sleigh/thank-you. A plain one, never an error, when the amount is not known. */
export function renderSleighThanks(amountPence: number | null): string {
  const heading = amountPence ? `Thank you for your ${pounds(amountPence)}` : "Thank you";
  const body =
    '<main class="sl-main sl-thanks" id="main">' +
    '<section class="sl-sky sl-sky--thanks" aria-labelledby="slThanksTitle">' +
    snow(22, 20261224, "near") +
    '<div class="sl-thanks__inner">' +
    '<img class="sl-thanks__img" src="/assets/img/santa-sleigh-720.webp" width="720" height="498" alt="" decoding="async" />' +
    `<h1 class="sl-title" id="slThanksTitle">${heading}</h1>` +
    '<p class="sl-lede">It’s in Santa’s bucket. It could mean a full red bag on Christmas morning for someone who would otherwise have nothing to open.</p>' +
    `<div class="sl-ctas"><a class="sl-btn sl-btn--cream" href="${SLEIGH_PATH}#nights">See the sleigh nights</a><a class="sl-link" href="/about-us">About NBCC</a></div>` +
    "</div>" +
    ROOFS +
    "</section></main>";
  return frame({
    title: "Thank you | Kilmarnock Santa Sleigh",
    description: "Thank you for giving to NBCC's Kilmarnock Santa Sleigh.",
    bodyClass: "sl-page--thanks",
    index: false,
    giveHref: `${SLEIGH_PATH}#give`,
    body,
  });
}
