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

// The two exact mandated lines (verbatim — do not reword).
export const REGISTRATION_LINES: readonly [string, string] = [
  `${CHARITY_NAME}, known as ${CHARITY_SHORT_NAME}, is a Scottish Charitable Incorporated Organisation.`,
  `Scottish Charity Number ${OSCR_NUMBER}. Regulated by the Scottish Charity Regulator, OSCR.`,
];

// Plain-text form (letters / receipt text renderings).
export const REGISTRATION_TEXT = REGISTRATION_LINES.join("\n");

// HTML form (email / receipt html renderings). Content is static and known-safe
// (no user input), so no escaping is needed here.
export const REGISTRATION_HTML = `<p class="charity-registration">${REGISTRATION_LINES[0]}<br />${REGISTRATION_LINES[1]}</p>`;
