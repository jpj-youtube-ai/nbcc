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
  quoteBox,
  signOff,
  signOffText,
  questionsBox,
  questionsText,
  PHONE_DISPLAY,
} from "../email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { dateParts } from "../events/render";
import { categoryLabel, OTHER_KIND } from "./categories";
import { FUNDRAISING_EMAIL, organiserFirstName, organiserGreeting, pounds, safeFirstName, type BuiltEmail, type Greeted } from "./emails";
import { shortName } from "./model";
import { forwardMessage } from "./teams";

// Team pages (Jaimie, 2026-10-03): the emails, built here and sent by src/fundraising/team-send.ts.
// NEW WORDING, every one, for Jaimie to sign off. Pure: no pool, no config, no clock.
//
//   team live        to the team organiser when staff approve the team: the page is live, the join
//                    link and a short message ready to forward (always, Jaimie's Q4), and how many
//                    of the people they added we have invited.
//   invite           to someone the team organiser added, once staff approve the team. It says why
//                    they got it ("[team organiser] gave us your email so we could invite you, or
//                    [first name] if this is a parent or guardian's email"), that that person is the
//                    team organiser, and that questions can still come to NBCC. Its button opens the
//                    join form filled in. "Not for you? Ignore this and we won't email again."
//                    When the team organiser ticked "This person is under 18", the email box was
//                    their parent's or guardian's: the invite and the reminder speak to the parent
//                    ("[team organiser] has invited [first name] to join ..."). NEW WORDING.
//   reminder         the ONE gentle reminder, 5 days later, if they have not joined. The same why.
//   nudge 1 and 2    to the team organiser, day 3 and (only if still nobody has joined) day 10:
//                    "Did you send the invite to your team? Here's the link to share with them."
//   join thanks      to someone who has just joined (their page waits for staff). Like the sign up
//                    thanks, it carries nothing they typed but a safe first name.
//   join staff       to the events inbox: a new member page to approve.
//   member removed   to the events inbox: the team organiser took someone off the team.
//   handover code    to the new team organiser when staff hand the role over: the code to confirm.
//
// The same shell, sign off and "Got any questions?" box as the other fundraising emails, with the
// events inbox as the contact. Every typed or stored value is escaped. No dashes.

/** The footer line on every email to someone the team organiser added (Jaimie's Q6). */
export const NOT_FOR_YOU = "Not for you? Ignore this and we won’t email again.";
/** The invite's footer: a reminder may still follow, once (review, 2026-10-03). */
export const INVITE_NOT_FOR_YOU = "Not for you? Just ignore this. We’ll send one gentle reminder at most, then we won’t email you again.";

const escapeHtml = (s: string): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const firstName = (name: string): string => shortName(name).split(" ")[0];

const shell = (body: string) => emailShell(body, { contactEmail: FUNDRAISING_EMAIL, registration: true, postalAddress: POSTAL_ADDRESS });

const EYEBROW = eyebrow("Fundraising for NBCC");

function toPerson(subject: string, bodyHtml: string, textLines: string[], line: string): BuiltEmail {
  const html = shell(bodyHtml + signOff(line) + questionsBox(FUNDRAISING_EMAIL));
  const text = [...textLines, "", signOffText(line), "", questionsText(FUNDRAISING_EMAIL), "", FOOTER_TEXT].join("\n");
  return { subject, html, text };
}

function toStaff(subject: string, bodyHtml: string, textLines: string[]): BuiltEmail {
  const line = "Go team!";
  return { subject, html: shell(bodyHtml + signOff(line)), text: [...textLines, "", signOffText(line)].join("\n") };
}

export interface TeamWords {
  title: string;
  kind: string;
  kindLabel?: string | null;
  kindOther?: string | null;
  eventDate: string | null;
}

/** "their Santa dash on Saturday 5 December": what the team is doing, from its category and date. */
export function teamEventWords(t: TeamWords): string {
  const what = (t.kind === OTHER_KIND && t.kindOther ? t.kindOther : t.kindLabel || categoryLabel(t.kind)).trim();
  // "Walk" reads "their walk"; a name stays a name: "their Santa dash".
  const lower = /^(Santa|Christmas|NBCC)\b/.test(what) ? what : what.charAt(0).toLowerCase() + what.slice(1);
  if (!t.eventDate) return `their ${lower}`;
  const p = dateParts(t.eventDate);
  return `their ${lower} on ${p.dayName} ${p.day} ${p.month}`;
}

// --- your team page is live ---------------------------------------------------------------------

