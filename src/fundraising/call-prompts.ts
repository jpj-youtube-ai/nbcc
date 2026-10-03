import { londonToday } from "../events/model";
import { isInMemory } from "./in-memory";
import { pounds } from "./emails";
import { isKind } from "./categories";
import type { FundraiserRecord, Meter } from "./model";

// TASK-515: the smart call prompts in Admin > Fundraising (Jaimie's rules, 2026-10-03). A pill on a
// fundraiser saying why it is worth a ring today, with a few talking points, and a Called button
// that records the call (fundraiser_calls, which = 'prompt'). Pure: today is passed in as a UK day
// (YYYY-MM-DD), so the clocks changing never moves anything, and every rule is unit tested
// (test/unit/fundraising-call-prompts.test.ts). The whole rule table is in this one file.
//
//   Behind        its date is 1 to 14 days away and it has raised under a third of its target
//   Ahead         it has reached its target and its date is still more than 7 days away
//   On track      within a quarter either side of the straight line from approval to its date
//                 (from a quarter of the way in, so a slow first day is not a verdict)
//   Gone quiet    no online gift for 14 days (or none since approval), while its page is live and
//                 before its date
//   Materials     a bake sale or coffee morning with no bucket or tin asked for; a run, walk or
//                 Santa dash with no sponsor form asked for; anything within 21 days of its date
//                 with no posters or leaflets asked for
//
// Behind, ahead and on track are one verdict on its pace, so at most one shows. Only an approved
// fundraiser gets prompts. A call recorded about a prompt clears it for good, except Gone quiet,
// which can come back a fortnight after the call if it is still quiet.

export const PROMPT_KEYS = ["behind", "ahead", "on_track", "quiet", "tin", "sponsor_form", "posters"] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

export const BEHIND_DAYS = 14;
export const AHEAD_DAYS = 7;
export const ON_TRACK_BAND = 0.25;
export const ON_TRACK_FROM = 0.25;
export const QUIET_DAYS = 14;
export const POSTERS_DAYS = 21;

export type PaceVerdict = "behind" | "ahead" | "on_track";

export interface PromptCall {
  prompt: PromptKey;
  /** ISO time. */
  calledAt: string;
  calledBy?: string | null;
  note?: string | null;
}

export interface PromptFacts {
  /** When the latest online gift (never money paid in) was paid, or null for none yet. */
  lastOnlineGiftAt: string | null;
  /** The calls staff recorded about prompts. */
  calls: PromptCall[];
  /**
   * Have they asked us for a sponsor form? There is no way to ask for one yet (the form is always in
   * their private area), so this is false until there is, and the suggestion shows until somebody
   * records the call.
   */
  sponsorFormAsked?: boolean;
}

export type PromptFundraiser = Pick<
  FundraiserRecord,
  "status" | "public" | "path" | "kind" | "eventDate" | "approvedAt" | "targetPence" | "wants"
> & { meter: Pick<Meter, "raisedPence">; inMemory?: boolean | null };

export interface CallPrompt {
  key: PromptKey;
  /** The short pill on the list. */
  pill: string;
  /** Its name in the open sign up. */
  label: string;
  /** Why, with the numbers. */
  reason: string;
  /** What to say. */
  points: string[];
}

interface Ctx {
  today: string;
  daysAway: number | null;
  raised: number;
  target: number | null;
  quietDays: number;
  expected: number;
}

interface PromptRule {
  key: PromptKey;
  /** The short pill on the list. */
  pill: string;
  /** Its name in the open sign up. */
  label: string;
  points: string[];
  reason: (c: Ctx) => string;
}

/** Whole UK days from one YYYY-MM-DD to another (negative when `to` is earlier). */
export const dayCount = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const ukDay = (iso: string): string => londonToday(new Date(iso));
const days = (n: number): string => (n === 1 ? "1 day" : `${n} days`);

