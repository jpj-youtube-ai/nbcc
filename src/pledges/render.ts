import { escapeHtml } from "../events/render";
import { timeAgo } from "../fundraising/render";
import {
  CONFIRM_DAYS,
  OWN_MONEY_WORDS,
  PLEDGE_DECLARATION_PARTS,
  PLEDGE_MAX_PENCE,
  RETENTION_DAYS,
  longDate,
  payWhenWords,
  pledgeDeclarationWording,
  pounds,
  type PledgeWallEntry,
} from "./model";

// Sponsor pledges (Jaimie, 2026-10-03), drawn on the server. Pure: no database, no config, no clock.
//
//   renderPledgeExtras   what a sponsorship fundraiser's page gains (src/fundraising/render.ts puts
//                        each where it belongs): the second option under the give button with the
//                        pledged line, the pledge form after the give form, and the pledges after the
//                        supporter wall. A pledge is a promise: nothing here touches the meter.
//   renderPayPage        the page the emailed pay link opens: a plain form (no JavaScript needed)
//                        that goes on to Stripe, the amount filled in. They may give more than they
//                        pledged, never less.
//   renderConfirmPage    the page the confirm email opens: asks first, with a button, so a link
//                        opened by a mail scanner never confirms a pledge.
//   renderCancelPage     "Can't pay your pledge after all?": asks first, with a button, so a link
//                        opened by a mail scanner never cancels anything.
//   renderPledgeNotice   a plain page of words: cancelled, already paid, link no longer works.
//
// Everything a person typed is escaped on the way out. Plain friendly English, no dashes.

export interface PledgePageInput {
  slug: string;
  title: string;
  /** The organiser's first name, as the page shows it ("Robin"). */
  organiserFirstName: string;
  eventDate: string | null;
  /** May someone pledge today (canPledge)? */
  open: boolean;
  minimumPence: number;
  /** The pledges still to be paid, as the page may show them, newest first. */
  pledges: PledgeWallEntry[];
  openCount: number;
  openPence: number;
  /** Today in UK time, YYYY-MM-DD. */
  today: string;
  now: Date;
}

export interface PledgeExtras {
  summaryHtml: string;
  giveHtml: string;
  wallHtml: string;
}

const sponsors = (n: number) => `${n} ${n === 1 ? "sponsor" : "sponsors"}`;

function renderSummary(i: PledgePageInput): string {
  const who = escapeHtml(i.organiserFirstName);
  const line =
    i.openCount > 0
      ? `<p class="fr-pledged"><strong class="fr-pledged__sum">${pounds(i.openPence)}</strong> pledged by ${sponsors(i.openCount)}, ` +
        `${payWhenWords(i, who, i.today)}. <span class="fr-pledged__note">Pledges are promises. They join the total once they are paid.</span></p>`
      : "";
  return (i.open ? '<a class="btn btn-ghost fr-summary__pledge" href="#pledge">Sponsor now, pay after</a>' : "") + line;
}

