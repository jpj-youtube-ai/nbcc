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
import { FUNDRAISING_EMAIL, organiserFirstName, organiserGreeting, pounds, safeFirstName, type BuiltEmail } from "./emails";
import { pagePath, type FundraiserRecord, type Meter } from "./model";
import type { TouchKind } from "./touch-rules";

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

const shell = (body: string) => emailShell(body, { contactEmail: FUNDRAISING_EMAIL, registration: true, postalAddress: POSTAL_ADDRESS });

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
// `child` is true on a page for someone under 18: the email goes to their parent or guardian, so a
// subject talks about the child ("One week to go for Jack!"), never to them. No possessives, so a
// name ending in s reads well.
type Builder = (d: TouchEmailData, hi: string, t: string, first: string | null, child: boolean) => BuiltEmail;

/** A subject that carries the first name: to an adult, about a child to their parent, or with no name. */
const named = (first: string | null, child: boolean, adult: string, parent: string, plain: string): string =>
  first ? (child ? parent : adult).replace("{name}", () => first) : plain;

const BUILDERS: Record<TouchKind, Builder> = {
  // 12, approved.
  first_gift: (d, hi, t) => {
    const tip = "share your page again today. People are more likely to give once they see others already have.";
    const body =
      EYEBROW +
      heading("Your first gift is in!") +
      bodyP(escapeHtml(hi)) +
      bodyP(`Exciting news: someone has just made the very first gift on <b>${t}</b>, and your meter has started to fill!`) +
      meterBar(d.raisedPence, d.targetPence) +
      bodyP("The first gift is often the hardest, so this is a lovely moment to celebrate.") +
      bodyP(`<b>Top tip:</b> ${tip}`) +
      button(d.urls.page, "See my page");
    const text = [
      hi,
      "",
      `Exciting news: someone has just made the very first gift on ${d.title}, and your meter has started to fill!`,
      "",
      meterText(d.raisedPence, d.targetPence),
      "",
      "The first gift is often the hardest, so this is a lovely moment to celebrate.",
      "",
      `Top tip: ${tip}`,
      "",
      `See my page: ${d.urls.page}`,
    ];
    return toOrganiser("Your first gift is in!", body, text, "High fives all round,");
  },

  // 13, approved.
  halfway: (d, hi, t) => {
    const of = `has raised ${pounds(d.raisedPence)} of your ${pounds(d.targetPence ?? 0)} target. That’s amazing! Thank you, and a huge thank you to everyone who has given.`;
    const keep = "The second half often goes faster than the first, so keep sharing. You’ve got this!";
    const body =
      EYEBROW +
      heading("You’re halfway there!") +
      bodyP(escapeHtml(hi)) +
      bodyP(`<b>${t}</b> ${of}`) +
      meterBar(d.raisedPence, d.targetPence) +
      bodyP(keep) +
      button(d.urls.page, "See my page");
    const text = [hi, "", `${d.title} ${of}`, "", meterText(d.raisedPence, d.targetPence), "", keep, "", `See my page: ${d.urls.page}`];
    return toOrganiser("You're halfway there!", body, text, "Onwards and upwards,");
  },

  // 14, the approved email changed as Jaimie asked: cheer them on to beat their goal. NEW WORDING.
  target: (d, hi, t) => {
    const reached = `has reached its ${pounds(d.targetPence ?? d.raisedPence)} target! That is a truly wonderful thing to have done for the children, young people and vulnerable adults we support.`;
    const further =
      "But why stop there? Your page stays open, so every gift from here on is a bonus for the children, young people and vulnerable adults we support. Why not see if you can beat your goal?";
    const raise = "Set yourself a new target from your private area, then share your page again to tell everyone. We’d love to see how far you can go!";
    const check = "We check every change before it goes on your page, so your new target may take a day or so to show.";
    const body =
      EYEBROW +
      heading("You did it!") +
      bodyP(escapeHtml(hi)) +
      bodyP(`WOW. <b>${t}</b> ${reached}`) +
      meterBar(d.raisedPence, d.targetPence) +
      bodyP(further) +
      bodyP(raise) +
      button(d.urls.editTarget, "Raise my target") +
      note(check);
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
      `Raise my target: ${d.urls.editTarget}`,
      "",
      check,
    ];
    return toOrganiser("You did it! Target reached", body, text, "With the biggest thanks,");
  },

  // 15, approved.
  week_before: (d, hi, t, first, child) => {
    const away =
      "is just a week away, and we’re so excited for you! Everything you need is ready in your private area: your QR code, your poster and your sponsor form.";
    const tip =
      "a last share of your page this week usually brings in a few more gifts. And on the day, we’d love a photo or two. Send them our way and we might share them!";
    const body =
      EYEBROW +
      heading("One week to go!") +
      bodyP(escapeHtml(hi)) +
      bodyP(`<b>${t}</b> ${away}`) +
      button(d.urls.manage, "Open my private area") +
      bodyP(`<b>Top tip:</b> ${tip}`);
    const text = [hi, "", `${d.title} ${away}`, "", `Open my private area: ${d.urls.manage}`, "", `Top tip: ${tip}`];
    return toOrganiser(named(first, child, "One week to go, {name}!", "One week to go for {name}!", "One week to go!"), body, text, "Good luck, you’ve got this!");
  },

  // 16, approved. With nothing in yet, the total is left out rather than cheering £0.
  week_after: (d, hi, t) => {
    const so = d.raisedPence > 0 ? ` So far you’ve raised <b>${pounds(d.raisedPence)}</b> for NBCC, which is just fantastic.` : "";
    const soText = d.raisedPence > 0 ? ` So far you’ve raised ${pounds(d.raisedPence)} for NBCC, which is just fantastic.` : "";
    const pay = "Pay it in by card from your private area in a couple of minutes, and it goes straight onto your meter.";
    const other =
      "Prefer a bank transfer, or to drop it in? Give us a ring and we’ll sort it. Please send us any paper sponsor forms too, so we can claim Gift Aid on them.";
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
  finished: (d, hi, t) => {
    const thanks = "Thank you for every step, every share and every ask. You’ve made a real difference to the children, young people and vulnerable adults we support.";
    const lead = d.raisedPence > 0 ? `<b>${t}</b> raised an incredible <b>${pounds(d.raisedPence)}</b> for NBCC. ${thanks}` : `Thank you so much for <b>${t}</b>, ${thanks.replace("Thank you for every", "and for every")}`;
    const leadText = d.raisedPence > 0 ? `${d.title} raised an incredible ${pounds(d.raisedPence)} for NBCC. ${thanks}` : `Thank you so much for ${d.title}, ${thanks.replace("Thank you for every", "and for every")}`;
    const cert = "We’ve made you a certificate to say thank you. Print it, frame it, show it off!";
    const after = "Your page stays up, so late gifts still count. And if you fancy doing something again, we’d love that.";
    const body =
      EYEBROW +
      heading("Thank you, from all of us") +
      bodyP(escapeHtml(hi)) +
      bodyP(lead) +
      bodyP(cert) +
      button(d.urls.certificate, "See my certificate") +
      bodyP(after);
    const text = [hi, "", leadText, "", cert, "", `See my certificate: ${d.urls.certificate}`, "", after];
    return toOrganiser("Thank you from all of us at NBCC", body, text, "With love and huge thanks,");
  },

  // 18, approved.
  year_on: (d, hi, t) => {
    const raised = d.raisedPence > 0 ? ` and raised <b>${pounds(d.raisedPence)}</b>` : "";
    const raisedText = d.raisedPence > 0 ? ` and raised ${pounds(d.raisedPence)}` : "";
    const again = "Fancy doing it again? We’ve kept your page details, so it takes one click to make a new one.";
    const body =
      EYEBROW +
      heading("A year ago today&hellip;") +
      bodyP(escapeHtml(hi)) +
      bodyP(`&hellip;you did <b>${t}</b>${raised} for NBCC. We still smile thinking about it!`) +
      bodyP(again) +
      button(d.urls.signUp, "Do it again");
    const text = [hi, "", `…you did ${d.title}${raisedText} for NBCC. We still smile thinking about it!`, "", again, "", `Do it again: ${d.urls.signUp}`];
    return toOrganiser("A year ago today...", body, text, "Here all year, and here for you,");
  },

  // NEW WORDING, for Jaimie to sign off: once, when their date is close and they are behind. It
  // never says so: it offers help.
  need_a_hand: (d, hi, t, first, child) => {
    const soon = "is coming up soon, and we’d love to help you make the most of it. Every gift so far is already making a difference to the children, young people and vulnerable adults we support.";
    const offers: Array<[string, string]> = [
      ["Posters and leaflets", " to put up at work, at school or in your local shop."],
      ["A collection bucket or tin", " for the day itself."],
      ["A shout out", " on our social media, to help spread the word."],
    ];
    const ask = "Just reply to this email or give us a ring, and tell us what would help. We’ll get it sorted.";
    const ideas = "Our fundraising help page has lots more ideas too.";
    const tip = "a quick personal message to a few friends often works better than one big post. People love to be asked!";
    const body =
      EYEBROW +
      heading("Need a hand?") +
      bodyP(escapeHtml(hi)) +
      bodyP(`<b>${t}</b> ${soon}`) +
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
    return toOrganiser(named(first, child, "Need a hand, {name}?", "Can we give you and {name} a hand?", "Need a hand?"), body, text, "Cheering you on,");
  },

  // NEW WORDING, for Jaimie to sign off: once, when they are on track for their target.
  on_track: (d, hi, t, first, child) => {
    const track = `and we just had to say: you’re right on track for your ${pounds(d.targetPence ?? 0)} target!`;
    const thanks = "Thank you, and a big thank you to everyone who has given so far. Every pound helps the children, young people and vulnerable adults we support, all year round.";
    const tip =
      "keep the momentum going. Share your page again, or post a news update from your private area so your supporters can see how it’s going. People love to see progress!";
    const body =
      EYEBROW +
      heading("You’re doing great!") +
      bodyP(escapeHtml(hi)) +
      bodyP(`We’ve been keeping an eye on <b>${t}</b>, ${track}`) +
      meterBar(d.raisedPence, d.targetPence) +
      bodyP(thanks) +
      bodyP(`<b>Top tip:</b> ${tip}`) +
      button(d.urls.page, "See my page");
    const text = [
      hi,
      "",
      `We’ve been keeping an eye on ${d.title}, ${track}`,
      "",
      meterText(d.raisedPence, d.targetPence),
      "",
      thanks,
      "",
      `Top tip: ${tip}`,
      "",
      `See my page: ${d.urls.page}`,
    ];
    return toOrganiser(named(first, child, "You're doing great, {name}!", "{name} is doing great!", "You're doing great!"), body, text, "Keep up the brilliant work,");
  },
};

/** One automatic email, ready to send. */
export function buildTouchEmail(kind: TouchKind, d: TouchEmailData): BuiltEmail {
  return BUILDERS[kind](d, organiserGreeting(d), escapeHtml(d.title), organiserFirstName(d), safeFirstName(d.guardianFirstName) !== null);
}
