import { redBag } from "./catalogue";
import { redBagList, type RedBagList } from "./list";
import { renderRedBagListData } from "./render";
import { DRIFT, renderLights } from "./scene";
import { redBagIsLive } from "./switch";

// Fill a Red Bag, on its own stage: the night sky, ten fairy lights, the big bag, the tiles, the elf,
// and the snow it all stands in. It goes on the home page and Get involved from the Ball's moment
// (src/site/after-ball.ts); before that not one byte of it is sent.
//
// This file draws the band. assets/js/red-bag-stage.js makes it work: it reads the same list the
// block of data here carries, the one /fill uses, so a price here is always the price on the real
// page, and it chooses the tiles from that list. Without the script the band still reads, and its
// main button is still a link to /fill. Its styles and script are files of their own, loaded only by
// a page that draws it, so no budgeted page pays for them.
//
// Pure, except for loadFillStage, which fetches the list and never throws.

/** Its styles, in the head of a page that draws it. */
export const STAGE_STYLES = '<link rel="stylesheet" href="/assets/css/red-bag-stage.css" />';

/** The home page's four tags: the stage goes straight before them. */
const HOME_ANCHOR = '<section class="home-lane"';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// The bag is the site's own drawing, split so things can sit inside it: the back, then what is in the
// bag, then the front. Its colours are the drawing's, not the stylesheet's.
const BAG_BACK =
  '<svg class="fb-back" viewBox="0 0 120 132" aria-hidden="true" focusable="false">' +
  '<path fill="none" stroke="#a31a2e" stroke-width="3" stroke-linecap="round" d="M44 36C44 10 88 10 88 36"/>' +
  '<path fill="#FFFDFA" stroke="#E9DFD2" d="M22 38l9-13 8 9 9-14 9 13 9-12 8 11 9-9 7 15z"/></svg>';

const BAG_FRONT =
  '<svg class="fb-front" viewBox="0 0 120 132" aria-hidden="true" focusable="false">' +
  '<defs><linearGradient id="fbPaper" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b81e34"/><stop offset=".38" stop-color="#d42a43"/><stop offset="1" stop-color="#C02238"/></linearGradient></defs>' +
  '<path fill="url(#fbPaper)" d="M12 36h96v88a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z"/>' +
  '<path fill="#a31a2e" d="M92 36h16v88a4 4 0 0 1-4 4H92z"/>' +
  '<path fill="#a31a2e" d="M12 36h96v10H12z"/>' +
  '<path fill="none" stroke="#8a1626" stroke-width=".8" d="M12 46h96M92 46v82"/>' +
  '<path fill="none" stroke="#a31a2e" stroke-width="3" stroke-linecap="round" d="M32 40C32 12 76 12 76 40"/>' +
  '<circle fill="#E8C4B4" cx="32" cy="41" r="2.2"/><circle fill="#E8C4B4" cx="76" cy="41" r="2.2"/>' +
  '<g class="fb-tie">' +
  '<g class="fb-tag"><path fill="none" stroke="#B8862B" stroke-width="1.4" d="M60 20c-3 9 3 21 0 31"/>' +
  '<path fill="#FFFDFA" d="M41 44h38l11 11v35a4 4 0 0 1-4 4H34a4 4 0 0 1-4-4V55z"/>' +
  '<circle fill="#C02238" cx="60" cy="51.5" r="2.6"/>' +
  '<text x="60" y="72" text-anchor="middle" font-family="Caveat,cursive" font-size="15" font-weight="700" fill="#800000">Packed</text>' +
  '<text x="60" y="86" text-anchor="middle" font-family="Caveat,cursive" font-size="15" font-weight="700" fill="#800000">with love</text></g>' +
  '<g class="fb-bow" fill="#D9A93E"><path d="M57.5 20l-8 12 5.5-.5 2 4.5 3.5-15zM62.5 20l8 12-5.5-.5-2 4.5-3.5-15z"/>' +
  '<path d="M60 18c-5-8-17-9-17-1s12 6 17 1zM60 18c5-8 17-9 17-1s-12 6-17 1z"/>' +
  '<rect fill="#B8862B" x="56" y="14" width="8" height="8" rx="2.5"/></g></g></svg>';

/**
 * The band, with its block of data and its two scripts. `list` is the list published last; null
 * while there is none, when the catalogue's own list stands, exactly as on /fill. The tiles are
 * drawn by the script, which knows them from the same list.
 */
