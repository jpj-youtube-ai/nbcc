import {
  emailShell,
  heading,
  subheading,
  eyebrow,
  bodyP,
  bodyList,
  note,
  button,
  codeBox,
  signOff,
  signOffText,
  questionsBox,
  questionsText,
} from "../email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { ACCESS_LABELS, BOOKING_LABELS, KIND_LABELS, shortName, type SignUp } from "./model";

// TASK-493: the community fundraising emails, built here and sent by src/fundraising/send.ts.
// TASK-497: reworded to the words Jaimie signed off on 2026-10-02 (warmer, a signed close, and a
// "Got any questions?" box with the phone and the events inbox side by side).
// Pure: no pool, no config, no clock, so each is unit tested (test/unit/fundraising-emails.test.ts).
//
//   thanks          to the organiser when they sign up: thank you, here is what happens next
//   staff           to the events inbox: everything they told us, and the next steps
//   approved        to the organiser: "your page is live" (raising money and public, sent once
//                   fundraising is on), or "you're on our list" for anyone else
//   sign in code    to the organiser: the 6 digit code for their private area (TASK-501, email 8;
//                   it replaced the 24 hour link to change their page)
//   finished staff  to the events inbox: the organiser pressed "I've finished" (TASK-501)
//   edit approved   to the organiser: "your update is live" (or "saved", with no live page)
//   edit rejected   to the organiser: "about your update", we'll give you a ring
//
// They wear NBCC's usual shell with the events inbox as the contact, because a fundraiser's
// questions belong with the events team, not the giving queue. Every email to an organiser ends
// with its sign off, then the questions box; the staff summary signs off but has no box. Plain
// friendly English, no dashes, and every stored value escaped.

export const FUNDRAISING_EMAIL = "events@nbcc.scot";

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const firstName = (name: string): string => shortName(name).split(" ")[0];

