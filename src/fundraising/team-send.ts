import { config } from "../config";
import { sendFundraiseTeam, type FundraiseEmailMessage, type FundraiseTeamKind } from "../clients/email";
import { claimInviteSend, listHeldInvites, releaseInviteSend, type TeamInviteRow } from "../db/fundraising-teams";
import { fundraisingIsOn, getFundraiser } from "../db/fundraisers";
import { approvedWordingKeys, touchEmailsOn } from "../db/fundraising-touch";
import { suppressedAmong } from "../db/email-suppressions";
import { optedOutAmong } from "../db/email-opt-outs";
import { hasPage, kindLabelOf, publicSplit, type FundraiserRecord } from "./model";
import { greetGuardian } from "./signup-tidy-emails";
import { firstWord } from "./signup-tidy";
import { isInMemory } from "./in-memory";
import { organiserFirstName } from "./emails";
import { TEAM_JOINED_KEY, hashTeamInviteToken, joinUrl, newTeamInviteToken, teamInviteUrl } from "./teams";
import {
  buildHandoverCodeEmail,
  buildJoinStaffEmail,
  buildJoinThanksEmail,
  buildMemberRemovedStaffEmail,
  buildTeamInviteEmail,
  buildTeamLiveEmail,
  buildTeamMemberJoinedEmail,
} from "./team-page-emails";

// Team pages (Jaimie, 2026-10-03): sending the team emails that follow something a person did.
// Each runs after its write has committed and is best effort: the approval, the join or the change
// stands whether or not the email goes, and a failure is logged (never with an address or a code).
// From and Reply-To are the events inbox (config.BALL_FROM_EMAIL), as every fundraising email; the
// two to the events inbox reply to the person they are about.
//
// The automatic ones (the nudges and the one reminder) are src/fundraising/team-runner.ts.

const base = () => config.PORTAL_BASE_URL.replace(/\/+$/, "");
/**
 * Why a send failed, for the log, with any email address taken out: a mail service's message can
 * name the address, and an invitee's address is never logged.
 */
export const safeWhy = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g, "[address]");
const why = safeWhy;

export interface TeamSendDeps {
  /** Nothing team related goes while fundraising is off (defence in depth: callers wait too). */
  fundraisingOn: () => Promise<boolean>;
  listHeld: (teamId: number) => Promise<TeamInviteRow[]>;
  /** Is this address suppressed or opted out? Throws when it cannot be told. */
  blocked: (email: string) => Promise<boolean>;
  claimInvite: (inviteId: number, tokenHash: string) => Promise<boolean>;
  releaseInvite: (inviteId: number) => Promise<void>;
  newToken: () => string;
  send: (kind: FundraiseTeamKind, name: string | null, message: FundraiseEmailMessage) => Promise<void>;
}

/** An address that asked us to stop, or that bounced: never emailed by the team emails. */
export async function teamEmailBlocked(email: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  const [suppressed, optedOut] = await Promise.all([suppressedAmong([address]), optedOutAmong([address])]);
  return suppressed.has(address) || optedOut.has(address);
}

export const realTeamSendDeps: TeamSendDeps = {
  fundraisingOn: fundraisingIsOn,
  listHeld: listHeldInvites,
  blocked: teamEmailBlocked,
  claimInvite: claimInviteSend,
  releaseInvite: releaseInviteSend,
  newToken: newTeamInviteToken,
  send: sendFundraiseTeam,
};

const fromEvents = (email: string, replyTo = config.BALL_FROM_EMAIL) => ({ email, from: config.BALL_FROM_EMAIL, replyTo });

const teamWords = (t: FundraiserRecord) => ({
  title: t.title,
  kind: t.kind,
  kindLabel: kindLabelOf(t),
  kindOther: t.kindOther ?? null,
  eventDate: t.eventDate,
});

type Outcome = "sent" | "skipped" | "failed";

async function inviteOne(team: FundraiserRecord, inv: TeamInviteRow, deps: TeamSendDeps): Promise<Outcome> {
  if (!inv.email || !inv.firstName) return "skipped";
  try {
    if (await deps.blocked(inv.email)) return "skipped";
  } catch (err) {
    console.error("team invite: could not check the opt out lists, not sent:", why(err));
    return "skipped";
  }
  const token = deps.newToken();
  let claimed = false;
  try {
    claimed = await deps.claimInvite(inv.id, hashTeamInviteToken(token));
  } catch (err) {
    console.error(`team invite ${inv.id}: could not claim it:`, why(err));
    return "skipped";
  }
  if (!claimed) return "skipped";
  try {
    const mail = buildTeamInviteEmail({
      firstName: inv.firstName,
      organiserName: team.name,
      organiserFirstName: team.firstName ?? null,
      under18: inv.under18 === true,
      team: teamWords(team),
      joinUrl: teamInviteUrl(base(), team.slug, token),
    });
    // No name in the email log: an invitee's details are deleted on time, and the log keeps none.
    await deps.send("fundraiseTeamInvite", null, { ...fromEvents(inv.email), ...mail });
    return "sent";
  } catch (err) {
    console.error(`team invite ${inv.id} for team ${team.id} did not send; held again:`, why(err));
    try {
      await deps.releaseInvite(inv.id);
    } catch (e) {
      console.error(`team invite ${inv.id}: could not hold it again:`, why(e));
    }
    return "failed";
  }
}

