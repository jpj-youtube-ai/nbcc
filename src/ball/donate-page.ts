import { SINGLE_DONATION_WORDING } from "../declarations/wording";
import { escapeHtml } from "./page";
import { londonDate } from "./sales-report";

// The Festive Ball's "Can't make it? Donate" page, /ball/donate (Jaimie, 14 October 2026).
//
// A short page in the Ball's look (ball-donate.html) with a once only give form, drawn here so the
// Gift Aid declaration is word for word the one the site keeps (SINGLE_DONATION_WORDING), as the
// fundraiser pages' form is. Its gifts go through the donate page's own checkout with the marker
// ball: true (src/routes/api.ts), are recorded with the source "ball", and show in Admin > Donations
// as Festive Ball. The thank you and the receipt are the donate page's own.
//
// The form is the fundraiser give form's shape and styles (src/fundraising/render.ts,
// assets/css/fundraising.css) with its own ids (bd...), driven by assets/js/ball-donate.js.
//
// Pure: no pool, no config, no clock of its own.

/** Where the template takes the form. */
export const BALL_DONATE_FORM_MARKER = "<!-- ball-donate:form -->";

/** The amounts offered, in pence. Your own amount is £2 or more (BALL_GIFT_MIN_PENCE). */
export const BALL_DONATE_PRESETS_PENCE: readonly number[] = [1000, 2500, 5000, 10000];

/** The Ball is on Saturday 7 November 2026 (BALL_EVENT_DATE). */
const BALL_DAY = "2026-11-07";

/** Whether the page is up: until the end of the Ball's own day in the UK. After it, /donate. */
export function ballDonateOpen(now: Date): boolean {
  return londonDate(now) <= BALL_DAY;
}

const pounds = (pence: number) => `£${pence / 100}`;