function renderForm(i: PledgePageInput): string {
  const who = escapeHtml(i.organiserFirstName);
  const min = pounds(i.minimumPence);
  const when = i.eventDate ? `the day after ${longDate(i.eventDate)}` : `when ${who} has finished`;
  return (
    '<section class="fr-give fr-pledge" id="pledge" aria-labelledby="fr-pledge-heading" tabindex="-1">' +
    '<div class="card card-lg give-card fr-give-card"><div class="give-main">' +
    '<h2 class="give-step-title" id="fr-pledge-heading">Sponsor now, pay after</h2>' +
    `<p class="give-step-sub">Promise an amount today and pay it once ${who} has finished. We will email you a link to pay ${when}. There is nothing to pay today.</p>` +
    '<ul class="fr-pledge__ways">' +
    `<li><strong>Already on ${who}'s paper sponsor form?</strong> You don't need to pledge here as well.</li>` +
    '<li><strong>Want to pay today?</strong> <a href="#give">Give now</a> instead, and it counts on the total straight away.</li>' +
    "</ul>" +
    '<p class="fr-noscript" data-nojs>Pledging on this page needs JavaScript switched on. You can still <a href="#give">give now</a>, or ask ' +
    `${who} for the paper sponsor form.</p>` +
    `<form id="pledgeForm" class="fr-give-form fr-pledge-form" data-slug="${escapeHtml(i.slug)}" data-minimum-pence="${i.minimumPence}" novalidate hidden data-needs-js>` +
    '<div hidden aria-hidden="true"><label for="plCompany">Leave blank<input type="text" id="plCompany" name="company" tabindex="-1" autocomplete="off" /></label></div>' +
    '<p class="form-error-summary" role="alert" data-pledge-error hidden></p>' +
    // 1. how much
    '<div class="give-question"><div class="give-field fr-own">' +
    `<label class="give-custom-label" for="plAmount">How much would you like to pledge? ${min} or more <span class="give-req" aria-hidden="true">*</span></label>` +
    '<div class="give-custom-field"><span class="give-custom-currency" aria-hidden="true">£</span>' +
    `<input class="give-custom-input" id="plAmount" name="plAmount" type="number" inputmode="decimal" min="${i.minimumPence / 100}" max="${PLEDGE_MAX_PENCE / 100}" step="0.01" placeholder="Amount" required aria-required="true" data-invalid-message="Tell us how much you would like to pledge, ${min} or more" />` +
    "</div></div></div>" +
    // 2. who
    '<div class="give-question">' +
    '<fieldset class="give-contact fr-fieldset"><legend class="give-contact-legend">Your details</legend>' +
    '<div class="give-name-row">' +
    '<div class="give-field"><label for="plFirstName">First name <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="plFirstName" name="plFirstName" type="text" autocomplete="given-name" maxlength="50" required aria-required="true" data-invalid-message="Please tell us your first name" /></div>' +
    '<div class="give-field"><label for="plSurname">Surname <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="plSurname" name="plSurname" type="text" autocomplete="family-name" maxlength="50" required aria-required="true" data-invalid-message="Please tell us your surname" /></div>' +
    "</div>" +
    '<div class="give-field"><label for="plEmail">Email <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="plEmail" name="plEmail" type="email" autocomplete="email" required aria-required="true" placeholder="you@example.com" data-invalid-message="Please give your email address, so we can send your link to pay" />' +
    '<p class="give-field-help">We only use this to send your link to pay, one reminder if you need it, and your receipt. We never share it.</p></div>' +
    "</fieldset></div>" +
    // 3. the wall
    '<div class="give-question">' +
    '<div class="give-field"><label for="plMessage">A message for the page <span class="give-optional">(optional)</span></label>' +
    '<textarea class="give-field-input fr-message" id="plMessage" name="plMessage" rows="3" maxlength="200" aria-describedby="plMessageCount"></textarea>' +
    '<p class="give-field-help" id="plMessageCount" data-pledge-count>Up to 200 characters.</p></div>' +
    '<div class="give-donor-options fr-choice" role="radiogroup" aria-label="Your name on the page">' +
    '<label class="give-donor-option" for="plShowNameYes"><input id="plShowNameYes" name="plShowName" type="radio" value="yes" checked />Show my name</label>' +
    '<label class="give-donor-option" for="plShowNameNo"><input id="plShowNameNo" name="plShowName" type="radio" value="no" />Stay anonymous</label>' +
    "</div>" +
    `<p class="give-field-help">On the page we show your first name and the first letter of your surname, like Robin T. ${who} will see your full name in their private list either way, so they know who has pledged.</p>` +
    '<label class="give-check" for="plShowAmount"><input class="give-check-box" id="plShowAmount" name="plShowAmount" type="checkbox" checked />' +
    '<span class="give-check-text">Show how much I pledged</span></label>' +
    "</div>" +
    // 4. Gift Aid, declared now for the payment made later
    '<div class="give-question">' +
    '<div class="giftaid">' +
    '<div class="giftaid-head"><strong class="giftaid-headline">Make your pledge worth 25% more</strong>' +
    '<span class="giftaid-logo" aria-hidden="true">gift aid it</span></div>' +
    '<p class="giftaid-intro">If you are a UK taxpayer, NBCC can turn every £1 you give into £1.25, at no cost to you. You say so now, and we only claim it once your pledge is paid.</p>' +
    '<div class="giftaid-check-row">' +
    '<input class="giftaid-check" id="plGiftAid" name="plGiftAid" type="checkbox" />' +
    '<label class="giftaid-label" for="plGiftAid"><strong>Yes, add Gift Aid when I pay. I am a UK taxpayer. ' +
    `${OWN_MONEY_WORDS}</strong>` +
    `<span class="giftaid-statement">${escapeHtml(PLEDGE_DECLARATION_PARTS.before)}<span data-pledge-ga-amount>the amount I pledge</span>${escapeHtml(PLEDGE_DECLARATION_PARTS.after)}</span></label>` +
    "</div></div>" +
    '<fieldset class="give-declaration fr-declaration" id="plDeclaration" hidden>' +
    '<legend class="give-declaration-legend">Your home address for Gift Aid</legend>' +
    '<p class="give-declaration-help">HMRC needs these to match your donation to your tax record.</p>' +
    '<div class="give-field"><label for="plHouse">House name or number <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="plHouse" name="plHouse" type="text" maxlength="100" required aria-required="true" placeholder="e.g. 12 or Rose Cottage" data-invalid-message="Please give your house name or number" /></div>' +
    '<div class="give-field"><label for="plAddress">Home address <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="plAddress" name="plAddress" type="text" autocomplete="street-address" maxlength="300" required aria-required="true" placeholder="Street and town" data-invalid-message="Please give your street and town" /></div>' +
    '<div class="give-field" id="plPostcodeField"><label for="plPostcode">Postcode <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="plPostcode" name="plPostcode" type="text" autocomplete="postal-code" required aria-required="true" placeholder="e.g. KA1 1AA" ' +
    'pattern="[A-Za-z]{1,2}[0-9][A-Za-z0-9]? ?[0-9][A-Za-z]{2}" data-invalid-message="Please give a UK postcode, like KA1 1AA" /></div>' +
    '<label class="give-check" for="plNonUk"><input class="give-check-box" id="plNonUk" name="plNonUk" type="checkbox" />' +
    '<span class="give-check-text">My home address is outside the UK</span></label>' +
    "</fieldset>" +
    "</div>" +
    '<div class="fr-captcha" id="pledgeCaptcha" hidden></div><input type="hidden" id="pledgeCaptchaToken" name="captchaToken" value="" />' +
    `<p class="give-field-help give-privacy">We keep your details until your pledge is paid, or for ${RETENTION_DAYS} days after we ask. We handle them as set out in our <a href="/privacy">Privacy notice</a>.</p>` +
    '<div class="give-cta-row">' +
    '<button class="btn btn-primary give-cta" type="submit" data-pledge-submit>Make my pledge</button>' +
    '<p class="give-pay-note">No payment today. We will email you a link to confirm your pledge.</p>' +
    "</div>" +
    '<p class="form-status" role="status" aria-live="polite" data-pledge-status></p>' +
    "</form>" +
    '<div class="fr-thanks-panel fr-pledge__done" data-pledge-done tabindex="-1" hidden></div>' +
    "</div></div>" +
    "</section>"
  );
}

