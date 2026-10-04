import {
  emailShell,
  heading,
  subheading,
  eyebrow,
  bodyP,
  bodyList,
  note,
  button,
  meterBar,
  signOff,
  signOffText,
  questionsBox,
  questionsText,
} from "../email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { raiseOrdinals } from "../email/dates";
import { FUNDRAISING_EMAIL, organiserFirstName, organiserGreeting, pounds, safeFirstName, type BuiltEmail } from "./emails";
import { pagePath, type FundraiserRecord, type Meter } from "./model";
import type { TouchKind } from "./touch-rules";
import { firstWord } from "./signup-tidy";

// TASK-515: the automatic emails to an organiser, built here and sent by ./touch-runner.ts.
//
//   12 first gift, 13 halfway, 15 a week before, 16 a week after, 17 finished, 18 a year on: the
//   words Jaimie approved on 2026-10-02 (memory: nbcc-fundraising-emails-approved-2026-10-02).
//   14 target reached: the approved email, changed as Jaimie asked on 2026-10-03 to cheer them on
//   to beat their goal, with a button to raise their target from their private area. NEW WORDING.
//   need a hand, you're doing great: written for this task in the same voice. NEW WORDING.
//
// Every one is shown in Admin > Fundraising > Automatic emails before any is sent (Jaimie's rule:
// every automatic email readable in the admin first), and nothing is sent until an admin switches
// Automatic emails on. Pure: no pool, no config, no clock. The same shell, sign off and "Got any
// questions?" box as the other fundraising emails (./emails.ts), with the events inbox as the
// contact. Every stored value is escaped. Plain friendly English, no dashes.

export interface TouchUrls {
  /** Their page. */
  page: string;
  /** Their private area. */
  manage: string;
  /** Their private area, at "Change your details", where the target is. */
  editTarget: string;
  /** Their certificate, in their private area (TASK-504). */
  certificate: string;
  /** The fundraising help page. */
  help: string;
  /** The sign up form, to do it again. */
  signUp: string;
}