export function buildTeamLiveEmail(
  t: TeamWords & Greeted,
  o: { pageUrl: string | null; manageUrl: string; joinUrl: string; invited: number },
): BuiltEmail {
  const hi = organiserGreeting(t);
  const title = escapeHtml(t.title);
  // A team kept off the website has no page to link to: it is approved, and the join link still works.
  const page = o.pageUrl;
  const liveWords = (name: string) =>
    page
      ? `Brilliant news: ${name} is approved and your team page is live. As the team organiser, you get the team’s emails and look after the team page.`
      : `Brilliant news: ${name} is approved. As the team organiser, you get the team’s emails and look after your team.`;
  const live = liveWords(t.title);
  const share = "Here’s the link for your team to join. Copy and send this to your team, on WhatsApp, in a group chat or by email:";
  const message = forwardMessage(t, o.joinUrl);
  const invited =
    o.invited > 0
      ? `We’ve emailed an invite to the ${o.invited === 1 ? "1 person" : `${o.invited} people`} you added. Anyone who joins gets their own page once we’ve checked it, and everything they raise counts towards your team total too.`
      : "Anyone who joins gets their own page once we’ve checked it, and everything they raise counts towards your team total too.";
  const area = "Your private area has the join link too, and shows who has joined.";
  const body =
    EYEBROW +
    heading(page ? "Your team page is live!" : "Your team is approved!") +
    bodyP(escapeHtml(hi)) +
    bodyP(liveWords(`<b>${title}</b>`)) +
    (page ? button(page, "See our team page") : "") +
    subheading("Invite your team") +
    bodyP("Here’s the link for your team to join. Copy and send this to your team, on WhatsApp, in a group chat or by email:") +
    quoteBox(message) +
    bodyP(escapeHtml(invited)) +
    note(`<a href="${escapeHtml(o.manageUrl)}" style="color:inherit">Your private area</a> has the join link too, and shows who has joined.`);
  const text = [
    hi,
    "",
    live,
    "",
    ...(page ? [`See our team page: ${page}`, ""] : []),
    "INVITE YOUR TEAM",
    share,
    "",
    message,
    "",
    invited,
    "",
    area,
    `Your private area: ${o.manageUrl}`,
  ];
  return toPerson(page ? `Your team page is live: ${t.title}` : `Your team is approved: ${t.title}`, body, text, "Cheering your whole team on,");
}

// --- the invite, and the one reminder -----------------------------------------------------------

export interface InviteWords {
  /** The first name the team organiser typed: theirs, or a child's at a parent's email. */
  firstName: string;
  /** The team organiser's whole name. */
  organiserName: string;
  /** The first name the team organiser gave on the form, when they gave one. */
  organiserFirstName?: string | null;
  /** The team organiser ticked "This person is under 18": the email is their parent's or guardian's. */
  under18?: boolean;
  team: TeamWords;
  /** The join form, with this invite's token, so it opens filled in. */
  joinUrl: string;
}

/** "Robin" for the team organiser; a group's or a business's whole name, never "The" (organiserFirstName). */
const organiserShort = (o: InviteWords): string =>
  organiserFirstName({ name: o.organiserName, firstName: o.organiserFirstName ?? null }) ?? o.organiserName.trim();

function why(o: InviteWords): string {
  if (o.under18) {
    const child = o.firstName.trim();
    return (
      `${o.organiserName.trim()} gave us your email, as the parent or guardian of ${child}, so we could invite ${child} ` +
      `to join ${o.team.title} for ${teamEventWords(o.team)}.`
    );
  }
  return (
    `${o.organiserName.trim()} gave us your email so we could invite you (or ${o.firstName.trim()}, if this is a parent or guardian’s email) ` +
    `to join ${o.team.title} for ${teamEventWords(o.team)}.`
  );
}

const WHO_WE_ARE = "We’re the Night Before Christmas Campaign (NBCC), a Scottish charity supporting children, young people and vulnerable adults, all year round.";

function askUs(o: InviteWords): string {
  return `Any questions about the team? Ask ${organiserShort(o)}, or ask us: just reply to this email, email ${FUNDRAISING_EMAIL} or call ${PHONE_DISPLAY}.`;
}

