import { config } from "../config";
import {
  sendFundraiseApproved,
  sendFundraiseCode,
  sendFundraiseEditApproved,
  sendFundraiseEditRejected,
  sendFundraiseFinishedStaff,
  sendFundraiseNewsApproved,
  sendFundraiseNewsRejected,
  sendFundraiseStaff,
  sendFundraiseThanks,
} from "../clients/email";
import { claimNextWaitingLiveEmail, fundraisingIsOn, markLiveEmailWaiting } from "../db/fundraisers";
import {
  buildApprovedEmail,
  buildEditApprovedEmail,
  buildEditRejectedEmail,
  buildFinishedStaffEmail,
  buildNewsApprovedEmail,
  buildNewsRejectedEmail,
  buildSignInCodeEmail,
  buildSignUpStaffEmail,
  buildSignUpThanksEmail,
} from "./emails";
import { hasPage, type FundraiserRecord } from "./model";

// TASK-493: sending the fundraising emails. TASK-497 adds "Your page is live" held until the switch
// goes on (sendWaitingLiveEmails) and the two emails about a change. Each is best effort and runs after its write has
// committed, like the ball's (src/ball/transfer-send.ts): the sign up or approval stands whether or
// not the email goes, and a failed send is logged, never turned into an error for the person.
//
// From and Reply-To are the events inbox (config.BALL_FROM_EMAIL, events@nbcc.scot). The summary to
// that inbox has Reply-To the organiser, so answering it reaches them. Links are built on
// PORTAL_BASE_URL, the public site address the other emails use.

const base = () => config.PORTAL_BASE_URL.replace(/\/+$/, "");

function logFailure(what: string, err: unknown): void {
  console.error(`fundraising ${what} email failed:`, err instanceof Error ? err.message : err);
}

export function fundraiserPageUrl(slug: string): string {
  return `${base()}/fundraise/${slug}`;
}

/** Any address on the public site, from its path (TASK-504: Get involved, for an event's poster). */
export function siteUrl(path: string): string {
  return `${base()}${path}`;
}

/** The private area (TASK-501), where an organiser signs in with a code. */
export function manageUrl(): string {
  return `${base()}/fundraise/manage`;
}

/** Thank the organiser, and tell the events inbox, after a sign up. */
export async function sendSignUpEmails(f: FundraiserRecord): Promise<void> {
  try {
    // Only a safe first name from what they typed (safeFirstName in ./emails), nothing else.
    const mail = buildSignUpThanksEmail(f.name);
    await sendFundraiseThanks(f.name, { email: f.email, from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL, ...mail });
  } catch (err) {
    logFailure("sign up thanks", err);
  }
  try {
    const mail = buildSignUpStaffEmail({ ...f, id: f.id }, { adminUrl: `${base()}/admin` });
    await sendFundraiseStaff(f.name, { email: config.BALL_FROM_EMAIL, from: config.BALL_FROM_EMAIL, replyTo: f.email, ...mail });
  } catch (err) {
    logFailure("sign up staff summary", err);
  }
}

/**
 * "Your page is live" with their page link (raising money and public), or "you're on our list" for
 * anyone else. The caller sends this only when there is nothing to wait for: a page holder approved
 * while fundraising is off is marked as waiting instead (moveFundraiser), and sendWaitingLiveEmails
 * sends theirs at the switch. True when the email went.
 */
export async function sendApprovedEmail(f: FundraiserRecord): Promise<boolean> {
  try {
    const page = hasPage(f);
    const mail = buildApprovedEmail(f, {
      pageUrl: page ? fundraiserPageUrl(f.slug) : null,
      manageUrl: page ? `${base()}/fundraise/manage` : null,
    });
    await sendFundraiseApproved(f.name, { email: f.email, from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL, ...mail });
    return true;
  } catch (err) {
    logFailure("approved", err);
    return false;
  }
}

/**
 * At the switch on, in the background after the admin has their answer: "Your page is live" to every
 * approved page holder still waiting. One at a time: each is claimed (its mark cleared) just before
 * its email, so a restart part way loses at most the one in flight, and switching on twice emails
 * nobody twice. The switch is read again before each one, and the run stops if fundraising has been
 * switched off meanwhile. One whose email fails is marked as waiting again for the next switch on;
 * the run goes on past it by id, so it never loops on it. Never throws: everything is logged.
 */