/**
 * After staff approve a team (or, approved while fundraising was off, when it is switched on): the
 * people the team organiser added are invited, then the team organiser hears their team is live,
 * always with the join link and a message to forward. Never throws.
 */
export async function sendTeamApproved(
  team: FundraiserRecord,
  deps: TeamSendDeps = realTeamSendDeps,
): Promise<{ invited: number; failed: number; skipped: number; liveSent: boolean }> {
  const out = { invited: 0, failed: 0, skipped: 0, liveSent: false };
  try {
    if (!(await deps.fundraisingOn())) {
      console.warn(`team ${team.id}: fundraising is off, so no team emails were sent`);
      return out;
    }
  } catch (err) {
    console.error(`team ${team.id}: could not read the fundraising switch, so no team emails were sent:`, why(err));
    return out;
  }
  let held: TeamInviteRow[] = [];
  try {
    held = await deps.listHeld(team.id);
  } catch (err) {
    console.error(`team ${team.id}: could not read the people to invite:`, why(err));
  }
  for (const inv of held) {
    const r = await inviteOne(team, inv, deps);
    if (r === "sent") out.invited += 1;
    else if (r === "failed") out.failed += 1;
    else out.skipped += 1;
  }
  try {
    const mail = buildTeamLiveEmail(
      { ...teamWords(team), name: team.name, firstName: team.firstName, creditName: team.creditName },
      {
        pageUrl: hasPage(team) ? `${base()}/fundraise/${team.slug}` : null,
        manageUrl: `${base()}/fundraise/manage`,
        joinUrl: joinUrl(base(), team.slug),
        invited: out.invited,
      },
    );
    await deps.send("fundraiseTeamLive", team.name, { ...fromEvents(team.email), ...mail });
    out.liveSent = true;
  } catch (err) {
    console.error(`team ${team.id}: the team live email failed:`, why(err));
  }
  return out;
}

/** Someone joined: thank them (their page waits for staff), and tell the events inbox. */
export async function sendJoinEmails(member: FundraiserRecord, team: FundraiserRecord, send = sendFundraiseTeam): Promise<void> {
  try {
    await send("fundraiseTeamJoined", member.name, { ...fromEvents(member.email), ...greetGuardian(buildJoinThanksEmail(member.firstName ?? member.name, team.title), member) });
  } catch (err) {
    console.error("team join thanks email failed:", why(err));
  }
  try {
    const split = publicSplit(member);
    const words = split
      ? `${split.nbccSharePercent}% to NBCC, the rest to ${split.otherCauseName}${team.teamShareMode === "team" ? " (the whole team's split)" : ""}`
      : "No, all of it comes to NBCC";
    const mail = buildJoinStaffEmail(member, team, { adminUrl: `${base()}/admin`, split: words });
    await send("fundraiseTeamJoinStaff", member.name, { ...fromEvents(config.BALL_FROM_EMAIL, member.email), ...mail });
  } catch (err) {
    console.error("team join staff email failed:", why(err));
  }
}

// --- a new member's page is approved: tell the team organiser (Jaimie, 2026-10-04) -------------------
//
// "[First name] has joined [team name]", so "you get the team's emails" is true. Sent after staff
// approve a member page (src/fundraising/send.ts, once the member's own "Your page is live" has
// gone). It is NEW wording and an automatic email, so every guard must say yes:
//
//   - its wording has been approved by an admin (touch_wording_approvals, key "team_joined", in
//     Admin > Fundraising > Automatic emails). Approvals that cannot be read count as none;
//   - Automatic emails and fundraising are both on (a switch that cannot be read counts as off).
//   While any of those says no it is HELD: nothing is sent and nothing is logged, and it is not sent
//   later (the team organiser sees who has joined in their private area).
//
// Never to the team organiser about their own page; never for a page in memory of someone (in memory
// teams do not exist: skipped quietly if ever asked); never to an address that asked us to stop or
// bounced (a list that cannot be read means no email). It goes only to the team organiser, From and
// Reply-To the events inbox. A member under 18 is named by the child's first name as their page
// shows it; the parent's name and email are never in it. Never throws, and never logs an address.

