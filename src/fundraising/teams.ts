import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { londonToday } from "../events/model";
import { addDays } from "./follow-up";
import { profilePhotoSrc } from "./pictures";
import { dayCount } from "./call-prompts";
import { memoryMeter } from "./in-memory";
import { checkGuardian, firstWord } from "./signup-tidy";
import {
  NAME_PART_MAX,
  OVER_18_MISSING,
  TARGET_MAX_PENCE,
  TARGET_MIN_PENCE,
  UNDER_18,
  hasPage,
  meter,
  shortName,
  splitSchema,
  type FundraiserRecord,
  type FundraiserSplit,
  type Meter,
  type SignUp,
} from "./model";

// Team pages (Jaimie, 2026-10-03, every decision approved; memory: the Get involved master list,
// points 29, 34a and 35). The rules, pure: no pool, no config, no clock (today and now are passed
// in), so each is unit tested (test/unit/fundraising-teams.test.ts). The SQL is in
// src/db/fundraising-teams.ts, the public routes in src/routes/fundraise-teams.ts and the admin's in
// src/routes/admin-fundraising-teams.ts.
//
//   - Only a sponsorship fundraiser (raising money) can be a team: "Just me, or a team?" on the sign
//     up form. The person who sets it up IS the team organiser (never "captain"): they get the
//     team's emails and look after the team page. A team is a fundraiser like any other (approval,
//     meter, giving, wall, QR code, news, materials), marked is_team.
//   - Sharing with another cause: the team organiser says whether the split is the WHOLE TEAM's
//     (every member page has the same split, and the join form only says so) or JUST THEIRS (each
//     member is asked when they join). The split is locked once approved; only staff correct it, and
//     only before the first gift (the team's or any member's, for a whole team split).
//   - The team organiser may add people (first name, surname, email; a parent's email for someone
//     under 18), up to 30. They are HELD: nothing is sent until staff approve the team.
//   - People join with a short form and get a MEMBER page linked to the team. Staff approve every
//     member page. Gifts on a member page count on the member's meter and on the team's.
//   - The team page lists its members A to Z by first name, each with a small meter: never a
//     ranking (teams are often children, and a ranking by money mostly measures family wealth).
//
// Words people read are plain, friendly English, with no dashes.

export const TEAM_MEMBERS_MAX = 30;
export const TEAM_SHARE_MODES = ["team", "organiser"] as const;
export type TeamShareMode = (typeof TEAM_SHARE_MODES)[number];

/** The most the line about why takes on the join form. It becomes the member page's story. */
export const JOIN_WHY_MAX = 300;
/** An invite not joined is reminded once, this many days after it was sent. */
export const INVITE_REMIND_DAYS = 5;
/** An invite's names and email are deleted this many days after it was sent (or added, if never). */
export const INVITE_KEEP_DAYS = 30;
/** The team organiser's nudges: day 3 after the team page went live, and day 10. */
export const NUDGE_DAYS = [3, 10] as const;
/** A missed morning (or a week of them) is caught up; weeks later it is not. */
export const NUDGE_CATCH_UP_DAYS = 7;
/** A handover code works this long: the new team organiser may not be at their emails at once. */
export const HANDOVER_CODE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export const TEAM_MISSING = "Tell us whether it is just you, or a team.";
export const TEAM_SHARE_MODE_MISSING = "Tell us whether the split is just for you, or for the whole team.";
/** A team needs a public page to be joined, so a team is always on the website. */
export const TEAM_ALWAYS_PUBLIC = "A team page is always on our website, so people can find it and join. Choose Just me to keep yours off it.";
/** The same kind note as the sign up form (Jaimie, 2026-10-03). */
export const JOIN_UNDER_18 = UNDER_18;

const DAY_MS = 24 * 60 * 60 * 1000;

type Fields = Record<string, string>;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
// A name is one plain line: line breaks, tabs and other control characters become spaces, and one
// space between words, so it can never break an email's subject or heading.
const isControl = (ch: string): boolean => {
  const c = ch.charCodeAt(0);
  return c < 32 || (c >= 127 && c <= 159) || c === 0x2028 || c === 0x2029;
};
const nameText = (v: unknown): string =>
  typeof v === "string"
    ? Array.from(v, (ch) => (isControl(ch) ? " " : ch)).join("").replace(/\s+/g, " ").trim()
    : "";
