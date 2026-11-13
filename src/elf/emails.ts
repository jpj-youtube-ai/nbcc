import { bodyList, bodyP, button, card, codeBox, emailShell, heading, note, questionsBox, questionsText, quoteBox, signOff, signOffText, subheading } from "../email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import type { Door } from "./calendar";
import type { DoorState } from "./doors";
import type { ElfFact } from "./facts";
import { detectiveNames, type DetectiveNameParts } from "./names";
import type { Rank } from "./progress";
import { whenWords } from "./posts";
import { clockWords, listWords, longDayWords, things } from "./words";

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
  const when = `Elf Detective School starts on ${longDayWords(o.firstClueAt)} at ${clockWords(o.firstClueAt)}, when the first clue comes out.`;
  const until = `Until then, ${many ? "each detective can" : "your detective can"} dress their elf in Detective HQ. More costumes unlock as they crack doors in December.`;
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

// ---- wave 2 (docs/superpowers/plans/2026-11-10-elf-wave-2-game-2.md, Task 2) -------------------
// The December emails: the clue to each family, the reminder to each place, the 8am Elf HQ email,
// the head elves' alerts and the proud moments. Their senders are in src/clients/email.ts. No link
// changes anything when followed, and a clue picture is never attached or linked.

/** The staff close: no questions box, since the readers are NBCC's own. */
function finishStaff(subject: string, bodyHtml: string, textLines: string[]): BuiltEmail {
  const line = "Thank you!";
  const html = shell(bodyHtml + signOff(line));
  const text = [...textLines, "", signOffText(line), "", FOOTER_TEXT].join("\n");
  return { subject, html, text };
}

const hello = (typed: string | null): string => {
  const first = typed ? firstName(typed) : null;
  return first ? `Hi ${first},` : "Hi there,";
};

const small = (url: string, words: string): string =>
  `<p style="font-size:12px;line-height:1.5;margin:14px 0 0"><a href="${escapeHtml(url)}" style="color:#6F6A66">${escapeHtml(words)}</a></p>`;

/** The email to a grown up when a door's first clue comes out. It never says when the place is shown: a family
 *  sees a door's place only once it has had its guess or been there (Plan 2c-1). It says when the family finds
 *  out whether it cracked the case: at the reveal, or later if the elf is still hiding then, unless the place
 *  closes by the reveal. A closing time not given, or not a real time, is none (ruling F13): such a place still
 *  closes, at the time a door falls back to, so the family may find out later. And a family that misses the hunt
 *  can still crack the case in Detective HQ, with one guess. */
