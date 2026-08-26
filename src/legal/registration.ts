// TASK-126: the single source of truth for NBCC's charity-registration statement.
// The exact, verbatim wording that must appear in every page footer and every
// donor-facing receipt / thank-you letter. Pure, DB-free, no clock — like
// src/declarations/wording.ts. All other modules import from here; none re-declare
// the wording.

export const CHARITY_NAME = "Night Before Christmas Campaign";
export const CHARITY_SHORT_NAME = "NBCC";
export const OSCR_NUMBER = "SC047995";

// The OSCR public-register deep link for NBCC, reused by the page footer's link.
export const OSCR_REGISTER_URL =
  "https://www.oscr.org.uk/about-charities/search-the-register/charity-details?number=SC047995";

// TASK-293: the registered postal address. Microsoft and the other big filters look for a real
// address in bulk email - its absence is a small but real spam signal, and every legitimate charity
// newsletter carries one. Declared here with the rest of the registration details so the site
// footer, the newsletter frame and the thank-you letter cannot drift apart.
export const POSTAL_ADDRESS_LINES: readonly string[] = [
  "The Elves Workshop",
  "Annbank Village Hall",
  "Weston Avenue",
  "Annbank",
  "KA6 5EE",
];

/** One line, comma-separated - how it reads in a footer. */
export const POSTAL_ADDRESS = POSTAL_ADDRESS_LINES.join(", ");

// The two exact mandated lines (verbatim — do not reword).
export const REGISTRATION_LINES: readonly [string, string] = [
  `${CHARITY_NAME}, known as ${CHARITY_SHORT_NAME}, is a Scottish Charitable Incorporated Organisation.`,
  `Scottish Charity Number ${OSCR_NUMBER}. Regulated by the Scottish Charity Regulator, OSCR.`,
];

// Plain-text form (letters / receipt text renderings). The registration statement ALONE — see
// FOOTER_TEXT below for the block an email puts at the bottom.
export const REGISTRATION_TEXT = REGISTRATION_LINES.join("\n");

// HTML form (email / receipt html renderings). Content is static and known-safe
// (no user input), so no escaping is needed here.
export const REGISTRATION_HTML = `<p class="charity-registration">${REGISTRATION_LINES[0]}<br />${REGISTRATION_LINES[1]}</p>`;

// TASK-293: what a donor-facing EMAIL puts at the bottom - the registration statement plus the
// registered postal address. Kept separate from REGISTRATION_* so those keep meaning the mandated
// statement on its own: a constant called REGISTRATION_TEXT that quietly contains an address would
// be a name that lies, and the next person to reuse it would carry the address somewhere it does
// not belong.
export const FOOTER_TEXT = [...REGISTRATION_LINES, POSTAL_ADDRESS].join("\n");

export const FOOTER_HTML = `<p class="charity-registration">${REGISTRATION_LINES[0]}<br />${REGISTRATION_LINES[1]}<br />${POSTAL_ADDRESS}</p>`;
