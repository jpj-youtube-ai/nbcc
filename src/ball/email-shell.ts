import { emailShell, MAROON, SLATE_SOFT, TAN_SOFT, CREAM, HEAD, BODY_FONT } from "../email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { FUNDRAISING_STATEMENT } from "./fundraising-statement";

// The frame every Festive Ball email shares. Five emails go out for this event (confirmation,
// the week-to-go reminder, the guest-list read-back, the chase and the last call) and until now
// each carried its own hand-written wrapper: a bare cream div in system-ui type, no NBCC
// letterhead, no sponsor, and the contact details buried in one small grey line at the bottom.
//
// Three things this fixes, all of them asked for:
//
//  * The emails now wear the same shell as the donation receipt and the thank-you letter, so a
//    supporter who has had one recognises the other.
//  * The Designer Rooms appears on every one. They are paying for the entire evening, and
//    clause 11.1 requires the credit wherever the event is promoted; five emails to every buyer
//    is unambiguously promoting it.
//  * The phone number and events@nbcc.scot are prominent rather than findable, in the body AND
//    in the footer bar of every email.
//
// Pure: no pool, no config, no clock, so all five stay unit-testable without a database.

/** The ball's own inbox. Deliberately NOT the giving address: a question about a nut allergy
 *  should not land in the donations queue. */
export const BALL_EMAIL = "events@nbcc.scot";
export const BALL_PHONE = "01292 811 015";

const DESIGNER_ROOMS = {
  label: "Event organised and sponsored by",
  name: "The Designer Rooms",
  // The cream wordmark, because the sponsor band sits on the maroon ground, exactly as it does
  // at the foot of the ball pages.
  logoUrl: "https://nbcc.scot/assets/img/the-designer-rooms-cream.png",
  href: "https://thedesignerrooms.com/",
  width: 190,
  // Appendix A2, verbatim, from the one place it is declared.
  statement: FUNDRAISING_STATEMENT,
};

/** Wrap a ball email body in the NBCC shell, with the sponsor band and the ball's contacts. */
export function ballEmailShell(bodyHtml: string): string {
  return emailShell(bodyHtml, {
    contactEmail: BALL_EMAIL,
    registration: true,
    postalAddress: POSTAL_ADDRESS,
    sponsor: DESIGNER_ROOMS,
  });
}

/**
 * The "talk to a person" block. Asked for directly: these details were a line of grey small
 * print at the bottom, and someone worried about a wheelchair space or a coeliac guest should
 * not have to hunt for them. Tan panel, maroon heading, both details at reading size.
 */
export function contactPanel(lead = "Any questions at all?"): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${TAN_SOFT};border-radius:10px;margin:24px 0">
    <tr><td style="padding:18px 20px;text-align:center">
      <div style="font-family:${HEAD};color:${MAROON};font-size:17px;font-weight:700;margin:0 0 8px">${lead}</div>
      <div style="font-family:${BODY_FONT};font-size:16px;font-weight:700;line-height:1.5"><a href="tel:+441292811015" style="color:${MAROON};text-decoration:none">${BALL_PHONE}</a><br /><a href="mailto:${BALL_EMAIL}" style="color:${MAROON};text-decoration:underline">${BALL_EMAIL}</a></div>
      <div style="font-family:${BODY_FONT};color:${SLATE_SOFT};font-size:12px;margin-top:8px">Monday to Friday. A real person reads every one.</div>
    </td></tr>
  </table>`;
}

/** A quiet rule between sections of a long email. */
export const divider = (): string =>
  `<div style="border-top:1px solid ${TAN_SOFT};margin:26px 0 0"></div>`;

/** The cream inner card used for the facts a reader comes back to find. */
export const factsCard = (rows: string): string =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${CREAM};border:1px solid ${TAN_SOFT};border-radius:10px;margin:0 0 20px">${rows}</table>`;

/**
 * What every ball email ends with in the PLAIN TEXT part: how to reach a human, the sponsor
 * credit the agreement requires, then the charity registration and the registered postal
 * address. The address is not decoration; Microsoft and the other large filters read its absence
 * as a small spam signal, and these are the emails that were landing in junk.
 */
export const BALL_TEXT_FOOTER = `Any questions at all? Call ${BALL_PHONE} or email ${BALL_EMAIL},
Monday to Friday. A real person reads every one.

Organised and sponsored by The Designer Rooms in aid of NBCC. The Designer Rooms is
covering the full cost of the evening, so all proceeds from ticket sales are donated
to the charity. The Designer Rooms receives no payment for organising this event.

${BALL_PHONE} · ${BALL_EMAIL} · nbcc.scot
${FOOTER_TEXT}`;
