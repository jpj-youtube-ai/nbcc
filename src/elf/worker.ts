import { config } from "../config";
import { familyWithDetectives, getElfSettings } from "../db/elf";
import { familyDoorsDone, finderOf, finderParts, loadDoorRuns, markAutomaticSnowDays, type DoorRun, type Finder } from "../db/elf-game";
import { listElfDoors } from "../db/elf-doors";
import { claimSend, familiesStillToEmail, familiesToSweep, markSendFailed, markSent, type ClueFamily } from "../db/elf-sends";
import { lastAlert, listHeadElves, oldestWaitingPhotoAt, recordAlert } from "../db/elf-alerts";
import { countPhotosWaiting, deleteExpiredPhotoFiles, oldestWaitingPhotoDoor } from "../db/elf-photos";
import { sendElfClue, sendElfFindAlert, sendElfMorning, sendElfPhotoAlert, sendElfPlaceReminder, sendElfProud, type FundraiseEmailMessage } from "../clients/email";
import { sendText, smsConfigured, type SmsMessage } from "../clients/sms";
import { alertRecipients, photoAlertDue, type HeadElf } from "./alerts";
import { doorInstant, doorOn, type Door } from "./calendar";
import { doorPicture, doorSeason, emptyDoor, readinessOf, READY_WORDS, type DoorSetup } from "./door-setup";
import { doorState, isOpen } from "./doors";
import { buildElfClueEmail, buildElfFindAlertEmail, buildElfMorningEmail, buildElfPhotoAlertEmail, buildElfPlaceReminderEmail, buildElfProudEmail, ELF_PHOTO_TEXT, type BuiltEmail } from "./emails";
import { factFor } from "./facts";
import { familyDetectiveName, type DetectiveNameParts } from "./names";
import { doorPost, postPicture, yesterdayPost } from "./posts";
import { progressOf, type DoorsDone } from "./progress";
import { CLUE_EMAILS_A_TICK, dueNow, londonDateAndHour, proudMomentsOf, type Due, type ProudMoment } from "./schedule";
import { ELF_DEFAULTS, type ElfSettings } from "./settings";
import type { FamilyRow } from "./views";
import { clockWords } from "./words";

// NBCC Elf Detective School wave 2: the elf worker. Everything that goes on time in December without a
// developer: the clue email to every family at clue 1, the reminder to each place at 9am, the 8am Elf HQ
// email and the find alert to head elves, the photo alerts by email and text, the proud moments a
// detective earns any way, and the clear out of every photo from 31 January. Design:
// docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md ("Emails in wave 2", "Alerts").
//
// It ticks every 30 seconds in the app, on the newsletter sender's pattern (src/newsletter/send-worker.ts),
// started from src/index.ts and never from createApp. What is due is worked out by the pure
// src/elf/schedule.ts; every send is claimed in elf_sends first (src/db/elf-sends.ts), so it goes once
// however many tasks tick, and a send that throws is tried again ten minutes on, three tries in all. The
// moment comes in from the caller: the timer passes the clock, the BDD's tick hook a time of its own
// (POST /api/admin/elf/worker/tick, outside production). Every outside call comes through ElfWorkerDeps,
// so a tick is unit tested with fakes (test/unit/elf-worker.test.ts). Each part of a tick is on its own:
// one that fails is logged with its message only (never a place, a clue, a word or a number) and the
// rest go on. A send that went but could not be marked sent (the database failing just then) is kept in
// this task's memory: marked at the start of every tick until that lands, and never sent again from here.

type Sender = (name: string | null, message: FundraiseEmailMessage) => Promise<void>;

/** Sends that went but could not be marked sent, by `${kind} ${key}`. */
export type Unmarked = Map<string, { kind: string; key: string }>;

/** This task's memory of them, shared by the timer's ticks and the tick hook's. */
const UNMARKED: Unmarked = new Map();