/** The give form: how much, your details, Gift Aid, the card fee, and the button. */
export function renderBallDonateForm(): string {
  const presets = BALL_DONATE_PRESETS_PENCE.map(
    (pence) =>
      `<label class="fr-amount"><input type="radio" name="bdAmount" value="${pence}" />` +
      `<span class="fr-amount__face">${pounds(pence)}</span></label>`,
  ).join("");
  return (
    '<section class="fr-give" id="give" aria-labelledby="bd-give-heading" tabindex="-1">' +
    '<div class="card card-lg give-card fr-give-card"><div class="give-main">' +
    '<h2 class="give-step-title" id="bd-give-heading">Make a donation</h2>' +
    '<p class="give-step-sub">A one off gift to NBCC, in place of your ticket.</p>' +
    // Shipped showing; the script hides it and shows the form.
    '<p class="fr-noscript" data-nojs>Giving on this page needs JavaScript switched on. You can still donate on our <a href="/donate">donate page</a>.</p>' +
    '<form id="bdGiveForm" class="fr-give-form" novalidate hidden data-needs-js>' +
    '<p class="form-error-summary" role="alert" data-give-error hidden></p>' +
    // 1. how much
    '<div class="give-question">' +
    '<fieldset class="fr-fieldset" id="bdAmountGroup"><legend class="give-scope-legend">How much would you like to give?</legend>' +
    `<div class="fr-amounts">${presets}</div>` +
    '<div class="give-field fr-own">' +
    '<label class="give-custom-label" for="bdOwnAmount">Or choose your own amount, £2 or more</label>' +
    '<div class="give-custom-field"><span class="give-custom-currency" aria-hidden="true">£</span>' +
    '<input class="give-custom-input" id="bdOwnAmount" name="bdOwnAmount" type="number" inputmode="decimal" min="2" step="0.01" placeholder="Amount" />' +
    "</div></div>" +
    "</fieldset></div>" +
    // 2. who
    '<div class="give-question">' +
    '<fieldset class="give-contact fr-fieldset"><legend class="give-contact-legend">Your details</legend>' +
    '<div class="give-name-row">' +
    '<div class="give-field"><label for="bdFirstName">First name <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="bdFirstName" name="bdFirstName" type="text" autocomplete="given-name" required aria-required="true" data-invalid-message="Please tell us your first name" /></div>' +
    '<div class="give-field"><label for="bdSurname">Surname <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="bdSurname" name="bdSurname" type="text" autocomplete="family-name" required aria-required="true" data-invalid-message="Please tell us your surname" /></div>' +
    "</div>" +
    '<div class="give-field"><label for="bdEmail">Email <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="bdEmail" name="bdEmail" type="email" autocomplete="email" required aria-required="true" placeholder="you@example.com" />' +
    '<p class="give-field-help">We only use this to send your receipt and a thank you. We never share it.</p></div>' +
    '<div class="give-newsletter"><label class="give-check give-newsletter-check" for="bdEmailConsent">' +
    '<input class="give-check-box" id="bdEmailConsent" name="bdEmailConsent" type="checkbox" />' +
    '<span class="give-check-text"><strong>Add me to our donor newsletter.</strong> A warm little update from NBCC on the difference your support helps make. Unsubscribe anytime.</span>' +
    "</label></div>" +
    '<p class="give-field-help give-privacy">We handle your details as set out in our <a href="/privacy">Privacy notice</a>.</p>' +
    "</fieldset></div>" +
    // 3. Gift Aid: the donate page's callout and the one off declaration
    '<div class="give-question">' +
    '<div class="giftaid">' +
    '<div class="giftaid-head">' +
    '<strong class="giftaid-headline" data-giftaid-headline>Make your donation worth 25% more</strong>' +
    '<span class="giftaid-logo" aria-hidden="true">gift aid it</span></div>' +
    '<p class="giftaid-intro">If you are a UK taxpayer, NBCC can turn every £1 you give into £1.25 on eligible donations, at no cost to you. That is 25% more for the people NBCC helps.</p>' +
    '<div class="giftaid-check-row">' +
    '<input class="giftaid-check" id="bdGiftAid" name="bdGiftAid" type="checkbox" />' +
    '<label class="giftaid-label" for="bdGiftAid"><strong>Yes, add Gift Aid. I am a UK taxpayer.</strong>' +
    `<span class="giftaid-statement">${escapeHtml(SINGLE_DONATION_WORDING.wording_snapshot)}</span></label>` +
    "</div></div>" +
    '<fieldset class="give-declaration fr-declaration" id="bdDeclaration" hidden>' +
    '<legend class="give-declaration-legend">Your home address for Gift Aid</legend>' +
    '<p class="give-declaration-help">HMRC needs these to match your donation to your tax record.</p>' +
    '<div class="give-field"><label for="bdHouse">House name or number <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="bdHouse" name="bdHouse" type="text" required aria-required="true" placeholder="e.g. 12 or Rose Cottage" data-invalid-message="Please give your house name or number" /></div>' +
    '<div class="give-field"><label for="bdAddress">Home address <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="bdAddress" name="bdAddress" type="text" autocomplete="street-address" required aria-required="true" placeholder="Street and town" data-invalid-message="Please give your street and town" /></div>' +
    '<div class="give-field" id="bdPostcodeField"><label for="bdPostcode">Postcode <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="bdPostcode" name="bdPostcode" type="text" autocomplete="postal-code" required aria-required="true" placeholder="e.g. KA1 1AA" ' +
    'pattern="[A-Za-z]{1,2}[0-9][A-Za-z0-9]? ?[0-9][A-Za-z]{2}" data-invalid-message="Please give a UK postcode, like KA1 1AA" /></div>' +
    '<label class="give-check" for="bdNonUk"><input class="give-check-box" id="bdNonUk" name="bdNonUk" type="checkbox" />' +
    '<span class="give-check-text">My home address is outside the UK</span></label>' +
    "</fieldset>" +
    "</div>" +
    // 4. the card fee
    '<div class="give-question">' +
    '<label class="give-check" for="bdCoverFee"><input class="give-check-box" id="bdCoverFee" name="bdCoverFee" type="checkbox" />' +
    '<span class="give-check-text"><strong>Add <span data-cover-fee-amount>a little</span> to cover the card fee.</strong> Card payments cost NBCC a small fee. Cover it and your donation funds our work rather than the card company. Gift Aid still applies to your donation only.</span></label>' +
    "</div>" +
    '<div class="give-cta-row">' +
    '<button class="btn btn-primary give-cta" type="submit" data-give-submit>Give now</button>' +
    '<p class="give-pay-note">Secure payment by Stripe. Card, Apple Pay and Direct Debit.</p>' +
    "</div>" +
    "</form>" +
    "</div></div>" +
    "</section>"
  );
}

/** The page as it goes out: the template with the form in its place. */
export function renderBallDonatePage(template: string): string {
  return template.replace(BALL_DONATE_FORM_MARKER, renderBallDonateForm());
}