function renderPledgeWall(i: PledgePageInput): string {
  if (i.pledges.length === 0) return "";
  const n = i.pledges.length;
  const items = i.pledges
    .map(
      (p) =>
        '<li class="fr-wall__item fr-pledges__item">' +
        '<p class="fr-wall__head">' +
        `<span class="fr-wall__who">${escapeHtml(p.name)}</span>` +
        `<span class="fr-wall__amount fr-pledges__amount">pledged${p.amountPence !== null ? ` ${pounds(p.amountPence)}` : ""}</span>` +
        "</p>" +
        (p.message ? `<p class="fr-wall__msg">${escapeHtml(p.message)}</p>` : "") +
        `<p class="fr-wall__when"><time datetime="${escapeHtml(p.createdAt)}">${timeAgo(p.createdAt, i.now)}</time></p>` +
        "</li>",
    )
    .join("");
  return (
    '<section class="fr-wall fr-pledges" aria-labelledby="fr-pledges-heading">' +
    '<h2 id="fr-pledges-heading">Pledges</h2>' +
    `<p class="fr-wall__count">${n === 1 ? "1 sponsor has" : `${n} sponsors have`} pledged, newest first. A pledge is a promise to pay after the event.</p>` +
    `<ol class="fr-wall__list" role="list">${items}</ol>` +
    "</section>"
  );
}

/** What a sponsorship fundraiser's page gains. All empty when pledges are closed and there are none. */
export function renderPledgeExtras(i: PledgePageInput): PledgeExtras {
  return {
    summaryHtml: renderSummary(i),
    giveHtml: i.open ? renderForm(i) : "",
    wallHtml: renderPledgeWall(i),
  };
}

// --- the pages the emailed links open --------------------------------------------------------------

