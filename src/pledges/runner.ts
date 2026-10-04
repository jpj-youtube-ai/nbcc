import { config } from "../config";
import { sendFundraisePledge, sendFundraisePledgeStaff, type FundraiseEmailMessage } from "../clients/email";
import { londonToday } from "../events/model";
import { buildPledgeConfirmEmail, buildPledgeEmail, buildPledgeStaffEmail, pledgesPaidTwiceNote } from "./emails";
import { payLinkRefusal, pledgeEmailDue, retentionAction, type PledgeEmailKind } from "./model";
import { signPledgeToken } from "./token";
import type { PledgeRecord, PledgeWithFundraiser } from "../db/pledges";

// Sponsor pledges (Jaimie, 2026-10-03): sending the emails to sponsors, the daily tidy up of personal
// details, and the notes to the events inbox.
//
// THE CONFIRM EMAIL (sendPledgeConfirmEmail) goes once, when someone pledges. It is what makes a
// pledge count at all, so it is not an automatic email: it goes whatever the Automatic emails switch
// says and its wording is not approval gated. It still respects the stop lists, and nothing ever
// follows it: an unconfirmed pledge is simply deleted after 7 days.
//
// THE PAY EMAIL AND ITS REMINDER are AUTOMATIC emails, so, exactly like the automatic emails to
// organisers (src/fundraising/touch-runner.ts), nothing is sent unless every guard says yes:
//
//   - the Automatic emails switch in Admin > Fundraising is on (it ships OFF) AND fundraising is on.
//     Both are read at the start and again before each email, so switching either off stops a run;
//   - the email's wording has been approved by an admin (pledge_pay, pledge_reminder in
//     touch_wording_approvals; both ship UNAPPROVED). One waiting is skipped and NOT claimed, so it
//     can still go once approved while it is due; approvals that cannot be read count as none;
//   - the sponsor's address is on neither the suppression list nor the opt out list; a list that
//     cannot be read means no email;
//   - each email is claimed on its pledge BEFORE it is sent, so neither ever goes twice; a failed
//     send gives the claim back for another day.
//
// The daily passes ride the 8am task (src/scripts/send-reminders.ts). The tidy up (runPledgeRetention)
// is not an email and runs whatever the switches say.
//
// Staff can send the pay link for one pledge by hand (sendPledgeEmailNow), or new links to everyone
// unpaid after the signing secret changes (sendAllPayLinks). Both obey EVERY rule above except the
// daily task's time window: never before the link is due, never while the switch is off, never
// unapproved wording, never a stopped address, and held for ten minutes so one never goes twice.
//
// Nothing here ever throws: every failure is logged, by pledge id, never with a name or an address.

export interface PledgeRunDeps {
  now: () => Date;
  touchOn: () => Promise<boolean>;
  fundraisingOn: () => Promise<boolean>;
  /** The wordings an admin has approved. */
  approvedWordings: () => Promise<ReadonlySet<string>>;
  readLive: () => Promise<PledgeWithFundraiser[]>;
  getPledge: (id: number) => Promise<PledgeWithFundraiser | null>;
  /** Is this address suppressed or opted out? Throws when it cannot be told. */
  blocked: (email: string) => Promise<boolean>;
  claim: (id: number, kind: PledgeEmailKind) => Promise<boolean>;
  release: (id: number, kind: PledgeEmailKind) => Promise<void>;
  markSent: (id: number, fundraiserId: number, kind: PledgeEmailKind, actor: string) => Promise<void>;
  /** Hold a pledge for a pay link sent by hand: false when one went in the last ten minutes. */
  claimResend: (id: number) => Promise<boolean>;
  releaseResend: (id: number) => Promise<void>;
  markConfirmSent: (id: number) => Promise<void>;
  /** To a sponsor. No name is given: the email log never keeps a sponsor's name. */
  send: (kind: PledgeEmailKind | "pledge_confirm", message: FundraiseEmailMessage) => Promise<void>;
  /** To the events inbox. */
  sendStaff: (message: FundraiseEmailMessage) => Promise<void>;
  anonymise: (id: number) => Promise<boolean>;
  trim: (id: number) => Promise<void>;
  deleteUnconfirmed: (id: number) => Promise<boolean>;
  listDoublePaid: () => Promise<PledgeWithFundraiser[]>;
  markAlerted: (ids: number[]) => Promise<void>;
}