/** £500, £12.50, £100,000. */
export function pounds(pence: number): string {
  const whole = pence % 100 === 0;
  return `£${(pence / 100).toLocaleString("en-GB", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

const shell = (body: string) =>
  emailShell(body, { contactEmail: FUNDRAISING_EMAIL, registration: true, postalAddress: POSTAL_ADDRESS });

const EYEBROW = eyebrow("Fundraising for NBCC");

/** An email to an organiser: the body, the sign off, then the questions box, in both parts. */
function toOrganiser(subject: string, bodyHtml: string, textLines: string[], line: string): BuiltEmail {
  const html = shell(bodyHtml + signOff(line) + questionsBox(FUNDRAISING_EMAIL));
  const text = [...textLines, "", signOffText(line), "", questionsText(FUNDRAISING_EMAIL), "", FOOTER_TEXT].join("\n");
  return { subject, html, text };
}

// Numbered steps in a plain text part.
const numbered = (items: string[]): string[] => items.map((item, i) => `${i + 1}. ${item}`);
const bulleted = (items: string[]): string[] => items.map((item) => `* ${item}`);

// --- thanks for signing up ------------------------------------------------------------------------

const MAX_FIRST_NAME = 20;
// One word of Latin letters (accents included: Siân, José, Zoë), with an apostrophe or hyphen only
// BETWEEN letters: O'Neill, Anne-Marie. No digits, dots, slashes, @ or markup, so it can never be a
// link or a tag; and no other script, so no letter that only looks Latin (Cyrillic, Cherokee,
// maths bold) and no invisible one (the Hangul filler) can pass as a word it is not.
const NAME_WORD = /^\p{Script=Latin}+(?:['’-]\p{Script=Latin}+)*$/u;

/**
 * The first name from the sign up form, if it is safe to put in an email to the address they typed:
 * the first word only, Latin letters (with apostrophes or hyphens inside it), at most 20 characters,
 * first letter capitalised. Put together first (NFC), so an accent typed as a separate mark counts
 * as part of its letter. Anything else is null, and the email says "Hi there," instead.
 */
export function safeFirstName(typed: string | null | undefined): string | null {
  const word = String(typed ?? "").normalize("NFC").trim().split(/\s+/)[0] ?? "";
  if (word.length === 0 || word.length > MAX_FIRST_NAME || !NAME_WORD.test(word)) return null;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

const THANKS_STEPS = [
  "Someone from our team will look at what you’ve sent us.",
  "We’ll be in touch within a few days, usually with a quick, friendly call, to say hello and talk through your plans.",
  "Once we’ve spoken, we’ll get you set up with everything you need.",
];

// Fixed words, bar one plain first name: anyone can type any address into the public form, so this
// email carries nothing else they typed (no title, description, or the rest of their name).
// Otherwise the form would send any words, from NBCC's own domain, to anyone. The first name is
// only ever one word of letters, at most 20 (safeFirstName), so it cannot carry a link or a
// message; anything else falls back to "Hi there,". Everything they told us goes to the events
// inbox instead.
export function buildSignUpThanksEmail(typedName?: string | null): BuiltEmail {
  const first = safeFirstName(typedName);
  const hi = first ? `Hi there ${first},` : "Hi there,";
  const intro =
    "We’re so excited that you want to raise money for NBCC. Every pound you raise helps the families we support, all year round, and we can’t wait to cheer you on.";
  const small = "Nothing goes on our website until we’ve spoken. If this wasn’t you, don’t worry, you can ignore this email.";
  const body =
    EYEBROW +
    heading("Thank you, you’ve made our day!") +
    bodyP(escapeHtml(hi)) +
    bodyP(intro) +
    subheading("What happens next") +
    bodyList(THANKS_STEPS, true) +
    note(small);
  const text = [hi, "", intro, "", "WHAT HAPPENS NEXT", ...numbered(THANKS_STEPS), "", small];
  return toOrganiser("Thank you for fundraising for NBCC!", body, text, "Thanks so much,");
}

// --- the summary to the events inbox --------------------------------------------------------------

// What the summary needs: a sign up, or the stored record (which may carry the single address box of
// a sign up made before TASK-499).
export type StaffSummary = SignUp & { id: number; postAddress?: string | null };

/** "1 Example Road, Exampleton, EX1 1EX": the boxes of an address, leaving out the empty ones. */
function joinParts(...parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === "string" && p.trim() !== "").join(", ");
}

// TASK-499: posters, leaflets, buckets and tins each have their own number. A sign up from before
// the split asked for "leaflets or posters" and "buckets or tins", and reads as it always did.
function requestFacts(w: SignUp["wants"]): Array<[string, string]> {
  const n = (v: number | undefined) => Number(v) || 0;
  const split = n(w.posterCount) + n(w.leafletCount) + n(w.bucketCount) + n(w.tinCount) > 0;
  const combined = n(w.leaflets) + n(w.buckets) > 0;
  const facts: Array<[string, string]> = [];
  if (split || !combined) {
    facts.push(
      ["Posters: " + n(w.posterCount), ""],
      ["Leaflets: " + n(w.leafletCount), ""],
      ["Collection buckets: " + n(w.bucketCount), ""],
      ["Collection tins: " + n(w.tinCount), ""],
    );
  }
  if (combined) facts.push(["Leaflets or posters: " + n(w.leaflets), ""], ["Buckets or tins: " + n(w.buckets), ""]);
  return facts;
}

// TASK-499: the event questions, as the form asks them.
function eventFacts(f: StaffSummary): Array<[string, string]> {
  const facts: Array<[string, string]> = [
    ["Front of the card", f.cardLine ?? "Not given"],
    ["Full address", joinParts(f.venueAddress, f.venuePostcode) || "Not given"],
    ["Access", f.access?.length ? f.access.map((a) => ACCESS_LABELS[a]).join(", ") : "None ticked"],
    ["Price", f.price ?? "Not given"],
    ["Getting in", f.booking ? BOOKING_LABELS[f.booking] : "Not given"],
  ];
  if (f.booking === "away" && f.ticketUrl) facts.push(["Ticket link", f.ticketUrl]);
  if (f.ageLimit) facts.push(["Age limit", f.ageLimit]);
  if (f.dressCode) facts.push(["Dress code", f.dressCode]);
  if (f.included) facts.push(["What's included", f.included]);
  facts.push(["Credit it to", f.creditName ?? `Not given, so the card says ${shortName(f.name)}`]);
  return facts;
}

function staffFacts(f: StaffSummary): Array<[string, string]> {
  const time = f.startTime && f.endTime ? `${f.startTime} to ${f.endTime}` : f.startTime;
  const when = [f.eventDate, time].filter(Boolean).join(" at ") + (f.timeTbc ? ", the time is still to be confirmed" : "");
  const where = [f.venue, f.town].filter(Boolean).join(", ");
  const facts: Array<[string, string]> = [
    ["What", f.path === "raising" ? "Raising money" : "Holding an event"],
    ["Kind", KIND_LABELS[f.kind]],
    ["Name for it", f.title],
    ["About it", f.description],
    ["When", when || "Not given"],
    ["Where", where || "Not given"],
  ];
  if (f.path === "event") facts.push(...eventFacts(f));
  if (f.path === "raising") facts.push(["Target", f.targetPence ? pounds(f.targetPence) : "No target"]);
  facts.push(
    ["On the website", f.public ? "Yes, they would like it shown" : "No, not to be shown on the website"],
    ["Organiser", f.name],
    ["Email", f.email],
    ["Phone", f.phone],
    ["Facebook or Instagram", f.socialLink ?? "Not given"],
    ["We can post about it", f.socialOk ? "Yes" : "No"],
    ...requestFacts(f.wants),
    ["A social media shout out", f.wants.shoutOut ? "Yes please" : "No"],
    ["Someone from NBCC to come along", f.wants.attend ? "Yes please" : "No"],
  );
  const address = joinParts(f.postLine1, f.postLine2, f.postTown, f.postPostcode) || f.postAddress;
  if (address) facts.push(["Address for materials", address]);
  facts.push(["Newsletter", f.newsletterOk ? "Yes, they ticked the box" : "No"]);
  return facts;
}

// For the team only, so no questions box: they are the people the questions go to.
export function buildSignUpStaffEmail(f: StaffSummary, o: { adminUrl: string }): BuiltEmail {
  const facts = staffFacts(f);
  const first = firstName(f.name);
  const rows = facts
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;vertical-align:top;color:#6F6A66;font-size:13px">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 0;vertical-align:top;font-size:14px">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const steps = [
    `Give ${first} a ring within a few days to say hello.`,
    "Approve or decline in Admin > Fundraising.",
    `Replying to this email replies to ${first}.`,
  ];
  const line = "Go team!";
  const body =
    eyebrow("For the team") +
    heading("Exciting news: a new fundraiser!") +
    bodyP(`<b>${escapeHtml(f.name)}</b> has signed up <b>${escapeHtml(f.title)}</b>. Nothing is public until someone approves it.`) +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px">${rows}</table>` +
    subheading("Next steps") +
    bodyList(steps.map(escapeHtml)) +
    button(o.adminUrl, "Open the admin") +
    signOff(line);
  const text = [
    "EXCITING NEWS: A NEW FUNDRAISER!",
    "",
    `${f.name} has signed up ${f.title}. Nothing is public until someone approves it.`,
    "",
    ...facts.map(([label, value]) => (value ? `${label}: ${value}` : label)),
    "",
    "NEXT STEPS",
    ...bulleted(steps),
    "",
    `Open the admin: ${o.adminUrl}`,
    "",
    signOffText(line),
  ].join("\n");
  return { subject: `New fundraiser: ${f.title}`, html: shell(body), text };
}

