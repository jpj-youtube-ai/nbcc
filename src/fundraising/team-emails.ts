import {
  emailShell,
  heading,
  subheading,
  eyebrow,
  bodyP,
  bodyList,
  note,
  button,
  quoteBox,
  signOff,
  signOffText,
  signOffAs,
  signOffAsText,
  questionsBox,
  questionsText,
  HEAD,
  MAROON,
  PHONE_DISPLAY,
} from "../email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { raiseOrdinals } from "../email/dates";
import { FUNDRAISING_EMAIL, MEMORY_EMAIL, MEMORY_EYEBROW, MEMORY_SIGNER, MEMORY_SIGN_OFF, STAFF_SIGN_OFF, dearGreeting, type BuiltEmail } from "./emails";
import type { InviteType } from "./invite";
import type { SummaryLines } from "./summary";

// TASK-503: emails 7 (the invite) and 11 (the Monday summary), in the words Jaimie signed off on
// 2026-10-02 (memory: nbcc-fundraising-emails-approved-2026-10-02). Pure, like ./emails.ts, and in
// the same shell with the events inbox as the contact. Every typed value is escaped.
//
//   invite    from the events inbox to someone staff have spoken to. Signed by the member of staff
//             who sent it, so they recognise who they spoke to; their personal note in a quote box;
//             a button to the sign up form with the invite (only first name, surname and email are filled in).
//   summary   Monday 8am, to the people chosen in Admin > Fundraising. For the team, so no
//             questions box.

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Every date in the body has its ending raised ("7th" as 7<sup>th</sup>): ../email/dates.ts.
// `contact` is the address in the footer bar: the events inbox, or Jodie's for the in memory invite
// (the readthrough, 2026-10-04).
const shell = (body: string, contact: string = FUNDRAISING_EMAIL) =>
  emailShell(raiseOrdinals(body), { contactEmail: contact, registration: true, postalAddress: POSTAL_ADDRESS });

// --- email 7, the invite ----------------------------------------------------------------------------

const INVITE_CHAT = "It was so lovely to chat with you about your plans to raise money for NBCC. Thank you, it honestly means the world to us.";
// Jaimie, 2026-10-04: the link only fills in their name and email, so every invite says the form is
// started, not that the page is filled in with what was talked about.
const INVITE_START = "We've given you a head start: press the button below and the form is already started for you. It only takes a few minutes.";
const INVITE_PAGE =
  "You'll get your very own fundraising page, with a meter that fills as gifts come in, a wall for your supporters' messages and your own QR code for posters.";
// Invite types (Jaimie, B1 + I1): the same email for a team, with only this line adapted.
const INVITE_PAGE_TEAM =
  "You'll get a team page with a meter for the whole team, and a page for everyone who joins, with a wall for your supporters' messages and your own QR code for posters.";
// For someone hosting an event (Jaimie's wording): about their event throughout, in the same shape.
const EVENT_SUBJECT = "We'd love to help with your event";
const EVENT_HEADING = "We'd love to help with your event!";
const EVENT_CHAT = "It was so lovely to chat with you about your plans for your event. Thank you, it honestly means the world to us.";
const EVENT_BUTTON = "Set up my event";
const INVITE_PAGE_EVENT = "Your event gets its own page on our website, with a meter, posters and a QR code.";
const INVITE_ASK = "Need posters, leaflets, a collection bucket or a shout out on our social media? Just ask, we're here to help.";
const INVITE_CLOSE = "Warmest wishes,";

// The in memory invite: gentle, with no exclamation marks and none of the cheerful invite's words.
// NEW wording, so it is only sent once an admin has approved it (INVITE_WORDING_KEYS in ./invite.ts).
const MEMORY_SUBJECT = "A page in memory of someone you love";
const MEMORY_HEADING = "A page in their memory";
const MEMORY_START =
  "Thank you for talking with us. If you would like to set up a page in memory of someone you love, the button below opens it with your details already filled in. Take your time: we will go through it all with you on the phone before anything goes live.";
const MEMORY_BUTTON = "Start the page";
const MEMORY_PAGE =
  "It is a quiet page where family and friends can give in their memory, and we can send collection envelopes for the service if you would like them.";
const MEMORY_CALL = `If you would rather we filled it in with you, call us on ${PHONE_DISPLAY}.`;
const MEMORY_CLOSE = MEMORY_SIGN_OFF;

export interface InviteEmailInput {
  firstName: string;
  note: string | null;
  signer: string;
  url: string;
  /** What they are invited to do; none (an invite from before) reads as raising money. */
  type?: InviteType | null;
}