export const PLEDGE_INTRO_MARKER = "<!-- pledge:intro -->";
export const PLEDGE_PAGE_MARKER = "<!-- pledge:page -->";

function page(template: string, title: string, introHtml: string, body: string): string {
  return template
    .replace(/__TITLE__/g, () => escapeHtml(title))
    .replace(PLEDGE_INTRO_MARKER, () => introHtml)
    .replace(PLEDGE_PAGE_MARKER, () => body);
}

const intro = (eyebrow: string, heading: string, lede: string) =>
  `<span class="eyebrow">${escapeHtml(eyebrow)}</span>` +
  `<h1 id="pledge-heading">${escapeHtml(heading)}</h1>` +
  '<div class="rule"><i></i></div>' +
  (lede ? `<p class="lede">${escapeHtml(lede)}</p>` : "");

/** 10 for £10, 12.50 for £12.50: what a number box takes. */
const amountValue = (pence: number) => (pence % 100 === 0 ? String(pence / 100) : (pence / 100).toFixed(2));

export interface PayPageData {
  token: string;
  title: string;
  organiserFirstName: string;
  sponsorFirstName: string | null;
  amountPence: number;
  giftAid: boolean;
  /** The day the declaration was made with the pledge, in words ("1 November 2026"). */
  declaredOn: string | null;
  pageUrl: string | null;
  /** What was wrong with what they sent, to say above the form. */
  error?: string;
}

export function renderPayPage(template: string, d: PayPageData): string {
  const who = escapeHtml(d.organiserFirstName);
  const thanks = d.sponsorFirstName ? `Thank you, ${d.sponsorFirstName}. ` : "Thank you. ";
  const lede = `${thanks}You pledged ${pounds(d.amountPence)} to sponsor ${d.organiserFirstName} for ${d.title}.`;
  const token = escapeHtml(d.token);
  // The declaration as it stands for what is paid today: the same words, without the pledged amount.
  const statement = pledgeDeclarationWording(d.amountPence).wording_snapshot.replace(` of ${pounds(d.amountPence)} when I pay it,`, "");
  const giftAid = d.giftAid
    ? '<div class="give-question"><div class="pl-pay__giftaid">' +
      '<label class="give-check" for="plPayGiftAid"><input class="give-check-box" id="plPayGiftAid" name="giftAid" type="checkbox" value="yes" checked />' +
      // Gift Aid is only for the giver's own money, so the box says who is paying (I6).
      `<span class="give-check-text"><strong>Keep Gift Aid on my donation. I am ${
        d.sponsorFirstName ? escapeHtml(d.sponsorFirstName) : "the person who made this pledge"
      } and this is my own money. I am still a UK taxpayer.</strong> ` +
      `You made your Gift Aid declaration with your pledge${d.declaredOn ? ` on ${escapeHtml(d.declaredOn)}` : ""}. It covers what you pay today: ` +
      `<span class="pl-pay__statement">${escapeHtml(statement)}</span> ` +
      "If someone else is paying, please untick this. Untick it too if you no longer pay enough UK tax.</span></label>" +
      "</div></div>"
    : "";
  const body =
    '<div class="card card-lg fr-panel pl-panel">' +
    (d.error ? `<p class="form-error-summary" role="alert">${escapeHtml(d.error)}</p>` : "") +
    '<form class="fr-form fr-form--plain pl-pay" method="post" action="/pledge/pay">' +
    `<input type="hidden" name="t" value="${token}" />` +
    '<div class="give-question"><div class="give-field fr-own">' +
    // More than they pledged if they like, never less (Jaimie, 2026-10-03).
    '<label class="give-custom-label" for="plPayAmount">The amount to pay. You can give more if you would like to.</label>' +
    '<div class="give-custom-field"><span class="give-custom-currency" aria-hidden="true">£</span>' +
    `<input class="give-custom-input" id="plPayAmount" name="amount" type="number" inputmode="decimal" min="${amountValue(d.amountPence)}" step="0.01" value="${amountValue(d.amountPence)}" required />` +
    "</div></div></div>" +
    giftAid +
    '<div class="give-question">' +
    '<label class="give-check" for="plPayCoverFee"><input class="give-check-box" id="plPayCoverFee" name="coverFee" type="checkbox" value="yes" />' +
    '<span class="give-check-text"><strong>Add a little to cover the card fee.</strong> Card payments cost NBCC a small fee. Cover it and your whole donation funds our work. Gift Aid still applies to your donation only.</span></label>' +
    "</div>" +
    '<div class="give-cta-row">' +
    '<button class="btn btn-primary give-cta" type="submit">Pay now</button>' +
    '<p class="give-pay-note">Secure payment by Stripe. Card or Apple Pay.</p>' +
    "</div>" +
    "</form>" +
    `<p class="pl-aside">Your payment goes to the Night Before Christmas Campaign and counts towards ${who}'s total. We will email you a receipt.</p>` +
    `<p class="pl-aside">Already paid ${who} in cash? You don't need to pay again. Just let ${who} know.</p>` +
    `<p class="pl-aside">Can't pay this after all? <a href="/pledge/cancel?t=${token}">Tell us here</a>, and we won't email you about it again.</p>` +
    (d.pageUrl ? `<p class="pl-aside"><a href="${escapeHtml(d.pageUrl)}">See ${who}'s page</a></p>` : "") +
    "</div>";
  return page(template, "Pay your pledge", intro("Sponsor pledge", "Pay your pledge", lede), body);
}

