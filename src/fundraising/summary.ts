import { z } from "zod";
import { londonToday } from "../events/model";
import { giftAidPence, giftNetPence, type FundraiserRecord, type Meter } from "./model";
import { addDays, callStates, offListPrompt, type CallRecord } from "./follow-up";
import { INVITE_NOT_TAKEN_DAYS, inviteVerdict } from "./invite";
import { pounds } from "./emails";
import { requestTotals, type RequestRow } from "./requests";
import type { PromptCounts } from "./call-prompts";
import { isCurrentMember, NUDGE_DAYS } from "./teams";
import { memoryYearOnDue } from "./in-memory";
import { packCounts } from "./welcome-pack";

// TASK-503: the Monday summary (email 11), at 8am on Mondays to the people chosen in Admin >
// Fundraising. Pure: the runner (./summary-runner.ts) reads the rows and the clock, and every count
// here is unit tested against a fixed one (test/unit/fundraising-summary.test.ts). Days are UK days.
//
// "Last week" is the Monday to Sunday before this week's Monday. A test sent on another day covers
// the same full week, so what staff check is what goes out.
//
//   money          online gifts (less refunds), what organisers paid in, the cash staff recorded,
//                  and the Gift Aid to claim on last week's gifts (a quarter of each gift, rounded
//                  down per gift as the meter does; never on money paid in); then how many are live
//                  and what every fundraiser has raised in all. A gift counts in the week it was
//                  PAID (a Direct Debit settles days after it is made) and cash in the week staff
//                  RECORDED it, so every pound is in exactly one Monday's summary, even one typed
//                  in after the summary for the week it was paid in had gone
//   new sign ups   every sign up that arrived last week
//   waiting on us  sign ups to approve; changes to check; news updates to check (TASK-506); thank yous to check (TASK-507); posters, leaflets, buckets and tins still
//                  to send (split and old combined requests, from sign ups still to come); shout outs
//                  still to do (only with their permission to post) and someone to come along still
//                  to arrange (likewise); TASK-505: only what staff have not yet marked sent or done
//                  in the Requests part of the sign up, and every bucket or tin not back yet, with
//                  how many are due back (each one due back is a thing waiting); calls due today; invites not taken
//                  up a week after they were sent (not those whose link has expired); fundraisers
//                  four weeks past their date still on
//                  Get involved; and those who say they've finished
//                  Team pages: team member sign ups to approve (on their own line), and teams live
//                  10 days or more that nobody has joined
//                  Welcome packs, each page in one line only: packs waiting for a T-shirt size
//                  (never a sign up still new, and never one whose waiting T-shirt staff left out
//                  with a reason: that is a pack to send); packs to send (approved more than 2 days ago, not
//                  yet sent, or sent with a T-shirt left out whose size has since come in); and in
//                  memory pages with things to send
//   coming up      approved fundraisers dated in the next four weeks

export const SUMMARY_MAX_RECIPIENTS = 10;
export const COMING_UP_DAYS = 28;
/** Team pages: a team nobody has joined is listed up to this many days after going live. */
export const NOBODY_JOINED_UNTIL_DAY = 30;

export type SummaryFundraiser = FundraiserRecord & { meter: Meter; editWaiting: boolean };

export interface SummaryGift {
  fundraiserId: number;
  amountPence: number;
  refundedPence: number;
  giftAid: boolean;
  /** Money the organiser collected and paid in from their private area. */
  paidIn: boolean;
  /** ISO time it became paid: when it was made for a card, when Stripe settled it for a Direct Debit. */
  paidAt: string;
}

export interface SummaryCash {
  fundraiserId: number;
  amountPence: number;
  /** ISO time staff recorded it in the admin (not the day it was paid in). */
  recordedAt: string;
}

export type SummaryCall = CallRecord & { fundraiserId: number };

/** An invite not yet taken up. */
export interface SummaryInvite {
  name: string;
  /** The first name staff typed in its own box; missing for an invite sent before the two boxes. */
  firstName?: string | null;
  signedBy: string;
  createdAt: string;
  resentAt: string | null;
}

