import { bodyList, bodyP, button, codeBox, emailShell, heading, note, questionsBox, questionsText, signOff, signOffText } from "../email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { clockWords, longDayWords } from "./words";

// NBCC Elf Detective School: the emails of wave 1 (docs/superpowers/plans/2026-11-03-elf-detective-
// wave1-sign-up.md, Tasks 5 and 6). Pure builders: the senders are in src/clients/email.ts
// (sendElfWelcome, sendElfSignInCode), and both are read in Admin > Get involved > All emails.
//
// They come from events@ on the apex (never news.nbcc.scot). No link in them changes anything: the
// welcome's buttons open pages, and the sign in code has no link at all. A detective is only ever
// named by detective name. Money wording uses "could". Unit tested in test/unit/elf-emails.test.ts.

export const ELF_CONTACT_EMAIL = "events@nbcc.scot";

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A badge number as the badge shows it: EDS 0042. */
export function badgeWords(n: number): string {
  return `EDS ${String(Math.max(0, Math.floor(n))).padStart(4, "0")}`;
}

/** The grown up's first word, if it is a plain name; otherwise nothing, and the email says "Hi there". */
function firstName(typed: string): string | null {
  const first = typed.trim().split(/\s+/)[0] ?? "";
  return /^\p{Script=Latin}{1,20}(?:['’]\p{Script=Latin}+)?$/u.test(first) ? first : null;
}

function shell(body: string): string {
  return emailShell(body, { contactEmail: ELF_CONTACT_EMAIL, registration: true, postalAddress: POSTAL_ADDRESS });
}

function finish(subject: string, bodyHtml: string, textLines: string[], line: string): BuiltEmail {
  const html = shell(bodyHtml + signOff(line) + questionsBox(ELF_CONTACT_EMAIL));
  const text = [...textLines, "", signOffText(line), "", questionsText(ELF_CONTACT_EMAIL), "", FOOTER_TEXT].join("\n");
  return { subject, html, text };
}

/** Sent when a payment settles. */
export function buildElfWelcomeEmail(o: {
  grownUpName: string;
  detectives: { name: string; badge: string }[];
  hqUrl: string;
  signInUrl: string;
  firstClueAt: Date;
}): BuiltEmail {
  const first = firstName(o.grownUpName);
  const hi = first ? `Hi ${first},` : "Hi there,";
  const many = o.detectives.length > 1;
  const enrolled = `Thank you for enrolling ${many ? "your detectives" : "your detective"} in NBCC Elf Detective School.`;
  const when = `School starts on ${longDayWords(o.firstClueAt)} at ${clockWords(o.firstClueAt)}, when the first clue comes out.`;
  const until = `Until then, ${many ? "each detective can" : "your detective can"} dress their elf in Detective HQ. More clothes unlock as they find elves in December.`;
  const signIn = `To get back in, sign in at ${o.signInUrl} with your email. We send a 6 digit code each time.`;
  const thanks = "Every pound you paid could help a child wake up to a Red Bag Full of Joy on Christmas morning.";
  const list = o.detectives.map((d) => `${d.name}, badge ${d.badge}`);

  const body =
    heading("Welcome to Elf Detective School") +
    bodyP(escapeHtml(hi)) +
    bodyP(escapeHtml(enrolled)) +
    bodyList(list.map(escapeHtml)) +
    bodyP(escapeHtml(when)) +
    bodyP(escapeHtml(until)) +
    button(o.hqUrl, "Open Detective HQ") +
    bodyP(escapeHtml(thanks)) +
    note(escapeHtml(signIn));
  const text = [hi, "", enrolled, "", ...list.map((l) => `* ${l}`), "", when, "", until, "", `Detective HQ: ${o.hqUrl}`, "", thanks, "", signIn];
  return finish(`Welcome to NBCC Elf Detective School`, body, text, "See you at school!");
}

/** The 6 digit code for signing in. No link: the code is typed on the page it was asked for from. */
export function buildElfSignInCodeEmail(code: string): BuiltEmail {
  const intro = "Here's your code to sign in to Detective HQ. It works for 10 minutes.";
  const small = "Didn't ask for this? No problem, just ignore this email. Nobody can get in without the code.";
  const body = heading("Here's your code") + bodyP(intro) + codeBox(code) + note(small);
  const text = [intro, "", `Your code: ${code}`, "", small];
  return finish(`Your Elf Detective School sign in code: ${code.slice(0, 3)} ${code.slice(3)}`, body, text, "Happy hunting!");
}

/** What the email log keeps as the code email's subject: never the code itself. */
export const ELF_CODE_LOG_SUBJECT = "Your Elf Detective School sign in code";
