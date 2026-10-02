import { emailShell, eyebrow, heading, bodyP, quoteBox, signOff, signOffText, questionsBox, questionsText } from "../email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { FUNDRAISING_EMAIL, safeFirstName, type BuiltEmail } from "./emails";

// TASK-507: email 20, to a giver when the organiser thanks them (staff check it first), in the words
// Jaimie approved on 2026-10-02 (memory: nbcc-fundraising-emails-approved-2026-10-02). Pure, in the
// same shell as the other fundraising emails, with the events inbox as the contact, so a reply goes
// to NBCC and never to the organiser.
//
// The organiser is named only by a safe first name (safeFirstName: one word of letters), so the
// subject and heading can never carry a link or other words. Without one, the email thanks them "for
// your gift" from "the organiser". The message (checked by staff) is quoted, escaped, with its line
// breaks kept; the title is escaped. Nothing about any other giver, or the organiser's address.

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const shell = (body: string) =>
  emailShell(body, { contactEmail: FUNDRAISING_EMAIL, registration: true, postalAddress: POSTAL_ADDRESS });

const EYEBROW = "Fundraising for NBCC";
const HELLO = "Hello,";
const LAST = "And from all of us: thank you too. Your gift helps the families we support, all year round.";
const CLOSE = "Thanks so much,";

export function buildSupporterThanksEmail(o: { organiserName: string; title: string; message: string }): BuiltEmail {
  const first = safeFirstName(o.organiserName);
  const title = first ? `A thank you from ${first}` : "A thank you for your gift";
  const who = first ?? "The organiser";
  const intro = (t: string) => `${who} asked us to pass this on to you, for your gift to ${t}:`;
  const quoted = `“${o.message.trim()}”`;
  const html = shell(
    eyebrow(EYEBROW) +
      heading(title) +
      bodyP(HELLO) +
      bodyP(intro(`<b>${escapeHtml(o.title)}</b>`)) +
      quoteBox(quoted) +
      bodyP(LAST) +
      signOff(CLOSE) +
      questionsBox(FUNDRAISING_EMAIL),
  );
  const text = [
    EYEBROW,
    title,
    "",
    HELLO,
    "",
    intro(o.title),
    "",
    quoted,
    "",
    LAST,
    "",
    signOffText(CLOSE),
    "",
    questionsText(FUNDRAISING_EMAIL),
    "",
    FOOTER_TEXT,
  ].join("\n");
  return { subject: title, html, text };
}
