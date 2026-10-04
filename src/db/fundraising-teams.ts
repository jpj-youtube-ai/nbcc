import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { FUNDRAISER_SELECT, listFundraisersWhere, toRecord, type FundraiserSummary } from "./fundraisers";
import type { FundraiserRecord, Meter } from "../fundraising/model";
import { MAX_CODE_ATTEMPTS } from "../fundraising/sign-in";
import type { TeamMemberToInvite, TeamShareMode } from "../fundraising/teams";

// Team pages (Jaimie, 2026-10-03): the SQL behind teams. The rules are in src/fundraising/teams.ts;
// this file only moves rows. Every change a person makes writes its audit_log row in the same
// transaction, against the fundraiser it changes, so each page's History shows it. Names and emails
// of the people a team organiser added are never logged, and a handover code only ever as its hash.

export type TeamErrorReason = "not_found" | "not_a_team" | "team_closed";

export class TeamError extends Error {
  constructor(public readonly reason: TeamErrorReason) {
    super(`team: ${reason}`);
    this.name = "TeamError";
  }
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const textOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const lower = (email: string) => email.trim().toLowerCase();

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// --- a team's sign up (inside createFundraiser's transaction) ---------------------------------------

/** Mark a sign up a team, with its split mode (null unless it shares with another cause). */
export async function markTeam(client: PoolClient, id: number, shareMode: TeamShareMode | null): Promise<void> {
  await client.query("UPDATE fundraisers SET is_team = true, team_share_mode = $2 WHERE id = $1", [id, shareMode]);
}

/** The people the team organiser added: HELD, nothing sent until staff approve the team. */
export async function insertHeldInvites(client: PoolClient, teamId: number, people: TeamMemberToInvite[]): Promise<void> {
  if (people.length === 0) return;
  await client.query(
    `INSERT INTO team_invites (team_id, first_name, last_name, email, under_18)
     SELECT $1, f, l, e, u FROM unnest($2::text[], $3::text[], $4::text[], $5::boolean[]) AS p(f, l, e, u)`,
    [teamId, people.map((p) => p.firstName), people.map((p) => p.lastName), people.map((p) => lower(p.email)), people.map((p) => p.under18 === true)],
  );
}

// --- someone joining (inside createFundraiser's transaction) ----------------------------------------

/**
 * Link a new member page to its team. The team row is read with a share lock, so it cannot stop
 * being an approved team in the same moment; if it has, the whole sign up is refused (team_closed).
 * Joined from an invite: that invite (of THIS team, its details not deleted) is marked joined.
 */
export async function linkMember(client: PoolClient, memberId: number, teamId: number, inviteHash: string | null): Promise<void> {
  const t = await client.query<{
    is_team: boolean;
    status: string;
    team_share_mode: string | null;
    shares_with_other: boolean | null;
    nbcc_share_percent: number | null;
    other_cause_name: string | null;
  }>("SELECT is_team, status, team_share_mode, shares_with_other, nbcc_share_percent, other_cause_name FROM fundraisers WHERE id = $1 FOR SHARE", [teamId]);
  const team = t.rows[0];
  if (!team || !team.is_team || team.status !== "approved") throw new TeamError("team_closed");
  await client.query("UPDATE fundraisers SET team_id = $2 WHERE id = $1", [memberId, teamId]);
  // A whole team split is the team's as it is NOW, read under its lock: staff may have corrected it
  // since the join form was checked, so what the route worked out is replaced.
  if (team.team_share_mode === "team" && team.shares_with_other === true) {
    await client.query("UPDATE fundraisers SET shares_with_other = $2, nbcc_share_percent = $3, other_cause_name = $4 WHERE id = $1", [
      memberId,
      true,
      team.nbcc_share_percent,
      team.other_cause_name,
    ]);
  }
  let fromInvite = false;
  if (inviteHash) {
    const r = await client.query(
      `UPDATE team_invites SET joined_at = now(), joined_fundraiser_id = $3
        WHERE (token_hash = $1 OR reminder_token_hash = $1) AND team_id = $2 AND joined_at IS NULL AND deleted_at IS NULL RETURNING id`,
      [inviteHash, teamId, memberId],
    );
    fromInvite = r.rows.length > 0;
  }
  // Joined another way (the team page, or a link passed on): an invite to the same email on this
  // team is joined too, so it is never reminded.
  if (!fromInvite) {
    await client.query(
      `UPDATE team_invites i SET joined_at = now(), joined_fundraiser_id = m.id
         FROM fundraisers m
        WHERE i.team_id = $1 AND m.id = $2 AND lower(i.email) = lower(m.organiser_email) AND i.joined_at IS NULL AND i.deleted_at IS NULL`,
      [teamId, memberId],
    );
  }
  await insertAudit(client, { actor: "public", action: "fundraiser.joined_team", entity: "fundraiser", entityId: teamId, data: { memberId, fromInvite } });
}

// --- reading a team ----------------------------------------------------------------------------------

/** Every member page of a team (any status, taken off it too), with its meter, oldest first. */
export async function listTeamMembers(teamId: number): Promise<FundraiserSummary[]> {
  return listFundraisersWhere("f.team_id = $1", [teamId]);
}

/**
 * The money on each team's current member pages (approved or finished, not taken off), for the
 * team meter: online gifts less refunds, cash, and the Gift Aid shown under it. One query for any
 * number of teams.
 */
export async function memberMetersFor(teamIds: number[]): Promise<Map<number, Array<Pick<Meter, "onlinePence" | "cashPence" | "giftAidPence">>>> {
  const out = new Map<number, Array<Pick<Meter, "onlinePence" | "cashPence" | "giftAidPence">>>();
  if (teamIds.length === 0) return out;
  const list = await listFundraisersWhere("f.team_id = ANY($1) AND f.team_left_at IS NULL AND f.status IN ('approved', 'finished')", [teamIds]);
  for (const m of list) {
    const id = Number(m.teamId);
    out.set(id, [...(out.get(id) ?? []), { onlinePence: m.meter.onlinePence, cashPence: m.meter.cashPence, giftAidPence: m.meter.giftAidPence }]);
  }
  return out;
}

// --- the invites ---------------------------------------------------------------------------------------

export interface TeamInviteRow {
  id: number;
  teamId: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  /** The team organiser ticked "This person is under 18": the email is their parent's or guardian's. */
  under18?: boolean;
  createdAt: string;
  sentAt: string | null;
  remindedAt: string | null;
  joinedAt: string | null;
  deletedAt: string | null;
  joinedFundraiserId: number | null;
}

const INVITE_COLUMNS = "i.id, i.team_id, i.first_name, i.last_name, i.email, i.created_at, i.sent_at, i.reminded_at, i.joined_at, i.deleted_at, i.joined_fundraiser_id, i.under_18";

function toInvite(r: Row): TeamInviteRow {
  return {
    id: Number(r.id),
    teamId: Number(r.team_id),
    firstName: textOrNull(r.first_name),
    lastName: textOrNull(r.last_name),
    email: textOrNull(r.email),
    under18: r.under_18 === true,
    createdAt: iso(r.created_at) as string,
    sentAt: iso(r.sent_at),
    remindedAt: iso(r.reminded_at),
    joinedAt: iso(r.joined_at),
    deletedAt: iso(r.deleted_at),
    joinedFundraiserId: r.joined_fundraiser_id == null ? null : Number(r.joined_fundraiser_id),
  };
}

/** Every invite of a team, in the order they were added. For staff and the team organiser. */
export async function listTeamInvites(teamId: number): Promise<TeamInviteRow[]> {
  const r = await pool.query(`SELECT ${INVITE_COLUMNS} FROM team_invites i WHERE i.team_id = $1 ORDER BY i.id`, [teamId]);
  return r.rows.map(toInvite);
}

/** The invites still held for a team (staff have not approved it yet), to send at approval. */
export async function listHeldInvites(teamId: number): Promise<TeamInviteRow[]> {
  const r = await pool.query(
    `SELECT ${INVITE_COLUMNS} FROM team_invites i WHERE i.team_id = $1 AND i.sent_at IS NULL AND i.deleted_at IS NULL ORDER BY i.id`,
    [teamId],
  );
  return r.rows.map(toInvite);
}

/** Claim one held invite for sending, with its new token's hash. True only for the first claim. */
export async function claimInviteSend(inviteId: number, tokenHash: string): Promise<boolean> {
  const r = await pool.query(
    "UPDATE team_invites SET sent_at = now(), token_hash = $2 WHERE id = $1 AND sent_at IS NULL AND deleted_at IS NULL RETURNING id",
    [inviteId, tokenHash],
  );
  return r.rows.length > 0;
}

/** The send failed: hold it again, so it can be sent another time. */
export async function releaseInviteSend(inviteId: number): Promise<void> {
  await pool.query("UPDATE team_invites SET sent_at = NULL, token_hash = NULL WHERE id = $1 AND reminded_at IS NULL AND joined_at IS NULL", [inviteId]);
}

export type TeamInviteFound = TeamInviteRow & { teamSlug: string; teamStatus: string };

/**
 * An invite by its token's hash (the invite's link, or the reminder's), with its team's address and
 * status, or null. The caller judges it.
 */
export async function findTeamInviteByHash(tokenHash: string): Promise<TeamInviteFound | null> {
  const r = await pool.query(
    `SELECT ${INVITE_COLUMNS}, f.slug AS team_slug, f.status AS team_status
       FROM team_invites i JOIN fundraisers f ON f.id = i.team_id
      WHERE i.token_hash = $1 OR i.reminder_token_hash = $1`,
    [tokenHash],
  );
  const row = r.rows[0];
  return row ? { ...toInvite(row), teamSlug: String(row.team_slug), teamStatus: String(row.team_status) } : null;
}

/**
 * Claim the one reminder, with a link of its own (the first email's link keeps working beside it).
 * True only for the first claim.
 */
export async function claimInviteReminder(inviteId: number, tokenHash: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE team_invites SET reminded_at = now(), reminder_token_hash = $2
      WHERE id = $1 AND reminded_at IS NULL AND joined_at IS NULL AND deleted_at IS NULL AND sent_at IS NOT NULL RETURNING id`,
    [inviteId, tokenHash],
  );
  return r.rows.length > 0;
}

/** The reminder could not be sent: give it back for another day, its link with it. */
export async function releaseInviteReminder(inviteId: number): Promise<void> {
  await pool.query("UPDATE team_invites SET reminded_at = NULL, reminder_token_hash = NULL WHERE id = $1 AND deleted_at IS NULL", [inviteId]);
}

// Deleting an invite's details: its names, email and both links, and the email log's rows for the
// emails to it (the invite and the reminder): the address becomes a marker that names nobody, the
// subject only the team, and no name. The rows stay, so the counts still add up.
const CLEAR_INVITE =
  "first_name = NULL, last_name = NULL, email = NULL, token_hash = NULL, reminder_token_hash = NULL, under_18 = false, deleted_at = now()";

async function clearInvites(client: PoolClient, where: string, params: unknown[]): Promise<number> {
  const r = await client.query<{ id: number; email: string; title: string }>(
    `WITH due AS (
       SELECT i.id, i.email, f.title FROM team_invites i JOIN fundraisers f ON f.id = i.team_id
        WHERE i.deleted_at IS NULL AND (${where})
          FOR UPDATE OF i
     )
     UPDATE team_invites t SET ${CLEAR_INVITE} FROM due WHERE t.id = due.id
     RETURNING due.id, due.email, due.title`,
    params,
  );
  if (r.rows.length === 0) return 0;
  await client.query(
    `UPDATE email_log e SET recipient = 'deleted team invitee', recipient_name = NULL, subject = 'Team invite: ' || d.title
       FROM unnest($1::text[], $2::text[]) AS d(email, title)
      WHERE e.kind IN ('fundraiseTeamInvite', 'fundraiseTeamInviteReminder') AND lower(e.recipient) = lower(d.email)`,
    [r.rows.map((x) => String(x.email).toLowerCase()), r.rows.map((x) => String(x.title))],
  );
  return r.rows.length;
}

/**
 * Delete the details of every invite whose time is up: 30 days after it was sent (or added, if never
 * sent), or once its team's event is over (`today`, a UK day). Returns how many.
 */
export async function deleteDueInvites(today: string): Promise<number> {
  return inTransaction((client) =>
    clearInvites(
      client,
      "COALESCE(i.sent_at, i.created_at) <= now() - interval '30 days' OR (f.event_date IS NOT NULL AND f.event_date < $1::date)",
      [today],
    ),
  );
}

/** Staff declined the team: every invite of it is deleted at once. Returns how many. */
export async function deleteTeamInvites(teamId: number): Promise<number> {
  return inTransaction((client) => clearInvites(client, "i.team_id = $1", [teamId]));
}

/**
 * Clear a handover's name, email, phone and code hash 30 days after it was confirmed, cancelled or ran
 * out. Returns how many.
 */
export async function clearOldHandovers(): Promise<number> {
  const r = await pool.query(
    `UPDATE team_handovers SET to_first_name = NULL, to_last_name = NULL, to_email = NULL, to_phone = NULL, code_hash = NULL, cleared_at = now()
      WHERE cleared_at IS NULL AND COALESCE(confirmed_at, cancelled_at, expires_at) <= now() - interval '30 days'
      RETURNING id`,
  );
  return r.rows.length;
}

// --- the nudges to the team organiser ---------------------------------------------------------------

const NUDGE_COLUMN = { 1: "team_nudge_1_at", 2: "team_nudge_2_at" } as const;

/** Claim nudge 1 or 2 for a team before it is sent. True only for the first claim. */
export async function claimTeamNudge(teamId: number, n: 1 | 2): Promise<boolean> {
  const col = NUDGE_COLUMN[n];
  const r = await pool.query(`UPDATE fundraisers SET ${col} = now() WHERE id = $1 AND ${col} IS NULL RETURNING id`, [teamId]);
  return r.rows.length > 0;
}

export async function releaseTeamNudge(teamId: number, n: 1 | 2): Promise<void> {
  await pool.query(`UPDATE fundraisers SET ${NUDGE_COLUMN[n]} = NULL WHERE id = $1`, [teamId]);
}

/** What the daily team pass reads: every approved team, how many have joined it, and the invites. */
export interface TeamRunState {
  teams: Array<{ team: FundraiserSummary; joined: number }>;
  invites: Array<TeamInviteRow & { team: FundraiserRecord }>;
}

export async function readTeamRunState(): Promise<TeamRunState> {
  // Someone who joined another way (the team page, or a link passed on) is never reminded: an invite
  // whose email is on a current member page of its team is joined.
  await pool.query(
    `UPDATE team_invites i SET joined_at = now(), joined_fundraiser_id = m.id
       FROM fundraisers m
      WHERE m.team_id = i.team_id AND lower(m.organiser_email) = lower(i.email)
        AND m.team_left_at IS NULL AND m.status <> 'declined' AND i.joined_at IS NULL AND i.deleted_at IS NULL`,
  );
  const [teams, members, invites] = await Promise.all([
    listFundraisersWhere("f.is_team AND f.status = 'approved'", []),
    pool.query<{ team_id: number; n: string }>(
      "SELECT team_id, count(*) AS n FROM fundraisers WHERE team_id IS NOT NULL AND team_left_at IS NULL AND status <> 'declined' GROUP BY team_id",
    ),
    pool.query(
      `SELECT ${INVITE_COLUMNS} FROM team_invites i
        WHERE i.deleted_at IS NULL AND i.sent_at IS NOT NULL AND i.reminded_at IS NULL AND i.joined_at IS NULL ORDER BY i.id`,
    ),
  ]);
  const joinedBy = new Map<number, number>(members.rows.map((r) => [Number(r.team_id), Number(r.n)]));
  const byId = new Map<number, FundraiserSummary>(teams.map((t) => [t.id, t]));
  return {
    teams: teams.map((team) => ({ team, joined: joinedBy.get(team.id) ?? 0 })),
    invites: (invites.rows as Row[])
      .map(toInvite)
      .filter((i) => byId.has(i.teamId))
      .map((i) => ({ ...i, team: byId.get(i.teamId) as FundraiserRecord })),
  };
}

// --- the team organiser taking someone off the team -------------------------------------------------

const sameEmail = (a: string, b: string) => lower(a) === lower(b);

/**
 * The signed in team organiser takes a member off their team, from their private area. Only their
 * own team (anyone else's reads as not there), and only someone still on it. The member page carries
 * on as their own; what it raises no longer counts on the team. Recorded on both pages' History.
 */
export async function removeTeamMember(
  teamId: number,
  memberId: number,
  organiserEmail: string,
): Promise<{ team: FundraiserRecord; member: FundraiserRecord }> {
  return takeOff(teamId, memberId, { organiserEmail });
}

/**
 * Staff (editors and admins) take a member off a team, from Admin > Fundraising: the same effect as
 * the team organiser's, whoever organises the team, recorded as staff (who, and by: "staff").
 */
export async function removeTeamMemberByStaff(
  teamId: number,
  memberId: number,
  actor: string,
): Promise<{ team: FundraiserRecord; member: FundraiserRecord }> {
  return takeOff(teamId, memberId, { actor });
}

async function takeOff(
  teamId: number,
  memberId: number,
  by: { organiserEmail: string } | { actor: string },
): Promise<{ team: FundraiserRecord; member: FundraiserRecord }> {
  return inTransaction(async (client) => {
    const t = await client.query(`${FUNDRAISER_SELECT} WHERE f.id = $1 FOR UPDATE`, [teamId]);
    const teamRow = t.rows[0];
    if (!teamRow || teamRow.is_team !== true) throw new TeamError("not_found");
    if ("organiserEmail" in by && !sameEmail(String(teamRow.organiser_email), by.organiserEmail)) throw new TeamError("not_found");
    const m = await client.query(`${FUNDRAISER_SELECT} WHERE f.id = $1 AND f.team_id = $2 AND f.team_left_at IS NULL FOR UPDATE`, [memberId, teamId]);
    const memberRow = m.rows[0];
    if (!memberRow) throw new TeamError("not_found");
    if ("actor" in by) {
      await client.query("UPDATE fundraisers SET team_left_at = now(), team_left_by = $2 WHERE id = $1", [memberId, by.actor]);
      await insertAudit(client, { actor: by.actor, action: "fundraiser.member_removed", entity: "fundraiser", entityId: teamId, data: { memberId, by: "staff" } });
      await insertAudit(client, { actor: by.actor, action: "fundraiser.removed_from_team", entity: "fundraiser", entityId: memberId, data: { teamId, by: "staff" } });
    } else {
      await client.query("UPDATE fundraisers SET team_left_at = now(), team_left_by = 'organiser' WHERE id = $1", [memberId]);
      await insertAudit(client, { actor: "organiser", action: "fundraiser.member_removed", entity: "fundraiser", entityId: teamId, data: { memberId } });
      await insertAudit(client, { actor: "organiser", action: "fundraiser.removed_from_team", entity: "fundraiser", entityId: memberId, data: { teamId } });
    }
    return { team: toRecord(teamRow), member: toRecord(memberRow) };
  });
}

// --- handing the team organiser role over (staff only) ----------------------------------------------

export interface HandoverTo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface OpenHandover {
  id: number;
  teamId: number;
  toFirstName: string;
  toLastName: string;
  toEmail: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Staff start a handover: any still open for the team is cancelled, and a new one stored with the
 * code's keyed hash (the code itself only ever goes in the email). Only for a team. Returns its id.
 */
export async function startHandover(teamId: number, to: HandoverTo, codeHash: string, expiresAt: Date, actor: string): Promise<number> {
  return inTransaction(async (client) => {
    const t = await client.query(`${FUNDRAISER_SELECT} WHERE f.id = $1 FOR UPDATE`, [teamId]);
    const team = t.rows[0];
    if (!team) throw new TeamError("not_found");
    if (team.is_team !== true) throw new TeamError("not_a_team");
    await client.query("UPDATE team_handovers SET cancelled_at = now() WHERE team_id = $1 AND confirmed_at IS NULL AND cancelled_at IS NULL", [teamId]);
    const r = await client.query<{ id: number }>(
      `INSERT INTO team_handovers (team_id, to_first_name, to_last_name, to_email, to_phone, code_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [teamId, to.firstName, to.lastName, lower(to.email), to.phone, codeHash, expiresAt, actor],
    );
    const id = Number(r.rows[0].id);
    await insertAudit(client, {
      actor,
      action: "fundraiser.handover_started",
      entity: "fundraiser",
      entityId: teamId,
      data: { handoverId: id, to: lower(to.email), toName: `${to.firstName} ${to.lastName}` },
    });
    return id;
  });
}

