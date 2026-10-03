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
import { ACCESS_LABELS, BOOKING_LABELS, kindLabelOf, shortName, type FundraiserRecord, type SignUp, type Wants } from "./model";
import { OTHER_KIND } from "./categories";
import { memoryStaffFacts } from "./in-memory";

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
//   news approved   to the organiser: "your news update is live" (TASK-506)
//   news rejected   to the organiser: "about your news update", we'll give you a ring (TASK-506)
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
    "We’re so excited that you want to raise money for NBCC. Every pound you raise helps the children, young people and vulnerable adults we support, all year round, and we can’t wait to cheer you on.";
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
// TASK-511: the new answers are absent on a sign up from before them.
type NewAnswers = "firstName" | "lastName" | "kindOther" | "instagram" | "facebook";
// Jaimie, 2026-10-03: 18 or over and the split, absent (or null) on a sign up from before them.
type AgeAndSplit = "over18" | "sharesWithOther" | "nbccSharePercent" | "otherCauseName";
// In memory (Jaimie, 2026-10-03), absent on a sign up from before.
type Memory = "inMemory" | "memoryName" | "memoryDates" | "memorySetupBy" | "memoryPermission" | "memoryShowTarget";
export type StaffSummary = Omit<SignUp, NewAnswers | AgeAndSplit | Memory | "wants"> &
  Partial<Pick<FundraiserRecord, Memory>> &
  Partial<Record<NewAnswers, string | null>> & { id: number; postAddress?: string | null; wants: Wants; kindLabel?: string | null } & {
    over18?: boolean | null;
    sharesWithOther?: boolean | null;
    nbccSharePercent?: number | null;
    otherCauseName?: string | null;
    /** Team pages: a team's sign up, whose split it is, and the people held to be invited. */
    team?: { isTeam: boolean; shareMode: "team" | "organiser" | null; members: Array<{ firstName: string; lastName: string; email: string }> };
  };

/** "1 Example Road, Exampleton, EX1 1EX": the boxes of an address, leaving out the empty ones. */
function joinParts(...parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === "string" && p.trim() !== "").join(", ");
}