export interface CancelPageData {
  token: string;
  title: string;
  organiserFirstName: string;
  amountPence: number;
}

export function renderCancelPage(template: string, d: CancelPageData): string {
  const token = escapeHtml(d.token);
  const lede = `That's okay, these things happen. Cancelling means we won't email you about your pledge for ${d.title} again.`;
  const body =
    '<div class="card card-lg fr-panel pl-panel">' +
    '<form class="fr-form fr-form--plain pl-cancel" method="post" action="/pledge/cancel">' +
    `<input type="hidden" name="t" value="${token}" />` +
    `<p>${escapeHtml(d.organiserFirstName)} will see that the pledge was cancelled, and nothing else. No money has been taken.</p>` +
    '<div class="give-cta-row">' +
    `<button class="btn btn-primary give-cta" type="submit">Cancel my ${pounds(d.amountPence)} pledge</button>` +
    "</div>" +
    "</form>" +
    `<p class="pl-aside">Changed your mind? <a href="/pledge/pay?t=${token}">Pay your pledge instead</a>.</p>` +
    "</div>";
  return page(template, "Cancel your pledge", intro("Sponsor pledge", "Can't pay your pledge after all?", lede), body);
}

export interface ConfirmPageData {
  token: string;
  title: string;
  organiserFirstName: string;
  amountPence: number;
}

/**
 * The page the confirm email's button opens. It only asks: pressing the button here (a POST) is what
 * confirms the pledge, so a mail scanner opening the link confirms nothing.
 */
export function renderConfirmPage(template: string, d: ConfirmPageData): string {
  const who = escapeHtml(d.organiserFirstName);
  const lede = `You pledged ${pounds(d.amountPence)} to sponsor ${d.organiserFirstName} for ${d.title}. Press the button to confirm it was you.`;
  const body =
    '<div class="card card-lg fr-panel pl-panel">' +
    '<form class="fr-form fr-form--plain pl-confirm" method="post" action="/pledge/confirm">' +
    `<input type="hidden" name="t" value="${escapeHtml(d.token)}" />` +
    '<div class="give-cta-row">' +
    `<button class="btn btn-primary give-cta" type="submit">Confirm my ${pounds(d.amountPence)} pledge</button>` +
    "</div>" +
    "</form>" +
    `<p class="pl-aside">There is nothing to pay today. We will email you a link to pay once ${who} has finished.</p>` +
    `<p class="pl-aside">Not you? You don't need to do anything. A pledge that isn't confirmed is deleted after ${CONFIRM_DAYS} days.</p>` +
    "</div>";
  return page(template, "Confirm your pledge", intro("Sponsor pledge", "Confirm your pledge", lede), body);
}

export interface NoticeData {
  heading: string;
  body: string[];
  link?: { href: string; label: string };
}

export function renderPledgeNotice(template: string, d: NoticeData): string {
  const body =
    '<div class="card card-lg fr-panel pl-panel pl-notice">' +
    d.body.map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
    (d.link ? `<div class="give-cta-row"><a class="btn btn-primary" href="${escapeHtml(d.link.href)}">${escapeHtml(d.link.label)}</a></div>` : "") +
    "</div>";
  return page(template, d.heading, intro("Sponsor pledge", d.heading, ""), body);
}
