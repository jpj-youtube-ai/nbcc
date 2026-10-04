import { ALL_DONATIONS_WORDING, SINGLE_DONATION_WORDING } from "../declarations/wording";
import { redBag, type RedBagCatalogue } from "./catalogue";

// Fill a Red Bag: the parts of the page the server draws into fill-a-red-bag.html, where its
// markers are. The list and the themes come from the one catalogue (./catalogue.ts), so they are in
// the page itself and read without JavaScript; assets/js/red-bag.js then makes them work. The ids,
// classes and data marks here are what that script and assets/css/red-bag.css look for.
//
// Pure: a template and a few choices in, a page out. No database, no clock.

export const LIST_MARKER = "<!-- red-bag:list -->";
export const THEMES_MARKER = "<!-- red-bag:themes -->";
export const DETAILS_MARKER = "<!-- red-bag:details -->";
export const PREVIEW_MARKER = "<!-- red-bag:preview -->";
export const BAG_MARKER = "<!-- red-bag:bag -->";
export const REAL_MARKER = "<!-- red-bag:real -->";

/**
 * "Prefer to give the real thing?" points here. The address did not resolve on 3 October 2026, so
 * the note is shown WITHOUT the link until Jaimie confirms it is live: then set DROP_OFF_LIVE true.
 */
export const DROP_OFF_URL = "https://drop.nbcc.scot";
export const DROP_OFF_LIVE = false;

/** The phone number the site already prints (contact.html, donate.html). */
const PHONE = '<a href="tel:+441292811015">01292 811 015</a>';

/** What staff see across the top while the page is switched off. Plain on purpose. */
export const PREVIEW_STRIP = '<p class="rb-preview" role="note">Staff preview: not public yet</p>';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// The plus and minus are drawn, not typed, so no dash character is read out or shown as copy.
const MINUS_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12M12 6v12"/></svg>';

/**
 * NBCC's Red Bag: a red paper gift bag, rectangular, with a folded top and two twisted cord handles
 * (assets/img/home-red-bags-handover.jpg). Not a sack. The bag starts as an outline on pale paper;
 * `.rb-bag__fill` is the red that rises inside it (the script scales it, transform only), and the
 * tissue shows at the top once it is full. For the eye only: the status line says it in words.
 */
export const BAG_SVG =
  '<svg class="rb-bag" viewBox="0 0 120 132" width="120" height="132" aria-hidden="true" focusable="false">' +
  '<path class="rb-bag__cord rb-bag__cord--back" d="M44 36C44 10 88 10 88 36"/>' +
  '<path class="rb-bag__tissue" d="M22 38l9-13 8 9 9-14 9 13 9-12 8 11 9-9 7 15z"/>' +
  '<path class="rb-bag__paper" d="M12 36h96v88a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z"/>' +
  '<g class="rb-bag__clip"><rect class="rb-bag__fill" x="12" y="36" width="96" height="92"/></g>' +
  '<path class="rb-bag__gusset" d="M92 36h16v88a4 4 0 0 1-4 4H92z"/>' +
  '<path class="rb-bag__fold" d="M12 36h96v10H12z"/>' +
  '<path class="rb-bag__outline" d="M12 36h96v88a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z"/>' +
  '<path class="rb-bag__crease" d="M12 46h96M92 46v82"/>' +
  '<path class="rb-bag__cord" d="M32 40C32 12 76 12 76 40"/>' +
  '<path class="rb-bag__twist" d="M32 40C32 12 76 12 76 40"/>' +
  '<circle class="rb-bag__eyelet" cx="32" cy="41" r="2.2"/><circle class="rb-bag__eyelet" cx="76" cy="41" r="2.2"/>' +
  "</svg>";

/** The list on the paper: the sheet's headings, and a row for each item with its stepper. */
export function renderRedBagList(rb: RedBagCatalogue = redBag()): string {
  return rb.GROUPS.map((g) => {
    const rows = g.items
      .map((i) => {
        const name = escapeHtml(i.name);
        const id = `rb-qty-${i.key}`;
        return (
          `<li class="rb-item" data-rb-item="${i.key}" data-pence="${i.pence}">` +
          `<span class="rb-item__name">${name}</span>` +
          `<span class="rb-item__price">${rb.pounds(i.pence)}</span>` +
          '<span class="rb-stepper">' +
          `<button class="rb-step" type="button" data-rb-minus aria-label="Take one away: ${name}">${MINUS_ICON}</button>` +
          `<label class="sr-only" for="${id}">How many: ${name}</label>` +
          `<input class="rb-qty" id="${id}" name="${id}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" value="0" />` +
          `<button class="rb-step" type="button" data-rb-plus aria-label="Add one: ${name}">${PLUS_ICON}</button>` +
          "</span></li>"
        );
      })
      .join("");
    return (
      `<div class="rb-group" role="group" aria-labelledby="rb-group-${g.key}">` +
      `<h3 class="rb-group__title" id="rb-group-${g.key}">${escapeHtml(g.heading)}</h3>` +
      `<ul class="rb-items">${rows}</ul></div>`
    );
  }).join("");
}