/** The one table: every prompt, its pill, its talking points and the words for why. */
export const PROMPT_RULES: readonly PromptRule[] = [
  {
    key: "behind",
    pill: "Behind",
    label: "Behind",
    points: [
      "Offer posters and leaflets to put up at work, school or the local shop.",
      "Offer a shout out on our social media.",
      "Offer someone from NBCC to come along on the day.",
    ],
    reason: (c) =>
      `Its date is ${days(c.daysAway ?? 0)} away and it has raised ${pounds(c.raised)} of its ${pounds(c.target ?? 0)} target, under a third.`,
  },
  {
    key: "ahead",
    pill: "Ahead",
    label: "Ahead",
    points: [
      "Celebrate with them: they have done brilliantly.",
      "Suggest raising the target, from their private area.",
      "Ask if they would like a shout out to thank their supporters.",
    ],
    reason: (c) => `It has raised ${pounds(c.raised)}, past its ${pounds(c.target ?? 0)} target, with ${days(c.daysAway ?? 0)} still to go.`,
  },
  {
    key: "on_track",
    pill: "On track",
    label: "On track",
    points: [
      "Tell them they are doing great.",
      "Thank them, and everyone who has given so far.",
      "Ask if there is anything they need for the day.",
    ],
    reason: (c) =>
      `It has raised ${pounds(c.raised)}, close to the ${pounds(Math.round(c.expected))} we would expect by now on the way to ${pounds(c.target ?? 0)}.`,
  },
  {
    key: "quiet",
    pill: "Gone quiet",
    label: "Gone quiet",
    points: [
      "A friendly check in to see how it is going.",
      "Suggest a news update on their page, from their private area.",
      "Suggest sharing their page again: a fresh share often brings in a few more gifts.",
    ],
    reason: (c) => `No gifts online for ${days(c.quietDays)}.`,
  },
  {
    key: "tin",
    pill: "Offer a tin",
    label: "Offer a collection tin",
    points: ["Offer a collection tin for the counter or the table.", "Ask where we should post it."],
    reason: () => "A bake sale or coffee morning, and no bucket or tin asked for.",
  },
  {
    key: "sponsor_form",
    pill: "Sponsor form",
    label: "Point them to the sponsor form",
    points: [
      "Their sponsor form is in their private area, ready to print, with the Gift Aid boxes.",
      "Ask them to send us the paper forms afterwards, so we can claim Gift Aid.",
    ],
    reason: () => "A run, walk or Santa dash: a sponsor form helps them collect, with Gift Aid on top.",
  },
  {
    key: "posters",
    pill: "Offer posters",
    label: "Offer posters and leaflets",
    points: ["Offer posters and leaflets.", "Their own poster, with their QR code, is in their private area."],
    reason: (c) => `Its date is ${c.daysAway === 0 ? "today" : `${days(c.daysAway ?? 0)} away`} and no posters or leaflets were asked for.`,
  },
];

const RULES = new Map(PROMPT_RULES.map((r) => [r.key, r]));

// By category (src/fundraising/categories.ts): isKind matches an old combined category and the
// ones it was split into both ways, so a bake sale or coffee morning from before the split, and a
// Bake sale or Coffee morning since, are all offered a tin; a run, walk or Santa dash, old or new,
// the sponsor form.

/** The pace verdict, or null when it is none of the three (or cannot be judged). */
export function pacePrompt(f: PromptFundraiser, today: string): PaceVerdict | null {
  if (f.status !== "approved" || f.path !== "raising" || !f.targetPence || !f.eventDate || !f.approvedAt) return null;
  const daysAway = dayCount(today, f.eventDate);
  if (daysAway <= 0) return null;
  const raised = f.meter.raisedPence;
  const target = f.targetPence;
  if (raised >= target) return daysAway > AHEAD_DAYS ? "ahead" : null;
  if (daysAway <= BEHIND_DAYS && raised * 3 < target) return "behind";
  const start = ukDay(f.approvedAt);
  const total = dayCount(start, f.eventDate);
  const elapsed = dayCount(start, today);
  if (total <= 0 || elapsed < total * ON_TRACK_FROM) return null;
  const expected = (target * elapsed) / total;
  return raised >= expected * (1 - ON_TRACK_BAND) && raised <= expected * (1 + ON_TRACK_BAND) ? "on_track" : null;
}