// --- approved -------------------------------------------------------------------------------------

/**
 * "Your page is live" when they have a page to link to, otherwise "you're on our list". A page
 * holder approved while fundraising is switched off gets nothing yet: they are marked as waiting,
 * and this goes to them when an admin switches fundraising on (src/fundraising/send.ts).
 */
export function buildApprovedEmail(
  f: { name: string; title: string },
  o: { pageUrl: string | null; manageUrl: string | null },
): BuiltEmail {
  const hi = `Hi ${firstName(f.name)},`;
  const title = escapeHtml(f.title);
  if (o.pageUrl) {
    const steps: Array<[string, string]> = [
      ["Share your page", " on Facebook, WhatsApp and by email. Most gifts come from people you know."],
      ["Make the first gift yourself", " if you can. Pages that start with a gift tend to raise more."],
      ["Print your QR code", " from your private area, for posters, buckets and the office fridge."],
    ];
    const gifts =
      "Every gift comes straight to NBCC, with Gift Aid on top when your supporters are UK taxpayers, and every message lands on your supporter wall.";
    const area = "is where you update your page, find your QR code and pay in any cash you collect. We send you a code to get in, so there are no passwords to remember.";
    // The approved words, with "Your private area" linked to it where there is an address for it.
    const areaHtml = o.manageUrl
      ? `<a href="${escapeHtml(o.manageUrl)}" style="color:inherit">Your private area</a> ${area}`
      : `Your private area ${area}`;
    const body =
      EYEBROW +
      heading("Your page is live!") +
      bodyP(escapeHtml(hi)) +
      bodyP(`Brilliant news: <b>${title}</b> is approved and your very own NBCC fundraising page is live. We can’t wait to watch your meter fill up!`) +
      button(o.pageUrl, "See my page") +
      subheading("Three things to do today") +
      bodyList(steps.map(([lead, rest]) => `<b>${lead}</b>${rest}`), true) +
      bodyP(gifts) +
      note(areaHtml);
    const text = [
      hi,
      "",
      `Brilliant news: ${f.title} is approved and your very own NBCC fundraising page is live. We can’t wait to watch your meter fill up!`,
      "",
      `See my page: ${o.pageUrl}`,
      "",
      "THREE THINGS TO DO TODAY",
      ...numbered(steps.map(([lead, rest]) => lead + rest)),
      "",
      gifts,
      "",
      `Your private area ${area}`,
      ...(o.manageUrl ? [`Your private area: ${o.manageUrl}`] : []),
    ];
    return toOrganiser(`Your fundraising page is live: ${f.title}`, body, text, "Cheering you on all the way,");
  }
  const thanks = "It’s all approved, and you’re officially part of the NBCC family.";
  const where = "If you asked us to show it, you’ll find it on our Get involved page at";
  const after = "We’ll be in touch about anything you asked us for.";
  const body =
    EYEBROW +
    heading("You’re on our list!") +
    bodyP(escapeHtml(hi)) +
    bodyP(`Thank you so much for doing <b>${title}</b> for NBCC. ${thanks}`) +
    bodyP(`${where} <b>nbcc.scot/get-involved</b>. ${after}`);
  const text = [
    hi,
    "",
    `Thank you so much for doing ${f.title} for NBCC. ${thanks}`,
    "",
    `${where} nbcc.scot/get-involved. ${after}`,
  ];
  return toOrganiser(`You're on our list: ${f.title}`, body, text, "You’re a star. Thank you,");
}