/** One live invite per address on a team (the database keeps it so). */
export const TEAM_EMAIL_TWICE = "That email is already on the list.";
/** The same, for someone under 18: two children at one parent's email. */
export const TEAM_EMAIL_TWICE_CHILD = `${TEAM_EMAIL_TWICE} If two children share a parent’s email, add one here and the other can join with the team link.`;
const EMAIL = z.string().email().max(254);

// --- Just me, or a team? ---------------------------------------------------------------------------

export interface TeamMemberToInvite {
  firstName: string;
  lastName: string;
  email: string;
  /** The team organiser ticked "This person is under 18": the email is their parent's or guardian's. */
  under18?: true;
}

export interface TeamSignUp {
  isTeam: boolean;
  shareMode: TeamShareMode | null;
  members: TeamMemberToInvite[];
}

const NOT_A_TEAM: TeamSignUp = { isTeam: false, shareMode: null, members: [] };

/**
 * The team part of a sign up (POST /api/fundraise), read beside the sign up's own schema (which
 * ignores these keys). `team` is "me" or "team" (none is "me"); an event is never a team, whatever
 * is sent. Field
 * messages are keyed as the form names them ("teamMembers.1.email"), and `team` is null when any is
 * given.
 */
export function checkTeamSignUp(body: unknown): { team: TeamSignUp | null; fields: Fields } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (b.path !== "raising") return { team: { ...NOT_A_TEAM }, fields: {} };
  const fields: Fields = {};
  // No answer at all is just me: a sign up page opened before the question was added (or any other
  // sender) carries on exactly as before. The form itself asks, with nothing chosen for them.
  if (b.team === undefined || b.team === null || b.team === "me") return { team: { ...NOT_A_TEAM }, fields: {} };
  if (b.team !== "team") return { team: null, fields: { team: TEAM_MISSING } };

  // A team needs a public page to be joined: the form never asks a team, and sends it as shown.
  if (b.public === false) fields.public = TEAM_ALWAYS_PUBLIC;
  const sharing = b.sharesWithOther === true;
  let shareMode: TeamShareMode | null = null;
  if (sharing) {
    if (b.teamShareMode === "team" || b.teamShareMode === "organiser") shareMode = b.teamShareMode;
    else fields.teamShareMode = TEAM_SHARE_MODE_MISSING;
  }

  const rows = Array.isArray(b.teamMembers) ? b.teamMembers : [];
  const members: TeamMemberToInvite[] = [];
  const seen = new Set<string>();
  const filled = rows.filter((r) => {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    return text(o.firstName) || text(o.lastName) || text(o.email);
  });
  if (filled.length > TEAM_MEMBERS_MAX) {
    fields.teamMembers = `You can add up to ${TEAM_MEMBERS_MAX} people here. Share the join link with anyone else.`;
  } else {
    rows.forEach((r, i) => {
      const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      const firstName = nameText(o.firstName);
      const lastName = nameText(o.lastName);
      const email = text(o.email).toLowerCase();
      if (!firstName && !lastName && !email) return;
      const at = `teamMembers.${i}`;
      if (!firstName) fields[`${at}.firstName`] = "Add their first name.";
      else if (firstName.length > NAME_PART_MAX) fields[`${at}.firstName`] = `Keep this to ${NAME_PART_MAX} characters or fewer.`;
      if (!lastName) fields[`${at}.lastName`] = "Add their surname.";
      else if (lastName.length > NAME_PART_MAX) fields[`${at}.lastName`] = `Keep this to ${NAME_PART_MAX} characters or fewer.`;
      if (!EMAIL.safeParse(email).success) fields[`${at}.email`] = "Check this email address.";
      else if (seen.has(email)) fields[`${at}.email`] = o.under18 === true ? TEAM_EMAIL_TWICE_CHILD : TEAM_EMAIL_TWICE;
      seen.add(email);
      members.push({ firstName, lastName, email, ...(o.under18 === true ? { under18: true as const } : {}) });
    });
  }
  if (Object.keys(fields).length > 0) return { team: null, fields };
  return { team: { isTeam: true, shareMode, members }, fields: {} };
}

// --- the split a member page has -------------------------------------------------------------------

/**
 * The split every member page of this team has, when it is the whole team's: the team's own. Null
 * when the team is not sharing, or the split is just the team organiser's (each member is asked).
 */
export function teamSplitFor(
  team: Pick<FundraiserRecord, "sharesWithOther" | "nbccSharePercent" | "otherCauseName" | "teamShareMode">,
): FundraiserSplit | null {
  if (team.teamShareMode !== "team" || team.sharesWithOther !== true || !team.nbccSharePercent || !team.otherCauseName) return null;
  return { sharesWithOther: true, nbccSharePercent: team.nbccSharePercent, otherCauseName: team.otherCauseName };
}