export interface SummaryInputs {
  now: Date;
  fundraisers: SummaryFundraiser[];
  gifts: SummaryGift[];
  cash: SummaryCash[];
  calls: SummaryCall[];
  invites: SummaryInvite[];
  /** TASK-505: the requests staff have acted on. None means every request is at its first step. */
  requests?: RequestRow[];
  /** TASK-506: news updates organisers posted that staff have still to check. */
  newsToCheck?: number;
  /** TASK-507: thank yous organisers sent to their supporters that staff have still to check. */
  thanksToCheck?: number;
  /** Profile pictures: photos organisers sent that staff have still to check. */
  photosToCheck?: number;
  /** TASK-515: the smart call prompts showing today (src/fundraising/call-prompts.ts). */
  prompts?: PromptCounts;
  /** In memory: messages givers left on in memory pages that staff have still to check. */
  messagesToCheck?: number;
  /** Sponsor pledges still unpaid two weeks after their event (src/pledges/model.ts). */
  pledgesUnpaid?: number;
  /** Sponsor pledges paid twice (or paid online after cash) that nobody has checked yet. */
  pledgesPaidTwice?: number;
  /**
   * Welcome packs: the fundraisers whose pack has gone with nothing more owed (packSettled). Null or
   * missing when it could not be read: the summary then says nothing of packs to send, rather than
   * counting every one.
   */
  packsSent?: number[] | null;
  /** Welcome packs: the fundraisers whose waiting T-shirt staff left out with a reason (tshirtLeftOut). */
  packsTshirtLeftOut?: number[] | null;
}

export interface Materials {
  posters: number;
  leaflets: number;
  buckets: number;
  tins: number;
  leafletsOrPosters: number;
  bucketsOrTins: number;
  /** TASK-511: printed QR codes still to post. */
  qrCodes?: number;
}

export interface SummaryCounts {
  week: { from: string; to: string };
  today: string;
  onlinePence: number;
  paidInPence: number;
  cashPence: number;
  giftAidPence: number;
  raisedPence: number;
  liveCount: number;
  totalRaisedPence: number;
  newSignUps: Array<{ title: string; path: FundraiserRecord["path"]; town: string }>;
  toApprove: number;
  changesToCheck: number;
  /** TASK-506 */
  newsToCheck: number;
  /** TASK-507 */
  thanksToCheck: number;
  /** Profile pictures */
  photosToCheck: number;
  materials: Materials;
  /** How many fundraisers have something to be sent. */
  materialsFundraisers: number;
  shoutOuts: number;
  /** The date of each request for someone to come along (null when it has none). */
  attend: Array<string | null>;
  /** TASK-505: buckets and tins with fundraisers now, and how many of them are due back. */
  notBack: number;
  notBackDue: number;
  /** How many requests have buckets or tins due back: each is someone to chase. */
  dueBackRequests: number;
  callsDue: number;
  invitesNotTaken: Array<{ name: string; signedBy: string }>;
  pastDate: number;
  saysFinished: number;
  comingUp: Array<{ date: string; title: string; town: string }>;
  /** TASK-515: the smart call prompts showing today, each a call to make. */
  prompts: PromptCounts;
  /** Team pages: member sign ups waiting for staff (not counted in toApprove). */
  teamMembersToApprove: number;
  /** Team pages: teams live 10 days or more that nobody has joined, by name, A to Z. */
  teamsNobodyJoined: string[];
  /** In memory: messages to check, and pages a year on for staff to decide whether to get in touch. */
  messagesToCheck: number;
  memoryYearOn: number;
  /** Sponsor pledges still unpaid two weeks after their event. */
  pledgesUnpaid: number;
  /** Sponsor pledges paid twice, to check and refund. */
  pledgesPaidTwice: number;
  /** Welcome packs: packs to send, those waiting for a T-shirt size, and in memory pages with things to send. */
  packsToSend: number;
  tshirtWaiting: number;
  memoryToSend: number;
  /** Every thing in "Waiting on us", added up. */
  waiting: number;
}

const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

/** Last week: the Monday to Sunday before this week's Monday, as UK days. */
export function lastWeek(now: Date): { from: string; to: string } {
  const today = londonToday(now);
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  return { from: addDays(monday, -7), to: addDays(monday, -1) };
}