export interface TeamJoinedDeps {
  getTeam: (id: number) => Promise<FundraiserRecord | null>;
  fundraisingOn: () => Promise<boolean>;
  touchOn: () => Promise<boolean>;
  /** The wordings an admin has approved. */
  approvedWordings: () => Promise<ReadonlySet<string>>;
  /** Is this address suppressed or opted out? Throws when it cannot be told. */
  blocked: (email: string) => Promise<boolean>;
  send: (kind: FundraiseTeamKind, name: string | null, message: FundraiseEmailMessage) => Promise<void>;
}

export const realTeamJoinedDeps: TeamJoinedDeps = {
  getTeam: getFundraiser,
  fundraisingOn: fundraisingIsOn,
  touchOn: touchEmailsOn,
  approvedWordings: approvedWordingKeys,
  blocked: teamEmailBlocked,
  send: sendFundraiseTeam,
};

const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const yes = async (ask: () => Promise<boolean>): Promise<boolean> => {
  try {
    return (await ask()) === true;
  } catch {
    return false;
  }
};

export async function sendTeamMemberJoined(
  member: FundraiserRecord,
  deps: TeamJoinedDeps = realTeamJoinedDeps,
): Promise<"sent" | "held" | "skipped" | "failed"> {
  try {
    // Only an approved member page that is still on its team; never a team's own page.
    if (!member.teamId || member.isTeam || member.teamLeftAt || member.status !== "approved") return "skipped";
    if (isInMemory(member)) return "skipped";
    const team = await deps.getTeam(member.teamId);
    if (!team || !team.isTeam || team.status !== "approved" || isInMemory(team)) return "skipped";
    // Never the team organiser about themselves.
    if (member.id === team.id || sameAddress(member.email, team.email)) return "skipped";

    // Held until every guard says yes. Nothing is sent and nothing is logged.
    let approved: ReadonlySet<string> = new Set();
    try {
      approved = await deps.approvedWordings();
    } catch {
      approved = new Set();
    }
    if (!approved.has(TEAM_JOINED_KEY)) return "held";
    if (!(await yes(deps.touchOn)) || !(await yes(deps.fundraisingOn))) return "held";

    try {
      if (await deps.blocked(team.email)) return "skipped";
    } catch (err) {
      console.error(`team ${team.id}: could not check the opt out lists, so the team organiser was not told of a new member:`, why(err));
      return "skipped";
    }

    // A member under 18: the child's first name as their page shows it. Anyone else: their first name.
    const memberFirstName = member.guardianFirstName
      ? firstWord(member.firstName ?? member.name) || null
      : organiserFirstName({ name: member.name, firstName: member.firstName ?? null });
    const mail = buildTeamMemberJoinedEmail({
      organiser: { name: team.name, firstName: team.firstName ?? null, creditName: team.creditName ?? null },
      memberFirstName,
      teamTitle: team.title,
      teamUrl: hasPage(team) ? `${base()}/fundraise/${team.slug}` : null,
    });
    try {
      await deps.send("fundraiseTeamMemberJoined", team.name, { ...fromEvents(team.email), ...mail });
      return "sent";
    } catch (err) {
      console.error(`team ${team.id}: the email to the team organiser about a new member failed:`, why(err));
      return "failed";
    }
  } catch (err) {
    console.error("team member joined email: could not be worked out:", why(err));
    return "failed";
  }
}

/** The team organiser took someone off the team: tell the events inbox, replying to the organiser. */
export async function sendMemberRemovedEmail(team: FundraiserRecord, member: FundraiserRecord, send = sendFundraiseTeam): Promise<void> {
  try {
    const mail = buildMemberRemovedStaffEmail({ memberName: member.name, teamTitle: team.title, organiserName: team.name }, { adminUrl: `${base()}/admin` });
    await send("fundraiseTeamMemberRemoved", team.name, { ...fromEvents(config.BALL_FROM_EMAIL, team.email), ...mail });
  } catch (err) {
    console.error("team member removed email failed:", why(err));
  }
}

/** The handover code, to the new team organiser. True when it went. Never logs the code. */
export async function sendHandoverCodeEmail(
  to: { firstName: string; lastName: string; email: string },
  team: FundraiserRecord,
  code: string,
  send = sendFundraiseTeam,
): Promise<boolean> {
  try {
    const mail = buildHandoverCodeEmail({ firstName: to.firstName, teamTitle: team.title, code, manageUrl: `${base()}/fundraise/manage` });
    await send("fundraiseTeamHandoverCode", `${to.firstName} ${to.lastName}`, { ...fromEvents(to.email), ...mail });
    return true;
  } catch (err) {
    console.error("team handover code email failed:", why(err));
    return false;
  }
}