/** Does someone joining this team answer the sharing question themselves? */
export function membersAskedToShare(team: Pick<FundraiserRecord, "sharesWithOther" | "teamShareMode">): boolean {
  return team.sharesWithOther === true && team.teamShareMode !== "team";
}

const NOT_SHARING: FundraiserSplit = { sharesWithOther: false, nbccSharePercent: null, otherCauseName: null };

// --- the join form ---------------------------------------------------------------------------------

export interface Join {
  firstName: string;
  lastName: string;
  email: string;
  targetPence: number | null;
  why: string;
  split: FundraiserSplit;
  /** The sign up tidy: joining for someone under 18, their parent's or guardian's first name and tick. */
  guardianFirstName: string | null;
  guardianConsent: boolean | null;
}

function readTarget(v: unknown): { pence: number | null; problem: string | null } {
  if (v === undefined || v === null || v === "") return { pence: null, problem: null };
  if (typeof v !== "number" || !Number.isFinite(v)) return { pence: null, problem: "Give the target in whole pounds and pence." };
  if (!Number.isInteger(v)) return { pence: null, problem: "Give the target in whole pounds and pence." };
  if (v < TARGET_MIN_PENCE) return { pence: null, problem: "A target needs to be at least £10." };
  if (v > TARGET_MAX_PENCE) return { pence: null, problem: "A target can be up to £100,000." };
  return { pence: v, problem: null };
}

/**
 * The join form (POST /api/fundraise/teams/:slug/join), checked against the team. Nothing is chosen
 * for them: 18 or over needs a Yes (a No gets the sign up form's kind note). The sharing question is
 * only theirs to answer when the split is just the team organiser's; a whole team split is the
 * team's, whatever is sent; a team not sharing never shares.
 */
export function checkJoin(
  body: unknown,
  team: Pick<FundraiserRecord, "sharesWithOther" | "nbccSharePercent" | "otherCauseName" | "teamShareMode">,
): { join: Join | null; fields: Fields } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fields: Fields = {};
  const firstName = text(b.firstName);
  const lastName = text(b.lastName);
  const email = text(b.email).toLowerCase();
  const why = text(b.why);
  if (!firstName) fields.firstName = "Please tell us your first name.";
  else if (firstName.length > NAME_PART_MAX) fields.firstName = `Keep this to ${NAME_PART_MAX} characters or fewer.`;
  if (!lastName) fields.lastName = "Please tell us your surname.";
  else if (lastName.length > NAME_PART_MAX) fields.lastName = `Keep this to ${NAME_PART_MAX} characters or fewer.`;
  if (!EMAIL.safeParse(email).success) fields.email = "Please check your email address.";
  if (b.over18 !== true && b.over18 !== false) fields.over18 = OVER_18_MISSING;
  else if (b.over18 === false) fields.over18 = JOIN_UNDER_18;
  const target = readTarget(b.targetPence);
  if (target.problem) fields.targetPence = target.problem;
  if (why.length > JOIN_WHY_MAX) fields.why = `Keep this to ${JOIN_WHY_MAX} characters or fewer.`;

  let split: FundraiserSplit = NOT_SHARING;
  const whole = teamSplitFor(team);
  if (whole) split = whole;
  else if (membersAskedToShare(team)) {
    const parsed = splitSchema.safeParse({
      sharesWithOther: typeof b.sharesWithOther === "boolean" ? b.sharesWithOther : undefined,
      nbccSharePercent: b.nbccSharePercent,
      otherCauseName: typeof b.otherCauseName === "string" ? b.otherCauseName : "",
    });
    if (parsed.success) split = parsed.data;
    else for (const issue of parsed.error.issues) fields[issue.path.join(".") || "sharesWithOther"] ??= issue.message;
  }
  const guardian = checkGuardian(b, (path, message) => {
    fields[path] = message;
  });
  if (Object.keys(fields).length > 0) return { join: null, fields };
  return { join: { firstName, lastName, email, targetPence: target.pence, why, split, ...guardian }, fields: {} };
}

/**
 * The member page a join makes: the team's kind, date, place and website choice; the member's own
 * name, email and target; their line about why as the story. Staff approve it, and may change any of
 * it first, as with any sign up. No phone is asked (the team organiser is who staff call).
 */