// Greeted "Dear", not "Hi" (Jaimie): the other invites keep "Hi".
function buildMemoryInviteEmail(o: InviteEmailInput): BuiltEmail {
  // The first name staff typed, whole ("Mary Jane"); "Hello," if ever there is none.
  const hi = dearGreeting(o.firstName);
  const body =
    eyebrow(MEMORY_EYEBROW) +
    heading(MEMORY_HEADING) +
    bodyP(escapeHtml(hi)) +
    bodyP(MEMORY_START) +
    (o.note ? quoteBox(o.note) : "") +
    button(o.url, MEMORY_BUTTON) +
    bodyP(MEMORY_PAGE) +
    bodyP(MEMORY_CALL) +
    // Always Jodie: it comes from her address, so she signs it, whoever sent it (o.signer is not used).
    signOffAs(MEMORY_CLOSE, MEMORY_SIGNER);
  const text = [
    MEMORY_EYEBROW,
    MEMORY_HEADING,
    "",
    hi,
    "",
    MEMORY_START,
    ...(o.note ? ["", o.note] : []),
    "",
    `${MEMORY_BUTTON}: ${o.url}`,
    "",
    MEMORY_PAGE,
    "",
    MEMORY_CALL,
    "",
    signOffAsText(MEMORY_CLOSE, MEMORY_SIGNER),
    "",
    FOOTER_TEXT,
  ].join("\n");
  // It comes from Jodie's address, shows it, and is signed by her.
  return { subject: MEMORY_SUBJECT, html: shell(body, MEMORY_EMAIL), text };
}

// Greeted by the first name staff typed in its own box (Jaimie 2026-10-03), so "Mary Jane" stays whole.
export function buildInviteEmail(o: InviteEmailInput): BuiltEmail {
  const hi = `Hi ${String(o.firstName).trim()},`;
  if (o.type === "memory") return buildMemoryInviteEmail(o);
  const event = o.type === "event";
  const page = o.type === "team" ? INVITE_PAGE_TEAM : event ? INVITE_PAGE_EVENT : INVITE_PAGE;
  const headingWords = event ? EVENT_HEADING : "We'd love you to fundraise with us!";
  const chat = event ? EVENT_CHAT : INVITE_CHAT;
  const buttonWords = event ? EVENT_BUTTON : "Make my page";
  const body =
    eyebrow("Fundraising for NBCC") +
    heading(headingWords) +
    bodyP(escapeHtml(hi)) +
    bodyP(chat) +
    (o.note ? quoteBox(o.note) : "") +
    bodyP(INVITE_START) +
    button(o.url, buttonWords) +
    bodyP(page) +
    bodyP(INVITE_ASK) +
    signOffAs(INVITE_CLOSE, o.signer) +
    questionsBox(FUNDRAISING_EMAIL);
  const text = [
    "Fundraising for NBCC",
    headingWords,
    "",
    hi,
    "",
    chat,
    ...(o.note ? ["", o.note] : []),
    "",
    INVITE_START,
    "",
    `${buttonWords}: ${o.url}`,
    "",
    page,
    "",
    INVITE_ASK,
    "",
    signOffAsText(INVITE_CLOSE, o.signer),
    "",
    questionsText(FUNDRAISING_EMAIL),
    "",
    FOOTER_TEXT,
  ].join("\n");
  return { subject: event ? EVENT_SUBJECT : "We'd love you to fundraise with us", html: shell(body), text };
}

// --- email 11, the Monday summary -------------------------------------------------------------------

const SUMMARY_CLOSE = STAFF_SIGN_OFF;
const TEST_LINE = "This is a test, sent only to you. The real one goes at 8am on Mondays to everyone on the list.";
const QUIET = {
  newSignUps: "No new sign ups last week.",
  waiting: "Nothing is waiting on us. Lovely!",
  comingUp: "Nothing dated in the next four weeks.",
};

function section(title: string, items: string[], quiet: string): { html: string; text: string[] } {
  return {
    html: subheading(title) + (items.length ? bodyList(items.map(escapeHtml)) : bodyP(quiet)),
    text: [title.toUpperCase(), ...(items.length ? items.map((i) => `* ${i}`) : [quiet]), ""],
  };
}

export function buildSummaryEmail(lines: SummaryLines, o: { adminUrl: string; test: boolean }): BuiltEmail {
  const signUps = section("New sign ups", lines.newSignUps, QUIET.newSignUps);
  const waiting = section("Waiting on us", lines.waiting, QUIET.waiting);
  const coming = section("Coming up", lines.comingUp, QUIET.comingUp);
  const body =
    (o.test ? note(TEST_LINE) : "") +
    eyebrow("For the team, Monday 8am") +
    heading("Good morning, team!") +
    bodyP("Here's how fundraising went last week.") +
    bodyP(`<b style="font-family:${HEAD};font-size:20px;color:${MAROON}">${escapeHtml(lines.headline)}</b><br>${escapeHtml(lines.money)}`) +
    signUps.html +
    waiting.html +
    coming.html +
    button(o.adminUrl, "Open the admin") +
    signOff(SUMMARY_CLOSE);
  const text = [
    ...(o.test ? [TEST_LINE, ""] : []),
    "For the team, Monday 8am",
    "Good morning, team!",
    "",
    "Here's how fundraising went last week.",
    "",
    lines.headline,
    lines.money,
    "",
    ...signUps.text,
    ...waiting.text,
    ...coming.text,
    `Open the admin: ${o.adminUrl}`,
    "",
    signOffText(SUMMARY_CLOSE),
  ].join("\n");
  return { subject: (o.test ? "Test: " : "") + lines.subject, html: shell(body), text };
}
