import { config } from "../config";
import { sendFundraiseTeam, type FundraiseEmailMessage, type FundraiseTeamKind } from "../clients/email";
import { fundraisingIsOn } from "../db/fundraisers";
import { touchEmailsOn } from "../db/fundraising-touch";
import {
  claimInviteReminder,
  clearOldHandovers,
  claimTeamNudge,
  deleteDueInvites,
  readTeamRunState,
  releaseInviteReminder,
  releaseTeamNudge,
  type TeamRunState,
} from "../db/fundraising-teams";
import { londonToday } from "../events/model";
import { kindLabelOf } from "./model";
import { buildTeamInviteReminderEmail, buildTeamNudgeEmail } from "./team-page-emails";
import { safeWhy, teamEmailBlocked } from "./team-send";
import { hashTeamInviteToken, inviteReminderDue, joinUrl, newTeamInviteToken, teamInviteUrl, teamNudgeDue } from "./teams";
import { isInMemory } from "./in-memory";

// Team pages (Jaimie, 2026-10-03): the daily team pass, on the 8am task (src/scripts/send-reminders.ts).
//
//   1. Delete the names, emails and tokens of the people a team organiser added, 30 days after the
//      invite or once the event is over, whichever is sooner. EVERY day, whatever the switches: it
//      is keeping only what we need, not an email.
//   2. Only while Automatic emails (Admin > Fundraising) and fundraising are both on, read again
//      before each email so switching either off stops a run part way:
//        - the team organiser's nudge, "Did you send the invite to your team?", on day 3 after the
//          team page went live, and a second on day 10 only if still nobody has joined; nothing
//          once anyone has joined or after the event (teamNudgeDue);
//        - ONE gentle reminder to someone invited, 5 days after the invite, if they have not joined
//          (inviteReminderDue), with a fresh link to the join form filled in.
//      Never to an address that asked us to stop (or bounced); a list that cannot be read means no
//      email. Each is claimed before it is sent, so it goes once; a failed send is given back for
//      another day. Never throws, and never logs an address.

export interface TeamRunDeps {
  touchOn: () => Promise<boolean>;
  fundraisingOn: () => Promise<boolean>;
  deleteDue: (today: string) => Promise<number>;
  /** Clear handovers' names, emails, phones and codes 30 days after they closed. */
  clearHandovers: () => Promise<number>;
  readState: () => Promise<TeamRunState>;
  blocked: (email: string) => Promise<boolean>;
  claimNudge: (teamId: number, n: 1 | 2) => Promise<boolean>;
  releaseNudge: (teamId: number, n: 1 | 2) => Promise<void>;
  claimReminder: (inviteId: number, tokenHash: string) => Promise<boolean>;
  releaseReminder: (inviteId: number) => Promise<void>;
  newToken: () => string;
  send: (kind: FundraiseTeamKind, name: string | null, message: FundraiseEmailMessage) => Promise<void>;
}

export const realTeamRunDeps: TeamRunDeps = {
  touchOn: touchEmailsOn,
  fundraisingOn: fundraisingIsOn,
  deleteDue: deleteDueInvites,
  clearHandovers: clearOldHandovers,
  readState: readTeamRunState,
  blocked: teamEmailBlocked,
  claimNudge: claimTeamNudge,
  releaseNudge: releaseTeamNudge,
  claimReminder: claimInviteReminder,
  releaseReminder: releaseInviteReminder,
  newToken: newTeamInviteToken,
  send: sendFundraiseTeam,
};

export interface TeamRunResult {
  deleted: number;
  handoversCleared?: number;
  nudges: number;
  reminders: number;
  failed: number;
  skipped?: "switched off" | "fundraising off" | "could not read";
}

const why = safeWhy;
const base = () => config.PORTAL_BASE_URL.replace(/\/+$/, "");
const from = (email: string) => ({ email, from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL });

async function bothOn(deps: TeamRunDeps): Promise<"on" | "switched off" | "fundraising off"> {
  if (!(await deps.touchOn())) return "switched off";
  if (!(await deps.fundraisingOn())) return "fundraising off";
  return "on";
}