export interface TouchEmailData {
  name: string;
  /** The first name they gave on the form, and the name an event is credited to (organiserFirstName). */
  firstName?: string | null;
  creditName?: string | null;
  /** A page for someone under 18: their parent's or guardian's first name. The email goes to them. */
  guardianFirstName?: string | null;
  title: string;
  raisedPence: number;
  targetPence: number | null;
  urls: TouchUrls;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Every date in the body has its ending raised ("7th" as 7<sup>th</sup>): ../email/dates.ts.
const shell = (body: string) => emailShell(raiseOrdinals(body), { contactEmail: FUNDRAISING_EMAIL, registration: true, postalAddress: POSTAL_ADDRESS });

const EYEBROW = eyebrow("Fundraising for NBCC");

function toOrganiser(subject: string, bodyHtml: string, textLines: string[], line: string): BuiltEmail {
  const html = shell(bodyHtml + signOff(line) + questionsBox(FUNDRAISING_EMAIL));
  const text = [...textLines, "", signOffText(line), "", questionsText(FUNDRAISING_EMAIL), "", FOOTER_TEXT].join("\n");
  return { subject, html, text };
}

/** The meter in a plain text part. */
const meterText = (raised: number, target: number | null) =>
  target ? `${pounds(raised)} raised of ${pounds(target)}` : `${pounds(raised)} raised so far`;

/** All the links an organiser's emails use, from the site's address. */
export function touchUrls(base: string, f: { id: number; slug: string; path?: FundraiserRecord["path"] }): TouchUrls {
  const b = base.replace(/\/+$/, "");
  return {
    // Event pages: an event's own page is /event/<short name>; without a kind it is a fundraiser's.
    page: `${b}${pagePath({ slug: f.slug, path: f.path ?? "raising" })}`,
    manage: `${b}/fundraise/manage`,
    editTarget: `${b}/fundraise/manage#mineEditHeading`,
    certificate: `${b}/api/fundraise/manage/fundraisers/${f.id}/materials/certificate`,
    help: `${b}/fundraise/help`,
    signUp: `${b}/fundraise`,
  };
}

/** What the emails need from a stored fundraiser and its meter. Raised never counts Gift Aid. */
export function touchEmailData(
  f: Pick<FundraiserRecord, "id" | "slug" | "name" | "title" | "targetPence"> &
    Partial<Pick<FundraiserRecord, "path" | "firstName" | "creditName" | "guardianFirstName">> & { meter: Pick<Meter, "raisedPence"> },
  base: string,
): TouchEmailData {
  return {
    name: f.name,
    firstName: f.firstName ?? null,
    creditName: f.creditName ?? null,
    guardianFirstName: f.guardianFirstName ?? null,
    title: f.title,
    raisedPence: f.meter.raisedPence,
    targetPence: f.targetPence,
    urls: touchUrls(base, f),
  };
}

// What each email shows in the admin's preview before anything is sent: invented, like the
// approved drafts (Sam's Santa Dash, a £500 target).
const SAMPLE_RAISED: Record<TouchKind, number> = {
  first_gift: 2000,
  halfway: 25000,
  target: 50000,
  week_before: 31000,
  week_after: 54000,
  finished: 61200,
  year_on: 61200,
  need_a_hand: 12000,
  on_track: 30000,
};

export function sampleTouchData(kind: TouchKind, base: string): TouchEmailData {
  return {
    name: "Sam Example",
    title: "Sam's Santa Dash",
    raisedPence: SAMPLE_RAISED[kind],
    targetPence: 50000,
    urls: touchUrls(base, { id: 7, slug: "sams-santa-dash" }),
  };
}

// `first` is null for a group or a business: the greeting is then "Hi there," and a subject drops the name.
//
// `kid` is set on a page for someone under 18 (Jaimie, 2026-10-04). The email goes to their parent or
// guardian, so it speaks to the parent THROUGHOUT, not just in the greeting and the subject: "your
// page" is the child's page, "you've raised" is what the child has raised, and a heading such as
// "You're doing great!" is "Jack is doing great!". A name ending in s never gets a possessive: it is
// "the page for James". On any other page `kid` is null, and every word is as it always was.
interface Kid {
  /** The child's first name, as their page shows it; "your child" when it is not a plain first name. */
  name: string;
  /** The same, to start a sentence: "Jack", "Your child". */
  Name: string;
  /** "Jack's page", "the page for James". */
  page: string;
  /** The same, to start a sentence: "Jack's page", "The page for James". */
  Page: string;
}

function kidOf(first: string | null): Kid {
  const name = first ?? "your child";
  const up = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const page = /s$/i.test(name) ? `the page for ${name}` : `${name}'s page`;
  return { name, Name: up(name), page, Page: up(page) };
}

type Builder = (d: TouchEmailData, hi: string, t: string, first: string | null, kid: Kid | null) => BuiltEmail;

/** A subject that carries the first name: to an adult, about a child to their parent, or with no name. */
const named = (first: string | null, child: boolean, adult: string, parent: string, plain: string): string =>
  first ? (child ? parent : adult).replace("{name}", () => first) : plain;

// A line written for a parent carries the child's name, so its HTML is escaped whole.
const h = escapeHtml;

const BUILDERS: Record<TouchKind, Builder> = {
  // 12, approved.
  first_gift: (d, hi, t, _first, kid) => {
    const title = kid ? `The first gift is in for ${kid.name}!` : "Your first gift is in!";
    const meter = kid ? "the meter" : "your meter";
    const tip = kid
      ? `share ${kid.page} again today. People are more likely to give once they see others already have.`
      : "share your page again today. People are more likely to give once they see others already have.";
    const see = kid ? "See the page" : "See my page";
    const body =
      EYEBROW +
      heading(kid ? h(title) : title) +
      bodyP(escapeHtml(hi)) +
      bodyP(`Exciting news: someone has just made the very first gift on <b>${t}</b>, and ${meter} has started to fill!`) +
      meterBar(d.raisedPence, d.targetPence) +
      bodyP("The first gift is often the hardest, so this is a lovely moment to celebrate.") +
      bodyP(`<b>Top tip:</b> ${kid ? h(tip) : tip}`) +
      button(d.urls.page, see);
    const text = [
      hi,
      "",
      `Exciting news: someone has just made the very first gift on ${d.title}, and ${meter} has started to fill!`,
      "",
      meterText(d.raisedPence, d.targetPence),
      "",
      "The first gift is often the hardest, so this is a lovely moment to celebrate.",
      "",
      `Top tip: ${tip}`,
      "",
      `${see}: ${d.urls.page}`,
    ];
    return toOrganiser(title, body, text, "High fives all round,");
  },

  // 13, approved.
  halfway: (d, hi, t, _first, kid) => {
    const of = `has raised ${pounds(d.raisedPence)} of ${kid ? "the" : "your"} ${pounds(d.targetPence ?? 0)} target. That's amazing! Thank you, and a huge thank you to everyone who has given.`;
    const keep = kid
      ? `The second half often goes faster than the first, so keep sharing. ${kid.Name} has got this!`
      : "The second half often goes faster than the first, so keep sharing. You've got this!";
    const title = kid ? `${kid.Name} is halfway there!` : "You're halfway there!";
    const see = kid ? "See the page" : "See my page";
    const body =
      EYEBROW +
      heading(kid ? h(title) : title) +
      bodyP(escapeHtml(hi)) +
      bodyP(`<b>${t}</b> ${of}`) +
      meterBar(d.raisedPence, d.targetPence) +
      bodyP(kid ? h(keep) : keep) +
      button(d.urls.page, see);
    const text = [hi, "", `${d.title} ${of}`, "", meterText(d.raisedPence, d.targetPence), "", keep, "", `${see}: ${d.urls.page}`];
    return toOrganiser(title, body, text, "Onwards and upwards,");
  },

  // 14, the approved email changed as Jaimie asked: cheer them on to beat their goal. NEW WORDING.
  target: (d, hi, t, _first, kid) => {
    const reached = `has reached its ${pounds(d.targetPence ?? d.raisedPence)} target! That is a truly wonderful thing to have done for the children, young people and vulnerable adults we support.`;
    const further = kid
      ? `But why stop there? ${kid.Page} stays open, so every gift from here on is a bonus for the children, young people and vulnerable adults we support. Why not see if ${kid.name} can beat the goal?`
      : "But why stop there? Your page stays open, so every gift from here on is a bonus for the children, young people and vulnerable adults we support. Why not see if you can beat your goal?";
    const raise = kid
      ? `Set a new target from your private area, then share ${kid.page} again to tell everyone. We'd love to see how far ${kid.name} can go!`
      : "Set yourself a new target from your private area, then share your page again to tell everyone. We'd love to see how far you can go!";
    const check = kid
      ? `We check every change before it goes on ${kid.page}, so the new target may take a day or so to show.`
      : "We check every change before it goes on your page, so your new target may take a day or so to show.";
    const title = kid ? `${kid.Name} did it!` : "You did it!";
    const label = kid ? "Raise the target" : "Raise my target";
    const body =
      EYEBROW +
      heading(kid ? h(title) : title) +
      bodyP(escapeHtml(hi)) +
      bodyP(`WOW. <b>${t}</b> ${reached}`) +
      meterBar(d.raisedPence, d.targetPence) +
      bodyP(kid ? h(further) : further) +
      bodyP(kid ? h(raise) : raise) +
      button(d.urls.editTarget, label) +
      note(kid ? h(check) : check);
    const text = [
      hi,
      "",
      `WOW. ${d.title} ${reached}`,
      "",
      meterText(d.raisedPence, d.targetPence),
      "",
      further,
      "",
      raise,
      "",
      `${label}: ${d.urls.editTarget}`,
      "",
      check,
    ];
    return toOrganiser(`${title} Target reached`, body, text, "With the biggest thanks,");
  },

  // 15, approved.
  week_before: (d, hi, t, first, kid) => {
    const away = kid
      ? `is just a week away, and we're so excited for ${kid.name}! Everything you need is ready in your private area: your QR code, your poster and your sponsor form.`
      : "is just a week away, and we're so excited for you! Everything you need is ready in your private area: your QR code, your poster and your sponsor form.";
    const tip = kid
      ? `a last share of ${kid.page} this week usually brings in a few more gifts. And on the day, we'd love a photo or two. Send them our way and we might share them!`
      : "a last share of your page this week usually brings in a few more gifts. And on the day, we'd love a photo or two. Send them our way and we might share them!";
    const body =
      EYEBROW +
      heading("One week to go!") +
      bodyP(escapeHtml(hi)) +
      bodyP(`<b>${t}</b> ${kid ? h(away) : away}`) +
      button(d.urls.manage, "Open my private area") +
      bodyP(`<b>Top tip:</b> ${kid ? h(tip) : tip}`);
    const text = [hi, "", `${d.title} ${away}`, "", `Open my private area: ${d.urls.manage}`, "", `Top tip: ${tip}`];
    return toOrganiser(
      named(first, kid !== null, "One week to go, {name}!", "One week to go for {name}!", "One week to go!"),
      body,
      text,
      kid ? "Good luck to you both!" : "Good luck, you've got this!",
    );
  },

  // 16, approved. With nothing in yet, the total is left out rather than cheering £0.
  week_after: (d, hi, t, _first, kid) => {
    const who = kid ? `${kid.name} has` : "you've";
    const so = d.raisedPence > 0 ? ` So far ${kid ? h(who) : who} raised <b>${pounds(d.raisedPence)}</b> for NBCC, which is just fantastic.` : "";
    const soText = d.raisedPence > 0 ? ` So far ${who} raised ${pounds(d.raisedPence)} for NBCC, which is just fantastic.` : "";
    const pay = `Pay it in by card from your private area in a couple of minutes, and it goes straight onto ${kid ? "the" : "your"} meter.`;
    const other =
      "Prefer a bank transfer, or to drop it in? Give us a ring and we'll sort it. Please send us any paper sponsor forms too, so we can claim Gift Aid on them.";
    const body =
      EYEBROW +
      heading("How did it go?") +
      bodyP(escapeHtml(hi)) +
      bodyP(`We hope <b>${t}</b> was a brilliant day!${so}`) +
      subheading("Collected some cash or sponsor money?") +
      bodyP(pay) +
      button(d.urls.manage, "Pay in what I collected") +
      bodyP(other);
    const text = [
      hi,
      "",
      `We hope ${d.title} was a brilliant day!${soText}`,
      "",
      "COLLECTED SOME CASH OR SPONSOR MONEY?",
      pay,
      "",
      `Pay in what I collected: ${d.urls.manage}`,
      "",
      other,
    ];
    return toOrganiser("How did it go?", body, text, "Thanks so much,");
  },

  // 17, approved, with the certificate (TASK-504). With nothing raised, the amount is left out.
  finished: (d, hi, t, _first, kid) => {
    const thanks = kid
      ? `Thank you for every step, every share and every ask. ${kid.Name} has made a real difference to the children, young people and vulnerable adults we support.`
      : "Thank you for every step, every share and every ask. You've made a real difference to the children, young people and vulnerable adults we support.";
    const thanksHtml = kid ? h(thanks) : thanks;
    const and = (s: string) => s.replace("Thank you for every", "and for every");
    const lead = d.raisedPence > 0 ? `<b>${t}</b> raised an incredible <b>${pounds(d.raisedPence)}</b> for NBCC. ${thanksHtml}` : `Thank you so much for <b>${t}</b>, ${and(thanksHtml)}`;
    const leadText = d.raisedPence > 0 ? `${d.title} raised an incredible ${pounds(d.raisedPence)} for NBCC. ${thanks}` : `Thank you so much for ${d.title}, ${and(thanks)}`;
    const cert = kid ? `We've made ${kid.name} a certificate to say thank you. Print it, frame it, show it off!` : "We've made you a certificate to say thank you. Print it, frame it, show it off!";
    const after = kid
      ? `${kid.Page} stays up, so late gifts still count. And if ${kid.name} fancies doing something again, we'd love that.`
      : "Your page stays up, so late gifts still count. And if you fancy doing something again, we'd love that.";
    const label = kid ? "See the certificate" : "See my certificate";
    const body =
      EYEBROW +
      heading("Thank you, from all of us") +
      bodyP(escapeHtml(hi)) +
      bodyP(lead) +
      bodyP(kid ? h(cert) : cert) +
      button(d.urls.certificate, label) +
      bodyP(kid ? h(after) : after);
    const text = [hi, "", leadText, "", cert, "", `${label}: ${d.urls.certificate}`, "", after];
    return toOrganiser("Thank you from all of us at NBCC", body, text, "With love and huge thanks,");
  },

  // 18, approved.
  year_on: (d, hi, t, _first, kid) => {
    const raised = d.raisedPence > 0 ? ` and raised <b>${pounds(d.raisedPence)}</b>` : "";
    const raisedText = d.raisedPence > 0 ? ` and raised ${pounds(d.raisedPence)}` : "";
    const who = kid ? `${kid.name} did` : "you did";
    // Jaimie, 2026-10-04: the button opens the form filled in from last year; they still check it and
    // send it. And three plain dots, the same in the subject, the heading and the line after it.
    const again = `Fancy doing it again? We've kept ${kid ? "the" : "your"} page details, so it only takes a minute to set up a new one.`;
    const body =
      EYEBROW +
      heading("A year ago today...") +
      bodyP(escapeHtml(hi)) +
      bodyP(`...${kid ? h(who) : who} <b>${t}</b>${raised} for NBCC. We still smile thinking about it!`) +
      bodyP(again) +
      button(d.urls.signUp, "Do it again");
    const text = [hi, "", `...${who} ${d.title}${raisedText} for NBCC. We still smile thinking about it!`, "", again, "", `Do it again: ${d.urls.signUp}`];
    return toOrganiser("A year ago today...", body, text, "Here all year, and here for you,");
  },

  // NEW WORDING, for Jaimie to sign off: once, when their date is close and they are behind. It
  // never says so: it offers help.
  need_a_hand: (d, hi, t, first, kid) => {
    const soon = `is coming up soon, and we'd love to help you ${kid ? `and ${kid.name} ` : ""}make the most of it. Every gift so far is already making a difference to the children, young people and vulnerable adults we support.`;
    const offers: Array<[string, string]> = [
      ["Posters and leaflets", " to put up at work, at school or in your local shop."],
      ["A collection bucket or tin", " for the day itself."],
      ["A shout out", " on our social media, to help spread the word."],
    ];
    const ask = "Just reply to this email or give us a ring, and tell us what would help. We'll get it sorted.";
    const ideas = "Our fundraising help page has lots more ideas too.";
    const tip = "a quick personal message to a few friends often works better than one big post. People love to be asked!";
    const body =
      EYEBROW +
      heading("Need a hand?") +
      bodyP(escapeHtml(hi)) +
      bodyP(`<b>${t}</b> ${kid ? h(soon) : soon}`) +
      subheading("We can help with") +
      bodyList(offers.map(([lead, rest]) => `<b>${lead}</b>${rest}`)) +
      bodyP(ask) +
      bodyP(ideas) +
      button(d.urls.help, "Get some ideas") +
      bodyP(`<b>Top tip:</b> ${tip}`);
    const text = [
      hi,
      "",
      `${d.title} ${soon}`,
      "",
      "WE CAN HELP WITH",
      ...offers.map(([lead, rest]) => `* ${lead}${rest}`),
      "",
      ask,
      "",
      ideas,
      `Get some ideas: ${d.urls.help}`,
      "",
      `Top tip: ${tip}`,
    ];
    return toOrganiser(named(first, kid !== null, "Need a hand, {name}?", "Can we give you and {name} a hand?", "Need a hand?"), body, text, "Cheering you on,");
  },

  // NEW WORDING, for Jaimie to sign off: once, when they are on track for their target.
  on_track: (d, hi, t, first, kid) => {
    const track = kid
      ? `and we just had to say: ${kid.name} is right on track for the ${pounds(d.targetPence ?? 0)} target!`
      : `and we just had to say: you're right on track for your ${pounds(d.targetPence ?? 0)} target!`;
    const thanks = "Thank you, and a big thank you to everyone who has given so far. Every pound helps the children, young people and vulnerable adults we support, all year round.";
    const tip = kid
      ? `keep the momentum going. Share ${kid.page} again, or post a news update from your private area so supporters can see how it's going. People love to see progress!`
      : "keep the momentum going. Share your page again, or post a news update from your private area so your supporters can see how it's going. People love to see progress!";
    const title = kid ? `${kid.Name} is doing great!` : "You're doing great!";
    const see = kid ? "See the page" : "See my page";
    const body =
      EYEBROW +
      heading(kid ? h(title) : title) +
      bodyP(escapeHtml(hi)) +
      bodyP(`We've been keeping an eye on <b>${t}</b>, ${kid ? h(track) : track}`) +
      meterBar(d.raisedPence, d.targetPence) +
      bodyP(thanks) +
      bodyP(`<b>Top tip:</b> ${kid ? h(tip) : tip}`) +
      button(d.urls.page, see);
    const text = [
      hi,
      "",
      `We've been keeping an eye on ${d.title}, ${track}`,
      "",
      meterText(d.raisedPence, d.targetPence),
      "",
      thanks,
      "",
      `Top tip: ${tip}`,
      "",
      `${see}: ${d.urls.page}`,
    ];
    return toOrganiser(named(first, kid !== null, "You're doing great, {name}!", "{name} is doing great!", "You're doing great!"), body, text, "Keep up the brilliant work,");
  },
};

/** One automatic email, ready to send. */
export function buildTouchEmail(kind: TouchKind, d: TouchEmailData): BuiltEmail {
  // A child's page is one with a parent or guardian on it, whatever their name looks like: the email
  // goes to them, so it never speaks to the child. It greets the parent and says whose page it is
  // about ("Hi Sarah, this is about Jack's page."; "Hi there," with a parent's name we cannot greet by).
  const child = String(d.guardianFirstName ?? "").trim() !== "";
  if (!child) return BUILDERS[kind](d, organiserGreeting(d), escapeHtml(d.title), organiserFirstName(d), null);
  // The child's first name as their page shows it (firstWord: "JACK sample" is "Jack"), and only when
  // it is a safe first name (safeFirstName: one word of letters), because it goes in the subject and
  // the heading. Anything else is "your child", and the subject then drops the name.
  const name = safeFirstName(firstWord(d.firstName ?? d.name));
  const kid = kidOf(name);
  const hi = `Hi ${safeFirstName(d.guardianFirstName) ?? "there"}, this is about ${kid.page}.`;
  return BUILDERS[kind](d, hi, escapeHtml(d.title), name, kid);
}

/**
 * One automatic email exactly as it is sent. The daily run and Mark finished (./touch-runner.ts) send
 * this, and the admin shows this (the preview for a real fundraiser, and All emails), so what is read
 * is what goes. Use this, never buildTouchEmail alone: it is the ONE path all three share.
 *
 * On a page for someone under 18 the builder itself now writes the whole email for the parent or
 * guardian (Jaimie, 2026-10-04): the hello ("Hi Sarah, this is about Jack's page."), the subject, the
 * heading and every line. So nothing is added here, and the hello can never be put on twice. (Until
 * then this added the hello to an email otherwise written for the child.)
 */
export function touchEmailAsSent(kind: TouchKind, d: TouchEmailData): BuiltEmail {
  return buildTouchEmail(kind, d);
}