export function buildTeamInviteEmail(o: InviteWords): BuiltEmail {
  const organiser = organiserShort(o);
  const name = o.firstName.trim();
  const role = o.under18
    ? `${organiser} is the team organiser. Joining takes a couple of minutes: ${name} gets a page with a meter, and everything it raises counts towards the team’s total too.`
    : `${organiser} is the team organiser. Joining takes a couple of minutes: you get your own page with a meter, and everything you raise counts towards the team’s total too.`;
  const child = o.under18
    ? `As ${name} is under 18, you set up the page as the parent or guardian, and can name ${name} on it.`
    : "Setting this up for someone under 18? A parent or guardian sets up their page, and can name them on it.";
  const body =
    EYEBROW +
    heading(o.under18 ? `${escapeHtml(name)} is invited to join a team!` : "You’re invited to join a team!") +
    bodyP("Hello,") +
    bodyP(escapeHtml(why(o))) +
    bodyP(escapeHtml(role)) +
    button(o.joinUrl, "Join the team") +
    bodyP(escapeHtml(child)) +
    bodyP(escapeHtml(WHO_WE_ARE)) +
    bodyP(escapeHtml(askUs(o))) +
    note(escapeHtml(INVITE_NOT_FOR_YOU));
  const text = ["Hello,", "", why(o), "", role, "", `Join the team: ${o.joinUrl}`, "", child, "", WHO_WE_ARE, "", askUs(o), "", INVITE_NOT_FOR_YOU];
  return toPerson(`${organiser} has invited ${o.under18 ? name : "you"} to join ${o.team.title}`, body, text, "Hope to see you on the team,");
}

export function buildTeamInviteReminderEmail(o: InviteWords): BuiltEmail {
  const organiser = organiserShort(o);
  const name = o.firstName.trim();
  const lead = "Just a gentle reminder about the team invite we sent a few days ago.";
  const role = `${organiser} is the team organiser, and it only takes a couple of minutes to join.`;
  const once = "This is the only reminder we’ll send.";
  const body =
    EYEBROW +
    heading(`Still keen ${o.under18 ? `for ${escapeHtml(name)} to join` : "to join"} ${escapeHtml(o.team.title)}?`) +
    bodyP("Hello,") +
    bodyP(escapeHtml(lead)) +
    bodyP(escapeHtml(why(o))) +
    bodyP(escapeHtml(role)) +
    button(o.joinUrl, "Join the team") +
    bodyP(escapeHtml(askUs(o))) +
    note(`${escapeHtml(once)} ${NOT_FOR_YOU}`);
  const text = ["Hello,", "", lead, "", why(o), "", role, "", `Join the team: ${o.joinUrl}`, "", askUs(o), "", once, NOT_FOR_YOU];
  return toPerson(`A gentle reminder: ${o.under18 ? `${name} is invited to join` : "join"} ${o.team.title}`, body, text, "Hope to see you on the team,");
}

// --- the nudges to the team organiser -----------------------------------------------------------

export function buildTeamNudgeEmail(n: 1 | 2, o: Greeted & { title: string; pageUrl: string; joinUrl: string }): BuiltEmail {
  const hi = organiserGreeting(o);
  const message = forwardMessage(o, o.joinUrl);
  const lead =
    n === 1
      ? `${o.title} has been live for a few days, and nobody has joined yet. Did you send the invite to your team? Here’s the link to share with them:`
      : `${o.title} has been live for over a week, and nobody has joined yet. Here’s your team link again, ready to share:`;
  const tip = "A quick message in your group chat usually does it. Copy this and send it:";
  const last = n === 2 ? "We won’t nudge you about this again." : "";
  const body =
    EYEBROW +
    heading(n === 1 ? "Did you send the invite to your team?" : "Here’s your team link again") +
    bodyP(escapeHtml(hi)) +
    bodyP(`${escapeHtml(lead)} <a href="${escapeHtml(o.joinUrl)}">${escapeHtml(o.joinUrl)}</a>`) +
    bodyP(escapeHtml(tip)) +
    quoteBox(message) +
    button(o.pageUrl, "See our team page") +
    (last ? note(escapeHtml(last)) : "");
  const text = [hi, "", lead, o.joinUrl, "", tip, "", message, "", `See our team page: ${o.pageUrl}`, ...(last ? ["", last] : [])];
  const subject = n === 1 ? "Did you send the invite to your team?" : `Nobody on ${o.title} yet: here’s your team link again`;
  return toPerson(subject, body, text, "Cheering your team on,");
}

// --- after someone joins ------------------------------------------------------------------------

/**
 * To someone who has just joined. Anyone can type any address into the public join form, so it
 * carries nothing they typed but a safe first name (safeFirstName), and the team's name, which staff
 * approved.
 */
