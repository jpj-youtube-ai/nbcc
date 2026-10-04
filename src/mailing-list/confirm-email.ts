import { bodyP, button, emailShell, heading, note, signOff, signOffText } from "../email/brand";
import { safeFirstName } from "../fundraising/emails";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { LINK_DAYS, WHO_WE_ARE_SHORT } from "./model";

// Joining the mailing list from the /newsletter page: the one email, asking the person to confirm.
//
// It is NOT a newsletter. It is a short reply to something the person has just done on the site, so
// it goes like every other email of that sort: from the main nbcc.scot address, never from the
// newsletter's own sending address (news.nbcc.scot). See sendNewsletterSignupConfirm in
// src/clients/email.ts.
//
// Fixed words, bar one plain first name: anyone can type any address into the public form, so this
// email carries nothing else they typed. The first name is one word of letters at most
// (safeFirstName), so it can never be a link or a message. Pure: no config, no clock.

/** The address in the footer bar: the general enquiries inbox, as on the contact page. */
export const SIGNUP_CONTACT_EMAIL = "info@nbcc.scot";

export const SIGNUP_CONFIRM_SUBJECT = "One more step to join the NBCC mailing list";
const BUTTON = "Yes, add me to the mailing list";
const ASK = "Thank you for asking to join our mailing list. Please press the button to confirm it was you.";
const WHAT = `We'll send you occasional news about the difference your support makes and what is coming up, and you can unsubscribe at any time. The link works for ${LINK_DAYS} days.`;
const NOT_YOU = "If you didn't ask for this, you can ignore this email and nothing will happen.";
const CLOSE = "With thanks,";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export function buildSignupConfirmEmail(d: { firstName: string; confirmUrl: string }): { subject: string; html: string; text: string } {
  const first = safeFirstName(d.firstName);
  const hello = first ? `Hello ${first},` : "Hello,";
  const html = emailShell(
    heading("One more step") +
      bodyP(esc(hello)) +
      bodyP(esc(ASK)) +
      button(d.confirmUrl, BUTTON) +
      bodyP(esc(WHAT)) +
      bodyP(esc(WHO_WE_ARE_SHORT)) +
      note(esc(NOT_YOU)) +
      signOff(CLOSE),
    { contactEmail: SIGNUP_CONTACT_EMAIL, registration: true, postalAddress: POSTAL_ADDRESS },
  );
  const text = [
    "One more step",
    "",
    hello,
    "",
    ASK,
    "",
    `${BUTTON}: ${d.confirmUrl}`,
    "",
    WHAT,
    "",
    WHO_WE_ARE_SHORT,
    "",
    NOT_YOU,
    "",
    signOffText(CLOSE),
    "",
    FOOTER_TEXT,
  ].join("\n");
  return { subject: SIGNUP_CONFIRM_SUBJECT, html, text };
}
