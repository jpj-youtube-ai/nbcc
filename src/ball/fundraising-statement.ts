import { OSCR_REGISTER_URL, REGISTRATION_LINES } from "../legal/registration";

// TASK-347: the two statements Appendix A of the NBCC / Designer Rooms fundraising agreement
// requires, held in one place because the agreement requires them VERBATIM.
//
// A2 says the wording "must be used as set out below", and clause 11.1 makes three of its parts
// mandatory: that the event is organised by The Designer Rooms in aid of the Charity, that the
// Company receives no payment for organising it, and how the amount reaching the Charity is
// determined. Before this, none of those three sentences appeared anywhere on the site, in the
// ticket terms, in the confirmation email or on the thank-you page.
//
// Warmer copy is not a substitute and is not forbidden either: the agreed sentence does the
// legal work, and NBCC's own paragraph sits beneath it doing the human work.

/**
 * Appendix A2 — required on all promotional material and BEFORE a ticket is bought.
 * Verbatim. Do not reword, reorder or split.
 */
export const FUNDRAISING_STATEMENT =
  "Organised and sponsored by The Designer Rooms in aid of NBCC. " +
  "The Designer Rooms is covering the full cost of the evening, so all proceeds from ticket " +
  "sales are donated to the charity. The Designer Rooms receives no payment for organising " +
  "this event.";

/**
 * Appendix A1 — required on all printed and online material and at the point tickets are bought.
 * Built from the existing single source of truth rather than retyped.
 */
export const CHARITY_STATEMENT = REGISTRATION_LINES.join(" ");

/**
 * A1, for the web. The agreement is specific: "Online, the charity number links to the Charity's
 * entry on the Scottish Charity Register." In print the same wording is plain text.
 */
export const CHARITY_STATEMENT_HTML =
  `${REGISTRATION_LINES[0]} Scottish Charity Number ` +
  `<a href="${OSCR_REGISTER_URL}" target="_blank" rel="noopener">SC047995</a>. ` +
  "Regulated by the Scottish Charity Regulator, OSCR.";