/** Every outside call the worker makes. realElfDeps() gives the real ones. */
export interface ElfWorkerDeps {
  /** The site's own address, with no slash on the end: every link in an email starts with it. */
  siteOrigin: string;
  /** Who every email is from, and where a reply goes: events@ on the apex. */
  from: string;
  /** The sender name on a text. */
  smsSenderId: string;
  /** Are texts tried? Yes once they are switched on, and outside production, where the text client sends
   *  nothing; with them off in production no text is tried, as the test alert does. */
  textsOn: boolean;
  /** Sends that went but could not be marked sent, kept until they are (never sent again meanwhile). */
  unmarked: Unmarked;
  getSettings: () => Promise<ElfSettings>;
  loadDoorRuns: (year: number, now: Date) => Promise<DoorRun[]>;
  /** The doors as head elves set them up: a place's contact, and what a door still needs. */
  listDoors: (year: number) => Promise<DoorSetup[]>;
  markAutomaticSnowDays: (year: number, now: Date) => Promise<unknown>;
  familiesStillToEmail: (year: number, door: number, limit: number) => Promise<ClueFamily[]>;
  familiesToSweep: () => Promise<number[]>;
  familyWithDetectives: (familyId: number) => Promise<FamilyRow | null>;
  familyDoorsDone: (year: number, familyId: number, runs: DoorRun[], now: Date) => Promise<Map<number, DoorsDone>>;
  finderOf: (year: number, door: number) => Promise<Finder | null>;
  finderParts: (year: number, door: number) => Promise<DetectiveNameParts[]>;
  countPhotosWaiting: () => Promise<number>;
  oldestWaitingPhotoAt: () => Promise<Date | null>;
  /** The door of the oldest photo still waiting (0 for the practice door), or null when none waits. */
  oldestWaitingPhotoDoor: () => Promise<Door | 0 | null>;
  listHeadElves: () => Promise<HeadElf[]>;
  lastAlert: (kind: "photo") => Promise<{ at: Date; textsFailed: string[] } | null>;
  recordAlert: (o: { kind: "photo"; year: number; door: number | null; emails: number; texts: number; textsFailed: string[] }) => Promise<void>;
  claimSend: (kind: string, key: string) => Promise<boolean>;
  markSent: (kind: string, key: string) => Promise<void>;
  markSendFailed: (kind: string, key: string, error: string) => Promise<void>;
  sendText: (msg: SmsMessage) => Promise<"sent" | "stubbed">;
  deleteExpiredPhotoFiles: (now: Date) => Promise<number>;
  send: { clue: Sender; reminder: Sender; morning: Sender; findAlert: Sender; photoAlert: Sender; proud: Sender };
}

/** The real outside calls, read when asked for (never when this file loads). */
export function realElfDeps(): ElfWorkerDeps {
  return {
    siteOrigin: String(config.PORTAL_BASE_URL ?? "").replace(/\/+$/, ""),
    from: config.BALL_FROM_EMAIL,
    smsSenderId: config.SMS_SENDER_ID,
    textsOn: smsConfigured || config.NODE_ENV !== "production",
    unmarked: UNMARKED,
    getSettings: getElfSettings,
    loadDoorRuns,
    listDoors: listElfDoors,
    markAutomaticSnowDays,
    familiesStillToEmail,
    familiesToSweep,
    familyWithDetectives,
    familyDoorsDone,
    finderOf,
    finderParts,
    countPhotosWaiting,
    oldestWaitingPhotoAt,
    oldestWaitingPhotoDoor,
    listHeadElves,
    lastAlert,
    recordAlert,
    claimSend,
    markSent,
    markSendFailed,
    sendText: (msg) => sendText(msg),
    deleteExpiredPhotoFiles,
    send: {
      clue: sendElfClue,
      reminder: sendElfPlaceReminder,
      morning: sendElfMorning,
      findAlert: sendElfFindAlert,
      photoAlert: sendElfPhotoAlert,
      proud: sendElfProud,
    },
  };
}

// ---- the pieces every send shares --------------------------------------------------------------------

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function failed(what: string, err: unknown): void {
  console.error(`elf worker ${what} failed:`, messageOf(err));
}

/** Runs one part of a tick on its own: a failure is logged and the tick goes on. */
async function part(what: string, work: () => Promise<unknown>): Promise<void> {
  await attempt(what, work);
}

/** The answer of one part of a tick, or null when it failed (logged). */
async function attempt<T>(what: string, work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (err) {
    failed(what, err);
    return null;
  }
}

const filled = (s: string | null | undefined): s is string => typeof s === "string" && s.trim() !== "";

const messageFor = (to: string, mail: BuiltEmail, from: string): FundraiseEmailMessage => ({
  email: to,
  from,
  replyTo: from,
  subject: mail.subject,
  html: mail.html,
  text: mail.text,
});

const sendId = (kind: string, key: string): string => `${kind} ${key}`;