export function memberSignUp(team: FundraiserRecord, j: Join): SignUp {
  const title = `${j.firstName}'s page for ${team.title}`.slice(0, 100).trim();
  return {
    path: "raising",
    kind: team.kind,
    kindOther: team.kindOther ?? null,
    title,
    description: j.why || `${j.firstName} is raising money for NBCC as part of ${team.title}.`,
    eventDate: team.eventDate,
    startTime: team.startTime,
    venue: team.venue,
    town: team.town,
    targetPence: j.targetPence,
    public: team.public,
    firstName: j.firstName,
    lastName: j.lastName,
    name: `${j.firstName} ${j.lastName}`,
    email: j.email,
    phone: "",
    instagram: null,
    facebook: null,
    socialLink: null,
    socialOk: false,
    over18: true,
    ...j.split,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, qrCount: 0, envelopeCount: 0, shoutOut: false, attend: false },
    postLine1: null,
    postLine2: null,
    postTown: null,
    postPostcode: null,
    newsletterOk: false,
    cardLine: null,
    endTime: null,
    timeTbc: false,
    venueAddress: null,
    venuePostcode: null,
    access: [],
    price: null,
    booking: null,
    ticketUrl: null,
    ageLimit: null,
    dressCode: null,
    included: null,
    creditName: null,
    // In memory: a member page of a team is never in memory (an in memory page is never a team).
    inMemory: false,
    memoryName: null,
    memoryDates: null,
    memorySetupBy: null,
    memoryPermission: null,
    memoryShowTarget: null,
    // The sign up tidy: a member page is listed with its team, and asks none of the new questions.
    listed: true,
    isSporting: null,
    tshirtSize: null,
    splitConfirmed: false,
    childFirstName: null,
    childConsent: null,
    orgName: null,
    employerMatch: null,
    memoryDirectorBusiness: null,
    memoryFamilyContactName: null,
    memoryFamilyContactEmail: null,
    callTime: null,
    dateTbc: false,
    guardianFirstName: j.guardianFirstName ?? null,
    // Their parent or guardian ticked: happy for their first name and any photo to be shown.
    ...(j.guardianFirstName ? { childConsent: j.guardianConsent === true } : {}),
  } as SignUp;
}

// --- the team's meter, and its members -------------------------------------------------------------

/**
 * The team's meter: gifts and cash on the team page itself, plus every current member page's
 * (approved or finished, not taken off the team; the caller passes those). Gift Aid the same way:
 * shown under the total, never in it. Against the team's own target.
 */
export function teamMeter(own: Meter, members: Array<Pick<Meter, "onlinePence" | "cashPence" | "giftAidPence">>, targetPence: number | null): Meter {
  const sum = (k: "onlinePence" | "cashPence" | "giftAidPence") => members.reduce((n, m) => n + Math.max(0, m[k] ?? 0), own[k]);
  return meter({ onlinePence: sum("onlinePence"), cashPence: sum("cashPence"), giftAidPence: sum("giftAidPence"), targetPence });
}

type WithMeter = {
  id: number;
  status: FundraiserRecord["status"];
  targetPence: number | null;
  isTeam?: boolean;
  teamId?: number | null;
  teamLeftAt?: string | null;
  meter: Meter;
};

/**
 * Every team in a list given its combined total (teamMeter), from the member pages in the same list:
 * the admin's list and the automatic emails read every fundraiser at once. Members, and everyone
 * else, keep their own. A list with no team comes back as it was.
 */
export function withTeamTotals<T extends WithMeter>(list: T[]): T[] {
  if (!list.some((f) => f.isTeam)) return list;
  const by = new Map<number, Meter[]>();
  for (const m of list) {
    if (!m.teamId || m.teamLeftAt || (m.status !== "approved" && m.status !== "finished")) continue;
    by.set(m.teamId, [...(by.get(m.teamId) ?? []), m.meter]);
  }
  return list.map((f) => (f.isTeam ? { ...f, meter: teamMeter(f.meter, by.get(f.id) ?? [], f.targetPence) } : f));
}

/** Still on the team: not taken off it, and not declined. A member waiting for staff counts. */
export function isCurrentMember(m: { status: FundraiserRecord["status"]; teamLeftAt?: string | null }): boolean {
  return !m.teamLeftAt && m.status !== "declined";
}

export interface TeamMemberRow {
  id: number;
  slug: string;
  name: string;
  firstName?: string | null;
  guardianFirstName?: string | null;
  status: FundraiserRecord["status"];
  public: boolean;
  path: FundraiserRecord["path"];
  teamLeftAt?: string | null;
  meter: Meter;
  /** In memory: never a member page, but its target stays hidden whatever a row says. */
  inMemory?: boolean | null;
  memoryShowTarget?: boolean | null;
}