async function isBlocked(email: string): Promise<boolean> {
  const [{ suppressedAmong }, { optedOutAmong }] = await Promise.all([import("../db/email-suppressions"), import("../db/email-opt-outs")]);
  const address = email.trim().toLowerCase();
  const [suppressed, optedOut] = await Promise.all([suppressedAmong([address]), optedOutAmong([address])]);
  return suppressed.has(address) || optedOut.has(address);
}

// The database modules are loaded when first used, so this file stays import safe for unit tests.
const db = () => import("../db/pledges");
export const realPledgeDeps: PledgeRunDeps = {
  now: () => new Date(),
  touchOn: async () => (await import("../db/fundraising-touch")).touchEmailsOn(),
  fundraisingOn: async () => (await import("../db/fundraisers")).fundraisingIsOn(),
  approvedWordings: async () => (await import("../db/fundraising-touch")).approvedWordingKeys(),
  readLive: async () => (await db()).readLivePledges(),
  getPledge: async (id) => (await db()).getPledgeWithFundraiser(id),
  blocked: isBlocked,
  claim: async (id, kind) => (await db()).claimPledgeEmail(id, kind),
  release: async (id, kind) => (await db()).releasePledgeEmail(id, kind),
  markSent: async (id, fundraiserId, kind, actor) => (await db()).markPledgeEmailSent(id, fundraiserId, kind, actor),
  claimResend: async (id) => (await db()).claimPayLinkResend(id),
  releaseResend: async (id) => (await db()).releasePayLinkResend(id),
  markConfirmSent: async (id) => (await db()).markConfirmEmailSent(id),
  send: sendFundraisePledge,
  sendStaff: sendFundraisePledgeStaff,
  anonymise: async (id) => (await db()).anonymisePledge(id),
  trim: async (id) => (await db()).trimPaidPledge(id),
  deleteUnconfirmed: async (id) => (await db()).deleteUnconfirmedPledge(id),
  listDoublePaid: async () => (await db()).listDoublePaidToAlert(),
  markAlerted: async (ids) => (await db()).markDoublePaidAlerted(ids),
};

const why = (err: unknown) => (err instanceof Error ? err.message : String(err));
const base = () => config.PORTAL_BASE_URL.replace(/\/+$/, "");
const fromEvents = () => ({ from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL });

/** The signed links the emails carry for one pledge, each signed for its own purpose. */
export function pledgeLinks(p: Pick<PledgeRecord, "id" | "tokenNonce">): { payUrl: string; cancelUrl: string; confirmUrl: string } {
  const pay = encodeURIComponent(signPledgeToken(p.id, p.tokenNonce, config.ADMIN_SESSION_SECRET));
  const confirm = encodeURIComponent(signPledgeToken(p.id, p.tokenNonce, config.ADMIN_SESSION_SECRET, "confirm"));
  return { payUrl: `${base()}/pledge/pay?t=${pay}`, cancelUrl: `${base()}/pledge/cancel?t=${pay}`, confirmUrl: `${base()}/pledge/confirm?t=${confirm}` };
}

async function bothOn(deps: PledgeRunDeps): Promise<"on" | "switched off" | "fundraising off"> {
  if (!(await deps.touchOn())) return "switched off";
  if (!(await deps.fundraisingOn())) return "fundraising off";
  return "on";
}

async function readApproved(deps: PledgeRunDeps): Promise<ReadonlySet<string>> {
  try {
    return await deps.approvedWordings();
  } catch (err) {
    console.error("pledge emails: could not read which wordings are approved, so none goes:", why(err));
    return new Set();
  }
}

type Outcome = "sent" | "skipped" | "failed";

async function mayEmail(c: PledgeWithFundraiser, kind: string, deps: PledgeRunDeps): Promise<boolean> {
  try {
    return !(await deps.blocked(c.p.email as string));
  } catch (err) {
    // Cannot tell whether we may email them: then we do not.
    console.error(`pledge email (${kind}) for pledge ${c.p.id}: could not check the opt out lists:`, why(err));
    return false;
  }
}

// --- the confirm email -----------------------------------------------------------------------------