// --- the sign in code (TASK-501, email 8) ---------------------------------------------------------

/**
 * The code for the private area, in the words Jaimie approved. Like the thanks for signing up, it
 * carries nothing typed but a safe first name (the address it goes to is whatever was typed into
 * the box), and no link: the code is typed in on the page it was asked for from.
 */
export function buildSignInCodeEmail(typedName: string | null | undefined, code: string): BuiltEmail {
  const first = safeFirstName(typedName);
  const hi = first ? `Hi ${first},` : "Hi there,";
  const intro = "Here’s your code to open your private fundraising area. It works for 10 minutes.";
  const inside =
    "Inside you’ll find your QR code, your latest gifts and messages, and everything you need to update your page or pay in what you’ve collected.";
  const small = "Didn’t ask for this? No problem, just ignore this email. Nobody can get in without the code.";
  const body = EYEBROW + heading("Here’s your code") + bodyP(escapeHtml(hi)) + bodyP(intro) + codeBox(code) + bodyP(inside) + note(small);
  const text = [hi, "", intro, "", `Your code: ${code}`, "", inside, "", small];
  return toOrganiser(`Your NBCC sign in code: ${code.slice(0, 3)} ${code.slice(3)}`, body, text, "Happy fundraising!");
}

// --- "I've finished", to the events inbox (TASK-501) ---------------------------------------------

