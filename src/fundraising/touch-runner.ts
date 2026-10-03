import { config } from "../config";
import { sendFundraiseTouch, type FundraiseEmailMessage } from "../clients/email";
import { fundraisingIsOn } from "../db/fundraisers";
import {
  approvedWordingKeys,
  claimTouch,
  clearFinishedPending,
  markFinishedPending,
  readTouchState,
  recordTouchSent,
  releaseTouch,
  touchEmailsOn,
  type TouchCandidate,
} from "../db/fundraising-touch";
import { suppressedAmong } from "../db/email-suppressions";
import { optedOutAmong } from "../db/email-opt-outs";
import { createAgainToken } from "../db/fundraiser-again";
import { againExpiresAt, againUrl, hashAgainToken, newAgainToken } from "./again";
import { londonToday } from "../events/model";
import { buildTouchEmail, touchEmailData } from "./touch-emails";
import { greetGuardian } from "./signup-tidy-emails";
import { canTouch, isQuietFundraiser, isSignedOff, pickTouch, wordingKey, type TouchFundraiser, type TouchKind } from "./touch-rules";
import type { FundraiserRecord, Meter } from "./model";

// TASK-515: sending the automatic emails to organisers. Fundraising is live with real fundraisers,
// so this is written to send nothing unless every guard says yes:
//
//   - the Automatic emails switch in Admin > Fundraising is on (admins only; it ships OFF, and Jaimie
//     switches it on after reading every email in the admin's preview), AND fundraising is on. Both
//     are read at the start and again before each email, so switching either off stops a run part way;
//   - the fundraiser may have them (a public page raising money, approved, or finished for the
//     finished and year on emails, with an organiser email) and is never in memory
//     (isQuietFundraiser);
//   - its address is on neither the suppression list nor the opt out list; a list that cannot be
//     read means no email;
//   - each email is claimed in fundraiser_touchpoints BEFORE it is sent (unique by fundraiser and
//     kind), so none ever goes twice; a failed send gives the claim back for another day;
//   - its wording, if new, has been approved by an admin (touch_wording_approvals; Jaimie,
//     2026-10-03). One waiting for sign off is skipped and NOT claimed, so it can still go once
//     approved while it is due; approvals that cannot be read count as none approved.
//
// The daily pass (runTouchEmails) rides the 8am task (src/scripts/send-reminders.ts), one email per
// fundraiser at most. The finished email (sendFinishedTouch) goes when staff press Mark finished,
// after that has committed; if it is held there for sign off, or its send fails, it is marked
// (fundraisers.touch_finished_pending) and the daily pass catches it up within a week. One not sent
// because the switches were off is never marked, so never sent later. Neither ever throws: every
// failure is logged, never with an address.

export interface TouchDeps {
  touchOn: () => Promise<boolean>;
  fundraisingOn: () => Promise<boolean>;
  readState: () => Promise<TouchCandidate[]>;
  /** Is this address suppressed or opted out? Throws when it cannot be told. */
  blocked: (email: string) => Promise<boolean>;
  claim: (fundraiserId: number, kind: TouchKind, by: string) => Promise<boolean>;
  release: (fundraiserId: number, kind: TouchKind) => Promise<void>;
  recordSent: (fundraiserId: number, kind: TouchKind, by: string) => Promise<void>;
  send: (kind: TouchKind, name: string, message: FundraiseEmailMessage) => Promise<void>;
  /** TASK-515: a new one use Do it again link for email 18's button (src/fundraising/again.ts). */
  againLink: (fundraiserId: number) => Promise<string>;
  /** The wordings an admin has approved (WORDING_KEYS in touch-rules.ts). */
  approvedWordings: () => Promise<ReadonlySet<string>>;
  /** The thank you at Mark finished was held for sign off, or its send failed: the daily run may catch it up. */
  markFinishedPending: (fundraiserId: number, reason: "held" | "failed") => Promise<void>;
  /** The thank you went: nothing to catch up. */
  clearFinishedPending: (fundraiserId: number) => Promise<void>;
  /** The in memory guard. Only tests pass another. */
  isQuiet?: (f: TouchFundraiser) => boolean;
}