/**
 * The one email sent when someone pledges: "Please confirm your £10 pledge". Not an automatic email
 * (see above), but never to an address on a stop list. Never throws.
 */
export async function sendPledgeConfirmEmail(c: PledgeWithFundraiser, deps: PledgeRunDeps = realPledgeDeps): Promise<"sent" | "blocked" | "failed"> {
  try {
    if (!c.p.email || !(await mayEmail(c, "pledge_confirm", deps))) return "blocked";
    const mail = buildPledgeConfirmEmail({
      sponsorFirstName: c.p.firstName,
      organiserName: c.f.name,
      title: c.f.title,
      amountPence: c.p.amountPence,
      confirmUrl: pledgeLinks(c.p).confirmUrl,
    });
    await deps.send("pledge_confirm", { email: c.p.email, ...fromEvents(), ...mail });
    try {
      await deps.markConfirmSent(c.p.id);
    } catch (err) {
      console.error(`pledge ${c.p.id}: the confirm email went, but could not be marked sent:`, why(err));
    }
    return "sent";
  } catch (err) {
    console.error(`pledge ${c.p.id}: the confirm email could not be sent:`, why(err));
    return "failed";
  }
}

// --- the pay email and its reminder ----------------------------------------------------------------

// Build and send one email. The caller has claimed it (or is staff, who have held it).
async function deliver(c: PledgeWithFundraiser, kind: PledgeEmailKind, deps: PledgeRunDeps): Promise<void> {
  const { payUrl, cancelUrl } = pledgeLinks(c.p);
  const mail = buildPledgeEmail(kind, {
    sponsorFirstName: c.p.firstName,
    organiserName: c.f.name,
    title: c.f.title,
    amountPence: c.p.amountPence,
    giftAid: c.p.giftAid,
    pledgedAt: c.p.createdAt,
    payUrl,
    cancelUrl,
  });
  await deps.send(kind, { email: c.p.email as string, ...fromEvents(), ...mail });
}

async function recordSent(c: PledgeWithFundraiser, kind: PledgeEmailKind, actor: string, deps: PledgeRunDeps): Promise<void> {
  try {
    await deps.markSent(c.p.id, c.f.id, kind, actor);
  } catch (err) {
    // It is claimed, so it can never go twice; only its sent mark and History row are missing.
    console.error(`pledge email (${kind}) for pledge ${c.p.id} went, but could not be marked sent:`, why(err));
  }
}

async function sendOne(c: PledgeWithFundraiser, kind: PledgeEmailKind, deps: PledgeRunDeps): Promise<Outcome> {
  if (!(await mayEmail(c, kind, deps))) return "skipped";
  let claimed = false;
  try {
    claimed = await deps.claim(c.p.id, kind);
  } catch (err) {
    console.error(`pledge email (${kind}) for pledge ${c.p.id}: could not claim it:`, why(err));
    return "skipped";
  }
  if (!claimed) return "skipped";
  try {
    await deliver(c, kind, deps);
  } catch (err) {
    // The mail service can fail after accepting an email, so it may still have arrived. It is given
    // back and tried again on a later run: a rare second copy beats a pay link never sent.
    console.error(`pledge email (${kind}) for pledge ${c.p.id} did not confirm as sent; it will be tried again on a later run:`, why(err));
    try {
      await deps.release(c.p.id, kind);
    } catch (e) {
      console.error(`pledge email (${kind}) for pledge ${c.p.id}: could not give the claim back:`, why(e));
    }
    return "failed";
  }
  await recordSent(c, kind, "system:schedule", deps);
  return "sent";
}

export interface PledgeRunResult {
  considered: number;
  sent: number;
  failed: number;
  /** How many were due but not sent (a stop list, already claimed), or why the run did nothing. */
  skipped: number | "switched off" | "fundraising off" | "could not read";
  /** How many were due but held back, their wording waiting for sign off. */
  waiting: number;
}

