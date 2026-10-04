import { emailShell, eyebrow, heading, bodyP, quoteBox, signOff, signOffText, questionsBox, questionsText } from "../email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { raiseOrdinals } from "../email/dates";
import { FUNDRAISING_EMAIL, MEMORY_EYEBROW, MEMORY_SIGN_OFF, dearGreeting, safeFirstName, type BuiltEmail } from "./emails";

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

// Every date in the body has its ending raised ("7th" as 7<sup>th</sup>): ../email/dates.ts.
const shell = (body: string) =>
  emailShell(raiseOrdinals(body), { contactEmail: FUNDRAISING_EMAIL, registration: true, postalAddress: POSTAL_ADDRESS });

const EYEBROW = "Fundraising for NBCC";
const HELLO = "Hello,";
const LAST = "And from all of us: thank you too. Your gift helps the children, young people and vulnerable adults we support, all year round.";
const CLOSE = "Thanks so much,";

// In memory (review fix): the same email, gently, for a page in memory of someone. Jaimie,
// 2026-10-04: like every in memory email it opens "Dear [first name]," (the giver's, and only a safe
// first name; "Hello," without one) and signs off "With warmest thoughts,". Any other page's is as
// it was: "Hello," with no name.

export function buildSupporterThanksEmail(o: { organiserName: string; title: string; message: string; inMemory?: boolean; giverName?: string | null }): BuiltEmail {
  const EYEBROW_WORDS = o.inMemory ? MEMORY_EYEBROW : EYEBROW;
  const CLOSE_WORDS = o.inMemory ? MEMORY_SIGN_OFF : CLOSE;
  const hello = o.inMemory ? dearGreeting(safeFirstName(o.giverName)) : HELLO;
  const first = safeFirstName(o.organiserName);
  const title = first ? `A thank you from ${first}` : "A thank you for your gift";
  const who = first ?? "The organiser";
  const intro = (t: string) => `${who} asked us to pass this on to you, for your gift to ${t}:`;
  const quoted = `“${o.message.trim()}”`;
  const html = shell(
    eyebrow(EYEBROW_WORDS) +
      heading(title) +
      bodyP(escapeHtml(hello)) +
      bodyP(intro(`<b>${escapeHtml(o.title)}</b>`)) +
      quoteBox(quoted) +
      bodyP(LAST) +
      signOff(CLOSE_WORDS) +
      questionsBox(FUNDRAISING_EMAIL),
  );
  const text = [
    EYEBROW_WORDS,
    title,
    "",
    hello,
    "",
    intro(o.title),
    "",
    quoted,
    "",
    LAST,
    "",
    signOffText(CLOSE_WORDS),
    "",
    questionsText(FUNDRAISING_EMAIL),
    "",
    FOOTER_TEXT,
  ].join("\n");
  return { subject: title, html, text };
}