/** Staff cancel the handover still open for a team. True when there was one. */
export async function cancelHandover(teamId: number, actor: string): Promise<boolean> {
  return inTransaction(async (client) => {
    const r = await client.query(
      "UPDATE team_handovers SET cancelled_at = now() WHERE team_id = $1 AND confirmed_at IS NULL AND cancelled_at IS NULL RETURNING id",
      [teamId],
    );
    if (r.rows.length === 0) return false;
    await insertAudit(client, { actor, action: "fundraiser.handover_cancelled", entity: "fundraiser", entityId: teamId, data: { handoverId: Number(r.rows[0].id) } });
    return true;
  });
}

/** The handover still open for a team, if any (never its code hash). */
export async function openHandoverFor(teamId: number): Promise<OpenHandover | null> {
  const r = await pool.query(
    `SELECT id, team_id, to_first_name, to_last_name, to_email, created_by, created_at, expires_at FROM team_handovers
      WHERE team_id = $1 AND confirmed_at IS NULL AND cancelled_at IS NULL AND cleared_at IS NULL`,
    [teamId],
  );
  const row = r.rows[0];
  return row
    ? {
        id: Number(row.id),
        teamId: Number(row.team_id),
        toFirstName: String(row.to_first_name),
        toLastName: String(row.to_last_name),
        toEmail: String(row.to_email),
        createdBy: String(row.created_by),
        createdAt: iso(row.created_at) as string,
        expiresAt: iso(row.expires_at) as string,
      }
    : null;
}