/** For the team only: an organiser pressed "I've finished". It finishes nothing by itself. */
export function buildFinishedStaffEmail(
  f: { id: number; name: string; title: string; email: string; raisedPence: number },
  o: { adminUrl: string },
): BuiltEmail {
  const first = firstName(f.name);
  const raised = pounds(f.raisedPence);
  const steps = [
    `Give ${first} a ring to say thank you, and to check any cash or sponsor money is on its way.`,
    "When everything is in, press Mark finished in Admin > Fundraising.",
    `Replying to this email replies to ${first}.`,
  ];
  const line = "Go team!";
  const body =
    eyebrow("For the team") +
    heading("A fundraiser says they’ve finished") +
    bodyP(`<b>${escapeHtml(f.name)}</b> says <b>${escapeHtml(f.title)}</b> has finished. It has raised <b>${escapeHtml(raised)}</b> so far.`) +
    bodyP("Nothing has changed on the website: it stays as it is until someone marks it finished.") +
    subheading("Next steps") +
    bodyList(steps.map(escapeHtml)) +
    button(o.adminUrl, "Open the admin") +
    signOff(line);
  const text = [
    "A FUNDRAISER SAYS THEY’VE FINISHED",
    "",
    `${f.name} says ${f.title} has finished. It has raised ${raised} so far.`,
    "",
    "Nothing has changed on the website: it stays as it is until someone marks it finished.",
    "",
    "NEXT STEPS",
    ...bulleted(steps),
    "",
    `Open the admin: ${o.adminUrl}`,
    "",
    signOffText(line),
  ].join("\n");
  return { subject: `${f.title} says they've finished`, html: shell(body), text };
}

// --- a change, approved or rejected ---------------------------------------------------------------

/**
 * Staff approved a change the organiser asked for. `pageUrl` is given only when their page is up
 * (they have one, it is approved and fundraising is on): then it says the change is on their page,
 * with the link and a nudge to share. Otherwise neutral words: the changes are saved.
 */
export function buildEditApprovedEmail(f: { name: string; title: string }, o: { pageUrl: string | null }): BuiltEmail {
  const hi = `Hi ${firstName(f.name)},`;
  const share = "Why not share it again so everyone sees what’s new? A fresh share often brings in a few more gifts.";
  const where = o.pageUrl ? "they’re now on your page" : "they’re all saved";
  const body =
    EYEBROW +
    heading(o.pageUrl ? "Your update is live!" : "Your update is saved!") +
    bodyP(escapeHtml(hi)) +
    bodyP(`Good news: we’ve checked your changes to <b>${escapeHtml(f.title)}</b> and ${where}.`) +
    (o.pageUrl ? bodyP(share) + button(o.pageUrl, "See my page") : "");
  const text = [
    hi,
    "",
    `Good news: we’ve checked your changes to ${f.title} and ${where}.`,
    ...(o.pageUrl ? ["", share, "", `See my page: ${o.pageUrl}`] : []),
  ];
  const subject = o.pageUrl ? `Your update is live: ${f.title}` : `Your update is saved: ${f.title}`;
  return toOrganiser(subject, body, text, "Thanks so much,");
}

/**
 * Staff rejected a change the organiser asked for: nothing to worry about, we'll ring. Only while
 * their page is up (`pageLive`) does it say the page is still live and gifts still coming in.
 */
export function buildEditRejectedEmail(f: { name: string; title: string }, o: { pageLive: boolean }): BuiltEmail {
  const hi = `Hi ${firstName(f.name)},`;
  const held = "We haven’t put this change on your page just yet, and someone from our team will give you a quick ring to talk it through.";
  const calm = o.pageLive
    ? "Nothing to worry about: your page is still live, just as it was, and gifts are still coming in."
    : "Nothing to worry about: everything stays just as it was.";
  const body =
    EYEBROW +
    heading("About your update") +
    bodyP(escapeHtml(hi)) +
    bodyP(`Thank you for updating <b>${escapeHtml(f.title)}</b>. ${held}`) +
    bodyP(calm);
  const text = [hi, "", `Thank you for updating ${f.title}. ${held}`, "", calm];
  return toOrganiser(`About your update to ${f.title}`, body, text, "Speak soon,");
}
