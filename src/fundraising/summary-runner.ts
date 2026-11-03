import { config } from "../config";
import { sendFundraiseSummary } from "../clients/email";
import { recordAudit } from "../db/donations";
import {
  claimSummaryWeek,
  getSummarySettings,
  readSummaryInputs,
  releaseSummaryWeek,
  type SummarySettings,
} from "../db/fundraising-team";
import { isSummaryAddress, summaryCounts, summaryDue, summaryLines, type SummaryInputs } from "./summary";
import { buildSummaryEmail } from "./team-emails";
import type { FundraiseSummaryMessage } from "../clients/email";

// TASK-503: the wiring for the Monday summary (email 11). It rides the daily 8am task (npm run
// reminders, src/scripts/send-reminders.ts) like the Ball's ticket report, rather than having a
// schedule of its own; the pure summaryDue decides whether today is the day.
//
//   - Mondays only (UK), and never twice for the same Monday: the week is claimed under a lock
//     before anything is sent, so a second run that morning sends nothing;
//   - nobody on the list (Admin > Get involved, Settings, Weekly summary): nothing happens, and
//     nothing is claimed;
//   - ONE email with everyone on the To line, from and replying to the events inbox, so Reply all
//     reaches the whole team (Jaimie, 2026-10-05). Reply all in a mail program goes to the Reply-To
//     address and to everyone else on the To line, so the events inbox stays as Reply-To;
//   - nbcc.scot addresses only: everyone on the To line sees everyone else and every reply, so an
//     address from anywhere else is left off it (saving refuses a new one, but an old one may still
//     be stored). How many were left off is logged, never which. If that leaves nobody, it is
//     "nobody to send to", and nothing is claimed;
//   - if it did not go, that is logged and the week is given back so a rerun can try again. `sent`
//     is the number of people on the To line when it went, `failed` that number when it did not;
//   - it never throws: every failure is logged, so it can never stop the passes after it.

export interface SummaryDeps {
  getSettings: () => Promise<SummarySettings>;
  claim: (week: string) => Promise<{ previous: string | null } | null>;
  release: (week: string, previous: string | null) => Promise<void>;
  readInputs: (now: Date) => Promise<SummaryInputs>;
  send: (message: FundraiseSummaryMessage) => Promise<void>;
  record: (data: { week: string; sent: number; failed: number }) => Promise<void>;
}

const realDeps: SummaryDeps = {
  getSettings: getSummarySettings,
  claim: claimSummaryWeek,
  release: releaseSummaryWeek,
  readInputs: readSummaryInputs,
  send: sendFundraiseSummary,
  record: (data) =>
    recordAudit({ actor: "system:schedule", action: "fundraising.summary_sent", entity: "fundraising_settings", entityId: 1, data }),
};

export interface SummaryRunResult {
  sent: number;
  failed: number;
  skipped?: "not today" | "nobody to send to" | "already sent" | "could not read";
}

const adminUrl = () => `${config.PORTAL_BASE_URL.replace(/\/+$/, "")}/admin`;
// `to` is never empty: the run stops before this with nobody to send to, and a test has one person.
const message = ([first, ...rest]: string[]) => ({
  email: first,
  ...(rest.length ? { alsoTo: rest } : {}),
  from: config.BALL_FROM_EMAIL,
  replyTo: config.BALL_FROM_EMAIL,
});
const why = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function runFundraisingSummary(now = new Date(), deps: SummaryDeps = realDeps): Promise<SummaryRunResult> {
  let settings: SummarySettings;
  try {
    settings = await deps.getSettings();
  } catch (err) {
    console.error("fundraising summary: could not read its settings:", why(err));
    return { sent: 0, failed: 0, skipped: "could not read" };
  }
  const { due, week } = summaryDue(now, settings.lastWeek);
  if (!due) return { sent: 0, failed: 0, skipped: "not today" };
  const to = settings.recipients.filter(isSummaryAddress);
  const leftOut = settings.recipients.length - to.length;
  // A count only: the addresses themselves are never logged.
  if (leftOut > 0) console.log(`fundraising summary: ${leftOut} ${leftOut === 1 ? "address" : "addresses"} left out, not nbcc.scot`);
  if (to.length === 0) return { sent: 0, failed: 0, skipped: "nobody to send to" };

  let claim: { previous: string | null } | null;
  try {
    claim = await deps.claim(week);
  } catch (err) {
    console.error("fundraising summary: could not claim the week:", why(err));
    return { sent: 0, failed: 0, skipped: "could not read" };
  }
  if (!claim) return { sent: 0, failed: 0, skipped: "already sent" };
  const giveBack = () => deps.release(week, claim!.previous).catch((err) => console.error("fundraising summary: could not give the week back:", why(err)));

  let mail;
  try {
    mail = buildSummaryEmail(summaryLines(summaryCounts(await deps.readInputs(now))), { adminUrl: adminUrl(), test: false });
  } catch (err) {
    console.error("fundraising summary: could not read the numbers:", why(err));
    await giveBack();
    return { sent: 0, failed: 0, skipped: "could not read" };
  }

  // One message, so it went to everyone on it or to nobody.
  let sent = 0;
  let failed = 0;
  try {
    await deps.send({ ...message(to), ...mail });
    sent = to.length;
  } catch (err) {
    failed = to.length;
    // Logged without the addresses; the email log has a row for each of them.
    console.error("fundraising summary: the email did not go:", why(err));
    await giveBack();
  }
  try {
    await deps.record({ week, sent, failed });
  } catch (err) {
    console.error("fundraising summary: went, but could not be recorded:", why(err));
  }
  return { sent, failed };
}

/**
 * "Send a test now": the real email with this week's numbers, marked as a test, to the admin asking
 * and nobody else, on any day. Claims nothing. Throws when it did not go, so the admin is told.
 */
export async function sendSummaryTest(to: string, now = new Date(), deps: SummaryDeps = realDeps): Promise<void> {
  const mail = buildSummaryEmail(summaryLines(summaryCounts(await deps.readInputs(now))), { adminUrl: adminUrl(), test: true });
  await deps.send({ ...message([to]), ...mail });
}