/** Is the summary due? On a Monday in the UK, when this Monday's has not gone. */
export function summaryDue(now: Date, lastSentWeek: string | null): { due: boolean; week: string } {
  const today = londonToday(now);
  return { due: weekday(today) === 1 && lastSentWeek !== today, week: today };
}

const inRange = (day: string, r: { from: string; to: string }) => day >= r.from && day <= r.to;
const ukDay = (iso: string) => londonToday(new Date(iso));
const firstWord = (s: string) => String(s).trim().split(/\s+/)[0] || String(s).trim();

export function summaryCounts(i: SummaryInputs): SummaryCounts {
  const today = londonToday(i.now);
  const week = lastWeek(i.now);

  let onlinePence = 0;
  let paidInPence = 0;
  let giftAid = 0;
  for (const g of i.gifts) {
    if (!inRange(ukDay(g.paidAt), week)) continue;
    const net = giftNetPence(g.amountPence, g.refundedPence);
    if (g.paidIn) paidInPence += net;
    else {
      onlinePence += net;
      // Rounded down on each gift, as the meter's Gift Aid is (giftAidOnGifts, GIFT_AID_SQL).
      if (g.giftAid) giftAid += giftAidPence(net);
    }
  }
  const cashPence = i.cash.filter((c) => inRange(ukDay(c.recordedAt), week)).reduce((s, c) => s + c.amountPence, 0);

  const callsBy = new Map<number, CallRecord[]>();
  for (const c of i.calls) callsBy.set(c.fundraiserId, [...(callsBy.get(c.fundraiserId) ?? []), c]);

  // What staff still have to send or do for a sign up still to come: new or approved, and not past
  // its date. Something asked for by one long past is done, or no longer wanted. TASK-505: only what
  // is still at its first step (src/fundraising/requests.ts), and every bucket or tin not back yet.
  const rowsBy = new Map<number, RequestRow[]>();
  for (const r of i.requests ?? []) rowsBy.set(r.fundraiserId, [...(rowsBy.get(r.fundraiserId) ?? []), r]);
  const requests = requestTotals(
    i.fundraisers.map((f) => ({ f, rows: rowsBy.get(f.id) ?? [] })),
    today,
  );
  const materials: Materials = { ...requests.materials };
  const { materialsFundraisers, shoutOuts, attend } = requests;

  const notTakenBy = addDays(today, -INVITE_NOT_TAKEN_DAYS);
  const invitesNotTaken = i.invites
    .filter((inv) => ukDay(inv.resentAt ?? inv.createdAt) <= notTakenBy)
    // An expired link can no longer be taken up: Admin > Fundraising marks it Expired, to resend.
    .filter((inv) => inviteVerdict({ createdAt: new Date(inv.createdAt), resentAt: inv.resentAt ? new Date(inv.resentAt) : null, usedAt: null }, i.now) === "ok")
    .sort((a, b) => ((a.resentAt ?? a.createdAt) < (b.resentAt ?? b.createdAt) ? -1 : 1))
    .map((inv) => ({ name: inv.firstName || firstWord(inv.name), signedBy: inv.signedBy }));

  // Team pages: a member sign up waiting is counted on its own line.
  const isMember = (f: SummaryFundraiser) => Boolean(f.teamId && !f.teamLeftAt);
  const toApprove = i.fundraisers.filter((f) => f.status === "new" && !isMember(f)).length;
  const teamMembersToApprove = i.fundraisers.filter((f) => f.status === "new" && isMember(f)).length;
  const joinedBy = new Set(i.fundraisers.filter((f) => f.teamId && isCurrentMember(f)).map((f) => Number(f.teamId)));
  const teamsNobodyJoined = i.fundraisers
    .filter((f) => f.isTeam && f.status === "approved" && f.approvedAt && !joinedBy.has(f.id))
    // From day 10 to day 30 after going live, and never once the event is over: only while a nudge
    // from us could still help.
    .filter((f) => {
      const live = ukDay(f.approvedAt as string);
      return addDays(live, NUDGE_DAYS[1]) <= today && today <= addDays(live, NOBODY_JOINED_UNTIL_DAY) && !(f.eventDate && f.eventDate < today);
    })
    .map((f) => f.title)
    .sort((a, b) => a.localeCompare(b, "en-GB"));
  const changesToCheck = i.fundraisers.filter((f) => f.editWaiting).length;
  const newsToCheck = Math.max(0, Math.floor(i.newsToCheck ?? 0));
  const thanksToCheck = Math.max(0, Math.floor(Number(i.thanksToCheck ?? 0) || 0));
  const photosToCheck = Math.max(0, Math.floor(Number(i.photosToCheck ?? 0) || 0));
  const callsDue = i.fundraisers.filter((f) => callStates(f, callsBy.get(f.id) ?? [], today).due).length;
  const pastDate = i.fundraisers.filter((f) => offListPrompt(f, today) === "date").length;
  const saysFinished = i.fundraisers.filter((f) => f.status === "approved" && f.finishedRequestedAt).length;
  const lastDay = addDays(today, COMING_UP_DAYS - 1);
  const p = i.prompts;
  const whole = (n: unknown) => Math.max(0, Math.floor(Number(n) || 0));
  const prompts: PromptCounts = {
    behind: whole(p?.behind),
    ahead: whole(p?.ahead),
    onTrack: whole(p?.onTrack),
    quiet: whole(p?.quiet),
    materials: whole(p?.materials),
  };
  const promptCalls = prompts.behind + prompts.ahead + prompts.onTrack + prompts.quiet + prompts.materials;
  // In memory (Jaimie, 2026-10-03): no automatic anniversary email, a reminder here instead.
  const messagesToCheck = whole(i.messagesToCheck);
  const memoryYearOn = i.fundraisers.filter((f) => memoryYearOnDue(f, today)).length;
  const pledgesUnpaid = whole(i.pledgesUnpaid);
  const pledgesPaidTwice = whole(i.pledgesPaidTwice);
  // Welcome packs (Jaimie, 2026-10-03; ./welcome-pack.ts).
  const packs = packCounts(i.fundraisers, new Set(i.packsSent ?? []), today, new Set(i.packsTshirtLeftOut ?? []));
  // Not read: no lines at all, rather than every pack ever sent counted as waiting.
  const { packsToSend, tshirtWaiting, memoryToSend } = i.packsSent ? packs : { packsToSend: 0, tshirtWaiting: 0, memoryToSend: 0 };

  return {
    week,
    today,
    onlinePence,
    paidInPence,
    cashPence,
    giftAidPence: giftAid,
    raisedPence: onlinePence + paidInPence + cashPence,
    liveCount: i.fundraisers.filter((f) => f.status === "approved").length,
    totalRaisedPence: i.fundraisers.reduce((s, f) => s + (f.meter?.raisedPence ?? 0), 0),
    newSignUps: i.fundraisers
      .filter((f) => inRange(ukDay(f.createdAt), week))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id))
      .map((f) => ({ title: f.title, path: f.path, town: f.town })),
    toApprove,
    changesToCheck,
    newsToCheck,
    thanksToCheck,
    photosToCheck,
    materials,
    materialsFundraisers,
    shoutOuts,
    attend,
    notBack: requests.notBack,
    notBackDue: requests.notBackDue,
    dueBackRequests: requests.dueBackRequests,
    callsDue,
    invitesNotTaken,
    pastDate,
    saysFinished,
    comingUp: i.fundraisers
      .filter((f) => f.status === "approved" && f.eventDate && f.eventDate >= today && f.eventDate <= lastDay)
      .sort((a, b) => String(a.eventDate).localeCompare(String(b.eventDate)) || a.title.localeCompare(b.title))
      .map((f) => ({ date: f.eventDate as string, title: f.title, town: f.town })),
    prompts,
    teamMembersToApprove,
    teamsNobodyJoined,
    messagesToCheck,
    memoryYearOn,
    pledgesUnpaid,
    pledgesPaidTwice,
    packsToSend,
    tshirtWaiting,
    memoryToSend,
    waiting:
      pledgesPaidTwice +
      pledgesUnpaid +
      packsToSend +
      tshirtWaiting +
      memoryToSend +
      messagesToCheck +
      memoryYearOn +
      toApprove +
      teamMembersToApprove +
      teamsNobodyJoined.length +
      changesToCheck +
      newsToCheck +
      thanksToCheck +
      photosToCheck +
      materialsFundraisers +
      shoutOuts +
      attend.length +
      requests.dueBackRequests +
      callsDue +
      invitesNotTaken.length +
      pastDate +
      saysFinished +
      promptCalls,
  };
}