export function buildElfClueEmail(o: {
  grownUpName: string;
  door: Door;
  elfName: string;
  clue: { words: string | null; pictureAlt: string | null };
  clue1At: Date;
  clue2At: Date;
  clue3At: Date;
  revealAt: Date;
  /** When the place closes, on the door's own day, when a closing time is typed in Doors (closingShown in
   *  src/elf/catch-up.ts); null otherwise. */
  closesAt: Date | null;
  hqUrl: string;
  fact: ElfFact | null;
  giveUrl: string;
}): BuiltEmail {
  const hi = hello(o.grownUpName);
  const intro = `Here is the first clue to find ${o.elfName}, the elf behind door ${o.door}.`;
  const hasWords = !!o.clue.words;
  const hasPicture = !!o.clue.pictureAlt;
  const pictureLine = hasWords
    ? hasPicture
      ? "See the picture in Detective HQ."
      : null
    : `Clue 1 is a picture: ${o.clue.pictureAlt ?? ""}. See it in Detective HQ.`;
  const closesAt = o.closesAt instanceof Date && Number.isFinite(o.closesAt.getTime()) ? o.closesAt : null;
  const reveal = clockWords(o.revealAt);
  const findOut =
    closesAt !== null && closesAt.getTime() <= o.revealAt.getTime()
      ? `You find out whether you cracked it at ${reveal}.`
      : `You find out whether you cracked it at ${reveal}, or later if the elf is still hiding then.`;
  const later = [
    `Clue 2 comes out at ${clockWords(o.clue2At)} and clue 3 at ${clockWords(o.clue3At)}, in Detective HQ.`,
    ...(closesAt ? [`The hiding place closes at ${clockWords(closesAt)} today.`] : []),
    findOut,
  ].join(" ");
  const missed = `If you miss ${whenWords(o.clue1At) === "tonight" ? "tonight's" : "today's"} hunt, you can still crack this case later in Detective HQ, with one guess.`;
  const lateNote = `If you are reading this a little late, the clue has been in Detective HQ since ${clockWords(o.clue1At)}.`;
  const give = "Every pound could help a child wake up to a Red Bag Full of Joy.";

  const body =
    heading(`Door ${o.door}: the first clue is out`) +
    bodyP(escapeHtml(hi)) +
    bodyP(escapeHtml(intro)) +
    (hasWords ? quoteBox(o.clue.words ?? "") : "") +
    (pictureLine ? bodyP(escapeHtml(pictureLine)) : "") +
    bodyP(escapeHtml(later)) +
    bodyP(escapeHtml(missed)) +
    button(o.hqUrl, "Open Detective HQ") +
    note(escapeHtml(lateNote)) +
    (o.fact ? subheading("Did you know?") + bodyP(escapeHtml(o.fact.grownUp)) : "") +
    small(o.giveUrl, give);
  const text = [
    hi,
    "",
    intro,
    "",
    ...(hasWords ? [`"${o.clue.words}"`, ""] : []),
    ...(pictureLine ? [pictureLine, ""] : []),
    later,
    "",
    missed,
    "",
    `Open Detective HQ: ${o.hqUrl}`,
    "",
    lateNote,
    ...(o.fact ? ["", "Did you know?", o.fact.grownUp] : []),
    "",
    `${give} ${o.giveUrl}`,
  ];
  return finish(`Door ${o.door}: the first clue is out`, body, text, "Happy hunting!");
}

/** The morning reminder to a place whose day it is. With no phone number for places in Settings it still
 *  goes, without the line saying who to ring: a reply reaches NBCC's events inbox either way. */
export function buildElfPlaceReminderEmail(o: {
  contactName: string | null;
  placeName: string;
  elfName: string;
  door: Door;
  clue1At: Date;
  closesAt: string | null;
  phone: string | null;
}): BuiltEmail {
  const hi = hello(o.contactName);
  const when = whenWords(o.clue1At) === "tonight" ? "Tonight" : "Today";
  const elf = o.elfName;
  const main = `${when} at ${clockWords(o.clue1At)}, please put ${elf} and the poster out together, with ${elf} wearing its tag. Until then keep them both out of sight.`;
  const stepsHeading = `When a detective finds ${elf}`;
  const steps = [
    "They scan your poster and type the word on the tag.",
    "The first to do it sees a gold screen that says You're first! Check it names your place, shows the right date and has a clock that is ticking.",
    `Then give them the prize. ${elf} stays with the poster for the rest of December.`,
  ];
  const closing = o.closesAt
    ? `Our list says you close at ${o.closesAt}. If nobody finds ${elf} before then, leave ${elf} out when you next open. The first detective to type the word still wins.`
    : `If nobody finds ${elf} before you close, leave ${elf} out when you next open. The first detective to type the word still wins.`;
  const ring = o.phone ? `Anything at all, ring NBCC on ${o.phone}.` : null;

  const body =
    heading("Today is your Elf Detective School day") +
    bodyP(escapeHtml(hi)) +
    bodyP(escapeHtml(main)) +
    subheading(escapeHtml(stepsHeading)) +
    bodyList(steps.map(escapeHtml), true) +
    bodyP(escapeHtml(closing)) +
    (ring ? bodyP(escapeHtml(ring)) : "");
  const text = [hi, "", main, "", stepsHeading, ...steps.map((s, i) => `${i + 1}. ${s}`), "", closing, ...(ring ? ["", ring] : [])];
  return finish("Today is your Elf Detective School day", body, text, "Thank you for helping!");
}

const postCard = (post: string, picture: string | null): string =>
  card(
    `<tr><td style="padding:14px 16px;font-size:14px;line-height:1.6;color:#333333">${escapeHtml(post).replace(/\r?\n/g, "<br>")}` +
      (picture ? `<br><img src="${escapeHtml(picture)}" alt="" width="260" style="display:block;margin-top:10px;max-width:100%;height:auto;border-radius:8px">` : "") +
      `</td></tr>`,
  );