/** "Whenever the need comes": four plain groups of examples, each a button that is pressed or not. */
export function renderRedBagThemes(rb: RedBagCatalogue = redBag()): string {
  const themes = rb.THEMES.map((t) => {
    const examples = t.examples
      .map(
        (e) =>
          `<li><button class="rb-example" type="button" data-rb-example="${e.key}" data-pence="${e.pence}" aria-pressed="false">` +
          `<span class="rb-example__amount">${rb.pounds(e.pence)}</span> <span class="rb-example__words">${escapeHtml(e.words)}</span></button></li>`,
      )
      .join("");
    return (
      `<div class="rb-theme" role="group" aria-labelledby="rb-theme-${t.key}">` +
      `<h3 id="rb-theme-${t.key}">${escapeHtml(t.title)}</h3>` +
      `<p class="rb-theme__sub">${escapeHtml(t.sub)}</p>` +
      `<ul class="rb-examples">${examples}</ul></div>`
    );
  }).join("");
  return `<div class="rb-themes">${themes}</div>`;
}

/**
 * The details step after Donate: the same asks, in the same words, as the give form on a
 * fundraiser's page (src/fundraising/render.ts renderGiveForm) and the donate page: name, email,
 * the newsletter tick, Gift Aid with HMRC's declaration, and covering the card fee (one off only).
 * A monthly gift shows the all donations declaration and the donate page's 18 or over tick instead
 * of the fee offer; the script swaps them. Shipped inside a hidden section, shown by the script.
 */