// --- the words -------------------------------------------------------------------------------------

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const parts = (ymd: string) => ymd.split("-").map(Number);
/** "Sat 6 Dec" */
const shortDay = (ymd: string) => {
  const [, m, d] = parts(ymd);
  return `${SHORT_DAYS[weekday(ymd)]} ${d} ${SHORT_MONTHS[m - 1]}`;
};
/** "6 December" */
const dayMonth = (ymd: string) => {
  const [, m, d] = parts(ymd);
  return `${d} ${MONTHS[m - 1]}`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const andList = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface SummaryLines {
  subject: string;
  headline: string;
  money: string;
  newSignUps: string[];
  waiting: string[];
  comingUp: string[];
}

/** Plain words, not yet escaped: the email builder escapes them for the html part. */
export function summaryLines(c: SummaryCounts): SummaryLines {
  const paidIn = c.paidInPence + c.cashPence;
  const giftAid = c.giftAidPence > 0 ? `, plus ${pounds(c.giftAidPence)} Gift Aid to claim` : "";
  const money =
    `${pounds(c.onlinePence)} online and ${pounds(paidIn)} paid in${giftAid}. ` +
    `${plural(c.liveCount, "fundraiser", "fundraisers")} live, ${pounds(c.totalRaisedPence)} raised in total.`;

  const waiting: string[] = [];
  if (c.toApprove) waiting.push(plural(c.toApprove, "sign up to approve", "sign ups to approve"));
  // Team pages
  if (c.teamMembersToApprove) waiting.push(plural(c.teamMembersToApprove, "team member sign up to approve", "team member sign ups to approve"));
  if (c.teamsNobodyJoined?.length) {
    waiting.push(`${plural(c.teamsNobodyJoined.length, "team", "teams")} with nobody joined after 10 days: ${andList(c.teamsNobodyJoined)}`);
  }
  if (c.changesToCheck) waiting.push(plural(c.changesToCheck, "change to check", "changes to check"));
  if (c.newsToCheck) waiting.push(plural(c.newsToCheck, "news update to check", "news updates to check"));
  if (c.thanksToCheck) waiting.push(plural(c.thanksToCheck, "thank you to check", "thank yous to check"));
  // Profile pictures: a waiting photo is kept until staff decide, so the summary keeps asking.
  if (c.photosToCheck) waiting.push(plural(c.photosToCheck, "photo waiting to be checked", "photos waiting to be checked"));
  // In memory
  if (c.messagesToCheck) waiting.push(`${plural(c.messagesToCheck, "message", "messages")} to check on in memory pages`);
  if (c.memoryYearOn) {
    waiting.push(`${plural(c.memoryYearOn, "in memory page", "in memory pages")} a year on: decide whether to get in touch`);
  }
  // Welcome packs
  if (c.packsToSend) waiting.push(plural(c.packsToSend, "welcome pack to send", "welcome packs to send"));
  if (c.tshirtWaiting) waiting.push(plural(c.tshirtWaiting, "welcome pack waiting for a T-shirt size", "welcome packs waiting for a T-shirt size"));
  if (c.memoryToSend) waiting.push(plural(c.memoryToSend, "in memory page with things to send", "in memory pages with things to send"));
  const m = c.materials;
  const posted = [
    m.posters ? `posters (${m.posters})` : "",
    m.leaflets ? `leaflets (${m.leaflets})` : "",
    m.leafletsOrPosters ? `leaflets or posters (${m.leafletsOrPosters})` : "",
    m.qrCodes ? `printed QR codes (${m.qrCodes})` : "",
  ].filter(Boolean);
  if (posted.length) waiting.push(`${capital(andList(posted))} to post`);
  const sent = [
    m.buckets ? plural(m.buckets, "collection bucket", "collection buckets") : "",
    m.tins ? plural(m.tins, "collection tin", "collection tins") : "",
    m.bucketsOrTins ? plural(m.bucketsOrTins, "bucket or tin", "buckets or tins") : "",
  ].filter(Boolean);
  if (sent.length) waiting.push(`${andList(sent)} to send`);
  // TASK-505
  if (c.notBack) {
    waiting.push(
      `${plural(c.notBack, "bucket or tin", "buckets or tins")} still out` + (c.notBackDue ? ` (${c.notBackDue} due back)` : ", none due back yet"),
    );
  }
  if (c.shoutOuts) waiting.push(plural(c.shoutOuts, "social media shout out", "social media shout outs"));
  if (c.attend.length) {
    const dates = c.attend.filter((d): d is string => !!d).map(dayMonth);
    waiting.push(
      plural(c.attend.length, "request for someone to come along", "requests for someone to come along") +
        (dates.length ? `, on ${andList(dates)}` : ""),
    );
  }
  if (c.callsDue) waiting.push(plural(c.callsDue, "call due", "calls due"));
  // TASK-515: the smart call prompts, in one line.
  const pr = c.prompts;
  const prTotal = pr ? pr.behind + pr.quiet + pr.ahead + pr.onTrack + pr.materials : 0;
  if (pr && prTotal) {
    const what = [
      pr.behind ? `${pr.behind} behind` : "",
      pr.quiet ? `${pr.quiet} gone quiet` : "",
      pr.ahead ? `${pr.ahead} ahead` : "",
      pr.onTrack ? `${pr.onTrack} on track` : "",
      pr.materials ? `${pr.materials} to offer materials` : "",
    ].filter(Boolean);
    waiting.push(`${plural(prTotal, "call to make from the prompts", "calls to make from the prompts")}: ${andList(what)}`);
  }
  if (c.invitesNotTaken.length) {
    waiting.push(
      `${plural(c.invitesNotTaken.length, "invite", "invites")} not taken up after a week: ` +
        c.invitesNotTaken.map((i) => `${i.name}, invited by ${i.signedBy}`).join("; "),
    );
  }
  // Sponsor pledges: promises still not paid a fortnight after the event.
  if (c.pledgesPaidTwice) waiting.push(`${plural(c.pledgesPaidTwice, "pledge", "pledges")} paid twice: check and refund`);
  if (c.pledgesUnpaid) waiting.push(`${plural(c.pledgesUnpaid, "pledge", "pledges")} unpaid 2 weeks after the event`);
  if (c.pastDate) {
    waiting.push(
      c.pastDate === 1
        ? "1 fundraiser 4 weeks past its date: take it off Get involved?"
        : `${c.pastDate} fundraisers 4 weeks past their date: take them off Get involved?`,
    );
  }
  if (c.saysFinished) {
    waiting.push(c.saysFinished === 1 ? "1 fundraiser says they’ve finished" : `${c.saysFinished} fundraisers say they’ve finished`);
  }

  const things = c.waiting === 0 ? "nothing waiting" : plural(c.waiting, "thing waiting", "things waiting");
  return {
    subject: `Fundraising this week: ${pounds(c.raisedPence)} raised, ${things}`,
    headline: `${pounds(c.raisedPence)} raised`,
    money,
    newSignUps: c.newSignUps.map((s) =>
      [s.title, s.path === "event" ? "holding an event" : "raising money", s.town].filter((x) => x && String(x).trim()).join(", "),
    ),
    waiting,
    comingUp: c.comingUp.map((u) => `${shortDay(u.date)}: ${[u.title, u.town].filter((x) => x && x.trim()).join(", ")}`),
  };
}

// --- who it goes to --------------------------------------------------------------------------------

/** The list as an admin saves it: tidied, each address once, in order. */
export const summaryRecipientsSchema = z
  .array(z.string().trim().toLowerCase().max(254, "That email is too long.").email("That isn't a whole email address."))
  .max(SUMMARY_MAX_RECIPIENTS, `The summary can go to up to ${SUMMARY_MAX_RECIPIENTS} people.`)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((e, idx) => {
      if (seen.has(e)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [idx], message: "That address is already on the list." });
      seen.add(e);
    });
  })
  .transform((list) => [...list].sort());
