import { londonToday } from "../events/model";
import { dayCount, pacePrompt } from "./call-prompts";
import type { FundraiserRecord, Meter } from "./model";

// TASK-515: keeping in touch with an organiser, automatically. Which of the automatic emails is due
// today for one fundraiser. Pure: today is a UK day (YYYY-MM-DD), passed in, so the clocks changing
// never moves an email (test/unit/fundraising-touch-rules.test.ts). The daily 8am job
// (src/fundraising/touch-runner.ts) sends what this says, only while the Automatic emails switch in
// Admin > Fundraising is on (it ships off) and fundraising is switched on.
//
//   first gift    the first online gift (never money paid in) was paid in the last 7 days (that
//                 day, and the 7 after it)
//   halfway       raised (never counting Gift Aid) is at least half the target, and under it
//   target        raised has reached the target
//   week before   the date is 7 days away (or 6 or 5, if a run was missed)
//   week after    the date was 7 days ago (or 8 or 9)
//   finished      not daily: sent when staff press Mark finished, with the certificate
//   year on       365 days after the date, or after it was finished when it had no date (a week
//                 to catch a missed run)
//   need a hand   the call prompt Behind holds (src/fundraising/call-prompts.ts)
//   on track      the call prompt On track holds
//
// Each goes at most once per fundraiser, ever (fundraiser_touchpoints, unique by kind). First gift,
// halfway and target are steps: only the highest that applies is ever a candidate, and none goes
// once a higher one has gone, so nobody hears "your first gift is in" after "you did it". At most
// one automatic email a day for a fundraiser, and the two gentle ones (need a hand, on track) wait a
// week after any other, so nobody is crowded.

export const TOUCH_KINDS = [
  "first_gift",
  "halfway",
  "target",
  "week_before",
  "week_after",
  "finished",
  "year_on",
  "need_a_hand",
  "on_track",
] as const;
export type TouchKind = (typeof TOUCH_KINDS)[number];

export const TOUCH_LABELS: Record<TouchKind, string> = {
  first_gift: "Your first gift is in",
  halfway: "You’re halfway there",
  target: "You did it, target reached",
  week_before: "One week to go",
  week_after: "How did it go?",
  finished: "Thank you, from all of us",
  year_on: "A year ago today",
  need_a_hand: "Need a hand?",
  on_track: "You’re doing great",
};

/** When each goes, in the words the admin shows beside it. */
export const TOUCH_WHEN: Record<TouchKind, string> = {
  first_gift: "When the first online gift arrives (the next morning).",
  halfway: "When the meter passes half the target.",
  target: "When the target is reached.",
  week_before: "A week before their date.",
  week_after: "A week after their date.",
  finished: "When you press Mark finished, with their certificate.",
  year_on: "A year after their date (or after it finished, with no date). Its button opens the sign up form filled in from last year, with a one use link.",
  need_a_hand: "Once, when their date is under a fortnight away and they have raised under a third of their target.",
  on_track: "Once, when they are on track for their target.",
};

/** Wording written for this task, waiting for Jaimie to sign it off (the target one was changed). */
export const NEW_WORDING_KINDS: readonly TouchKind[] = ["target", "need_a_hand", "on_track"];

export const FIRST_GIFT_DAYS = 7;
export const WEEK_DAYS = 7;
export const CATCH_UP_DAYS = 2;
export const YEAR_DAYS = 365;
export const YEAR_CATCH_UP_DAYS = 7;
export const GENTLE_GAP_DAYS = 7;

// The order they are tried in when more than one is due on the same day.
const PRIORITY: readonly TouchKind[] = ["week_after", "week_before", "target", "halfway", "first_gift", "need_a_hand", "on_track", "year_on"];
const STEPS: readonly TouchKind[] = ["first_gift", "halfway", "target"];
const GENTLE: ReadonlySet<TouchKind> = new Set(["need_a_hand", "on_track"]);

export interface TouchSent {
  kind: TouchKind;
  /** ISO time. */
  sentAt: string;
}

export interface TouchFacts {
  /** When the first online gift (never money paid in) was paid; null for none yet. */
  firstOnlineGiftAt: string | null;
  /** When the latest online gift was paid; null for none yet. */
  lastOnlineGiftAt: string | null;
  /** When staff marked it finished; null when they have not. */
  finishedAt: string | null;
  /** The automatic emails it has already had. */
  sent: TouchSent[];
}

