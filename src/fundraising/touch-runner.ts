import { config } from "../config";
import { sendFundraiseTouch, type FundraiseEmailMessage } from "../clients/email";
import { fundraisingIsOn } from "../db/fundraisers";
import { claimTouch, readTouchState, recordTouchSent, releaseTouch, touchEmailsOn, type TouchCandidate } from "../db/fundraising-touch";
import { suppressedAmong } from "../db/email-suppressions";
import { optedOutAmong } from "../db/email-opt-outs";
import { createAgainToken } from "../db/fundraiser-again";
import { againExpiresAt, againUrl, hashAgainToken, newAgainToken } from "./again";
import { londonToday } from "../events/model";
import { buildTouchEmail, touchEmailData } from "./touch-emails";
import { canTouch, isQuietFundraiser, nextTouch, type TouchFundraiser, type TouchKind } from "./touch-rules";
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
//     kind), so none ever goes twice; a failed send gives the claim back for another day.
//
// The daily pass (runTouchEmails) rides the 8am task (src/scripts/send-reminders.ts), one email per
// fundraiser at most. The finished email (sendFinishedTouch) goes when staff press Mark finished,
// after that has committed. Neither ever throws: every failure is logged, never with an address.

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
};

const why = (err: unknown) => (err instanceof Error ? err.message : String(err));
const base = () => config.PORTAL_BASE_URL.replace(/\/+$/, "");

async function bothOn(deps: TouchDeps): Promise<"on" | "switched off" | "fundraising off"> {
  if (!(await deps.touchOn())) return "switched off";
  if (!(await deps.fundraisingOn())) return "fundraising off";
  return "on";
}

type Outcome = "sent" | "skipped" | "failed";

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
    const mail = buildTouchEmail(kind, data);
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
  return "sent";
}

export interface TouchRunResult {
  considered: number;
  sent: number;
  failed: number;
  /** How many were due but not sent (an opt out, already claimed), or why the run did nothing. */
  skipped: number | "switched off" | "fundraising off" | "could not read";
}

/** The daily pass. One automatic email at most per fundraiser. Never throws. */
export async function runTouchEmails(now = new Date(), deps: TouchDeps = realTouchDeps): Promise<TouchRunResult> {
  const result = { considered: 0, sent: 0, failed: 0, skipped: 0 };
  let state: TouchCandidate[];
  try {
    const on = await bothOn(deps);
    if (on !== "on") return { ...result, skipped: on };
    state = await deps.readState();
  } catch (err) {
    console.error("fundraising automatic emails: could not read:", why(err));
    return { ...result, skipped: "could not read" };
  }
  const today = londonToday(now);
  const isQuiet = deps.isQuiet ?? isQuietFundraiser;
  for (const c of state) {
    result.considered += 1;
    const kind = nextTouch(c.f, c.touch, today, { isQuiet });
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
    return await sendOne(f, "finished", "system:finished", deps);
  } catch (err) {
    console.error("fundraising automatic email (finished) failed:", why(err));
    return "failed";
  }
}