/** The daily pass: the pay email the day after the event, one reminder a week later. Never throws. */
export async function runPledgeEmails(now = new Date(), deps: PledgeRunDeps = realPledgeDeps): Promise<PledgeRunResult> {
  const result = { considered: 0, sent: 0, failed: 0, skipped: 0, waiting: 0 };
  let rows: PledgeWithFundraiser[];
  let approved: ReadonlySet<string>;
  try {
    const on = await bothOn(deps);
    if (on !== "on") return { ...result, skipped: on };
    rows = await deps.readLive();
    approved = await readApproved(deps);
  } catch (err) {
    console.error("pledge emails: could not read:", why(err));
    return { ...result, skipped: "could not read" };
  }
  const today = londonToday(now);
  for (const c of rows) {
    const kind = pledgeEmailDue(c.p, c.f, today);
    if (!kind) continue;
    result.considered += 1;
    if (!approved.has(kind)) {
      result.waiting += 1;
      console.info(`pledge email (${kind}) for pledge ${c.p.id} not sent: its wording is waiting for sign off`);
      continue;
    }
    try {
      const on = await bothOn(deps);
      if (on !== "on") {
        console.warn(`pledge emails stopped part way: ${on} (${result.sent} sent)`);
        break;
      }
    } catch (err) {
      console.error("pledge emails: could not read the switches:", why(err));
      break;
    }
    result[await sendOne(c, kind, deps)] += 1;
  }
  return result;
}

// --- the tidy up -----------------------------------------------------------------------------------

export interface PledgeRetentionResult {
  anonymised: number;
  trimmed: number;
  /** Pledges nobody confirmed within 7 days, deleted outright. */
  deleted: number;
  failed: number;
}

/**
 * The daily tidy up: a pledge nobody confirmed is deleted after 7 days; an unpaid pledge's personal
 * details go 90 days after its pay email, keeping the amount; a paid one loses its email after the
 * same wait (retentionAction). Each takes its email log rows with it. Not an email, so it runs
 * whatever the switches say. Never throws.
 */
export async function runPledgeRetention(now = new Date(), deps: PledgeRunDeps = realPledgeDeps): Promise<PledgeRetentionResult> {
  const result = { anonymised: 0, trimmed: 0, deleted: 0, failed: 0 };
  let rows: PledgeWithFundraiser[];
  try {
    rows = await deps.readLive();
  } catch (err) {
    console.error("pledge tidy up: could not read:", why(err));
    return result;
  }
  const today = londonToday(now);
  for (const c of rows) {
    const action = retentionAction(c.p, c.f, today);
    if (!action) continue;
    try {
      if (action === "anonymise") {
        if (await deps.anonymise(c.p.id)) result.anonymised += 1;
      } else if (action === "delete") {
        if (await deps.deleteUnconfirmed(c.p.id)) result.deleted += 1;
      } else {
        await deps.trim(c.p.id);
        result.trimmed += 1;
      }
    } catch (err) {
      result.failed += 1;
      console.error(`pledge tidy up: pledge ${c.p.id} could not be tidied:`, why(err));
    }
  }
  return result;
}

// --- staff, by hand --------------------------------------------------------------------------------

export type SendNowOutcome = "sent" | "not_found" | "not_open" | "page" | "early" | "switched_off" | "off" | "waiting" | "blocked" | "too_soon" | "failed";

async function sendNow(c: PledgeWithFundraiser, actor: string, deps: PledgeRunDeps): Promise<SendNowOutcome> {
  const kind: PledgeEmailKind = "pledge_pay";
  const refusal = payLinkRefusal(c.p, c.f, londonToday(deps.now()));
  if (refusal) return refusal;
  if (!(await deps.touchOn())) return "switched_off";
  if (!(await deps.fundraisingOn())) return "off";
  if (!(await readApproved(deps)).has(kind)) return "waiting";
  if (!(await mayEmail(c, kind, deps))) return "blocked";
  // The FIRST pay link takes the same claim the daily task takes, so the two can never both send
  // it; a later one is a resend, held for ten minutes.
  const first = !c.p.payEmailSentAt;
  if (!(first ? await deps.claim(c.p.id, kind) : await deps.claimResend(c.p.id))) return "too_soon";
  try {
    await deliver(c, kind, deps);
  } catch (err) {
    console.error(`pledge pay link for pledge ${c.p.id} could not be sent by hand:`, why(err));
    try {
      if (first) await deps.release(c.p.id, kind);
      else await deps.releaseResend(c.p.id);
    } catch (e) {
      console.error(`pledge pay link for pledge ${c.p.id}: could not release its hold:`, why(e));
    }
    return "failed";
  }
  await recordSent(c, kind, actor, deps);
  return "sent";
}