export type TouchFundraiser = Pick<
  FundraiserRecord,
  "status" | "public" | "path" | "kind" | "email" | "eventDate" | "approvedAt" | "targetPence" | "wants"
> & { meter: Pick<Meter, "raisedPence"> };

/**
 * Is this fundraiser in memory of someone? A page in memory of someone must never get these upbeat
 * automatic emails (Jaimie, 2026-10-03): no "high fives", no "you did it". There are no in memory
 * pages yet, so nothing is, and this says no for everyone. When they are built, this is the one
 * place that recognises one, and every automatic email already asks it first.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function isQuietFundraiser(_f: Pick<FundraiserRecord, "kind">): boolean {
  return false;
}

export interface TouchOptions {
  /** The in memory guard. Only tests pass another. */
  isQuiet?: (f: TouchFundraiser) => boolean;
}

const quietOf = (o?: TouchOptions) => o?.isQuiet ?? isQuietFundraiser;

/**
 * May this fundraiser have automatic emails at all? A public page raising money, approved (or
 * finished, for the finished and year on emails), with an organiser email, and never in memory.
 */
export function canTouch(f: TouchFundraiser, isQuiet: (f: TouchFundraiser) => boolean = quietOf()): boolean {
  if (f.path !== "raising" || !f.public) return false;
  if (f.status !== "approved" && f.status !== "finished") return false;
  if (!f.email || f.email.trim() === "") return false;
  return !isQuiet(f);
}

const ukDay = (iso: string): string => londonToday(new Date(iso));

/** Every automatic email due today from the daily run, most important first. Never "finished". */
export function dueTouches(f: TouchFundraiser, facts: TouchFacts, today: string, o?: TouchOptions): TouchKind[] {
  if (!canTouch(f, quietOf(o))) return [];
  const sent = new Set(facts.sent.map((s) => s.kind));
  const sentDays = facts.sent.map((s) => ukDay(s.sentAt));
  if (sentDays.includes(today)) return [];
  const lastSent = sentDays.sort().pop() ?? null;
  const approved = f.status === "approved";
  const due = new Set<TouchKind>();

  // The steps: only the highest that applies, and only while nothing at or above it has gone.
  if (approved) {
    const raised = f.meter.raisedPence;
    const target = f.targetPence && f.targetPence > 0 ? f.targetPence : null;
    let step: TouchKind | null = null;
    if (target && raised >= target) step = "target";
    else if (target && raised * 2 >= target) step = "halfway";
    else if (facts.firstOnlineGiftAt && dayCount(ukDay(facts.firstOnlineGiftAt), today) <= FIRST_GIFT_DAYS) step = "first_gift";
    if (step && !STEPS.slice(STEPS.indexOf(step)).some((k) => sent.has(k))) due.add(step);
  }

  if (approved && f.eventDate) {
    const away = dayCount(today, f.eventDate);
    if (away <= WEEK_DAYS && away >= WEEK_DAYS - CATCH_UP_DAYS) due.add("week_before");
    if (-away >= WEEK_DAYS && -away <= WEEK_DAYS + CATCH_UP_DAYS) due.add("week_after");
    const pace = pacePrompt(f, today);
    if (pace === "behind") due.add("need_a_hand");
    if (pace === "on_track") due.add("on_track");
  }

  const yearFrom = f.eventDate ?? (facts.finishedAt ? ukDay(facts.finishedAt) : null);
  if (yearFrom) {
    const since = dayCount(yearFrom, today);
    if (since >= YEAR_DAYS && since <= YEAR_DAYS + YEAR_CATCH_UP_DAYS) due.add("year_on");
  }

  const gentleOk = lastSent === null || dayCount(lastSent, today) >= GENTLE_GAP_DAYS;
  return PRIORITY.filter((k) => due.has(k) && !sent.has(k) && (!GENTLE.has(k) || gentleOk));
}

/** The one automatic email to send today, or null. */
export function nextTouch(f: TouchFundraiser, facts: TouchFacts, today: string, o?: TouchOptions): TouchKind | null {
  return dueTouches(f, facts, today, o)[0] ?? null;
}