function cleared(key: PromptKey, calls: PromptCall[], today: string): boolean {
  const mine = calls.filter((c) => c.prompt === key);
  if (mine.length === 0) return false;
  if (key !== "quiet") return true;
  const latest = mine.map((c) => ukDay(c.calledAt)).sort().pop() as string;
  return dayCount(latest, today) < QUIET_DAYS;
}

/** Every prompt showing today for one fundraiser, in the table's order. */
export function callPrompts(f: PromptFundraiser, facts: PromptFacts, today: string): CallPrompt[] {
  if (f.status !== "approved") return [];
  // In memory (Jaimie, 2026-10-03): no upbeat prompts. Staff get in touch personally, as they see fit.
  if (isInMemory(f)) return [];
  const daysAway = f.eventDate ? dayCount(today, f.eventDate) : null;
  const beforeDate = daysAway === null || daysAway > 0;
  const raised = f.meter.raisedPence;
  const quietFrom = facts.lastOnlineGiftAt ? ukDay(facts.lastOnlineGiftAt) : f.approvedAt ? ukDay(f.approvedAt) : null;
  const quietDays = quietFrom ? dayCount(quietFrom, today) : 0;
  let expected = 0;
  if (f.approvedAt && f.eventDate && f.targetPence) {
    const total = dayCount(ukDay(f.approvedAt), f.eventDate);
    if (total > 0) expected = (f.targetPence * dayCount(ukDay(f.approvedAt), today)) / total;
  }
  const ctx: Ctx = { today, daysAway, raised, target: f.targetPence, quietDays, expected };

  const w = f.wants;
  const keys: PromptKey[] = [];
  const pace = pacePrompt(f, today);
  if (pace) keys.push(pace);
  if (f.path === "raising" && f.public && beforeDate && quietFrom && quietDays >= QUIET_DAYS) keys.push("quiet");
  const stillToCome = daysAway === null || daysAway >= 0;
  if (stillToCome && isKind(f.kind, "bake_sale") && w.bucketCount + w.tinCount + w.buckets === 0) keys.push("tin");
  if (stillToCome && isKind(f.kind, "run_walk", "santa_dash") && !facts.sponsorFormAsked) keys.push("sponsor_form");
  if (daysAway !== null && daysAway >= 0 && daysAway <= POSTERS_DAYS && w.posterCount + w.leafletCount + w.leaflets === 0) keys.push("posters");

  return keys
    .filter((k) => !cleared(k, facts.calls, today))
    .map((k) => {
      const rule = RULES.get(k) as PromptRule;
      return { key: k, pill: rule.pill, label: rule.label, reason: rule.reason(ctx), points: [...rule.points] };
    });
}

export interface PromptCounts {
  behind: number;
  ahead: number;
  onTrack: number;
  quiet: number;
  /** The tin and posters suggestions, added up (never the sponsor form: see promptCounts). */
  materials: number;
}

/** How many of each are showing, for the Monday summary. */
export function promptCounts(list: Array<{ f: PromptFundraiser; facts: PromptFacts }>, today: string): PromptCounts {
  const out: PromptCounts = { behind: 0, ahead: 0, onTrack: 0, quiet: 0, materials: 0 };
  for (const { f, facts } of list) {
    for (const p of callPrompts(f, facts, today)) {
      if (p.key === "behind") out.behind += 1;
      else if (p.key === "ahead") out.ahead += 1;
      else if (p.key === "on_track") out.onTrack += 1;
      else if (p.key === "quiet") out.quiet += 1;
      // The sponsor form shows as a pill, but is not a thing waiting: nothing records it but a call.
      else if (p.key !== "sponsor_form") out.materials += 1;
    }
  }
  return out;
}