/**
 * Staff send (or send again) the pay link for one pledge. Every rule of the daily task applies except
 * its time window: the pledge is open with an address, its page still has pledges, the link is DUE
 * (never early), the Automatic emails switch and fundraising are on, the wording is approved, the
 * address is on neither stop list, and none went in the last ten minutes. Never throws.
 */
export async function sendPledgeEmailNow(pledgeId: number, actor: string, deps: PledgeRunDeps = realPledgeDeps): Promise<SendNowOutcome> {
  try {
    const c = await deps.getPledge(pledgeId);
    return c ? await sendNow(c, actor, deps) : "not_found";
  } catch (err) {
    console.error(`pledge pay link for pledge ${pledgeId} could not be sent by hand:`, why(err));
    return "failed";
  }
}

export interface SendAllResult {
  sent: number;
  /** Held back one at a time: a stopped address, or one that went in the last ten minutes. */
  skipped: number;
  failed: number;
  /** Why nothing (more) could go at all, or null. */
  stopped: "switched_off" | "off" | "waiting" | null;
}

/**
 * "Send new pay links to everyone unpaid": for when ADMIN_SESSION_SECRET has been changed, which
 * makes every link already emailed stop working. One new pay link to every open pledge that has
 * already had one (anyone not yet sent theirs gets it from the daily task as usual), under exactly
 * the rules of sendPledgeEmailNow. Never throws.
 */
export async function sendAllPayLinks(actor: string, deps: PledgeRunDeps = realPledgeDeps): Promise<SendAllResult> {
  const result: SendAllResult = { sent: 0, skipped: 0, failed: 0, stopped: null };
  let rows: PledgeWithFundraiser[];
  try {
    rows = await deps.readLive();
  } catch (err) {
    console.error("new pay links: could not read:", why(err));
    return result;
  }
  const today = londonToday(deps.now());
  for (const c of rows) {
    if (!c.p.payEmailSentAt || payLinkRefusal(c.p, c.f, today)) continue;
    let outcome: SendNowOutcome;
    try {
      outcome = await sendNow(c, actor, deps);
    } catch (err) {
      console.error(`new pay link for pledge ${c.p.id} failed:`, why(err));
      outcome = "failed";
    }
    if (outcome === "switched_off" || outcome === "off" || outcome === "waiting") return { ...result, stopped: outcome };
    if (outcome === "sent") result.sent += 1;
    else if (outcome === "failed") result.failed += 1;
    else result.skipped += 1;
  }
  return result;
}

// --- notes to the events inbox ---------------------------------------------------------------------

/** A plain note to the events inbox. Never throws: true when it went. */
export async function sendPledgeStaffNote(subject: string, lines: string[], deps: PledgeRunDeps = realPledgeDeps): Promise<boolean> {
  try {
    const mail = buildPledgeStaffEmail({ subject, lines, adminUrl: `${base()}/admin` });
    await deps.sendStaff({ email: config.BALL_FROM_EMAIL, ...fromEvents(), ...mail });
    return true;
  } catch (err) {
    console.error("pledge note to the events inbox could not be sent:", why(err));
    return false;
  }
}

/**
 * Tell the events inbox about pledges that were paid twice (or paid online after being marked as paid
 * in cash), once each: "N pledges paid twice: check and refund". By pledge number, fundraiser and
 * amount, never a sponsor's name or address. Returns how many it told them about. Never throws.
 */
export async function sendDoublePaidAlerts(deps: PledgeRunDeps = realPledgeDeps): Promise<number> {
  try {
    const rows = await deps.listDoublePaid();
    if (rows.length === 0) return 0;
    const { subject, lines } = pledgesPaidTwiceNote(rows.map((c) => ({ title: c.f.title, pledgeId: c.p.id, amountPence: c.p.amountPence, cashMarked: Boolean(c.p.cashMarkedAt) })));
    if (!(await sendPledgeStaffNote(subject, lines, deps))) return 0;
    await deps.markAlerted(rows.map((c) => c.p.id));
    return rows.length;
  } catch (err) {
    console.error("pledges paid twice: the events inbox could not be told:", why(err));
    return 0;
  }
}