// TASK-499: posters, leaflets, buckets and tins each have their own number. A sign up from before
// the split asked for "leaflets or posters" and "buckets or tins", and reads as it always did.
function requestFacts(w: Wants): Array<[string, string]> {
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
  // TASK-511: printed QR codes, only on a sign up that asked for some.
  if (n(w.qrCount) > 0) facts.push(["Printed QR codes: " + n(w.qrCount), ""]);
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
  // TASK-511: Other (once Something else), in their words.
  const kind = kindLabelOf(f) + (f.kind === OTHER_KIND && f.kindOther ? `: ${f.kindOther}` : "");
  const facts: Array<[string, string]> = [
    ["What", f.path === "raising" ? "Raising money" : "Holding an event"],
    // In memory of someone: who, the dates, who set it up, and the target choice.
    ...memoryStaffFacts(f),
    ["Kind", kind],
    ["Name for it", f.title],
    ["About it", f.description],
    ["When", when || "Not given"],
    ["Where", where || "Not given"],
  ];
  if (f.path === "event") facts.push(...eventFacts(f));
  if (f.path === "raising") facts.push(["Target", f.targetPence ? pounds(f.targetPence) : "No target"]);
  // Jaimie, 2026-10-03: a sign up from before was asked neither.
  if (f.over18 === true) facts.push(["18 or over", "Yes"]);
  if (f.sharesWithOther === true) {
    facts.push(["Sharing with another cause", `Yes, ${f.nbccSharePercent}% to NBCC, the rest to ${f.otherCauseName ?? ""}`]);
  } else if (f.sharesWithOther === false) {
    facts.push(["Sharing with another cause", "No, all of it comes to NBCC"]);
  }
  // Team pages: the person signing up is the team organiser (never "captain").
  if (f.team?.isTeam) {
    facts.push(["A team", `Yes. ${f.name} is the team organiser`]);
    if (f.sharesWithOther === true) {
      facts.push([
        "Whose split",
        f.team.shareMode === "team"
          ? "The whole team’s: every member page shares the same way"
          : "Just the team organiser’s: each member is asked when they join",
      ]);
    }
    // Only how many: their names and emails stay in the admin, and are deleted on time.
    const n = f.team.members.length;
    facts.push([
      "People to invite",
      n ? `${n === 1 ? "1 person" : `${n} people`} to invite once you approve it: see Admin > Fundraising` : "Nobody added. They can share the join link.",
    ]);
  }
  // TASK-511: a sign up made since has the name in two parts, and Instagram and Facebook apart; one
  // from before reads as it always did.
  const split = Boolean(f.firstName || f.lastName);
  const ownLinks = f.instagram !== undefined || f.facebook !== undefined;
  const social: Array<[string, string]> = ownLinks || !f.socialLink
    ? [["Instagram", f.instagram ?? "Not given"], ["Facebook", f.facebook ?? "Not given"]]
    : [["Facebook or Instagram", f.socialLink]];
  const shoutOut = !f.wants.shoutOut
    ? "No"
    : f.socialOk
      ? "Yes please"
      : "Yes please, but they have not said we can post about it, so ask them first";
  facts.push(
    ["On the NBCC website", f.public ? "Yes, they would like it shown" : "No, not to be shown on the website"],
    ["Organiser", f.name],
    ...(split ? ([["First name", f.firstName ?? ""], ["Surname", f.lastName ?? ""]] as Array<[string, string]>) : []),
    ["Email", f.email],
    ["Phone", f.phone],
    ...social,
    ["We can post about it", f.socialOk ? "Yes" : "No"],
    ...requestFacts(f.wants),
    ["A social media shout out", shoutOut],
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
  f: { name: string; title: string; path?: string; booking?: FundraiserRecord["booking"] },
  o: { pageUrl: string | null; manageUrl: string | null },
): BuiltEmail {
  const hi = `Hi ${firstName(f.name)},`;
  const title = escapeHtml(f.title);
  // Event pages: an event's page has words of its own, about the event, with no sponsorship tips.
  if (o.pageUrl && f.path === "event") return eventPageLiveEmail(f, hi, o.pageUrl, o.manageUrl);
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

/**
 * Event pages: "Your event's page is live", for an approved public event: its own page to share, its
 * posters with their QR codes, giving on the page, and help from us. Wording for Jaimie to approve.
 */
/**
 * Event clarity (Jaimie, 2026-10-03): what the organiser does with entry money, by how people get in.
 * Giving on the page is a donation, and Gift Aid never goes on entry or ticket money.
 */
function entryMoneyWords(booking: FundraiserRecord["booking"] | undefined): string {
  const noGiftAid = "Gift Aid can’t go on entry or ticket money.";
  if (booking === "door") return `Entry money is separate: collect it as usual and pay it in afterwards from your private area. ${noGiftAid}`;
  if (booking === "away") return `Ticket money goes through your ticket seller as usual; only pay in NBCC’s share of anything you collect yourself. ${noGiftAid}`;
  if (booking === "free") return "Entry is free, so anything people give on your page or on the day is a donation.";
  return `If you charge entry, collect it as usual and pay it in afterwards from your private area. ${noGiftAid}`;
}

function eventPageLiveEmail(f: { title: string; booking?: FundraiserRecord["booking"] }, hi: string, pageUrl: string, manageUrl: string | null): BuiltEmail {
  const title = escapeHtml(f.title);
  const intro = "is approved, and your event now has its very own page on the NBCC website, with a meter that fills up as people give.";
  const steps: Array<[string, string]> = [
    ["Share your event page", " on Facebook, WhatsApp and by email, so people know when and where to come."],
    ["Put up your posters", " from your private area. Each one has a QR code that takes people straight to your page."],
    [
      "On the day, point people to your page",
      ` if they’d like to give a little extra. ${entryMoneyWords(f.booking)}`,
    ],
  ];
  const gifts =
    "Every gift made on your page comes straight to NBCC, with Gift Aid on top when your supporters are UK taxpayers, and helps us bring comfort, dignity and joy to children, young people and vulnerable adults across South West Scotland.";
  const help = "Need anything for the day, like a collection bucket or someone from NBCC to come along? Just reply to this email.";
  const area = "is where you update your event, post news, print your posters and QR code, and pay in any cash you collect. We send you a code to get in, so there are no passwords to remember.";
  const areaHtml = manageUrl
    ? `<a href="${escapeHtml(manageUrl)}" style="color:inherit">Your private area</a> ${area}`
    : `Your private area ${area}`;
  const body =
    EYEBROW +
    heading("Your event’s page is live!") +
    bodyP(escapeHtml(hi)) +
    bodyP(`Great news: <b>${title}</b> ${intro}`) +
    button(pageUrl, "See my event page") +
    subheading("Three things that help") +
    bodyList(steps.map(([lead, rest]) => `<b>${lead}</b>${rest}`), true) +
    bodyP(gifts) +
    bodyP(help) +
    note(areaHtml);
  const text = [
    hi,
    "",
    `Great news: ${f.title} ${intro}`,
    "",
    `See my event page: ${pageUrl}`,
    "",
    "THREE THINGS THAT HELP",
    ...numbered(steps.map(([lead, rest]) => lead + rest)),
    "",
    gifts,
    "",
    help,
    "",
    `Your private area ${area}`,
    ...(manageUrl ? [`Your private area: ${manageUrl}`] : []),
  ];
  return toOrganiser(`Your event's page is live: ${f.title}`, body, text, "Wishing you a brilliant event,");
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
    bodyP("Nothing has changed on the website yet. Marking it finished takes it off the Get involved list; its page stays up with a thank you banner and can still take gifts.") +
    subheading("Next steps") +
    bodyList(steps.map(escapeHtml)) +
    button(o.adminUrl, "Open the admin") +
    signOff(line);
  const text = [
    "A FUNDRAISER SAYS THEY’VE FINISHED",
    "",
    `${f.name} says ${f.title} has finished. It has raised ${raised} so far.`,
    "",
    "Nothing has changed on the website yet. Marking it finished takes it off the Get involved list; its page stays up with a thank you banner and can still take gifts.",
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

// --- a news update, approved or not used (TASK-506) ---------------------------------------------
//
// The same shape and words as the two emails about a change (above), for a news update the
// organiser posted from their private area. A reason staff give for not using one is internal and
// never goes in the email.

/** Staff approved a news update. `pageUrl` only while their page is up, as for a change. */
export function buildNewsApprovedEmail(f: { name: string; title: string }, o: { pageUrl: string | null }): BuiltEmail {
  const hi = `Hi ${firstName(f.name)},`;
  const share = "Why not share your page again so everyone sees your news? A fresh share often brings in a few more gifts.";
  const where = o.pageUrl ? "it’s now on your page" : "it’s all saved";
  const body =
    EYEBROW +
    heading(o.pageUrl ? "Your news update is live!" : "Your news update is saved!") +
    bodyP(escapeHtml(hi)) +
    bodyP(`Good news: we’ve checked your news update for <b>${escapeHtml(f.title)}</b> and ${where}.`) +
    (o.pageUrl ? bodyP(share) + button(o.pageUrl, "See my page") : "");
  const text = [
    hi,
    "",
    `Good news: we’ve checked your news update for ${f.title} and ${where}.`,
    ...(o.pageUrl ? ["", share, "", `See my page: ${o.pageUrl}`] : []),
  ];
  const subject = o.pageUrl ? `Your news update is live: ${f.title}` : `Your news update is saved: ${f.title}`;
  return toOrganiser(subject, body, text, "Thanks so much,");
}

/** Staff did not use a news update: nothing to worry about, we'll ring. */
export function buildNewsRejectedEmail(f: { name: string; title: string }, o: { pageLive: boolean }): BuiltEmail {
  const hi = `Hi ${firstName(f.name)},`;
  const held = "We haven’t put this one on your page, and someone from our team will give you a quick ring to talk it through.";
  const calm = o.pageLive
    ? "Nothing to worry about: your page is still live, just as it was, and gifts are still coming in."
    : "Nothing to worry about: everything stays just as it was.";
  const body =
    EYEBROW +
    heading("About your news update") +
    bodyP(escapeHtml(hi)) +
    bodyP(`Thank you for sending a news update for <b>${escapeHtml(f.title)}</b>. ${held}`) +
    bodyP(calm);
  const text = [hi, "", `Thank you for sending a news update for ${f.title}. ${held}`, "", calm];
  return toOrganiser(`About your news update for ${f.title}`, body, text, "Speak soon,");
}