async function mayEmail(email: string | null, deps: TeamRunDeps): Promise<boolean> {
  if (!email) return false;
  try {
    return !(await deps.blocked(email));
  } catch (err) {
    console.error("team automatic email: could not check the opt out lists, not sent:", why(err));
    return false;
  }
}

export async function runTeamEmails(now = new Date(), deps: TeamRunDeps = realTeamRunDeps): Promise<TeamRunResult> {
  const today = londonToday(now);
  const out: TeamRunResult = { deleted: 0, nudges: 0, reminders: 0, failed: 0 };
  try {
    out.deleted = await deps.deleteDue(today);
  } catch (err) {
    console.error("team invites clean up failed:", why(err));
  }
  try {
    out.handoversCleared = await deps.clearHandovers();
  } catch (err) {
    console.error("team handovers clean up failed:", why(err));
  }
  let state: TeamRunState;
  try {
    const on = await bothOn(deps);
    if (on !== "on") return { ...out, skipped: on };
    state = await deps.readState();
  } catch (err) {
    console.error("team automatic emails: could not read:", why(err));
    return { ...out, skipped: "could not read" };
  }

  const stillOn = async () => {
    try {
      return (await bothOn(deps)) === "on";
    } catch {
      return false;
    }
  };

  for (const { team, joined } of state.teams) {
    // In memory: never a team, and never emailed about as one (src/fundraising/in-memory.ts).
    if (isInMemory(team)) continue;
    const n = teamNudgeDue(team, joined, today);
    if (!n) continue;
    if (!(await stillOn())) return out;
    if (!(await mayEmail(team.email, deps))) continue;
    try {
      if (!(await deps.claimNudge(team.id, n))) continue;
    } catch (err) {
      console.error(`team nudge for team ${team.id}: could not claim it:`, why(err));
      continue;
    }
    try {
      const mail = buildTeamNudgeEmail(n, { name: team.name, firstName: team.firstName, creditName: team.creditName, title: team.title, pageUrl: `${base()}/fundraise/${team.slug}`, joinUrl: joinUrl(base(), team.slug) });
      await deps.send("fundraiseTeamNudge", team.name, { ...from(team.email), ...mail });
      out.nudges += 1;
    } catch (err) {
      out.failed += 1;
      console.error(`team nudge ${n} for team ${team.id} did not send; given back for another day:`, why(err));
      try {
        await deps.releaseNudge(team.id, n);
      } catch (e) {
        console.error("team nudge: could not give it back:", why(e));
      }
    }
  }

  for (const inv of state.invites) {
    if (isInMemory(inv.team)) continue;
    const t = inv.team;
    if (!t || t.status !== "approved" || !inviteReminderDue(inv, t.eventDate, now)) continue;
    if (!(await stillOn())) return out;
    if (!(await mayEmail(inv.email, deps)) || !inv.firstName || !inv.email) continue;
    const token = deps.newToken();
    const hash = hashTeamInviteToken(token);
    try {
      if (!(await deps.claimReminder(inv.id, hash))) continue;
    } catch (err) {
      console.error(`team invite reminder ${inv.id}: could not claim it:`, why(err));
      continue;
    }
    try {
      const mail = buildTeamInviteReminderEmail({
        firstName: inv.firstName,
        organiserName: t.name,
        team: { title: t.title, kind: t.kind, kindLabel: kindLabelOf(t), kindOther: t.kindOther ?? null, eventDate: t.eventDate },
        joinUrl: teamInviteUrl(base(), t.slug, token),
      });
      // No name in the email log: an invitee's details are deleted on time, and the log keeps none.
      await deps.send("fundraiseTeamInviteReminder", null, { ...from(inv.email), ...mail });
      out.reminders += 1;
    } catch (err) {
      out.failed += 1;
      console.error(`team invite reminder ${inv.id} did not send; given back for another day:`, why(err));
      try {
        await deps.releaseReminder(inv.id);
      } catch (e) {
        console.error("team invite reminder: could not give it back:", why(e));
      }
    }
  }
  return out;
}
