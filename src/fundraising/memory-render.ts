import { escapeHtml } from "../events/render";
import type { PublicPage, WallEntry } from "./model";
import {
  CHECKOUT_MARKER,
  EMBEDDED_CHECKOUT,
  INTRO_MARKER,
  PAGE_MARKER,
  WALL_FIRST,
  paragraphs,
  renderGiveForm,
  renderMeter,
  renderNews,
  renderWallItem,
  shareLinks,
  shorten,
  type FundraiserPageOptions,
} from "./render";

// In memory pages (Jaimie, 2026-10-03): a page in memory of someone, drawn on the server like every
// fundraiser's page (src/fundraising/render.ts), but quieter:
//
//   - "In memory of <name>" with the dates under it, and their photo if staff have added one;
//   - soft colours (fundraising.css, .fr-memory-page): the house palette at a lower contrast, with
//     no festive banner, no countdown, no "Good luck", no confetti;
//   - what has been given, and the target and how close it is only if the family chose to show them
//     (the meter arrives with them hidden otherwise: memoryMeter in ./in-memory.ts);
//   - giving works exactly as on every page, Gift Aid and all (the same give form and checkout);
//   - every message waits for staff before it shows, and the page says so; after giving, a giver may
//     tick "Let the family know I gave" (unticked unless they tick it).
//
// Pure, like ./render.ts: no database, no config, no clock. Everything typed is escaped on the way out.
// The ids and data marks the page's script (assets/js/fundraiser.js) looks for are the same as on
// every page, so giving, the wall and the step after paying work unchanged.

const PERSON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';

function nameOf(p: PublicPage): string {
  return p.memory?.name ?? p.title;
}

function renderMemoryIntro(p: PublicPage): string {
  const name = escapeHtml(nameOf(p));
  return (
    '<span class="eyebrow">In memory</span>' +
    `<h1 id="fr-title">In memory of ${name}</h1>` +
    (p.memory?.dates ? `<p class="fr-memory__dates">${escapeHtml(p.memory.dates)}</p>` : "") +
    '<div class="rule"><i></i></div>' +
    `<ul class="fr-facts"><li>${PERSON}<span>Set up by ${escapeHtml(p.organisedBy)}</span></li></ul>`
  );
}

/** After giving: a message for the page (staff read it first), the wall choices, and the family tick. */
function renderMemoryWallStep(p: PublicPage, sessionId: string): string {
  return (
    `<section class="fr-after" data-wall-step data-slug="${escapeHtml(p.slug)}" data-session-id="${escapeHtml(sessionId)}" aria-labelledby="fr-after-heading" hidden>` +
    '<h3 class="fr-after__title" id="fr-after-heading">Leave a message <span class="give-optional">(optional)</span></h3>' +
    "<p>Only if you would like to. Our team reads every message before it goes on the page.</p>" +
    '<form id="frWallForm" class="fr-after__form" novalidate>' +
    '<p class="form-error-summary" role="alert" data-wall-error hidden></p>' +
    '<div class="give-field"><label for="frMessage">Your message <span class="give-optional">(optional)</span></label>' +
    '<textarea class="give-field-input fr-message" id="frMessage" name="frMessage" rows="3" maxlength="200" aria-describedby="frMessageCount"></textarea>' +
    '<p class="give-field-help" id="frMessageCount" data-message-count>Up to 200 characters.</p></div>' +
    '<div class="give-donor-options fr-choice" role="radiogroup" aria-label="Your name on the page">' +
    '<label class="give-donor-option" for="frShowNameYes"><input id="frShowNameYes" name="frShowName" type="radio" value="yes" checked />Show my name</label>' +
    '<label class="give-donor-option" for="frShowNameNo"><input id="frShowNameNo" name="frShowName" type="radio" value="no" />Stay anonymous</label>' +
    "</div>" +
    '<p class="give-field-help">We show your first name and the first letter of your surname, like Robin T.</p>' +
    // Review fix: unticked here, so how much someone gave stays private unless they choose otherwise.
    '<label class="give-check" for="frShowAmount"><input class="give-check-box" id="frShowAmount" name="frShowAmount" type="checkbox" />' +
    '<span class="give-check-text">Show how much I gave</span></label>' +
    '<label class="give-check fr-family-check" for="frFamilyNotify"><input class="give-check-box" id="frFamilyNotify" name="frFamilyNotify" type="checkbox" aria-describedby="frFamilyNotifyHelp" />' +
    '<span class="give-check-text"><strong>Let the family know I gave</strong></span></label>' +
    '<p class="give-field-help" id="frFamilyNotifyHelp">We will share your name and your message with the family, through the person who set up this page, but never how much you gave or your email address. If you tick this, we won’t show how much you gave on the page.</p>' +
    '<div class="fr-after__actions">' +
    '<button class="btn btn-primary" type="submit" data-wall-submit>Add to the wall</button>' +
    '<button class="btn btn-ghost fr-after__skip" type="button" data-wall-skip>No thanks</button>' +
    "</div>" +
    "</form>" +
    "</section>"
  );
}

function renderMemoryThanks(p: PublicPage, pageUrl: string, thanks: NonNullable<FundraiserPageOptions["thanks"]>): string {
  const name = escapeHtml(nameOf(p));
  const lead = thanks.added
    ? "<p>Thank you. Our team will read your message, and it will show on the page soon.</p>"
    : "<p>Your gift will show on the page shortly.</p>";
  return (
    '<div class="fr-thanks-panel" data-thanks-panel data-copy-scope tabindex="-1">' +
    `<h2>Thank you for your gift in memory of ${name}.</h2>` +
    lead +
    (thanks.sessionId && !thanks.added ? renderMemoryWallStep(p, thanks.sessionId) : "") +
    "<p>If you would like to, you can share the page with others who knew them.</p>" +
    shareLinks(p, pageUrl, `In memory of ${nameOf(p)}, giving to the Night Before Christmas Campaign (NBCC): ${pageUrl}`) +
    '<p class="fr-share__status" role="status" aria-live="polite" data-copy-status></p>' +
    "</div>"
  );
}