async function isBlocked(email: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  const [suppressed, optedOut] = await Promise.all([suppressedAmong([address]), optedOutAmong([address])]);
  return suppressed.has(address) || optedOut.has(address);
}

// A fresh token for each email: only its hash is stored, with when it runs out.
async function makeAgainLink(fundraiserId: number): Promise<string> {
  const token = newAgainToken();
  await createAgainToken(fundraiserId, hashAgainToken(token), againExpiresAt(new Date()));
  return againUrl(config.PORTAL_BASE_URL, token);
}

export const realTouchDeps: TouchDeps = {
  touchOn: touchEmailsOn,
  fundraisingOn: fundraisingIsOn,
  readState: readTouchState,
  blocked: isBlocked,
  claim: claimTouch,
  release: releaseTouch,
  recordSent: recordTouchSent,
  send: sendFundraiseTouch,
  againLink: makeAgainLink,
  approvedWordings: approvedWordingKeys,
  markFinishedPending,
  clearFinishedPending,
};

const why = (err: unknown) => (err instanceof Error ? err.message : String(err));
const base = () => config.PORTAL_BASE_URL.replace(/\/+$/, "");

async function bothOn(deps: TouchDeps): Promise<"on" | "switched off" | "fundraising off"> {
  if (!(await deps.touchOn())) return "switched off";
  if (!(await deps.fundraisingOn())) return "fundraising off";
  return "on";
}

type Outcome = "sent" | "skipped" | "failed";

// The approved wordings; when they cannot be read, none: then no new wording goes, the rest still does.
async function readApproved(deps: TouchDeps): Promise<ReadonlySet<string>> {
  try {
    return await deps.approvedWordings();
  } catch (err) {
    console.error("fundraising automatic emails: could not read which wordings are approved, so no new wording goes:", why(err));
    return new Set();
  }
}

const sayWaiting = (fundraiserId: number, kind: TouchKind, raisedPence: number) =>
  console.info(`fundraising automatic email (${kind}) for fundraiser ${fundraiserId} not sent: its wording (${wordingKey(kind, raisedPence)}) is waiting for sign off`);

// One email to one organiser, through every guard after the switches.
async function sendOne(
  f: FundraiserRecord & { meter: Pick<Meter, "raisedPence"> },
  kind: TouchKind,
  by: string,
  deps: TouchDeps,
): Promise<Outcome> {
  try {
    if (await deps.blocked(f.email)) return "skipped";
  } catch (err) {
    // Cannot tell whether we may email them: then we do not.
    console.error(`fundraising automatic email (${kind}): could not check the opt out lists:`, why(err));
    return "skipped";
  }
  let claimed = false;
  try {
    claimed = await deps.claim(f.id, kind, by);
  } catch (err) {
    console.error(`fundraising automatic email (${kind}): could not claim it:`, why(err));
    return "skipped";
  }
  if (!claimed) return "skipped";
  try {
    const data = touchEmailData(f, base());
    // Email 18's button opens the form filled in from last year: a one use link made for it. If it
    // cannot be made, the email does not go (its words promise one click), and another day tries.
    if (kind === "year_on") data.urls.signUp = await deps.againLink(f.id);
    // A member page for someone under 18: the email greets their parent or guardian.
    const mail = greetGuardian(buildTouchEmail(kind, data), f);
    await deps.send(kind, f.name, { email: f.email, from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL, ...mail });
  } catch (err) {
    // An error from the mail service can come after it has accepted the email (a timeout), so it may
    // still have arrived. It is given back and tried again on a later run (on purpose, after review: a rare
    // second copy beats one never sent); the log says so plainly, by fundraiser id, never the address.
    console.error(
      `fundraising automatic email (${kind}) for fundraiser ${f.id} did not confirm as sent; it may still have reached them, ` +
        `and will be tried again on a later run (the email log has the attempt):`,
      why(err),
    );
    try {
      await deps.release(f.id, kind);
    } catch (e) {
      console.error(`fundraising automatic email (${kind}): could not give the claim back:`, why(e));
    }
    return "failed";
  }
  try {
    await deps.recordSent(f.id, kind, by);
  } catch (err) {
    console.error(`fundraising automatic email (${kind}): went, but its History row was not written:`, why(err));
  }
  if (kind === "finished") {
    try {
      await deps.clearFinishedPending(f.id);
    } catch (err) {
      // Harmless: it is claimed, so it can never go twice.
      console.error("fundraising automatic email (finished): went, but its catch up mark was not cleared:", why(err));
    }
  }
  return "sent";
}