export interface HandoverForCheck {
  id: number;
  teamId: number;
  codeHash: string;
}

/**
 * The new team organiser confirms with their email and the code. In one transaction: every open
 * handover to that email has its try counted FIRST (so tries at once cannot share a count), then
 * each still in date and under the limit is checked with `matches` (the route's keyed compare). The
 * right one makes them the team's organiser (name, email and phone), closes the handover and records
 * it. Anything else is "wrong", and changes nothing but the count.
 */
export async function confirmHandover(
  email: string,
  matches: (h: HandoverForCheck) => boolean,
  now: Date,
): Promise<{ status: "ok"; team: FundraiserRecord } | { status: "wrong" }> {
  return inTransaction(async (client) => {
    const r = await client.query(
      `UPDATE team_handovers SET attempts = attempts + 1
        WHERE lower(to_email) = $1 AND confirmed_at IS NULL AND cancelled_at IS NULL
        RETURNING id, team_id, to_first_name, to_last_name, to_email, to_phone, code_hash, expires_at, attempts`,
      [lower(email)],
    );
    const right = (r.rows as Row[]).find(
      (h) =>
        new Date(h.expires_at as string).getTime() > now.getTime() &&
        Number(h.attempts) <= MAX_CODE_ATTEMPTS &&
        matches({ id: Number(h.id), teamId: Number(h.team_id), codeHash: String(h.code_hash) }),
    );
    if (!right) return { status: "wrong" as const };
    const teamId = Number(right.team_id);
    const before = await client.query("SELECT organiser_email FROM fundraisers WHERE id = $1 FOR UPDATE", [teamId]);
    const first = String(right.to_first_name);
    const last = String(right.to_last_name);
    await client.query(
      `UPDATE fundraisers SET organiser_name = $1, first_name = $2, last_name = $3, organiser_email = $4, organiser_phone = $5,
              updated_at = now(), updated_by = $6 WHERE id = $7`,
      [`${first} ${last}`, first, last, String(right.to_email), String(right.to_phone), "team handover", teamId],
    );
    await client.query("UPDATE team_handovers SET confirmed_at = now() WHERE id = $1", [Number(right.id)]);
    await insertAudit(client, {
      actor: "team handover",
      action: "fundraiser.organiser_handed_over",
      entity: "fundraiser",
      entityId: teamId,
      data: { handoverId: Number(right.id), from: before.rows[0]?.organiser_email ?? null, to: String(right.to_email) },
    });
    const after = await client.query(`${FUNDRAISER_SELECT} WHERE f.id = $1`, [teamId]);
    return { status: "ok" as const, team: toRecord(after.rows[0]) };
  });
}