export function buildJoinThanksEmail(typedFirstName: string | null | undefined, teamTitle: string): BuiltEmail {
  const first = safeFirstName(typedFirstName);
  const hi = first ? `Hi ${first},` : "Hi there,";
  const got = `Thank you for joining ${teamTitle}! We’ve got your sign up.`;
  const next = "Someone from NBCC will check it, usually within a few days, and then we’ll email you the link to your own page. Everything you raise counts towards the team’s total too.";
  const small = "Didn’t sign up? No problem, just ignore this email. Nothing goes on our website until we’ve checked it.";
  const body = EYEBROW + heading("Welcome to the team!") + bodyP(escapeHtml(hi)) + bodyP(escapeHtml(got)) + bodyP(escapeHtml(next)) + note(escapeHtml(small));
  return toPerson(`Thanks for joining ${teamTitle}!`, body, [hi, "", got, "", next, "", small], "Thanks so much,");
}

/** To the events inbox: a new member page waiting for staff. */
export function buildJoinStaffEmail(
  m: { name: string; email: string; title: string; targetPence: number | null; description: string },
  t: { title: string; name: string },
  o: { adminUrl: string; split: string },
): BuiltEmail {
  const facts: Array<[string, string]> = [
    ["Team", t.title],
    ["Team organiser", t.name],
    ["Joining", m.name],
    ["Email", m.email],
    ["Their page", m.title],
    ["Target", m.targetPence ? pounds(m.targetPence) : "No target"],
    ["Why", m.description],
    ["Sharing with another cause", o.split],
  ];
  const steps = ["Approve or decline it in Admin > Fundraising. Nothing shows until you do.", `Replying to this email replies to ${organiserFirstName(m) ?? m.name.trim()}.`];
  const rows = facts
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;vertical-align:top;color:#6F6A66;font-size:13px">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 0;vertical-align:top;font-size:14px">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const body =
    eyebrow("For the team") +
    heading("A new team member!") +
    bodyP(`<b>${escapeHtml(m.name)}</b> wants to join <b>${escapeHtml(t.title)}</b>. Their page is waiting for you.`) +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px">${rows}</table>` +
    subheading("Next steps") +
    bodyList(steps.map(escapeHtml)) +
    button(o.adminUrl, "Open the admin");
  const text = [
    "A NEW TEAM MEMBER!",
    "",
    `${m.name} wants to join ${t.title}. Their page is waiting for you.`,
    "",
    ...facts.map(([label, value]) => `${label}: ${value}`),
    "",
    "NEXT STEPS",
    ...steps.map((s) => `* ${s}`),
    "",
    `Open the admin: ${o.adminUrl}`,
  ];
  return toStaff(`New team member: ${m.name} wants to join ${t.title}`, body, text);
}

/** To the events inbox: the team organiser took someone off the team, from their private area. */
export function buildMemberRemovedStaffEmail(
  o: { memberName: string; teamTitle: string; organiserName: string },
  links: { adminUrl: string },
): BuiltEmail {
  const what = `${o.organiserName}, the team organiser, took ${o.memberName} off ${o.teamTitle} from their private area.`;
  const after = "Their page stays up as their own, and what it raises no longer counts towards the team’s total. If that doesn’t sound right, give the team organiser a ring.";
  const body =
    eyebrow("For the team") +
    heading("Someone was taken off a team") +
    bodyP(escapeHtml(what)) +
    bodyP(escapeHtml(after)) +
    button(links.adminUrl, "Open the admin");
  return toStaff(`${o.memberName} was taken off ${o.teamTitle}`, body, [what, "", after, "", `Open the admin: ${links.adminUrl}`]);
}

// --- the handover code ----------------------------------------------------------------------------

export function buildHandoverCodeEmail(o: { firstName: string; teamTitle: string; code: string; manageUrl: string }): BuiltEmail {
  const hi = `Hi ${o.firstName.trim()},`;
  const why = `We’ve been asked to make you the team organiser of ${o.teamTitle}. The team organiser gets the team’s emails and looks after the team page.`;
  const how = `To say yes, go to ${o.manageUrl}, choose "Taking over a team?", and put in your email address and this code. It works for 3 days.`;
  const small = "Not expecting this? Ignore it and nothing changes.";
  const body =
    EYEBROW +
    heading("Becoming team organiser") +
    bodyP(escapeHtml(hi)) +
    bodyP(escapeHtml(why)) +
    codeBox(o.code) +
    bodyP(
      `To say yes, go to <a href="${escapeHtml(o.manageUrl)}">${escapeHtml(o.manageUrl)}</a>, choose "Taking over a team?", and put in your email address and this code. It works for 3 days.`,
    ) +
    note(escapeHtml(small));
  const text = [hi, "", why, "", `Your code: ${o.code}`, "", how, "", small];
  return toPerson(`Your code to become team organiser of ${o.teamTitle}`, body, text, "Thanks so much,");
}