export function renderFillStage(list: RedBagList | null): string {
  const rb = redBag();
  const data = list ? renderRedBagListData(redBagList().toCatalogue(list)) : "";
  return (
    '<section class="fb" id="fillBand" aria-labelledby="fbTitle">' +
    '<div class="fb-night" id="fbNight">' +
    '<canvas class="fb-sky" aria-hidden="true"></canvas>' +
    renderLights() +
    `<div class="fb-topedge">${DRIFT}</div>` +
    '<div class="wrap fb-grid">' +
    '<div class="fb-head">' +
    '<span class="eyebrow on-dark">A new way to give</span>' +
    '<h2 id="fbTitle">Fill a<br /> <span class="fb-under">Red Bag<svg viewBox="0 0 300 18" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path pathLength="1" d="M4 12C60 3 120 15 176 8s86-3 120 2"/></svg></span></h2>' +
    `<p class="fb-lede">Pop a few things in the bag and watch it fill. Your donation could help NBCC bring comfort, dignity and joy to ${escapeHtml(rb.WORDS.audience)}, all year round.</p>` +
    "</div>" +
    '<div class="fb-stage" id="fbStage">' +
    '<div class="fb-glow" aria-hidden="true"></div>' +
    '<div class="fb-bag" id="fbBag"><div class="fb-wob" id="fbWob">' +
    BAG_BACK +
    '<div class="fb-peeks" id="fbPeeks" aria-hidden="true"></div>' +
    BAG_FRONT +
    `<p class="fb-sum" aria-hidden="true"><b id="fbSum">${rb.pounds(0)}</b><span>of ${rb.pounds(rb.BAG_VALUE_PENCE)}</span></p>` +
    "</div></div>" +
    '<img class="fb-elf" id="fbElf" src="/assets/img/nbcc-elf.png" alt="" width="150" height="98" loading="lazy" decoding="async" />' +
    '<p class="fb-note hand" id="fbNote" aria-hidden="true"></p>' +
    '<div class="fb-mound" aria-hidden="true"></div>' +
    "</div>" +
    '<div class="fb-play">' +
    '<p class="fb-try hand" hidden>Go on, tap something.</p>' +
    '<div class="fb-tiles" id="fbTiles" role="group" aria-label="Pop something in the bag"></div>' +
    "</div>" +
    "</div>" +
    DRIFT +
    '<svg class="fb-hill" viewBox="0 0 700 110" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path fill="currentColor" d="M0 110C90 104 150 66 262 34S430 8 520 18s130 4 180 2v90z"/></svg>' +
    "</div>" +
    '<div class="fb-ground"><div class="wrap fb-ground-grid">' +
    '<div class="fb-said">' +
    `<p class="fb-status" id="fbStatus" role="status" aria-live="off">${escapeHtml(rb.WORDS.empty)}</p>` +
    `<p class="fb-elves">${escapeHtml(rb.WORDS.elves)}</p>` +
    "</div>" +
    '<div class="fb-acts">' +
    '<a class="btn btn-primary fb-cta" id="fbGo" href="/fill">Fill a Red Bag</a>' +
    '<button class="fb-link" id="fbAgain" type="button" hidden>Start again</button>' +
    '<button class="fb-link" id="fbPause" type="button" hidden>Pause</button>' +
    "</div>" +
    "</div></div>" +
    "</section>" +
    data +
    '<script defer src="/assets/js/red-bag-catalogue.js"></script>' +
    '<script defer src="/assets/js/red-bag-stage.js"></script>'
  );
}

/** The stage's styles, for the head of a page that draws it. Safe to run twice. */
export function addFillStageStyles(html: string): string {
  if (html.includes(STAGE_STYLES)) return html;
  return html.replace("</head>", () => `${STAGE_STYLES}\n  </head>`);
}

/**
 * The home page with the stage, between the hero and the four tags, as the page goes out: the file
 * does not change. No stage (it was left out), or no place for it: the page as it came.
 */
export function addFillStageToHome(html: string, stage: string): string {
  if (!stage) return html;
  const at = html.indexOf(HOME_ANCHOR);
  if (at === -1) return html;
  return addFillStageStyles(`${html.slice(0, at)}${stage}\n\n      ${html.slice(at)}`);
}

/**
 * The stage for a page going out now, or "" to leave it out: while Fill a Red Bag is switched off, as
 * /fill is then a 404, and if anything at all goes wrong. It is only a part of the page, so a failure
 * here must never take a page down. The list is the one /fill reads, through the read that never
 * throws and never waits long.
 */
export async function loadFillStage(): Promise<string> {
  try {
    if (!redBagIsLive()) return "";
    const { loadPublishedRedBagList } = await import("../db/red-bag-lists");
    return renderFillStage(await loadPublishedRedBagList());
  } catch (err) {
    console.error("fill a red bag stage left out:", err instanceof Error ? err.message : err);
    return "";
  }
}
