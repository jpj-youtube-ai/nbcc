import { SCHOOL_LOGO_SRC } from "./logo";

// NBCC Elf Detective School: the card that sends people to the school (/elf) from the home page,
// Get involved and Your school (Jaimie, 9 November 2026: nothing on the site linked to the school).
// It is drawn only while the school is switched on (elf_settings.school_on). Switched off, each page
// goes out exactly as it would without it: not one byte of the card, and no link to /elf, because
// every /elf page is a 404 then. The lever in Head Elf HQ is read on every page view, so the card
// comes and goes with it, with no deploy. The private preview link does not show it: only the switch.
//
// Its styles are a file of their own (assets/css/elf-promo.css), loaded only by a page that draws the
// card, so no page with a weight budget pays for it while the school is off.
//
// Pure, except for elfSchoolIsOn, which reads the switch and never throws.

export type ElfCardPage = "home" | "get-involved" | "schools";

/** The card's styles, for the head of a page that draws it. */
export const ELF_CARD_STYLES = '<link rel="stylesheet" href="/assets/css/elf-promo.css" />';

/**
 * Where the card goes: straight before this, which each page's file has exactly once. On the home
 * page that is the four ways to start, the same place Fill a Red Bag's stage goes before; added after
 * the stage, the card sits between the two. On Get involved, before "Coming as a business, school or
 * group?", so it follows the events and Fill a Red Bag. On Your school, before the form.
 */
export const ELF_CARD_ANCHORS: Readonly<Record<ElfCardPage, string>> = Object.freeze({
  home: '<section class="home-lane"',
  "get-involved": '<section class="band band-holly together-band"',
  schools: '<section class="tellus" id="tell-us"',
});

const CARD_ID = 'id="elfCard"';

// Only Your school has a line of its own: a school writing to its families needs the short address.
const SCHOOL_LINE = '<p class="elfp-small">Telling families at your school? Send them to <b>nbcc.scot/elf</b></p>';

/** The card for one of the three pages. */
export function renderElfCard(page: ElfCardPage): string {
  return (
    `<section class="elfp" ${CARD_ID} aria-labelledby="elfCardTitle">` +
    '<div class="wrap"><div class="elfp-note">' +
    '<span class="elfp-tape" aria-hidden="true"></span>' +
    // The logo spells out the school's name, which the words beside it say too.
    `<img class="elfp-logo" src="${SCHOOL_LOGO_SRC}" alt="" width="640" height="640" loading="lazy" decoding="async" />` +
    '<div class="elfp-words">' +
    '<p class="eyebrow">New this Christmas</p>' +
    // The building's name keeps its straight apostrophe everywhere (test/unit/elves-workshop-name.test.ts).
    "<h2 id=\"elfCardTitle\">24 cheeky elves have escaped from the Elves' Workshop</h2>" +
    '<p class="elfp-text">Join Elf Detective School, crack the clues and find them all by the Night Before Christmas.</p>' +
    (page === "schools" ? SCHOOL_LINE : "") +
    "</div>" +
    '<p class="elfp-go"><a class="btn btn-primary" href="/elf">Find out more<span class="sr-only"> about Elf Detective School</span></a></p>' +
    "</div></div>" +
    "</section>"
  );
}

/**
 * The page with the card, as it goes out: the file does not change. While the school is off (`on`
 * false), the page exactly as it came. A page that already has the card, or has no place for it, is
 * also left as it came, styles and all.
 */
export function addElfCard(html: string, page: ElfCardPage, on: boolean): string {
  if (!on || html.includes(CARD_ID)) return html;
  const at = html.indexOf(ELF_CARD_ANCHORS[page]);
  if (at === -1) return html;
  const out = `${html.slice(0, at)}${renderElfCard(page)}\n\n      ${html.slice(at)}`;
  return out.includes(ELF_CARD_STYLES) ? out : out.replace("</head>", () => `${ELF_CARD_STYLES}\n  </head>`);
}

/**
 * Is the school switched on? Read fresh for every page view, like the Ball's gate, so the lever takes
 * effect on the very next one. Anything that goes wrong reads as off: a failed read must never put a
 * link to a page that is not there on the front page.
 */
export async function elfSchoolIsOn(): Promise<boolean> {
  try {
    const { getElfSettings } = await import("../db/elf");
    return (await getElfSettings()).schoolOn === true;
  } catch {
    return false;
  }
}