export interface TeamMemberCard {
  name: string;
  url: string;
  meter: Meter;
  /** Profile pictures: their approved round photo, or null for the NBCC elf. */
  photoSrc?: string | null;
}

const firstOf = (m: Pick<TeamMemberRow, "name" | "firstName">) => (m.firstName || m.name.trim().split(/\s+/)[0] || "").trim();

/**
 * The members on the team page: every member page with a page of its own (approved or finished, and
 * public) still on the team, A to Z by first name (then surname), each as "Ava S." with its own small
 * meter. Never ordered by money.
 */
export function teamMemberList(rows: TeamMemberRow[], photos: ReadonlyMap<number, string> = new Map()): TeamMemberCard[] {
  const byName = (a: TeamMemberRow, b: TeamMemberRow) =>
    firstOf(a).localeCompare(firstOf(b), "en-GB", { sensitivity: "base" }) ||
    a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }) ||
    a.id - b.id;
  return rows
    .filter((r) => !r.teamLeftAt && hasPage(r))
    .sort(byName)
    .map((r) => {
      const photoId = photos.get(r.id);
      // A member under 18 (their parent or guardian joined for them): first name only.
      return { name: r.guardianFirstName ? firstWord(r.firstName ?? r.name) : shortName(r.name), url: `/fundraise/${r.slug}`, meter: memoryMeter(r, r.meter), photoSrc: photoId ? profilePhotoSrc(photoId) : null };
    });
}

// --- "[First name] has joined [team name]" (Jaimie, 2026-10-04) ---------------------------------------
//
// The email to the team organiser when staff approve a new team member's page. NEW wording, so it is
// only sent once an admin has approved it, with the same sign off as the other new wording
// (touch_wording_approvals, key "team_joined"), read and approved in Admin > Fundraising > Automatic
// emails. No row, not approved: nothing is sent and nothing is logged.
export const TEAM_JOINED_KEY = "team_joined";
export const TEAM_WORDING_KEYS = [TEAM_JOINED_KEY] as const;
export type TeamWordingKey = (typeof TEAM_WORDING_KEYS)[number];
export const TEAM_JOINED_LABEL = "A new member has joined your team";
export const TEAM_JOINED_WHEN = "To the team organiser, when you approve a new team member's page. Never about their own page.";

// --- the join link ---------------------------------------------------------------------------------

export function joinUrl(base: string, slug: string): string {
  return `${base.replace(/\/+$/, "")}/fundraise/${slug}/join`;
}

// An invite's token: 32 random bytes, base64url, in the invite email's link only. Only its sha256
// is kept (with its own domain prefix, apart from staff invites' tokens), so a copy of the table
// opens nothing. It fills in the join form; it is never needed to join.
const TEAM_TOKEN_DOMAIN = "teaminvite.v1:";

export function newTeamInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashTeamInviteToken(token: string): string {
  return createHash("sha256").update(TEAM_TOKEN_DOMAIN + token).digest("hex");
}

/** The token from what the page sent, or null when it is not one. */
export function readTeamInviteToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return /^[A-Za-z0-9_-]{43}$/.test(t) ? t : null;
}

/** The join link with an invite's token, so the form opens filled in. */
export function teamInviteUrl(base: string, slug: string, token: string): string {
  return `${joinUrl(base, slug)}?invite=${encodeURIComponent(token)}`;
}

/**
 * The short message the team organiser can paste into a group chat or WhatsApp, with the join link.
 * The same words in the "your team page is live" email, the nudges and their private area.
 */
export function forwardMessage(team: { title: string }, link: string): string {
  return (
    // Who NBCC is, in the words of the charity's own short description (ABOUT_NBCC_SHORT,
    // src/email/brand.ts), run into the sentence so it reads as a chat message. The name is given in
    // full first: this is pasted to people who may never have heard of NBCC.
    `I've set up a team, ${team.title}, to raise money for the Night Before Christmas Campaign (NBCC), a volunteer led ` +
    "charity here all year for children, young people and vulnerable adults across South West Scotland. Would you like to join? " +
    `You get your own page, and everything you raise counts towards our team total too. Join here: ${link}`
  );
}

// --- an invite, over time --------------------------------------------------------------------------

export type InviteStatus = "held" | "sent" | "reminded" | "joined" | "deleted";