function renderMemoryFinished(p: PublicPage): string {
  return (
    '<div class="fr-finished">' +
    '<h2 class="fr-finished__title">Thank you</h2>' +
    `<p>Thank you to everyone who gave in memory of ${escapeHtml(nameOf(p))}. <a href="#give">You can still give</a>.</p>` +
    "</div>"
  );
}

const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

/** A gift on the wall, dated by its day only (review fix), never "5 minutes ago". */
function renderMemoryWallItem(w: WallEntry, i: number): string {
  const day = w.createdAt.slice(0, 10);
  const when = `<p class="fr-wall__when"><time datetime="${escapeHtml(day)}">${DAY.format(new Date(`${day}T12:00:00Z`))}</time></p>`;
  return renderWallItem(w, i, new Date(0)).replace(/<p class="fr-wall__when">.*?<\/p>/, () => when);
}

function renderMemoryWall(p: PublicPage): string {
  const count = p.wall.length;
  const body = count
    ? `<ol class="fr-wall__list" role="list" data-wall>${p.wall.map((w, i) => renderMemoryWallItem(w, i)).join("")}</ol>` +
      (count > WALL_FIRST ? `<button class="fr-wall__more" type="button" data-wall-show-all hidden>Show all ${count}</button>` : "")
    : '<p class="fr-wall__empty">No gifts yet.</p>';
  return (
    '<section class="fr-wall" aria-labelledby="fr-wall-heading">' +
    '<h2 id="fr-wall-heading">Gifts and messages</h2>' +
    (count ? `<p class="fr-wall__count">${count === 1 ? "1 person has" : `${count} people have`} given, newest first.</p>` : "") +
    body +
    '<p class="fr-wall__note">Our team reads every message before it shows here.</p>' +
    "</section>"
  );
}

function renderMemoryShare(p: PublicPage, pageUrl: string): string {
  const shown = pageUrl.replace(/^https?:\/\//, "");
  return (
    '<section class="card fr-card fr-share" aria-labelledby="fr-share-heading" data-copy-scope>' +
    '<h2 id="fr-share-heading">Share this page</h2>' +
    "<p>With family and friends who may like to give in their memory.</p>" +
    shareLinks(p, pageUrl, `In memory of ${nameOf(p)}, giving to the Night Before Christmas Campaign (NBCC): ${pageUrl}`) +
    `<p class="fr-share__url"><span class="sr-only">The page address: </span>${escapeHtml(shown)}</p>` +
    '<p class="fr-share__status" role="status" aria-live="polite" data-copy-status></p>' +
    "</section>"
  );
}

/** The page in memory of someone: the template's head filled in, and the page where its markers are. */
export function renderMemoryPage(template: string, p: PublicPage, opts: FundraiserPageOptions): string {
  const origin = (() => {
    try {
      return new URL(opts.pageUrl).origin;
    } catch {
      return "";
    }
  })();
  const name = nameOf(p);
  const safe = escapeHtml(name);
  const title = `In memory of ${name}`;
  const description = `Give in memory of ${name}. ${shorten(p.description, 140)}`;
  const image = p.imageSrc ? `${origin}${p.imageSrc}` : "https://nbcc.scot/assets/img/og-image.png";
  const intro =
    renderMemoryIntro(p) +
    (p.finished ? renderMemoryFinished(p) : "") +
    (opts.thanks ? renderMemoryThanks(p, opts.pageUrl, opts.thanks) : "");
  const split = p.split ? " Everything given on this page goes to NBCC, as NBCC's share." : "";
  const body =
    '<div class="card card-lg fr-summary">' +
    '<h2 class="sr-only">Given so far</h2>' +
    renderMeter(p.meter, { large: true }) +
    (p.split ? `<p class="fr-split">${escapeHtml(p.split.statement)}</p>` : "") +
    '<a class="btn btn-primary fr-summary__give" href="#give">Give in their memory</a>' +
    "</div>" +
    '<div class="fr-main">' +
    (p.imageSrc
      ? `<figure class="fr-memory__photo"><img src="${escapeHtml(p.imageSrc)}" alt="${escapeHtml(`A photo of ${name}`)}" decoding="async" /></figure>`
      : "") +
    '<section class="fr-story" aria-labelledby="fr-story-heading">' +
    `<h2 id="fr-story-heading">Remembering ${safe}</h2>` +
    paragraphs(p.description) +
    "</section>" +
    renderNews(p) +
    renderGiveForm(p, { heading: `Give in memory of ${name}`, sub: `Your gift goes to NBCC, in their memory.${split}` }) +
    renderMemoryWall(p) +
    "</div>" +
    `<div class="fr-extras">${renderMemoryShare(p, opts.pageUrl)}</div>`;

  const fill: Record<string, string> = {
    __TITLE__: escapeHtml(title),
    __DESCRIPTION__: escapeHtml(description),
    __PAGE_URL__: escapeHtml(opts.pageUrl),
    __OG_IMAGE__: escapeHtml(image),
  };
  return template
    .replace(/__(TITLE|DESCRIPTION|PAGE_URL|OG_IMAGE)__/g, (token) => fill[token])
    .replace('<main class="site-main"', '<main class="site-main fr-memory-page"')
    .replace(INTRO_MARKER, () => intro)
    .replace(PAGE_MARKER, () => body)
    .replace(CHECKOUT_MARKER, () => EMBEDDED_CHECKOUT);
}