export interface TouchRunResult {
  considered: number;
  sent: number;
  failed: number;
  /** How many were due but not sent (an opt out, already claimed), or why the run did nothing. */
  skipped: number | "switched off" | "fundraising off" | "could not read";
  /** How many were due but held back, their new wording waiting for sign off. */
  waiting: number;
}

/** The daily pass. One automatic email at most per fundraiser. Never throws. */
export async function runTouchEmails(now = new Date(), deps: TouchDeps = realTouchDeps): Promise<TouchRunResult> {
  const result = { considered: 0, sent: 0, failed: 0, skipped: 0, waiting: 0 };
  let state: TouchCandidate[];
  let approved: ReadonlySet<string>;
  try {
    const on = await bothOn(deps);
    if (on !== "on") return { ...result, skipped: on };
    state = await deps.readState();
    approved = await readApproved(deps);
  } catch (err) {
    console.error("fundraising automatic emails: could not read:", why(err));
    return { ...result, skipped: "could not read" };
  }
  const today = londonToday(now);
  const isQuiet = deps.isQuiet ?? isQuietFundraiser;
  for (const c of state) {
    result.considered += 1;
    // New wording waiting for sign off is passed over (never claimed), and the next one due goes.
    const { kind, held } = pickTouch(c.f, c.touch, today, approved, { isQuiet });
    for (const k of held) {
      result.waiting += 1;
      sayWaiting(c.f.id, k, c.f.meter.raisedPence);
    }
    if (!kind) continue;
    try {
      const on = await bothOn(deps);
      if (on !== "on") {
        console.warn(`fundraising automatic emails stopped part way: ${on} (${result.sent} sent)`);
        break;
      }
    } catch (err) {
      console.error("fundraising automatic emails: could not read the switches:", why(err));
      break;
    }
    result[await sendOne(c.f, kind, "system:schedule", deps)] += 1;
  }
  return result;
}

/**
 * The finished email, with the certificate, once staff have pressed Mark finished and it has
 * committed. Only while both switches are on, only for a finished public page raising money, and
 * once. Never throws.
 */
export async function sendFinishedTouch(
  f: FundraiserRecord & { meter: Pick<Meter, "raisedPence"> },
  deps: TouchDeps = realTouchDeps,
): Promise<Outcome> {
  try {
    if (f.status !== "finished" || !canTouch(f, deps.isQuiet ?? isQuietFundraiser)) return "skipped";
    if ((await bothOn(deps)) !== "on") return "skipped";
    // Held back, not claimed, and marked: the daily run sends it once approved, within a week
    // (touch-rules.ts). Only a held or failed one is ever caught up: never one switched off here.
    if (!isSignedOff("finished", f.meter.raisedPence, await readApproved(deps))) {
      sayWaiting(f.id, "finished", f.meter.raisedPence);
      await deps.markFinishedPending(f.id, "held");
      return "skipped";
    }
    const outcome = await sendOne(f, "finished", "system:finished", deps);
    if (outcome === "failed") await deps.markFinishedPending(f.id, "failed");
    return outcome;
  } catch (err) {
    console.error("fundraising automatic email (finished) failed:", why(err));
    return "failed";
  }
}