export function renderRedBagDetails(): string {
  return (
    '<div class="card card-lg rb-details">' +
    '<h2 class="rb-details__title" id="rb-details-title" tabindex="-1">Your details</h2>' +
    '<p class="rb-details__sum">Your Red Bag donation: <strong data-rb-details-total>£0</strong><span data-rb-details-monthly hidden> a month</span>. ' +
    '<button class="rb-link" type="button" data-rb-back>Back to my bag</button></p>' +
    '<form id="rbDetailsForm" class="rb-form" novalidate>' +
    '<p class="form-error-summary" role="alert" data-rb-error hidden></p>' +
    // who
    '<fieldset class="give-contact rb-ask"><legend class="give-contact-legend">About you</legend>' +
    '<div class="give-name-row">' +
    '<div class="give-field"><label for="rbFirstName">First name <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="rbFirstName" name="rbFirstName" type="text" autocomplete="given-name" required aria-required="true" data-invalid-message="Please tell us your first name" /></div>' +
    '<div class="give-field"><label for="rbSurname">Surname <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="rbSurname" name="rbSurname" type="text" autocomplete="family-name" required aria-required="true" data-invalid-message="Please tell us your surname" /></div>' +
    "</div>" +
    '<div class="give-field"><label for="rbEmail">Email <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="rbEmail" name="rbEmail" type="email" autocomplete="email" required aria-required="true" placeholder="you@example.com" />' +
    '<p class="give-field-help">We only use this to send your receipt and a thank you. We never share it.</p></div>' +
    '<div class="give-newsletter"><label class="give-check give-newsletter-check" for="rbEmailConsent">' +
    '<input class="give-check-box" id="rbEmailConsent" name="rbEmailConsent" type="checkbox" />' +
    '<span class="give-check-text"><strong>Add me to our donor newsletter.</strong> A warm little update from NBCC on the difference your support helps make. Unsubscribe anytime.</span>' +
    "</label></div>" +
    '<p class="give-field-help give-privacy">We handle your details as set out in our <a href="/privacy">Privacy notice</a>.</p>' +
    "</fieldset>" +
    // Gift Aid: the donate page's callout and declaration
    '<div class="rb-ask">' +
    '<div class="giftaid">' +
    '<div class="giftaid-head">' +
    '<strong class="giftaid-headline" data-rb-giftaid-headline>Make your donation worth 25% more</strong>' +
    '<span class="giftaid-logo" aria-hidden="true">gift aid it</span></div>' +
    '<p class="giftaid-intro">If you are a UK taxpayer, NBCC can turn every £1 you give into £1.25 on eligible donations, at no cost to you. That is 25% more for the people NBCC helps.</p>' +
    '<div class="giftaid-check-row">' +
    '<input class="giftaid-check" id="rbGiftAid" name="rbGiftAid" type="checkbox" />' +
    '<label class="giftaid-label" for="rbGiftAid"><strong>Yes, add Gift Aid. I am a UK taxpayer.</strong>' +
    `<span class="giftaid-statement" data-rb-wording="once">${escapeHtml(SINGLE_DONATION_WORDING.wording_snapshot)}</span>` +
    `<span class="giftaid-statement" data-rb-wording="monthly" hidden>${escapeHtml(ALL_DONATIONS_WORDING.wording_snapshot)}</span></label>` +
    "</div></div>" +
    '<fieldset class="give-declaration rb-declaration" id="rbDeclaration" hidden>' +
    '<legend class="give-declaration-legend">Your home address for Gift Aid</legend>' +
    '<p class="give-declaration-help">HMRC needs these to match your donation to your tax record.</p>' +
    '<div class="give-field"><label for="rbHouse">House name or number <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="rbHouse" name="rbHouse" type="text" required aria-required="true" placeholder="e.g. 12 or Rose Cottage" data-invalid-message="Please give your house name or number" /></div>' +
    '<div class="give-field"><label for="rbAddress">Home address <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="rbAddress" name="rbAddress" type="text" autocomplete="street-address" required aria-required="true" placeholder="Street and town" data-invalid-message="Please give your street and town" /></div>' +
    '<div class="give-field" id="rbPostcodeField"><label for="rbPostcode">Postcode <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="rbPostcode" name="rbPostcode" type="text" autocomplete="postal-code" required aria-required="true" placeholder="e.g. KA1 1AA" ' +
    'pattern="[A-Za-z]{1,2}[0-9][A-Za-z0-9]? ?[0-9][A-Za-z]{2}" data-invalid-message="Please give a UK postcode, like KA1 1AA" /></div>' +
    '<label class="give-check" for="rbNonUk"><input class="give-check-box" id="rbNonUk" name="rbNonUk" type="checkbox" />' +
    '<span class="give-check-text">My home address is outside the UK</span></label>' +
    "</fieldset>" +
    "</div>" +
    // the card fee, one off only
    '<div class="rb-ask" data-rb-fee>' +
    '<label class="give-check" for="rbCoverFee"><input class="give-check-box" id="rbCoverFee" name="rbCoverFee" type="checkbox" />' +
    '<span class="give-check-text"><strong>Add <span data-rb-fee-amount>a little</span> to cover the card fee.</strong> Card payments cost NBCC a small fee. Cover it and your donation funds our work rather than the card company. Gift Aid still applies to your donation only.</span></label>' +
    "</div>" +
    // 18 or over, monthly only (the donate page's words)
    '<div class="rb-ask" data-rb-age hidden>' +
    '<label class="give-check give-age" for="rbAgeConfirmed"><input class="give-check-box" id="rbAgeConfirmed" name="rbAgeConfirmed" type="checkbox" required aria-required="true" data-invalid-message="Please confirm you are aged 18 or over" />' +
    '<span class="give-check-text">I confirm I am aged 18 or over. Monthly giving is set up by adults.</span></label>' +
    "</div>" +
    '<div class="give-cta-row">' +
    '<button class="btn btn-primary give-cta" type="submit" data-rb-pay>Donate</button>' +
    '<p class="give-pay-note">Secure payment by Stripe. Card, Apple Pay and Direct Debit.</p>' +
    "</div>" +
    "</form></div>"
  );
}

/** "Prefer to give the real thing?": with the drop off link once it is live, the phone until then. */
export function renderRealThing(dropOffLive: boolean): string {
  const how = dropOffLive
    ? `See what we need and where to bring it at <a href="${DROP_OFF_URL}">drop.nbcc.scot</a>.`
    : `We would love that. Get in touch on ${PHONE} and we can tell you what we need and where to bring it.`;
  return `<p class="rb-real"><strong>Prefer to give the real thing?</strong> ${how}</p>`;
}

export interface RedBagPageOptions {
  /** A signed in member of staff looking while the page is switched off: adds the strip. */
  preview: boolean;
  /** For tests: the drop off link as it is once live. Defaults to DROP_OFF_LIVE. */
  dropOffLive?: boolean;
}

/** The whole page: the template with every marker filled in. */
export function renderRedBagPage(template: string, opts: RedBagPageOptions): string {
  const rb = redBag();
  let html = template
    .replace(LIST_MARKER, renderRedBagList(rb))
    .replace(THEMES_MARKER, renderRedBagThemes(rb))
    .replace(DETAILS_MARKER, renderRedBagDetails())
    .split(BAG_MARKER)
    .join(BAG_SVG)
    .replace(REAL_MARKER, renderRealThing(opts.dropOffLive ?? DROP_OFF_LIVE))
    .replace(PREVIEW_MARKER, opts.preview ? PREVIEW_STRIP : "");
  // The script sends the staff session with the checkout only on a preview (assets/js/red-bag.js).
  if (opts.preview) html = html.replace("<body>", '<body data-rb-preview="true">');
  return html;
}
