import { config } from "../config";
import {
  sendFundraiseApproved,
  sendFundraiseManage,
  sendFundraiseStaff,
  sendFundraiseThanks,
} from "../clients/email";
import { buildApprovedEmail, buildManageLinkEmail, buildSignUpStaffEmail, buildSignUpThanksEmail } from "./emails";
import { hasPage, type FundraiserRecord } from "./model";
import { manageLink } from "./manage-token";

// TASK-493: sending the fundraising emails. Each is best effort and runs after its write has
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

/** Thank the organiser, and tell the events inbox, after a sign up. */
export async function sendSignUpEmails(f: FundraiserRecord): Promise<void> {
  try {
    const mail = buildSignUpThanksEmail(f);
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

/** Their page link (raising money and public), or "you're on our list" for anyone else. */
export async function sendApprovedEmail(f: FundraiserRecord): Promise<void> {
  try {
    const page = hasPage(f);
    const mail = buildApprovedEmail(f, {
      pageUrl: page ? fundraiserPageUrl(f.slug) : null,
      manageUrl: page ? `${base()}/fundraise/manage` : null,
    });
    await sendFundraiseApproved(f.name, { email: f.email, from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL, ...mail });
  } catch (err) {
    logFailure("approved", err);
  }
}

/** The 24 hour link to change their page. The caller has stored the token's hash. */
export async function sendManageLinkEmail(f: FundraiserRecord, token: string): Promise<void> {
  try {
    const mail = buildManageLinkEmail(f, manageLink(base(), token));
    await sendFundraiseManage(f.name, { email: f.email, from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL, ...mail });
  } catch (err) {
    logFailure("manage link", err);
  }
}
