import { emailShell, eyebrow, heading, subheading, bodyP, button, quoteBox, ABOUT_NBCC_FULL, signOff, signOffText, signOffAs, signOffAsText, questionsBox, questionsText } from "../email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { raiseOrdinals } from "../email/dates";
import { FUNDRAISING_EMAIL, MEMORY_EMAIL, MEMORY_EYEBROW, MEMORY_SIGNER, MEMORY_SIGN_OFF, dearGreeting, safeFirstName, type BuiltEmail } from "./emails";

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
const shell = (body: string, contact: string) =>
  emailShell(raiseOrdinals(body), { contactEmail: contact, registration: true, postalAddress: POSTAL_ADDRESS });

const EYEBROW = "Fundraising for NBCC";
const HELLO = "Hello,";
const THANKS_TOO = "And from all of us: thank you too.";
const CLOSE = "Thanks so much,";

// Keep in touch (Jaimie, 2026-10-04). Many of these givers have never dealt with NBCC, so after the
// fundraiser's message the email says who the charity is, in its own words (ABOUT_NBCC_FULL, once),
// and invites them to stay in touch: a button to the mailing list page and a link to the Get
// involved page. It is an invitation and nothing more: this email adds nobody to any list, and the
// two links are the plain public pages, the same for every giver, with no token, nothing to track
// and nothing about the person in them. Built on the public site address the other fundraising
// emails use (the sender passes config.PORTAL_BASE_URL). The same on an event page or a team page.
const KEEP_HEADING = "We'd love to keep in touch";
const KEEP = "If you'd like to hear how your gift helps, join our mailing list. It's a few emails a year, and you can unsubscribe at any time.";
const JOIN = "Join our mailing list";
const MORE = "There's lots going on, too. See what's coming up, and support the people fundraising for NBCC, on our";
const MORE_LINK = "Get involved page";

function keepInTouch(baseUrl: string): { html: string; text: string[] } {
  const base = baseUrl.replace(/\/+$/, "");
  const newsletterUrl = `${base}/newsletter`;
  const getInvolvedUrl = `${base}/get-involved`;
  return {
    html:
      bodyP(THANKS_TOO) +
      bodyP(ABOUT_NBCC_FULL) +
      subheading(KEEP_HEADING) +
      bodyP(KEEP) +
      button(newsletterUrl, JOIN) +
      bodyP(`${MORE} <a href="${escapeHtml(getInvolvedUrl)}" style="color:inherit">${MORE_LINK}</a>.`),
    text: [THANKS_TOO, "", ABOUT_NBCC_FULL, "", KEEP_HEADING, KEEP, `${JOIN}: ${newsletterUrl}`, "", `${MORE} ${MORE_LINK}: ${getInvolvedUrl}`],
  };
}

// The in memory version is not touched by any of that: it keeps the one closing line it always had.
const MEMORY_LAST = "And from all of us: thank you too. Your gift helps the children, young people and vulnerable adults we support across South West Scotland, all year round.";

// In memory (review fix): the same email, gently, for a page in memory of someone. Jaimie,
// 2026-10-04: like every in memory email it opens "Dear [first name]," (the giver's, and only a safe
// first name; "Hello," without one) and signs off "With warmest thoughts,". Any other page's is as
// it was: "Hello," with no name.

export function buildSupporterThanksEmail(o: { organiserName: string; title: string; message: string; baseUrl: string; inMemory?: boolean; giverName?: string | null }): BuiltEmail {
  const EYEBROW_WORDS = o.inMemory ? MEMORY_EYEBROW : EYEBROW;
  const CLOSE_WORDS = o.inMemory ? MEMORY_SIGN_OFF : CLOSE;
  const hello = o.inMemory ? dearGreeting(safeFirstName(o.giverName)) : HELLO;
  // In memory, it comes from Jodie and shows her address (the readthrough, 2026-10-04).
  const contact = o.inMemory ? MEMORY_EMAIL : FUNDRAISING_EMAIL;
  const first = safeFirstName(o.organiserName);
  const title = first ? `A thank you from ${first}` : "A thank you for your gift";
  const who = first ?? "The organiser";
  const intro = (t: string) => `${who} asked us to pass this on to you, for your gift to ${t}:`;
  const quoted = `“${o.message.trim()}”`;
  const last = o.inMemory ? { html: bodyP(MEMORY_LAST), text: [MEMORY_LAST] } : keepInTouch(o.baseUrl);
  const html = shell(
    eyebrow(EYEBROW_WORDS) +
      heading(title) +
      bodyP(escapeHtml(hello)) +
      bodyP(intro(`<b>${escapeHtml(o.title)}</b>`)) +
      quoteBox(quoted) +
      last.html +
      // In memory, Jodie signs it: her name above "NBCC Team".
      (o.inMemory ? signOffAs(CLOSE_WORDS, MEMORY_SIGNER) : signOff(CLOSE_WORDS)) +
      questionsBox(contact),
    contact,
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
    ...last.text,
    "",
    o.inMemory ? signOffAsText(CLOSE_WORDS, MEMORY_SIGNER) : signOffText(CLOSE_WORDS),
    "",
    questionsText(contact),
    "",
    FOOTER_TEXT,
  ].join("\n");
  return { subject: title, html, text };
}