export interface InviteTimes {
  createdAt: string;
  sentAt: string | null;
  remindedAt: string | null;
  joinedAt: string | null;
  deletedAt: string | null;
}

/** Where an invite is up to. Joined stays joined once its details are deleted. */
export function inviteStatus(i: InviteTimes): InviteStatus {
  if (i.joinedAt) return "joined";
  if (i.deletedAt) return "deleted";
  if (i.remindedAt) return "reminded";
  if (i.sentAt) return "sent";
  return "held";
}

const passed = (iso: string, days: number, now: Date) => new Date(iso).getTime() + days * DAY_MS <= now.getTime();

/**
 * One gentle reminder, 5 days after the invite was sent, while they have not joined, it has not
 * been reminded or deleted, and the event (if it has a date) is still to come.
 */
export function inviteReminderDue(i: InviteTimes, eventDate: string | null, now: Date): boolean {
  if (!i.sentAt || i.remindedAt || i.joinedAt || i.deletedAt) return false;
  if (eventDate && eventDate < londonToday(now)) return false;
  return passed(i.sentAt, INVITE_REMIND_DAYS, now);
}

/**
 * Delete the names and email: 30 days after the invite was sent (or added, if staff never approved
 * the team), or once the event is over, whichever is sooner. Joined or not.
 */
export function inviteDeleteDue(i: InviteTimes, eventDate: string | null, now: Date): boolean {
  if (i.deletedAt) return false;
  if (eventDate && eventDate < londonToday(now)) return true;
  return passed(i.sentAt ?? i.createdAt, INVITE_KEEP_DAYS, now);
}

// --- the nudges to the team organiser --------------------------------------------------------------

export interface NudgeTeam {
  isTeam?: boolean;
  status: FundraiserRecord["status"];
  approvedAt: string | null;
  eventDate: string | null;
  teamNudge1At?: string | null;
  teamNudge2At?: string | null;
}

/**
 * "Did you send the invite to your team?" On day 3 after the team page went live (approved), and
 * again on day 10 only if still nobody has joined. Nothing once anyone has joined (`joined` counts
 * member sign ups, waiting ones too), after the event date, or for a team no longer approved. A
 * missed morning is caught up within a few days; the first is never sent once the second is due.
 * Whether they asked us to stop, and the Automatic emails switch, are the runner's to check.
 */
export function teamNudgeDue(t: NudgeTeam, joined: number, today: string): 1 | 2 | null {
  if (!t.isTeam || t.status !== "approved" || !t.approvedAt || joined > 0) return null;
  if (t.eventDate && t.eventDate < today) return null;
  const day = dayCount(londonToday(new Date(t.approvedAt)), today);
  const [first, second] = NUDGE_DAYS;
  if (day >= second) return !t.teamNudge2At && day <= second + NUDGE_CATCH_UP_DAYS ? 2 : null;
  if (day >= first) return !t.teamNudge1At && !t.teamNudge2At ? 1 : null;
  return null;
}

/** The day the second nudge is due, for the Monday summary's "nobody joined after 10 days". */
export function nobodyJoinedSince(approvedAt: string): string {
  return addDays(londonToday(new Date(approvedAt)), NUDGE_DAYS[1]);
}

// --- handing the team organiser role over (staff only) ---------------------------------------------

const phone = z
  .string()
  .trim()
  .min(1, "Give their phone number, so we can call them.")
  .max(20, "That phone number is too long.")
  .refine((v) => /^[+0-9 ()-]+$/.test(v) && v.replace(/\D/g, "").length >= 7, "That does not look like a phone number.");

/**
 * Who staff hand the team organiser role to: one of the team's members (their page's name and email,
 * with the phone staff type), or a new person.
 */
export const handoverSchema = z.union([
  z.object({ memberId: z.number().int().positive(), phone: phone.optional() }).strict(),
  z
    .object({
      firstName: z.string().trim().min(1, "Add their first name.").max(NAME_PART_MAX),
      lastName: z.string().trim().min(1, "Add their surname.").max(NAME_PART_MAX),
      email: z.string().trim().toLowerCase().max(254).email("That isn't a whole email address."),
      phone,
    })
    .strict(),
]);

export type HandoverInput = z.infer<typeof handoverSchema>;

/**
 * What the handover code's keyed hash is bound to: the team and the email it was sent to. A new
 * handover for the team replaces the old one's stored hash, so an old code never works again.
 */
export function handoverCodeKey(teamId: number, email: string): string {
  return `team-handover:${teamId}:${email.trim().toLowerCase()}`;
}