export async function sendWaitingLiveEmails(): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  let lastId = 0;
  try {
    for (;;) {
      if (!(await fundraisingIsOn())) {
        // Switched off again, or the switch could not be read: either way, stop. Anyone not reached
        // keeps their mark and is emailed at the next switch on. Say so, so a quiet stop is visible.
        console.warn(`fundraising live emails stopped: fundraising is off or the switch could not be read (${sent} sent, ${failed} failed)`);
        break;
      }
      const f = await claimNextWaitingLiveEmail(lastId);
      if (!f) break;
      lastId = f.id;
      if (await sendApprovedEmail(f)) {
        sent += 1;
        continue;
      }
      failed += 1;
      try {
        await markLiveEmailWaiting(f.id);
      } catch (err) {
        logFailure("live (marking as waiting again)", err);
      }
    }
  } catch (err) {
    logFailure("live (the run stopped)", err);
  }
  return { sent, failed };
}

/**
 * After staff approve or reject a change the organiser asked for. Their page counts as up only
 * when they have one (raising money, public, approved) and fundraising is on; only then do the
 * emails talk about the page and link it. True when the email went.
 */
export async function sendEditDecisionEmail(f: FundraiserRecord, approved: boolean, pagesOpen: boolean): Promise<boolean> {
  try {
    const message = { email: f.email, from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL };
    const pageLive = hasPage(f) && pagesOpen;
    if (approved) {
      const pageUrl = pageLive ? fundraiserPageUrl(f.slug) : null;
      await sendFundraiseEditApproved(f.name, { ...message, ...buildEditApprovedEmail(f, { pageUrl }) });
    } else {
      await sendFundraiseEditRejected(f.name, { ...message, ...buildEditRejectedEmail(f, { pageLive }) });
    }
    return true;
  } catch (err) {
    logFailure(approved ? "update live" : "about your update", err);
    return false;
  }
}

/**
 * TASK-501: the sign in code for the private area (email 8), to the email it was asked for. The
 * caller has stored only its keyed hash. Greeted by a safe first name from `name`, the newest of
 * their fundraisers. Never throws, and a failure is logged without the code.
 */
export async function sendSignInCodeEmail(email: string, name: string, code: string): Promise<void> {
  try {
    const mail = buildSignInCodeEmail(name, code);
    await sendFundraiseCode(name, { email, from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL, ...mail });
  } catch (err) {
    logFailure("sign in code", err);
  }
}

/** TASK-501: the organiser pressed "I've finished". To the events inbox, replying to them. */
export async function sendFinishedStaffEmail(f: FundraiserRecord, raisedPence: number): Promise<void> {
  try {
    const mail = buildFinishedStaffEmail({ ...f, raisedPence }, { adminUrl: `${base()}/admin` });
    await sendFundraiseFinishedStaff(f.name, { email: config.BALL_FROM_EMAIL, from: config.BALL_FROM_EMAIL, replyTo: f.email, ...mail });
  } catch (err) {
    logFailure("finished (to the events inbox)", err);
  }
}

/**
 * TASK-506: after staff approve, or do not use, a news update the organiser posted. As for a change:
 * their page counts as up only when they have one and fundraising is on, and only then do the emails
 * talk about the page and link it. True when the email went. Never throws.
 */
export async function sendNewsDecisionEmail(f: FundraiserRecord, approved: boolean, pagesOpen: boolean): Promise<boolean> {
  try {
    const message = { email: f.email, from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL };
    const pageLive = hasPage(f) && pagesOpen;
    if (approved) {
      const pageUrl = pageLive ? fundraiserPageUrl(f.slug) : null;
      await sendFundraiseNewsApproved(f.name, { ...message, ...buildNewsApprovedEmail(f, { pageUrl }) });
    } else {
      await sendFundraiseNewsRejected(f.name, { ...message, ...buildNewsRejectedEmail(f, { pageLive }) });
    }
    return true;
  } catch (err) {
    logFailure(approved ? "news update live" : "about your news update", err);
    return false;
  }
}