/** The 8am email to head elves: the day's door, yesterday's find, photos waiting and the two posts. A door that
 *  is not ready becomes a snow day only when it cannot open as it stands (`canRun`: canRun in
 *  src/db/elf-game.ts, without its place, a usable word on its tag or its first clue, it is snowed in at its
 *  first clue); anything else it still needs is only a to do. */
export function buildElfMorningEmail(o: {
  day: Date;
  today: { door: Door; ready: boolean; toDo: string[]; clue1At: Date; snow: boolean; canRun: boolean } | null;
  yesterday: { door: Door; finders: DetectiveNameParts[]; foundAt: Date | null; place: { name: string; town: string } | null; state: DoorState; snow: boolean } | null;
  photosWaiting: number;
  posts: { today: string | null; yesterday: string | null };
  pictures: { today: string | null; yesterday: string | null };
  adminUrl: string;
}): BuiltEmail {
  const subject = `Elf HQ: ${longDayWords(o.day)}`;
  const t = o.today;
  const todayLine = !t
    ? "There is no door today."
    : t.snow
      ? `Door ${t.door} is a snow day.`
      : t.ready
        ? `Door ${t.door} is ready. The first clue comes out at ${clockWords(t.clue1At)}.`
        : `Door ${t.door} is NOT ready: ${t.toDo.join(", ")}. Fix it in Doors before ${clockWords(t.clue1At)}.` +
          (t.canRun === true ? "" : " Without its place, the word on its tag or its first clue, it becomes a snow day.");
  const y = o.yesterday;
  const yesterdayLine = !y
    ? null
    : y.snow || y.state === "snow"
      ? `Door ${y.door} was a snow day.`
      : y.finders.length > 0 && y.foundAt
        ? `${detectiveNames(y.finders)} found door ${y.door}'s elf at ${clockWords(y.foundAt)}.`
        : `Nobody found door ${y.door}'s elf; its place was shown.`;
  const waiting = `${things(o.photosWaiting, "photo")} waiting to be checked`;
  const NOT_PUBLIC = "Yesterday's find is not public yet, so there is no post for it.";

  let body = heading(subject) + subheading("Today's door") + bodyP(escapeHtml(todayLine));
  const text = [subject, "", "Today's door", todayLine];
  if (yesterdayLine) {
    body += subheading("Yesterday") + bodyP(escapeHtml(yesterdayLine));
    text.push("", "Yesterday", yesterdayLine);
  }
  body += subheading("Photos") + bodyP(escapeHtml(waiting)) + button(o.adminUrl, "Open Head Elf HQ");
  text.push("", waiting, `Open Head Elf HQ: ${o.adminUrl}`);

  if (o.posts.today !== null || y !== null) {
    body += subheading("Today's posts, ready to copy");
    text.push("", "Today's posts, ready to copy");
    if (o.posts.today !== null) {
      body += bodyP("The door that opens today:") + postCard(o.posts.today, o.pictures.today);
      text.push("", "The door that opens today:", o.posts.today, ...(o.pictures.today ? [`Picture: ${o.pictures.today}`] : []));
    }
    if (y !== null) {
      if (o.posts.yesterday !== null) {
        body += bodyP("Yesterday's find:") + postCard(o.posts.yesterday, o.pictures.yesterday);
        text.push("", "Yesterday's find:", o.posts.yesterday, ...(o.pictures.yesterday ? [`Picture: ${o.pictures.yesterday}`] : []));
      } else {
        body += bodyP(escapeHtml(NOT_PUBLIC));
        text.push("", NOT_PUBLIC);
      }
    }
  }
  return finishStaff(subject, body, text);
}

/** To head elves only: a door's elf has been found. Full names, because head elves may see them. */
export function buildElfFindAlertEmail(o: {
  door: Door;
  elfName: string;
  detectives: string[];
  grownUpName: string;
  at: Date;
  placeName: string;
  adminUrl: string;
}): BuiltEmail {
  const line = `${listWords(o.detectives)} (${o.grownUpName}'s family) found ${o.elfName} at ${o.placeName} at ${clockWords(o.at)}.`;
  const subject = `Door ${o.door}'s elf has been found`;
  const body = heading(subject) + bodyP(escapeHtml(line)) + button(o.adminUrl, "Open Finds");
  return finishStaff(subject, body, [line, "", `Open Finds: ${o.adminUrl}`]);
}