/** Claims a send for this task: true only when this task should send it. A send this task has already sent
 *  but not yet marked is never claimed again from here. Never throws. */
async function claim(deps: ElfWorkerDeps, kind: string, key: string): Promise<boolean> {
  if (deps.unmarked.has(sendId(kind, key))) return false;
  try {
    return await deps.claimSend(kind, key);
  } catch (err) {
    failed(`${kind} ${key} claim`, err);
    return false;
  }
}

/** Marks a claimed send sent. If that fails the send has still gone: it is kept in this task's memory, marked
 *  at the start of every tick until that lands, and never sent again from here meanwhile. */
async function noteSent(deps: ElfWorkerDeps, kind: string, key: string): Promise<void> {
  try {
    await deps.markSent(kind, key);
  } catch (err) {
    failed(`${kind} ${key} sent note`, err);
    deps.unmarked.set(sendId(kind, key), { kind, key });
  }
}

/** Sends a send this task has claimed. One that throws is noted with its message, so the claim is taken
 *  again ten minutes on. Never throws. True when it went. */
async function sendClaimed(deps: ElfWorkerDeps, kind: string, key: string, send: () => Promise<void>): Promise<boolean> {
  try {
    await send();
  } catch (err) {
    const message = messageOf(err);
    console.error(`elf worker ${kind} ${key} failed:`, message);
    await part(`${kind} ${key} failure note`, () => deps.markSendFailed(kind, key, message));
    return false;
  }
  await noteSent(deps, kind, key);
  return true;
}

/** One claimed send: it goes only from the task that wins the claim. Never throws. True when it went. */
async function claimed(deps: ElfWorkerDeps, kind: string, key: string, send: () => Promise<void>): Promise<boolean> {
  return (await claim(deps, kind, key)) ? sendClaimed(deps, kind, key, send) : false;
}

/** The sends this task sent but could not mark: tried again first thing on every tick until they land. */
async function markUnmarked(deps: ElfWorkerDeps): Promise<void> {
  for (const [id, s] of [...deps.unmarked]) {
    try {
      await deps.markSent(s.kind, s.key);
      deps.unmarked.delete(id);
    } catch (err) {
      failed(`${s.kind} ${s.key} sent note, again`, err);
    }
  }
}

/** One email to each head elf, each on its own, so one that fails never stops the others. Throws only
 *  when not one went, so its claim is tried again. */
async function toEach(elves: HeadElf[], mail: BuiltEmail, send: Sender, from: string): Promise<number> {
  let went = 0;
  let last: unknown = null;
  for (const elf of elves) {
    try {
      await send(elf.name, messageFor(elf.email, mail, from));
      went++;
    } catch (err) {
      last = err;
      failed("an email to a head elf", err);
    }
  }
  if (elves.length > 0 && went === 0) throw last instanceof Error ? last : new Error(messageOf(last));
  return went;
}

/** A clock time on a door's day in words ("8:30pm"), or null for none. */
function clockOn(year: number, door: Door, time: string | null): string | null {
  if (!time) return null;
  const instant = doorInstant(doorSeason(year), door, time);
  return instant ? clockWords(instant) || null : null;
}

