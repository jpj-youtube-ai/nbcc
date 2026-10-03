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
} from "../email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { FUNDRAISING_EMAIL, type BuiltEmail } from "./emails";
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

const shell = (body: string) =>
  emailShell(body, { contactEmail: FUNDRAISING_EMAIL, registration: true, postalAddress: POSTAL_ADDRESS });

// --- email 7, the invite ----------------------------------------------------------------------------

const INVITE_CHAT = "It was so lovely to chat with you about your plans to raise money for NBCC. Thank you, it honestly means the world to us.";
const INVITE_START =
  "We’ve given you a head start: press the button below and your page is already filled in with what we talked about. It only takes a couple of minutes.";
const INVITE_PAGE =
  "You’ll get your very own fundraising page, with a meter that fills as gifts come in, a wall for your supporters’ messages and your own QR code for posters.";
const INVITE_ASK = "Need posters, leaflets, a collection bucket or a shout out on our social media? Just ask, we’re here to help.";
const INVITE_CLOSE = "Warmest wishes,";

// Greeted by the first name staff typed in its own box (Jaimie 2026-10-03), so "Mary Jane" stays whole.
export function buildInviteEmail(o: { firstName: string; note: string | null; signer: string; url: string }): BuiltEmail {
  const hi = `Hi ${String(o.firstName).trim()},`;
  const body =
    eyebrow("Fundraising for NBCC") +
    heading("We’d love you to fundraise with us!") +
    bodyP(escapeHtml(hi)) +
    bodyP(INVITE_CHAT) +
    (o.note ? quoteBox(o.note) : "") +
    bodyP(INVITE_START) +
    button(o.url, "Make my page") +
    bodyP(INVITE_PAGE) +
    bodyP(INVITE_ASK) +
    signOffAs(INVITE_CLOSE, o.signer) +
    questionsBox(FUNDRAISING_EMAIL);
  const text = [
    "Fundraising for NBCC",
    "We’d love you to fundraise with us!",
    "",
    hi,
    "",
    INVITE_CHAT,
    ...(o.note ? ["", o.note] : []),
    "",
    INVITE_START,
    "",
    `Make my page: ${o.url}`,
    "",
    INVITE_PAGE,
    "",
    INVITE_ASK,
    "",
    signOffAsText(INVITE_CLOSE, o.signer),
    "",
    questionsText(FUNDRAISING_EMAIL),
    "",
    FOOTER_TEXT,
  ].join("\n");
  return { subject: "We'd love you to fundraise with us", html: shell(body), text };
}

// --- email 11, the Monday summary -------------------------------------------------------------------

const SUMMARY_CLOSE = "Have a brilliant week,";
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
    bodyP("Here’s how fundraising went last week.") +
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
    "Here’s how fundraising went last week.",
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