/** To head elves only: photos have started waiting. No photo and no family name. */
export function buildElfPhotoAlertEmail(o: { door: Door | 0; adminUrl: string }): BuiltEmail {
  const from = o.door === 0 ? "the practice door" : `door ${o.door}`;
  const line = `A family has sent a photo from ${from} of Elf Detective School. Nobody sees it until a head elf approves it.`;
  const once = "You get one of these when photos start waiting, not one for every photo.";
  const subject = "A photo is waiting to be checked";
  const body = heading(subject) + bodyP(escapeHtml(line)) + button(o.adminUrl, "Check the photos") + note(escapeHtml(once));
  return finishStaff(subject, body, [line, "", `Check the photos: ${o.adminUrl}`, "", once]);
}

/** To one head elf who pressed the test alert button. */
export function buildElfTestAlertEmail(o: { name: string; adminUrl: string }): BuiltEmail {
  const line = `Hi ${o.name}, this is the email half of a test alert. If you gave a mobile number, a text has gone too.`;
  const subject = "Your test alert from Elf Detective School";
  const body = heading(subject) + bodyP(escapeHtml(line)) + button(o.adminUrl, "Open Head Elf HQ");
  return finishStaff(subject, body, [line, "", `Open Head Elf HQ: ${o.adminUrl}`]);
}

/** The text a head elf gets when photos start waiting, and the one for the test alert. */
export const ELF_PHOTO_TEXT = "Elf Detective School: a photo is waiting for a head elf to check. nbcc.scot/admin";
export const ELF_TEST_TEXT = "Elf Detective School: this is your test alert. nbcc.scot/admin";

/** What the email log keeps as every proud email's subject. A promotion's and a graduation's subject name the
 *  detective, and the log is kept for six tax years and copied into the backups, so no child's name goes in it. */
export const ELF_PROUD_LOG_SUBJECT = "A proud moment from Elf Detective School";

/** To a grown up when their detective wins an elf, is promoted or graduates. A win may name every detective
 *  who was there (a list), and then says "were" and "have". */
export function buildElfProudEmail(o: {
  kind: "won" | "promoted" | "graduated";
  grownUpName: string;
  detectiveName: string | readonly string[];
  elfName?: string;
  door?: Door;
  rank?: Rank;
  hqUrl: string;
  giveUrl: string;
}): BuiltEmail {
  const hi = hello(o.grownUpName);
  const elf = o.elfName ?? "the elf";
  const rank = o.rank ?? "Detective";
  const names = typeof o.detectiveName === "string" ? [o.detectiveName] : o.detectiveName;
  const who = listWords(names);
  const many = names.length > 1;
  const [subject, headline, news] =
    o.kind === "won"
      ? [`You found ${elf}!`, `You found ${elf}!`, `${who} ${many ? "were" : "was"} the first to find ${elf}${o.door ? ` on door ${o.door}` : ""}, and ${many ? "have" : "has"} won the prize. Well done!`]
      : o.kind === "promoted"
        ? [`${who} is now a ${rank}`, "A promotion!", `${who} has been promoted to ${rank} in Elf Detective School. Well done!`]
        : [`${who} has graduated!`, "A graduate!", `${who} has done every door and has graduated from Elf Detective School. Well done!`];
  const thanks = "Thank you for playing along. It means a great deal to everyone at NBCC.";
  const ask = "If Elf Detective School has given your family a smile, a little more could help another family this Christmas.";
  const body =
    heading(escapeHtml(headline)) +
    bodyP(escapeHtml(hi)) +
    bodyP(escapeHtml(news)) +
    bodyP(escapeHtml(thanks)) +
    button(o.hqUrl, "Open Detective HQ") +
    bodyP(escapeHtml(ask)) +
    button(o.giveUrl, "Give a little more");
  const text = [hi, "", news, "", thanks, "", `Detective HQ: ${o.hqUrl}`, "", ask, `Give a little more: ${o.giveUrl}`];
  return finish(subject, body, text, "Well done from all of us!");
}