/** The London date before a YYYY-MM-DD date. */
function dayBefore(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** A detective as their own family reads them: the whole name. */
const ownName = (d: { firstName: string; surname: string }): string => familyDetectiveName({ firstName: d.firstName, surname: d.surname, approved: true });

/** One tick's view of Elf Detective School, read once and shared by its parts. */
interface Tick {
  at: Date;
  settings: ElfSettings;
  year: number;
  runs: DoorRun[];
  deps: ElfWorkerDeps;
  /** A door's setup, read once a tick for whichever part needs one first. */
  setup: (door: Door) => Promise<DoorSetup>;
}

// ---- the clue email, the reminder, the morning email and the find alert --------------------------------

async function clueEmails(due: Due, door: Door, run: DoorRun, t: Tick): Promise<void> {
  const first = run.clues.find((c) => c.n === 1);
  // A first clue with neither words nor a picture is never sent: such a door is snowed in instead.
  if (!first || (!filled(first.words) && !first.hasPicture)) return;
  const families = await t.deps.familiesStillToEmail(t.year, door, CLUE_EMAILS_A_TICK);
  for (const f of families) {
    await claimed(t.deps, "clue", `${due.key}:${f.familyId}`, async () => {
      const mail = buildElfClueEmail({
        grownUpName: f.grownUpName,
        door,
        elfName: run.elfName,
        // The picture itself is never sent: the email says it is in Detective HQ.
        clue: { words: filled(first.words) ? first.words : null, pictureAlt: first.hasPicture ? first.pictureAlt : null },
        clue1At: run.facts.clue1At,
        clue2At: run.facts.clue2At,
        clue3At: run.facts.clue3At,
        revealAt: run.facts.revealAt,
        hqUrl: `${t.deps.siteOrigin}/elf/hq`,
        fact: factFor(door),
        giveUrl: `${t.deps.siteOrigin}/donate`,
      });
      await t.deps.send.clue(f.grownUpName, messageFor(f.email, mail, t.deps.from));
    });
  }
}

/** The 9am reminder to a place. Without a phone number for places in Settings it still goes, without the
 *  line saying who to ring (a reply reaches NBCC either way). */
async function placeReminder(due: Due, door: Door, run: DoorRun, t: Tick): Promise<void> {
  const to = run.contactEmail;
  if (!filled(to)) return;
  await claimed(t.deps, "reminder", due.key, async () => {
    const phone = filled(t.settings.placePhone) ? t.settings.placePhone : null;
    const setup = await t.setup(door);
    const mail = buildElfPlaceReminderEmail({
      contactName: setup.contactName,
      placeName: run.placeName ?? "",
      elfName: run.elfName,
      door,
      clue1At: run.facts.clue1At,
      closesAt: clockOn(t.year, door, run.closesAt),
      phone,
    });
    await t.deps.send.reminder(setup.contactName, messageFor(to, mail, t.deps.from));
  });
}

/** The 8am email: today's door and what it still needs, yesterday's find by the public name, the photos
 *  waiting, and the day's two posts, which never name a place before it is shown. */
async function morningEmail(date: string, t: Tick): Promise<BuiltEmail> {
  const season = doorSeason(t.year);
  const origin = t.deps.siteOrigin;
  const runFor = (door: Door | null): DoorRun | null => (door === null ? null : (t.runs.find((r) => r.door === door) ?? null));
  const todayDoor = doorOn(season, date);
  const yesterdayDoor = doorOn(season, dayBefore(date));
  const todayRun = runFor(todayDoor);
  const yesterdayRun = runFor(yesterdayDoor);

  let today: Parameters<typeof buildElfMorningEmail>[0]["today"] = null;
  if (todayDoor !== null && todayRun) {
    const readiness = readinessOf(await t.setup(todayDoor), doorPicture(t.year, todayDoor) !== null);
    today = {
      door: todayDoor,
      ready: readiness.ready,
      toDo: readiness.items.filter((i) => !i.done).map((i) => lowerFirst(READY_WORDS[i.key])),
      clue1At: todayRun.facts.clue1At,
      snow: todayRun.facts.snowDay,
    };
  }

  let yesterday: Parameters<typeof buildElfMorningEmail>[0]["yesterday"] = null;
  let yesterdayWords: string | null = null;
  if (yesterdayDoor !== null && yesterdayRun) {
    const state = doorState(yesterdayRun.facts, t.at);
    const finders = state === "found" || state === "found-hidden" ? await t.deps.finderParts(t.year, yesterdayDoor) : [];
    const place =
      isOpen(state) && filled(yesterdayRun.placeName) && filled(yesterdayRun.placeTown) ? { name: yesterdayRun.placeName, town: yesterdayRun.placeTown } : null;
    yesterday = { door: yesterdayDoor, finders, foundAt: yesterdayRun.facts.foundAt, place, state, snow: yesterdayRun.facts.snowDay };
    yesterdayWords = yesterdayPost({ door: yesterdayDoor, elfName: yesterdayRun.elfName, state, finders, foundAt: yesterdayRun.facts.foundAt, place });
  }

  // A snow day has no door to post about.
  const todayWords = today && !today.snow ? doorPost({ door: today.door, clue1At: today.clue1At, joinUrl: `${origin}/elf` }) : null;
  return buildElfMorningEmail({
    day: t.at,
    today,
    yesterday,
    photosWaiting: await t.deps.countPhotosWaiting(),
    posts: { today: todayWords, yesterday: yesterdayWords },
    pictures: {
      today: todayWords !== null && today ? postPicture(t.year, today.door, origin) : null,
      yesterday: yesterdayWords !== null && yesterdayDoor !== null ? postPicture(t.year, yesterdayDoor, origin) : null,
    },
    adminUrl: `${origin}/admin`,
  });
}

async function morning(due: Due, t: Tick): Promise<void> {
  await claimed(t.deps, "morning", due.key, async () => {
    const elves = alertRecipients(await t.deps.listHeadElves()).emails;
    if (elves.length === 0) return;
    await toEach(elves, await morningEmail(due.key, t), t.deps.send.morning, t.deps.from);
  });
}

/** The find alert (C7): an email only, to the same people as the photo alerts, with the finders' full
 *  names, which head elves may see. */
async function findAlert(due: Due, door: Door, run: DoorRun, t: Tick): Promise<void> {
  await claimed(t.deps, "find", due.key, async () => {
    const finder = await t.deps.finderOf(t.year, door);
    // A finding family that has been removed is never named: there is nothing to tell.
    if (!finder) return;
    const elves = alertRecipients(await t.deps.listHeadElves()).emails;
    const mail = buildElfFindAlertEmail({
      door,
      elfName: run.elfName,
      detectives: finder.detectives,
      grownUpName: finder.grownUpName,
      at: finder.at,
      placeName: run.placeName ?? "",
      adminUrl: `${t.deps.siteOrigin}/admin`,
    });
    await toEach(elves, mail, t.deps.send.findAlert, t.deps.from);
  });
}

// ---- proud moments ---------------------------------------------------------------------------------------

/** A detective's proud moments not yet claimed, each claimed as ("proud", `${year}:${key}`). Only the highest
 *  new one is emailed to the family: a run of snow days can bring several ranks at once, and the family hears
 *  once, about the newest (graduating above every rank); the lower ones are claimed and marked without an
 *  email. If the email fails, its own claim is tried again ten minutes on. */
async function sendMoments(
  deps: ElfWorkerDeps,
  year: number,
  family: { grownUpName: string; email: string },
  detectiveName: string,
  moments: ProudMoment[],
): Promise<void> {
  const fresh: ProudMoment[] = [];
  for (const m of moments) if (await claim(deps, "proud", `${year}:${m.key}`)) fresh.push(m);
  const top = fresh[fresh.length - 1];
  if (!top) return;
  for (const m of fresh) if (m !== top) await noteSent(deps, "proud", `${year}:${m.key}`);
  await sendClaimed(deps, "proud", `${year}:${top.key}`, async () => {
    const mail = buildElfProudEmail({
      kind: top.kind,
      grownUpName: family.grownUpName,
      detectiveName,
      ...(top.rank ? { rank: top.rank } : {}),
      hqUrl: `${deps.siteOrigin}/elf/hq`,
      giveUrl: `${deps.siteOrigin}/donate`,
    });
    await deps.send.proud(family.grownUpName, messageFor(family.email, mail, deps.from));
  });
}

/** The won email to a finding family, claimed once a family a door as ("proud", `${year}:won:<family>:<door>`),
 *  by the word that won or, if that one failed, by a later sweep. `detectives` are the finders by the names
 *  their own family sees. */
async function sendWon(
  deps: ElfWorkerDeps,
  o: { year: number; door: Door; elfName: string; familyId: number; family: { grownUpName: string; email: string }; detectives: string[] },
): Promise<void> {
  await claimed(deps, "proud", `${o.year}:won:${o.familyId}:${o.door}`, async () => {
    const mail = buildElfProudEmail({
      kind: "won",
      grownUpName: o.family.grownUpName,
      detectiveName: o.detectives,
      elfName: o.elfName,
      door: o.door,
      hqUrl: `${deps.siteOrigin}/elf/hq`,
      giveUrl: `${deps.siteOrigin}/donate`,
    });
    await deps.send.proud(o.family.grownUpName, messageFor(o.family.email, mail, deps.from));
  });
}

const NO_DOORS: DoorsDone = { cracked: [], visited: [], snow: [] };

/** Every ten minutes: each found door's won email, in case the word's own did not go (the same claim, so
 *  never twice); then every active detective of a family not removed, so a rank earned by a guess, a snow
 *  day or a visit that counts from the reveal is never missed. */
async function sweep(due: Due, t: Tick): Promise<void> {
  await claimed(t.deps, "sweep", due.key, async () => {
    for (const run of t.runs) {
      if (run.door === 0 || run.foundFamilyId === null || !run.facts.foundAt) continue;
      try {
        // Null when the finding family has been removed: nobody to tell.
        const finder = await t.deps.finderOf(t.year, run.door);
        if (!finder) continue;
        await sendWon(t.deps, {
          year: t.year,
          door: run.door,
          elfName: run.elfName,
          familyId: run.foundFamilyId,
          family: finder,
          // Named as the word's own won email names them: in full, as their family typed them, through the
          // name checks, so nothing of a name that fails them is shown.
          detectives: (await t.deps.finderParts(t.year, run.door)).map(ownName),
        });
      } catch (err) {
        failed("the sweep of a found door", err);
      }
    }
    for (const familyId of await t.deps.familiesToSweep()) {
      try {
        const family = await t.deps.familyWithDetectives(familyId);
        if (!family) continue;
        const done = await t.deps.familyDoorsDone(t.year, familyId, t.runs, t.at);
        for (const d of family.detectives) {
          await sendMoments(t.deps, t.year, family, ownName(d), proudMomentsOf(d.id, progressOf(done.get(d.id) ?? NO_DOORS)));
        }
      } catch (err) {
        // One family that cannot be read never stops the others.
        failed("the sweep of a family", err);
      }
    }
  });
}

/** A word that counted (src/routes/elf.ts, after recordWord): what it gave, for the proud moments. */
export interface WordMoment {
  year: number;
  door: Door | 0;
  elfName: string;
  family: { id: number; grownUpName: string; email: string };
  /** Did this word win the door's elf? */
  won: boolean;
  /** The detectives the word stamped, each with their doors done once the word counts: without this door
   *  while the visit counts only from later. */
  stamped: { id: number; name: string; doorsDone: DoorsDone }[];
}

/** The proud moments after a word: for a win, the won email (claimed once a family a door), then each
 *  stamped detective's newest promotion or graduation as the sweep sends them. The practice door sends
 *  nothing. Best effort: every send is claimed and on its own, so this does not throw for a send that fails;
 *  the word's route still keeps it from ever failing the word. */
export async function sendProudMoments(m: WordMoment, deps: ElfWorkerDeps): Promise<void> {
  if (m.door === 0 || m.stamped.length === 0) return;
  if (m.won) {
    await sendWon(deps, { year: m.year, door: m.door, elfName: m.elfName, familyId: m.family.id, family: m.family, detectives: m.stamped.map((s) => s.name) });
  }
  for (const s of m.stamped) await sendMoments(deps, m.year, m.family, s.name, proudMomentsOf(s.id, progressOf(s.doorsDone)));
}

// ---- photo alerts ------------------------------------------------------------------------------------------

/** One email to everyone with alerts on and one text to each of them with a mobile, when photos start
 *  waiting (photoAlertDue: never in quiet hours, never twice for the same photos, never sooner than half an
 *  hour after the last). A text that fails never stops the emails, and is named in the alert's record so
 *  Settings > Alerts can say whose text did not go. Doors on or off: the practice door plays it too.
 *
 *  Its claim is keyed by the last alert's time and the London date. The date changes at midnight, inside
 *  quiet hours, so an alert given up after three failed tries is tried again from 8am the next day rather
 *  than never.
 *
 *  An alert that would reach nobody (no head elf has alerts on) is neither claimed nor recorded: a record
 *  would read in Finds as an alert that went, and would hold back the alert for these photos. So the photos
 *  waiting alert on the first tick after someone turns alerts on. */
async function photoAlert(at: Date, year: number, deps: ElfWorkerDeps): Promise<void> {
  const [oldestWaitingAt, last] = await Promise.all([deps.oldestWaitingPhotoAt(), deps.lastAlert("photo")]);
  if (!photoAlertDue({ oldestWaitingAt, lastAlertAt: last?.at ?? null }, at)) return;
  const door = await deps.oldestWaitingPhotoDoor();
  // Checked while this tick was looking: nothing waits, so nothing is claimed.
  if (door === null) return;
  // Everyone with alerts on has an email, and those of them with a mobile a text: none of them, nobody to tell.
  const { emails, texts } = alertRecipients(await deps.listHeadElves());
  if (emails.length === 0) return;
  const key = `${last ? last.at.toISOString() : "first"}:${londonDateAndHour(at).date}`;
  await claimed(deps, "photo-alert", key, async () => {
    const mail = buildElfPhotoAlertEmail({ door, adminUrl: `${deps.siteOrigin}/admin` });
    let emailed = 0;
    let lastError: unknown = null;
    for (const elf of emails) {
      try {
        await deps.send.photoAlert(elf.name, messageFor(elf.email, mail, deps.from));
        emailed++;
      } catch (err) {
        lastError = err;
        failed("a photo alert email", err);
      }
    }
    let texted = 0;
    const textsFailed: string[] = [];
    if (deps.textsOn) {
      for (const elf of texts) {
        try {
          await deps.sendText({ to: elf.mobile ?? "", text: ELF_PHOTO_TEXT, senderId: deps.smsSenderId });
          texted++;
        } catch (err) {
          textsFailed.push(elf.name);
          failed("a photo alert text", err);
        }
      }
    }
    // Not one went: no record, so the claim is tried again ten minutes on.
    if (emails.length > 0 && emailed === 0 && texted === 0) throw lastError instanceof Error ? lastError : new Error(messageOf(lastError));
    try {
      await deps.recordAlert({ kind: "photo", year, door, emails: emailed, texts: texted, textsFailed });
    } catch (err) {
      // Once anything went, a record that cannot be written is only logged: the claim is still marked sent,
      // so the alert is never sent again.
      if (emailed === 0 && texted === 0) throw err;
      failed("the record of a photo alert that went", err);
    }
  });
}

// ---- a tick ------------------------------------------------------------------------------------------------

async function sendDue(due: Due, t: Tick): Promise<void> {
  if (due.kind === "morning") return morning(due, t);
  if (due.kind === "sweep") return sweep(due, t);
  const run = t.runs.find((r) => r.door === due.door);
  if (!run || due.door === null) return;
  if (due.kind === "clue") return clueEmails(due, due.door, run, t);
  if (due.kind === "reminder") return placeReminder(due, due.door, run, t);
  return findAlert(due, due.door, run, t);
}

/**
 * One tick at `at`, in order, each part on its own: first the sends this task sent but could not mark;
 * then snow in what cannot run (December's doors on only); then whatever is due (the clue emails, the
 * reminders, the morning email, the find alerts, the sweep); then the photo alert; last, the clear out of
 * every photo past its 31 January.
 */
export async function runElfTick(at: Date, deps: ElfWorkerDeps): Promise<void> {
  await markUnmarked(deps);
  let settings: ElfSettings;
  try {
    settings = await deps.getSettings();
  } catch (err) {
    // Read as switched off, as getElfSettings itself does: then only the photo alert and the clear out run.
    failed("settings", err);
    settings = { ...ELF_DEFAULTS };
  }
  // Nothing goes to a family, or about a real door, unless Elf Detective School and December's doors are
  // both switched on.
  const live = settings.schoolOn && settings.doorsOn;
  if (live) {
    await part("snow days", () => deps.markAutomaticSnowDays(settings.year, at));
    // Read after the snow days, so a door snowed in this tick sends no clue and no reminder.
    const runs = await attempt("the doors", () => deps.loadDoorRuns(settings.year, at));
    if (runs !== null) {
      const known = new Map<Door, Promise<DoorSetup>>();
      let setups: Promise<DoorSetup[]> | null = null;
      const t: Tick = {
        at,
        settings,
        year: settings.year,
        runs,
        deps,
        setup: (door) => {
          let found = known.get(door);
          if (!found) {
            setups = setups ?? deps.listDoors(settings.year);
            found = setups.then((all) => all.find((d) => d.door === door) ?? emptyDoor(door, ""));
            known.set(door, found);
          }
          return found;
        },
      };
      for (const due of dueNow({ year: settings.year, runs, now: at, doorsOn: live })) {
        await part(`${due.kind} ${due.key}`, () => sendDue(due, t));
      }
    }
  }
  await part("photo alert", () => photoAlert(at, settings.year, deps));
  await part("clear out", () => deps.deleteExpiredPhotoFiles(at));
}

// ---- the timer ------------------------------------------------------------------------------------------------

let timer: NodeJS.Timeout | null = null;
let running = false;

/** Ticks every 30 seconds with the clock, from src/index.ts. Guarded so a slow tick never has another
 *  start beside it in this task; the claims in elf_sends keep several tasks apart. */
export function startElfWorker(intervalMs = 30_000): NodeJS.Timeout {
  timer = setInterval(() => {
    if (running) return;
    running = true;
    Promise.resolve()
      .then(() => runElfTick(new Date(), realElfDeps()))
      .catch((err) => failed("tick", err))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  // Never hold the process open for a timer: the container should still exit cleanly.
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

export function stopElfWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
