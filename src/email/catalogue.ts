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
  type StaffSummary,
} from "../fundraising/emails";
import { buildMemoryReceiptEmail, buildTshirtAskEmail, greetGuardian } from "../fundraising/signup-tidy-emails";
import { buildInMemoryApprovedEmail } from "../fundraising/memory-emails";
import { buildSupporterThanksEmail } from "../fundraising/thanks-email";
import { buildInviteEmail, buildSummaryEmail } from "../fundraising/team-emails";
import {
  buildHandoverCodeEmail,
  buildJoinStaffEmail,
  buildJoinThanksEmail,
  buildMemberRemovedStaffEmail,
  buildTeamInviteEmail,
  buildTeamInviteReminderEmail,
  buildTeamLiveEmail,
  buildTeamMemberJoinedEmail,
  buildTeamNudgeEmail,
} from "../fundraising/team-page-emails";
import { sampleTouchData, touchEmailAsSent, type TouchEmailData } from "../fundraising/touch-emails";
import { TOUCH_LABELS, wordingKey, type TouchKind } from "../fundraising/touch-rules";
import { summaryLines, type SummaryCounts } from "../fundraising/summary";
import { joinUrl, TEAM_JOINED_KEY, TEAM_JOINED_LABEL } from "../fundraising/teams";
import { inviteWordingKey, type InviteType } from "../fundraising/invite";
import {
  buildPledgeConfirmEmail,
  buildPledgeEmail,
  buildPledgeStaffEmail,
  PLEDGE_EMAIL_LABELS,
  pledgeHiddenNote,
  pledgesPaidTwiceNote,
  samplePledgeEmailData,
} from "../pledges/emails";
import type { PledgeEmailKind } from "../pledges/model";
import {
  buildBookingCancelledEmail,
  buildOrderFlagStaffEmail,
  buildRefundRequestStaffEmail,
  buildTicketConfirmationEmail,
  buildTicketRefundEmail,
  buildTicketsProposedStaffEmail,
  buildTicketsReleasedEmail,
  buildUnknownPaymentStaffEmail,
} from "../tickets/emails";
import { flagWords } from "../tickets/model";
import { buildBallConfirmationEmail } from "../ball/confirmation-email";
import { buildBallReminderEmail } from "../ball/reminder-email";
import { buildGuestChaseEmail, buildGuestSummaryEmail } from "../ball/run-up-email";
import { buildMenuReadyEmail } from "../ball/menu-email";
import { buildInvoicePaidEmail, buildTransferCancelledEmail, buildTransferDetailsEmail, buildTransferReminderEmail } from "../ball/transfer-email";
import { buildTransferStaffEmail } from "../ball/transfer-staff-email";
import { renderReport } from "../ball/sales-report";
import { buildDonationConfirmation } from "../donors/confirmation";
import { buildKindEmail } from "./templates";

// All emails (Admin > Fundraising): the one list of every email the community fundraising, sponsor
// pledge, event ticket and Festive Ball code can send. The admin's "All emails" card is drawn from
// this and nothing else (src/routes/admin-fundraising-emails.ts), so it is the single source of truth
// for what exists, what it is called, who gets it and when, and which wording is approval gated.
//
// Three rules:
//   1. Every entry renders by calling the REAL builder with invented sample data. No wording lives
//      here: what an admin reads is what is sent. (Sample people are all "Example", every address is
//      example.com, and the repo is public, so never a real person.)
//   2. This file creates no approval gate and changes none. A version's `approval` only POINTS at a
//      gate that already exists (touch_wording_approvals, through the three existing endpoints). The
//      keys are worked out with the senders' own rules (wordingKey, inviteWordingKey), never typed.
//   3. A new email builder, or a new kind of email in the log, must be added here. The guard
//      (test/unit/email-catalogue-guard.test.ts) fails otherwise.
//
// The order of CATALOGUE is the order on screen: by group, then the order they would be sent.

export type GroupId = "signup" | "invites" | "teams" | "touch" | "finishing" | "memory" | "pledges" | "events" | "ball" | "staff";

export const CATALOGUE_GROUPS: ReadonlyArray<{ id: GroupId; name: string }> = [
  { id: "signup", name: "Signing up and approval" },
  { id: "invites", name: "Invites from staff" },
  { id: "teams", name: "Teams" },
  { id: "touch", name: "Keeping in touch (automatic)" },
  { id: "finishing", name: "Finishing and paying in" },
  { id: "memory", name: "In memory" },
  { id: "pledges", name: "Sponsor pledges" },
  { id: "events", name: "Event pages and tickets" },
  { id: "ball", name: "The Festive Ball" },
  { id: "staff", name: "Staff notices" },
];

export interface Rendered {
  subject: string;
  html: string;
}

/** Where a version's wording is signed off today: its key, and the endpoint that already does it (POST approves, DELETE withdraws). */
export interface VersionApproval {
  key: string;
  path: string;
}

export interface CatalogueVersion {
  /** Stable, url safe. The first version of an email is its usual one. */
  id: string;
  /** What the Version drop-down says. */
  label: string;
  /** Only when this wording is approval gated today. */
  approval?: VersionApproval;
  /** Subject and HTML, from the real builder. `base` is the site's address, for the links. */
  render: (base: string) => Rendered;
}

export interface CatalogueEmail {
  /** Stable, url safe. */
  id: string;
  group: GroupId;
  name: string;
  /** One short sentence: who gets it and when. */
  who: string;
  audience: "public" | "staff";
  /** The names it is written to the email log under (src/clients/email.ts). The guard reads these. */
  logKinds: string[];
  /** A quiet line under the email: its words are typed elsewhere, or depend on what people typed. */
  note?: string;
  /** One of the automatic emails to an organiser: it can also be shown for a real fundraiser. */
  touchKind?: TouchKind;
  versions: CatalogueVersion[];
}

// --- the existing approval endpoints ---------------------------------------------------------------

const touchApproval = (key: string | null): VersionApproval | undefined =>
  key ? { key, path: `/api/admin/fundraising/touch/approvals/${key}` } : undefined;
const pledgeApproval = (key: PledgeEmailKind): VersionApproval => ({ key, path: `/api/admin/fundraising/pledges/approvals/${key}` });
const inviteApproval = (type: InviteType): VersionApproval | undefined => {
  const key = inviteWordingKey(type);
  return key ? { key, path: `/api/admin/fundraising/invite-wording/${key}/approval` } : undefined;
};

// --- invented people and pages ---------------------------------------------------------------------

const USUAL = "The usual one";
const GROUP_LABEL = "A group or business (no first name to use)";
const UNDER_18_LABEL = "A page for someone under 18 (goes to the parent or guardian)";
const NO_NAME_LABEL = "No first name we can safely use";
const OFF_SITE_LABEL = "Their page is not on the website";

const SAM = { name: "Sam Example", firstName: "Sam", creditName: null as string | null };
const ARMS = { name: "The Example Arms", firstName: null, creditName: "The Example Arms" };
const JACK = { name: "Jack Example", firstName: "Jack", guardianFirstName: "Sarah" };
const PAGE = "Sam's Santa Dash";
const TEAM_TITLE = "The Example Runners";
const EVENT_TITLE = "The Example Christmas Fair";
const MEMORY_NAME = "Mary Example";
const CODE = "123456";

const STAFF_NOTE = "A notice to the team. The details here are an example: the real one carries what the person typed.";
const NOTE_NOTE = "The personal note is typed by whoever sends the invite. The one here is an example.";
const NUMBERS_NOTE = "The numbers here are made up. The real one counts what has really happened.";

const v = (id: string, label: string, render: (base: string) => Rendered, approval?: VersionApproval): CatalogueVersion => ({
  id,
  label,
  render,
  ...(approval ? { approval } : {}),
});

// --- signing up and approval -----------------------------------------------------------------------

const pageLinks = (b: string) => ({ pageUrl: `${b}/fundraise/sams-santa-dash`, manageUrl: `${b}/fundraise/manage` });
const pageLive = (f: typeof SAM | typeof ARMS | typeof JACK) => (b: string) => buildApprovedEmail({ ...f, title: PAGE, path: "raising" }, pageLinks(b));
const onList = (f: typeof SAM | typeof ARMS) => () => buildApprovedEmail({ ...f, title: PAGE, path: "raising" }, { pageUrl: null, manageUrl: null });
const titled = <T extends object>(f: T) => ({ ...f, title: PAGE });

const SIGNUP: CatalogueEmail[] = [
  {
    id: "signup-thanks",
    group: "signup",
    name: "Thank you for signing up",
    who: "Goes to the person who filled in the Fundraise for us form, as soon as they sign up.",
    audience: "public",
    logKinds: ["fundraiseThanks"],
    versions: [v("usual", USUAL, () => buildSignUpThanksEmail(SAM.name)), v("no-name", NO_NAME_LABEL, () => buildSignUpThanksEmail("4x4 Club"))],
  },
  {
    id: "signup-page-live",
    group: "signup",
    name: "Your page is live",
    who: "Goes to the fundraiser when staff approve a public page that raises money.",
    audience: "public",
    logKinds: ["fundraiseApproved"],
    versions: [
      v("usual", USUAL, pageLive(SAM)),
      v("group", GROUP_LABEL, pageLive(ARMS)),
      v("under-18", UNDER_18_LABEL, (b) => greetGuardian(pageLive(JACK)(b), JACK)),
    ],
  },
  {
    id: "signup-on-list",
    group: "signup",
    name: "You're on our list",
    who: "Goes to the fundraiser or event host when staff approve a sign up that has no public page.",
    audience: "public",
    logKinds: ["fundraiseApproved"],
    versions: [v("usual", USUAL, onList(SAM)), v("group", GROUP_LABEL, onList(ARMS))],
  },
  {
    id: "sign-in-code",
    group: "signup",
    name: "Your sign in code",
    who: "Goes to anyone with a fundraiser, when they ask for a code to open their private area.",
    audience: "public",
    logKinds: ["fundraiseCode"],
    versions: [
      v("usual", USUAL, () => buildSignInCodeEmail(SAM.name, CODE)),
      v("no-name", NO_NAME_LABEL, () => buildSignInCodeEmail("4x4 Club", CODE)),
      // Jaimie, 2026-10-04: a family or a funeral director with a page in memory of someone.
      v("in-memory", "They have a page in memory of someone (the gentle one)", () => buildSignInCodeEmail(SAM.name, CODE, { gentle: true })),
      v("in-memory-no-name", "In memory, with no first name we can safely use", () => buildSignInCodeEmail("4x4 Club", CODE, { gentle: true })),
    ],
  },
  {
    id: "update-live",
    group: "signup",
    name: "Your update is live",
    who: "Goes to the fundraiser when staff approve a change they asked for.",
    audience: "public",
    logKinds: ["fundraiseEditApproved"],
    versions: [
      v("usual", USUAL, (b) => buildEditApprovedEmail(titled(SAM), { pageUrl: pageLinks(b).pageUrl })),
      v("off-site", OFF_SITE_LABEL, () => buildEditApprovedEmail(titled(SAM), { pageUrl: null })),
      v("under-18", UNDER_18_LABEL, (b) => greetGuardian(buildEditApprovedEmail(titled(JACK), { pageUrl: pageLinks(b).pageUrl }), JACK)),
    ],
  },
  {
    id: "update-declined",
    group: "signup",
    name: "About your update",
    who: "Goes to the fundraiser when staff turn down a change they asked for.",
    audience: "public",
    logKinds: ["fundraiseEditRejected"],
    versions: [
      v("usual", USUAL, () => buildEditRejectedEmail(titled(SAM), { pageLive: true })),
      v("off-site", OFF_SITE_LABEL, () => buildEditRejectedEmail(titled(SAM), { pageLive: false })),
      v("under-18", UNDER_18_LABEL, () => greetGuardian(buildEditRejectedEmail(titled(JACK), { pageLive: true }), JACK)),
    ],
  },
  {
    id: "news-live",
    group: "signup",
    name: "Your news update is live",
    who: "Goes to the fundraiser when staff approve a news update.",
    audience: "public",
    logKinds: ["fundraiseNewsApproved"],
    versions: [
      v("usual", USUAL, (b) => buildNewsApprovedEmail(titled(SAM), { pageUrl: pageLinks(b).pageUrl })),
      v("off-site", OFF_SITE_LABEL, () => buildNewsApprovedEmail(titled(SAM), { pageUrl: null })),
      v("under-18", UNDER_18_LABEL, (b) => greetGuardian(buildNewsApprovedEmail(titled(JACK), { pageUrl: pageLinks(b).pageUrl }), JACK)),
    ],
  },
  {
    id: "news-declined",
    group: "signup",
    name: "About your news update",
    who: "Goes to the fundraiser when staff do not use a news update.",
    audience: "public",
    logKinds: ["fundraiseNewsRejected"],
    versions: [
      v("usual", USUAL, () => buildNewsRejectedEmail(titled(SAM), { pageLive: true })),
      v("off-site", OFF_SITE_LABEL, () => buildNewsRejectedEmail(titled(SAM), { pageLive: false })),
      v("under-18", UNDER_18_LABEL, () => greetGuardian(buildNewsRejectedEmail(titled(JACK), { pageLive: true }), JACK)),
    ],
  },
  {
    id: "tshirt-size",
    group: "signup",
    name: "What size T-shirt would you like?",
    who: "Goes to the fundraiser when staff press “Ask them for their T-shirt size”.",
    audience: "public",
    logKinds: ["fundraiseTshirtAsk"],
    versions: [
      v("usual", USUAL, (b) => buildTshirtAskEmail("Sam", `${b}/fundraise/tshirt?t=example`)),
      v("no-name", NO_NAME_LABEL, (b) => buildTshirtAskEmail("4x4 Club", `${b}/fundraise/tshirt?t=example`)),
    ],
  },
];

// --- invites from staff ----------------------------------------------------------------------------

const EXAMPLE_NOTE = "It was lovely to chat at the school fair on Saturday. Here is the link I promised.";
const invite = (type: InviteType, note: string | null) => (b: string) =>
  buildInviteEmail({ firstName: "Mary", note, signer: "Robin", url: `${b}/fundraise?invite=example`, type });
const inviteEmail = (type: InviteType, id: string, name: string, who: string): CatalogueEmail => ({
  id,
  group: "invites",
  name,
  who,
  audience: "public",
  logKinds: ["fundraiseInvite"],
  note: NOTE_NOTE,
  versions: [
    v("usual", "With a personal note", invite(type, EXAMPLE_NOTE), inviteApproval(type)),
    v("no-note", "No personal note typed", invite(type, null), inviteApproval(type)),
  ],
});

const INVITES: CatalogueEmail[] = [
  inviteEmail("raising", "invite-raising", "Invite: raising money", "Goes to someone a member of staff has spoken to, when staff send an invite of the type “Raising money”."),
  inviteEmail("team", "invite-team", "Invite: a team", "Goes to someone staff have spoken to about setting up a team, when staff send an invite of the type “A team”."),
  inviteEmail("event", "invite-event", "Invite: hosting an event", "Goes to someone staff have spoken to about holding an event, when staff send an invite of the type “Hosting an event”."),
  inviteEmail("memory", "invite-memory", "Invite: in memory", "Goes to someone staff have spoken to about a page in memory of someone, when staff send an invite of the type “In memory”."),
];

// --- teams -----------------------------------------------------------------------------------------

const TEAM = { title: TEAM_TITLE, kind: "santa", kindLabel: "Santa dash", kindOther: null, eventDate: "2026-12-05" };
type TeamLiveWho = Parameters<typeof buildTeamLiveEmail>[0];
type TeamLiveLinks = Parameters<typeof buildTeamLiveEmail>[1];
const teamLive = (o: Partial<TeamLiveLinks> = {}, f: typeof SAM | typeof ARMS = SAM) => (b: string) =>
  buildTeamLiveEmail({ ...TEAM, ...f } as TeamLiveWho, {
    pageUrl: `${b}/fundraise/the-example-runners`,
    manageUrl: `${b}/fundraise/manage`,
    joinUrl: joinUrl(b, "the-example-runners"),
    invited: 3,
    ...o,
  });
type InviteWordsIn = Parameters<typeof buildTeamInviteEmail>[0];
const teamInvite = (b: string, o: Partial<InviteWordsIn> = {}): InviteWordsIn => ({
  firstName: "Alex",
  organiserName: SAM.name,
  organiserFirstName: "Sam",
  under18: false,
  team: TEAM as InviteWordsIn["team"],
  joinUrl: `${joinUrl(b, "the-example-runners")}?invite=example`,
  ...o,
});
const nudge = (n: 1 | 2, f: typeof SAM | typeof ARMS = SAM) => (b: string) =>
  buildTeamNudgeEmail(n, { ...f, title: TEAM_TITLE, pageUrl: `${b}/fundraise/the-example-runners`, joinUrl: joinUrl(b, "the-example-runners") });

const memberJoined = (b: string | null, o: Partial<Parameters<typeof buildTeamMemberJoinedEmail>[0]> = {}) =>
  buildTeamMemberJoinedEmail({ organiser: SAM, memberFirstName: "Alex", teamTitle: TEAM_TITLE, teamUrl: b === null ? null : `${b}/fundraise/the-example-runners`, ...o });

const TEAMS: CatalogueEmail[] = [
  {
    id: "team-live",
    group: "teams",
    name: "Your team page is live",
    who: "Goes to the team organiser when staff approve a team.",
    audience: "public",
    logKinds: ["fundraiseTeamLive"],
    versions: [
      v("usual", "The usual one (they added three people)", teamLive()),
      v("one-added", "They added one person", teamLive({ invited: 1 })),
      v("none-added", "They added nobody", teamLive({ invited: 0 })),
      v("off-site", "The team is kept off the website", teamLive({ pageUrl: null })),
      v("group", GROUP_LABEL, teamLive({}, ARMS)),
    ],
  },
  {
    id: "team-invite",
    group: "teams",
    name: "Team invite",
    who: "Goes to an adult the team organiser added to their team, when staff approve the team.",
    audience: "public",
    logKinds: ["fundraiseTeamInvite"],
    versions: [
      v("usual", USUAL, (b) => buildTeamInviteEmail(teamInvite(b))),
      v("no-date", "The team has no date set", (b) => buildTeamInviteEmail(teamInvite(b, { team: { ...TEAM, eventDate: null } as InviteWordsIn["team"] }))),
    ],
  },
  {
    id: "team-invite-under-18",
    group: "teams",
    name: "Team invite, under 18",
    who: "Goes to the parent or guardian of a child the team organiser added, when staff approve the team.",
    audience: "public",
    logKinds: ["fundraiseTeamInvite"],
    versions: [v("usual", USUAL, (b) => buildTeamInviteEmail(teamInvite(b, { firstName: "Jack", under18: true })))],
  },
  {
    id: "team-reminder",
    group: "teams",
    name: "Team invite reminder",
    who: "Goes to an adult invited to a team, 5 days after the invite, if they have not joined.",
    audience: "public",
    logKinds: ["fundraiseTeamInviteReminder"],
    versions: [v("usual", USUAL, (b) => buildTeamInviteReminderEmail(teamInvite(b)))],
  },
  {
    id: "team-reminder-under-18",
    group: "teams",
    name: "Team invite reminder, under 18",
    who: "Goes to the parent or guardian of a child invited to a team, 5 days after the invite, if they have not joined.",
    audience: "public",
    logKinds: ["fundraiseTeamInviteReminder"],
    versions: [v("usual", USUAL, (b) => buildTeamInviteReminderEmail(teamInvite(b, { firstName: "Jack", under18: true })))],
  },
  {
    id: "team-nudge-1",
    group: "teams",
    name: "Nudge on day 3: did you send the invite?",
    who: "Goes to the team organiser 3 days after the team went live, if nobody has joined.",
    audience: "public",
    logKinds: ["fundraiseTeamNudge"],
    versions: [v("usual", USUAL, nudge(1)), v("group", GROUP_LABEL, nudge(1, ARMS))],
  },
  {
    id: "team-nudge-2",
    group: "teams",
    name: "Nudge on day 10: here's your team link again",
    who: "Goes to the team organiser 10 days after the team went live, if still nobody has joined.",
    audience: "public",
    logKinds: ["fundraiseTeamNudge"],
    versions: [v("usual", USUAL, nudge(2))],
  },
  {
    id: "team-joined",
    group: "teams",
    name: "Thanks for joining",
    who: "Goes to someone who has just filled in the join form, as soon as they join a team.",
    audience: "public",
    logKinds: ["fundraiseTeamJoined"],
    versions: [
      v("usual", USUAL, () => buildJoinThanksEmail("Alex", TEAM_TITLE)),
      v("no-name", NO_NAME_LABEL, () => buildJoinThanksEmail("4x4", TEAM_TITLE)),
      v("under-18", "Joining for someone under 18 (goes to the parent or guardian)", () => greetGuardian(buildJoinThanksEmail("Jack", TEAM_TITLE), JACK)),
    ],
  },
  // Jaimie, 2026-10-04: new wording, held until an admin approves it (key team_joined, signed off by
  // the automatic emails' endpoint). Sent by sendTeamMemberJoined in src/fundraising/team-send.ts.
  {
    id: "team-member-joined",
    group: "teams",
    name: TEAM_JOINED_LABEL,
    who: "Goes to the team organiser when staff approve a new team member's page. Never about their own page.",
    audience: "public",
    logKinds: ["fundraiseTeamMemberJoined"],
    versions: [
      v("usual", USUAL, (b) => memberJoined(b), touchApproval(TEAM_JOINED_KEY)),
      v("under-18", "The new member is under 18 (their first name only, never the parent's)", (b) => memberJoined(b, { memberFirstName: "Jack" }), touchApproval(TEAM_JOINED_KEY)),
      v("off-site", "The team is kept off the website (no team page to link to)", () => memberJoined(null), touchApproval(TEAM_JOINED_KEY)),
      v("group", GROUP_LABEL, (b) => memberJoined(b, { organiser: ARMS }), touchApproval(TEAM_JOINED_KEY)),
    ],
  },
  {
    id: "team-handover",
    group: "teams",
    name: "Your code to become team organiser",
    who: "Goes to the person staff have chosen to take over, when staff hand the team organiser role over.",
    audience: "public",
    logKinds: ["fundraiseTeamHandoverCode"],
    versions: [v("usual", USUAL, (b) => buildHandoverCodeEmail({ firstName: "Alex", teamTitle: TEAM_TITLE, code: CODE, manageUrl: `${b}/fundraise/manage` }))],
  },
];

// --- keeping in touch (automatic), and the two that go after their date ------------------------------

// As the daily run sends it (touchEmailAsSent, which src/fundraising/touch-runner.ts sends too). On a
// page for someone under 18 the whole email is written for the parent or guardian (Jaimie,
// 2026-10-04): the hello, the subject, the heading and every line. The approval key is the sender's
// own rule for this much raised.
function touchVersion(kind: TouchKind, id: string, label: string, over: Partial<TouchEmailData> = {}): CatalogueVersion {
  const data = (b: string): TouchEmailData => ({ ...sampleTouchData(kind, b), ...over });
  const raised = data("").raisedPence;
  return v(
    id,
    label,
    (b) => touchEmailAsSent(kind, data(b)),
    touchApproval(wordingKey(kind, raised)),
  );
}

function touchEmail(kind: TouchKind, id: string, group: GroupId, logKind: string, who: string, extra: CatalogueVersion[] = []): CatalogueEmail {
  return {
    id,
    group,
    name: TOUCH_LABELS[kind].replace(/’/g, "'"),
    who,
    audience: "public",
    logKinds: [logKind],
    touchKind: kind,
    versions: [
      touchVersion(kind, "usual", USUAL),
      ...extra,
      touchVersion(kind, "group", GROUP_LABEL, ARMS),
      touchVersion(kind, "under-18", UNDER_18_LABEL, JACK),
    ],
  };
}

const TOUCH: CatalogueEmail[] = [
  touchEmail("first_gift", "touch-first-gift", "touch", "fundraiseFirstGift", "Goes to the fundraiser the morning after the first online gift.", [
    touchVersion("first_gift", "no-target", "The page has no target", { targetPence: null }),
  ]),
  touchEmail("halfway", "touch-halfway", "touch", "fundraiseHalfway", "Goes to the fundraiser when the meter passes half the target."),
  touchEmail("target", "touch-target", "touch", "fundraiseTargetReached", "Goes to the fundraiser when the target is reached."),
  touchEmail("on_track", "touch-on-track", "touch", "fundraiseOnTrack", "Goes to the fundraiser once, when they are on track for their target."),
  touchEmail("need_a_hand", "touch-need-a-hand", "touch", "fundraiseNeedAHand", "Goes to the fundraiser once, when their date is close and they are well short of their target."),
  touchEmail("week_before", "touch-week-before", "touch", "fundraiseWeekBefore", "Goes to the fundraiser a week before their date."),
  touchEmail("year_on", "touch-year-on", "touch", "fundraiseYearOn", "Goes to the fundraiser a year after their date.", [
    touchVersion("year_on", "nothing-raised", "Nothing was raised", { raisedPence: 0 }),
  ]),
];

const receipt = (o: Partial<Parameters<typeof buildDonationConfirmation>[0]>) => (): Rendered => {
  const c = buildDonationConfirmation({
    fullName: SAM.name,
    amountPence: 12345,
    currency: "GBP",
    giftAid: false,
    mode: "once",
    reference: "NBCC-000123",
    donationDate: new Date("2026-12-12T12:00:00Z"),
    ...o,
  } as Parameters<typeof buildDonationConfirmation>[0]);
  return buildKindEmail("donation", { html: c.html, text: c.text });
};
const supporterThanks = (o: Partial<Parameters<typeof buildSupporterThanksEmail>[0]> = {}) => () =>
  buildSupporterThanksEmail({
    organiserName: SAM.name,
    title: PAGE,
    message: "Thank you so much for sponsoring me. I made it round, in full Santa suit, and every pound will help a child this Christmas.",
    ...o,
  });

const FINISHING: CatalogueEmail[] = [
  touchEmail("week_after", "touch-week-after", "finishing", "fundraiseWeekAfter", "Goes to the fundraiser a week after their date.", [
    touchVersion("week_after", "nothing-raised", "Nothing raised yet", { raisedPence: 0 }),
  ]),
  touchEmail("finished", "touch-finished", "finishing", "fundraiseFinished", "Goes to the fundraiser when staff press Mark finished, with their certificate.", [
    touchVersion("finished", "nothing-raised", "Nothing raised", { raisedPence: 0 }),
  ]),
  {
    id: "paid-in-receipt",
    group: "finishing",
    name: "Receipt for money paid in",
    who: "Goes to a fundraiser who paid in cash or sponsor money by card, as soon as they pay it in from their private area.",
    audience: "public",
    logKinds: ["donation"],
    versions: [v("usual", USUAL, receipt({ paidIn: true }))],
  },
  {
    id: "supporter-thanks",
    group: "finishing",
    name: "A thank you from the fundraiser",
    who: "Goes to people who gave on a fundraiser's page, when staff approve a thank you the fundraiser wrote.",
    audience: "public",
    logKinds: ["fundraiseSupporterThanks"],
    note: "The message in the box is written by the fundraiser and checked by staff. The one here is an example.",
    versions: [
      v("usual", USUAL, supporterThanks()),
      v("group", "From a group or business (no first name to use)", supporterThanks({ organiserName: "4x4 Club" })),
      v("in-memory", "The page is in memory of someone", supporterThanks({ inMemory: true, giverName: "Alex Example", message: "Thank you for your kind gift, and for remembering her with us." })),
      v("in-memory-no-name", "In memory, and the giver has no first name we can safely use", supporterThanks({ inMemory: true, giverName: "4x4 Club", message: "Thank you for your kind gift, and for remembering her with us." })),
    ],
  },
];

// --- in memory -------------------------------------------------------------------------------------

type MemoryWho = Parameters<typeof buildInMemoryApprovedEmail>[0];
const memoryLive = (o: Partial<MemoryWho> = {}) => (b: string) =>
  buildInMemoryApprovedEmail({ name: SAM.name, firstName: "Sam", memoryName: MEMORY_NAME, setupBy: "family", ...o }, { pageUrl: `${b}/fundraise/in-memory-of-mary-example` });

const MEMORY: CatalogueEmail[] = [
  {
    id: "memory-signup",
    group: "memory",
    name: "We have your details",
    who: "Goes to the person who asked for a page in memory of someone, as soon as they sign up.",
    audience: "public",
    logKinds: ["fundraiseMemoryReceipt"],
    versions: [v("usual", USUAL, () => buildMemoryReceiptEmail(SAM.name)), v("no-name", NO_NAME_LABEL, () => buildMemoryReceiptEmail("4x4 Club"))],
  },
  {
    id: "memory-live",
    group: "memory",
    name: "Your page in memory (family or friend)",
    who: "Goes to the person who set up the page, when staff approve an in memory page.",
    audience: "public",
    logKinds: ["fundraiseApproved"],
    versions: [v("usual", USUAL, memoryLive()), v("group", GROUP_LABEL, memoryLive({ name: "The Example Arms", firstName: null }))],
  },
  {
    id: "memory-live-director",
    group: "memory",
    name: "Your page in memory (funeral director)",
    who: "Goes to the funeral director who set up the page for the family, when staff approve it.",
    audience: "public",
    logKinds: ["fundraiseApproved"],
    versions: [
      v("usual", USUAL, memoryLive({ setupBy: "funeral_director" })),
      v("business", "A business name instead of a person", memoryLive({ setupBy: "funeral_director", name: "The Example Funeral Directors", firstName: null })),
    ],
  },
];

// --- sponsor pledges -------------------------------------------------------------------------------

const NO_NAMES = { sponsorFirstName: "x1", organiserName: "4x4 Club" };
const pledgeData = (b: string) => ({ ...samplePledgeEmailData(b), giftAid: false });
const pledgeEmail = (kind: PledgeEmailKind, id: string, who: string): CatalogueEmail => ({
  id,
  group: "pledges",
  name: PLEDGE_EMAIL_LABELS[kind].replace(/’/g, "'"),
  who,
  audience: "public",
  logKinds: [kind === "pledge_pay" ? "fundraisePledgePay" : "fundraisePledgeReminder"],
  versions: [
    v("usual", USUAL, (b) => buildPledgeEmail(kind, pledgeData(b)), pledgeApproval(kind)),
    v("gift-aid", "The sponsor ticked Gift Aid when they pledged", (b) => buildPledgeEmail(kind, { ...pledgeData(b), giftAid: true }), pledgeApproval(kind)),
    v("no-names", "No first names we can safely use", (b) => buildPledgeEmail(kind, { ...pledgeData(b), ...NO_NAMES }), pledgeApproval(kind)),
  ],
});

const PLEDGES: CatalogueEmail[] = [
  {
    id: "pledge-confirm",
    group: "pledges",
    name: "Please confirm your pledge",
    who: "Goes to the sponsor as soon as they pledge.",
    audience: "public",
    logKinds: ["fundraisePledgeConfirm"],
    versions: [
      v("usual", USUAL, (b) => buildPledgeConfirmEmail({ ...pledgeData(b), confirmUrl: `${b}/pledge/confirm?t=example` })),
      v("no-names", "No first names we can safely use", (b) => buildPledgeConfirmEmail({ ...pledgeData(b), ...NO_NAMES, confirmUrl: `${b}/pledge/confirm?t=example` })),
    ],
  },
  pledgeEmail("pledge_pay", "pledge-pay", "Goes to the sponsor the day after the fundraiser's date."),
  pledgeEmail("pledge_reminder", "pledge-reminder", "Goes to the sponsor a week after the pay link, if the pledge is still unpaid."),
  {
    id: "pledge-receipt",
    group: "pledges",
    name: "Receipt for a paid pledge",
    who: "Goes to the sponsor as soon as they pay their pledge.",
    audience: "public",
    logKinds: ["donation"],
    versions: [v("usual", USUAL, receipt({ fullName: "Alex Example", amountPence: 1000 })), v("gift-aid", "The sponsor added Gift Aid", receipt({ fullName: "Alex Example", amountPence: 1000, giftAid: true }))],
  },
];

// --- event pages and tickets -----------------------------------------------------------------------

type EventBooking = NonNullable<Parameters<typeof buildApprovedEmail>[0]["booking"]>;
const eventLive = (booking: EventBooking) => (b: string) =>
  buildApprovedEmail({ ...SAM, title: EVENT_TITLE, path: "event", booking }, { pageUrl: `${b}/event/the-example-christmas-fair`, manageUrl: `${b}/fundraise/manage` });
const ticketEvent = (b: string) => ({
  title: EVENT_TITLE,
  eventDate: "2026-12-05" as string | null,
  startTime: "19:30",
  endTime: "22:30",
  timeTbc: false,
  where: "Example Village Hall, 1 Example Road, Exampleton, EX1 1EX",
  organisedBy: "Example Community Group",
  pageUrl: `${b}/event/the-example-christmas-fair`,
});
type TicketOrder = Parameters<typeof buildTicketConfirmationEmail>[1];
type TicketLine = TicketOrder["lines"][number];
const ticketLine = (o: Partial<TicketLine> = {}): TicketLine => ({ id: 1, typeName: "Adult", unitPence: 1300, quantity: 2, refundedQuantity: 0, ...o }) as TicketLine;
const REF = "NBCC-EXAMPLE";
const ticketOrder = (o: Partial<TicketOrder> = {}): TicketOrder => ({
  reference: REF,
  firstName: "Alex",
  lines: [ticketLine()],
  ticketsPence: 2600,
  feeCoverPence: 0,
  totalPence: 2600,
  ...o,
});
const refund = (o: Partial<Parameters<typeof buildTicketRefundEmail>[1]> = {}) => (b: string) =>
  buildTicketRefundEmail(ticketEvent(b), { reference: REF, firstName: "Alex", amountPence: 2600, full: true, standing: "", ...o });

const EVENTS: CatalogueEmail[] = [
  {
    id: "event-page-live",
    group: "events",
    name: "Your event's page is live",
    who: "Goes to the event host when staff approve a public event.",
    audience: "public",
    logKinds: ["fundraiseApproved"],
    versions: [
      v("usual", "Tickets on the door", eventLive("door")),
      v("away", "Tickets are sold on another website", eventLive("away")),
      v("free", "Free, just come along", eventLive("free")),
      v("other", "Any other way of getting in", eventLive("donations")),
    ],
  },
  {
    id: "ticket-confirmation",
    group: "events",
    name: "Your tickets",
    who: "Goes to the ticket buyer as soon as their card payment goes through.",
    audience: "public",
    logKinds: ["eventTickets"],
    versions: [
      v("usual", USUAL, (b) => buildTicketConfirmationEmail(ticketEvent(b), ticketOrder())),
      v("fee-covered", "The buyer chose to cover the card fee", (b) => buildTicketConfirmationEmail(ticketEvent(b), ticketOrder({ feeCoverPence: 150, totalPence: 2750 }))),
      v("free", "A free booking", (b) => buildTicketConfirmationEmail(ticketEvent(b), ticketOrder({ lines: [ticketLine({ unitPence: 0 })], ticketsPence: 0, totalPence: 0 }))),
      v("one-ticket", "Only one ticket", (b) => buildTicketConfirmationEmail(ticketEvent(b), ticketOrder({ lines: [ticketLine({ quantity: 1 })], ticketsPence: 1300, totalPence: 1300 }))),
      v("no-details", "The event has no date, time or place set", (b) => buildTicketConfirmationEmail({ ...ticketEvent(b), eventDate: null, where: "" }, ticketOrder())),
      v("no-name", NO_NAME_LABEL, (b) => buildTicketConfirmationEmail(ticketEvent(b), ticketOrder({ firstName: "x1" }))),
    ],
  },
  {
    id: "ticket-refund",
    group: "events",
    name: "Your refund",
    who: "Goes to the ticket buyer when an admin refunds tickets.",
    audience: "public",
    logKinds: ["eventTicketsRefund"],
    versions: [v("usual", "Every ticket was refunded", refund()), v("part", "Only some of the tickets were refunded", refund({ amountPence: 1300, full: false, standing: "1 Adult" }))],
  },
  {
    id: "ticket-cancelled",
    group: "events",
    name: "Your booking is cancelled",
    who: "Goes to the ticket buyer when a free booking is cancelled.",
    audience: "public",
    logKinds: ["eventTicketsCancelled"],
    versions: [v("usual", USUAL, (b) => buildBookingCancelledEmail(ticketEvent(b), { reference: REF, firstName: "Alex", tickets: "2 Adult" }))],
  },
  {
    id: "ticket-some-cancelled",
    group: "events",
    name: "Some of your tickets are cancelled",
    who: "Goes to the ticket buyer when staff cancel some tickets with no money moving.",
    audience: "public",
    logKinds: ["eventTicketsCancelled"],
    versions: [
      v("usual", "Some tickets are left on the booking", (b) => buildTicketsReleasedEmail(ticketEvent(b), { reference: REF, firstName: "Alex", released: "1 Adult", standing: "1 Child" })),
      v("none-left", "No tickets are left on the booking", (b) => buildTicketsReleasedEmail(ticketEvent(b), { reference: REF, firstName: "Alex", released: "1 Adult", standing: "" })),
    ],
  },
];

// --- the Festive Ball ------------------------------------------------------------------------------

type BallBooking = Parameters<typeof buildBallConfirmationEmail>[0];
type BallDetails = Parameters<typeof buildBallConfirmationEmail>[1];
const BALL_REF = "BALL-EXAMPLE";
const BALL_BOOKING = {
  reference: BALL_REF,
  kind: "seat",
  quantity: 2,
  seats: 2,
  buyerName: "Alex Example",
  buyerFirstName: "Alex",
  buyerSurname: "Example",
  buyerEmail: "alex@example.com",
  ticketsPence: 45000,
  donationPence: 0,
  feeCoverPence: 0,
  totalPence: 45000,
  giftAid: false,
  newsletterOptIn: false,
  stripeSessionId: "example",
};
const ballBooking = (o: Partial<typeof BALL_BOOKING> = {}) => ({ ...BALL_BOOKING, ...o }) as unknown as BallBooking;
const guestLink = (b: string) => `${b}/ball/guests/example`;
const invoiceUrl = (b: string) => `${b}/ball/invoice/example`;
const ballConfirm = (booking: Partial<typeof BALL_BOOKING> = {}, details: (b: string) => Partial<BallDetails> = () => ({})) => (b: string) =>
  buildBallConfirmationEmail(ballBooking(booking), { arrivalTime: null, includedNote: null, guestLink: guestLink(b), calendarUrl: `${b}/ball/calendar.ics`, ...details(b) } as BallDetails);
const GUESTS = [
  { fullName: "Alex Example", dietary: "Vegetarian", accessNeeds: null },
  { fullName: "Robin Example", dietary: null, accessNeeds: null },
];
type ReminderBookingIn = Parameters<typeof buildBallReminderEmail>[0];
type ReminderGuests = Parameters<typeof buildBallReminderEmail>[1];
type ReminderDetailsIn = Parameters<typeof buildBallReminderEmail>[2];
const ballReminder = (booking: Partial<ReminderBookingIn> = {}, guests: typeof GUESTS = GUESTS, details: Partial<ReminderDetailsIn> = {}) => (b: string) =>
  buildBallReminderEmail(
    { reference: BALL_REF, buyerName: "Alex Example", buyerFirstName: "Alex", seats: 2, tableName: null, ...booking } as ReminderBookingIn,
    guests as ReminderGuests,
    { arrivalTime: null, includedNote: null, guestLink: guestLink(b), ...details } as ReminderDetailsIn,
  );
const LOCK = new Date("2026-10-23T12:00:00Z");
type SummaryIn = Parameters<typeof buildGuestSummaryEmail>[0];
const guestSummary = (o: Partial<SummaryIn> = {}) => (b: string) =>
  buildGuestSummaryEmail({ buyerFirstName: "Alex", reference: BALL_REF, seats: 2, guests: GUESTS, guestLink: guestLink(b), lockAt: LOCK, ...o } as SummaryIn);
type ChaseIn = Parameters<typeof buildGuestChaseEmail>[0];
const chase = (o: Partial<ChaseIn> = {}) => (b: string) =>
  buildGuestChaseEmail({ buyerFirstName: "Alex", reference: BALL_REF, seats: 10, guestsNamed: 4, guestLink: guestLink(b), lockAt: LOCK, finalCall: false, ...o } as ChaseIn);
type MenuIn = Parameters<typeof buildMenuReadyEmail>[0];
const MENU = [
  { name: "Starter", options: ["Example soup (v)", "Example pâté"] },
  { name: "Main", options: ["Example roast", "Example risotto (v)"] },
  { name: "Dessert", options: ["Example pudding"] },
  { name: "Coffee and mints", options: [] },
];
const menu = (m: unknown = MENU, note: string | null = "(v) vegetarian") => (b: string) =>
  buildMenuReadyEmail({ buyerFirstName: "Alex", reference: BALL_REF, guestLink: guestLink(b), menu: m, menuNote: note } as MenuIn);
const BANK = { accountName: "Example Charity Account", sortCode: "00-00-00", accountNumber: "00000000" } as Parameters<typeof buildTransferDetailsEmail>[1];
const PAY_BY = "2026-10-22";
type TransferBooking = Parameters<typeof buildTransferDetailsEmail>[0];
const transferBooking = (o: Partial<typeof BALL_BOOKING> = {}) => ({ ...BALL_BOOKING, ...o }) as unknown as TransferBooking;
const SALES = {
  totalSeats: 300,
  seatsSold: 120,
  tablesSold: 8,
  singleSeatsSold: 40,
  seatsRemaining: 170,
  tablesRemaining: 12,
  heldSeats: 10,
  soldSinceLast: 14,
  soldLast7Days: 22,
  soldPrevious7Days: 18,
  waitingList: 0,
  waitingSeats: 0,
  awaitingTransfers: 2,
  awaitingTransferSeats: 12,
};
type SalesIn = Parameters<typeof renderReport>[0];
type ReportCtx = Parameters<typeof renderReport>[1];
const report = (i: Record<string, unknown> = {}, c: Partial<ReportCtx> = {}) => () =>
  renderReport({ ...SALES, ...i } as unknown as SalesIn, { today: "2026-10-05", eventDate: "2026-11-07", test: false, ...c } as ReportCtx);

const STAFF_WORDS_NOTE = "The arrival time and the note about what is included are typed by staff. Pick that version to see them, with example words.";
const BALL_KIND = ["ballTransfer"];

const BALL: CatalogueEmail[] = [
  {
    id: "ball-confirmation",
    group: "ball",
    name: "You're coming to the ball",
    who: "Goes to the person who booked, when they pay by card or when their bank transfer is marked as arrived.",
    audience: "public",
    logKinds: ["ballConfirmation"],
    note: STAFF_WORDS_NOTE,
    versions: [
      v("usual", USUAL, ballConfirm()),
      v("donation-fee", "They added a donation and covered the card fee", ballConfirm({ donationPence: 2100, feeCoverPence: 777, totalPence: 47877 })),
      v("donation-gift-aid", "They added a donation with Gift Aid", ballConfirm({ donationPence: 2100, totalPence: 47100, giftAid: true })),
      v("staff-words", "With the arrival time and the what is included note (example words)", ballConfirm({}, () => ({ arrivalTime: "Arrival from 6.30pm, dinner at 7.30pm", includedNote: "A vegetarian option is available." }))),
      v("transfer", "Paid by bank transfer, with an invoice", ballConfirm({}, (b) => ({ transferArrived: true, invoiceUrl: invoiceUrl(b) }) as Partial<BallDetails>)),
      v("no-guest-link", "No guest link could be made", ballConfirm({}, () => ({ guestLink: null }) as Partial<BallDetails>)),
    ],
  },
  {
    id: "ball-transfer-details",
    group: "ball",
    name: "How to pay by bank transfer",
    who: "Goes to the person who booked to pay by bank transfer, as soon as they book. The company's accounts address is copied in, if they gave one.",
    audience: "public",
    logKinds: BALL_KIND,
    versions: [
      v("usual", USUAL, () => buildTransferDetailsEmail(transferBooking(), BANK, PAY_BY, {})),
      v("invoice", "They asked for an invoice", (b) => buildTransferDetailsEmail(transferBooking(), BANK, PAY_BY, { invoiceUrl: invoiceUrl(b) })),
      v("donation-gift-aid", "They added a donation with Gift Aid", () => buildTransferDetailsEmail(transferBooking({ donationPence: 2100, totalPence: 47100, giftAid: true }), BANK, PAY_BY, {})),
    ],
  },
  {
    id: "ball-transfer-reminder",
    group: "ball",
    name: "Reminder to pay by bank transfer",
    who: "Goes to the person who booked, two days before their pay-by date, if the money has not arrived.",
    audience: "public",
    logKinds: BALL_KIND,
    versions: [
      v("usual", USUAL, () => buildTransferReminderEmail(transferBooking(), BANK, PAY_BY, {})),
      v("invoice", "They asked for an invoice", (b) => buildTransferReminderEmail(transferBooking(), BANK, PAY_BY, { invoiceUrl: invoiceUrl(b) })),
    ],
  },
  {
    id: "ball-transfer-cancelled",
    group: "ball",
    name: "Your booking has been cancelled",
    who: "Goes to the person who booked, when staff cancel an unpaid bank transfer booking.",
    audience: "public",
    logKinds: BALL_KIND,
    versions: [
      v("usual", USUAL, () => buildTransferCancelledEmail(transferBooking(), {})),
      v("invoice", "They asked for an invoice", (b) => buildTransferCancelledEmail(transferBooking(), { invoiceUrl: invoiceUrl(b) })),
    ],
  },
  {
    id: "ball-invoice-paid",
    group: "ball",
    name: "Payment received (to the accounts team)",
    who: "Goes to the company's accounts address, when a bank transfer with an invoice is marked as arrived.",
    audience: "public",
    logKinds: BALL_KIND,
    versions: [v("usual", USUAL, (b) => buildInvoicePaidEmail(transferBooking(), { invoiceUrl: invoiceUrl(b) }))],
  },
  {
    id: "ball-guest-list",
    group: "ball",
    name: "Your guest list",
    who: "Goes to the person who booked, each time they save their guest list.",
    audience: "public",
    logKinds: ["ballRunUp"],
    versions: [
      v("usual", "Every place has a name", guestSummary()),
      v("places-left", "Some places still to fill", guestSummary({ seats: 4 })),
      v("no-closing-date", "One place still to fill, and no closing date set", guestSummary({ seats: 3, lockAt: null })),
    ],
  },
  {
    id: "ball-guest-chase",
    group: "ball",
    name: "We still need your guest list",
    who: "Goes to the person who booked, from 14 days before the guest list closes, if places still have no name.",
    audience: "public",
    logKinds: ["ballRunUp"],
    versions: [
      v("usual", "Some guests named", chase()),
      v("nobody", "They have not named anyone yet", chase({ guestsNamed: 0 })),
      v("nobody-one-ticket", "They have not named anyone, and booked one ticket", chase({ guestsNamed: 0, seats: 1 })),
    ],
  },
  {
    id: "ball-guest-last-call",
    group: "ball",
    name: "Last call for your guest list",
    who: "Goes to the person who booked, on the day the guest list closes, if places still have no name.",
    audience: "public",
    logKinds: ["ballRunUp"],
    versions: [v("usual", "Some guests named", chase({ finalCall: true })), v("nobody", "They have not named anyone yet", chase({ finalCall: true, guestsNamed: 0 }))],
  },
  {
    id: "ball-menu",
    group: "ball",
    name: "The menu is here",
    who: "Goes to everyone who has paid, when staff press “Send the menu email”.",
    audience: "public",
    logKinds: ["ballRunUp"],
    note: "The menu and the note under it are typed by staff. The ones here are an example.",
    versions: [v("usual", "A menu with choices", menu()), v("fixed", "A menu with nothing to choose", menu([{ name: "Main", options: ["Example roast"] }], null))],
  },
  {
    id: "ball-week-to-go",
    group: "ball",
    name: "A week to go",
    who: "Goes to everyone who has paid, a week before the Ball (the morning after, for a booking paid in the last week), or when staff press “Send the reminder”.",
    audience: "public",
    logKinds: ["ballRunUp", "ballReminder"],
    note: "The arrival time and the table name are typed by staff. Pick that version to see them, with example words.",
    versions: [
      v("usual", "Every place has a name", ballReminder()),
      v("places-left", "Some places still have no name", ballReminder({ seats: 4 })),
      v("no-guests", "No guest names given at all", ballReminder({}, [])),
      v("staff-words", "With the arrival time and a table name (example words)", ballReminder({ tableName: "Table 4" }, GUESTS, { arrivalTime: "Arrival from 6.30pm" })),
      v("by-button", "Sent with the button in the admin (it uses their whole name)", ballReminder({ buyerFirstName: null })),
      // The charity, 2026-10-04: it says the true time to go when it is not sent a week before.
      v("days-to-go", "A few days to go (someone who booked in the last week)", ballReminder({}, GUESTS, { daysToGo: 4 })),
      v("tomorrow", "Tomorrow (sent the day before the Ball)", ballReminder({}, GUESTS, { daysToGo: 1 })),
      v("today", "Today (only if staff press the button on the day of the Ball)", ballReminder({}, GUESTS, { daysToGo: 0 })),
      v("early", "More than a week to go (staff pressed the button early)", ballReminder({}, GUESTS, { daysToGo: 10 })),
    ],
  },
  {
    id: "ball-report",
    group: "ball",
    name: "Festive Ball ticket report",
    who: "Goes to the people on the report list, on Mondays and Thursdays at 8am.",
    audience: "staff",
    logKinds: ["ballReport"],
    note: NUMBERS_NOTE,
    versions: [
      v("usual", USUAL, report()),
      v("first", "The first report, with a waiting list", report({ soldSinceLast: null, awaitingTransfers: 0, awaitingTransferSeats: 0, waitingList: 3, waitingSeats: 8, tablesRemaining: 0, heldSeats: 0 })),
      v("sold-out", "Sold out, and the last report before the Ball", report({ seatsRemaining: 0, tablesRemaining: 0 }, { today: "2026-11-05" })),
      v("test", "A test sent from the admin", report({}, { test: true })),
    ],
  },
];

// --- staff notices ---------------------------------------------------------------------------------

const admin = (b: string) => ({ adminUrl: `${b}/admin` });
const WANTS = { posterCount: 10, leafletCount: 20, bucketCount: 1, tinCount: 2, leaflets: 0, buckets: 0, qrCount: 5, shoutOut: true, attend: true };
const SIGN_UP = {
  id: 1,
  path: "raising",
  kind: "santa",
  kindLabel: "Santa dash",
  kindOther: null,
  title: PAGE,
  description: "I am running the Santa dash in full costume to help children this Christmas.",
  eventDate: "2026-12-05",
  startTime: "10:00",
  endTime: null,
  timeTbc: false,
  dateTbc: false,
  venue: "Example Park",
  town: "Exampleton",
  targetPence: 50000,
  public: true,
  listed: true,
  name: SAM.name,
  firstName: "Sam",
  lastName: "Example",
  email: "sam@example.com",
  phone: "07700 900000",
  instagram: "@example",
  facebook: null,
  socialOk: true,
  wants: WANTS,
  newsletterOk: true,
  over18: true,
  sharesWithOther: false,
  isSporting: true,
  tshirtSize: "adult_m",
  callTime: "Weekday evenings",
  postLine1: "1 Example Road",
  postLine2: null,
  postTown: "Exampleton",
  postPostcode: "EX1 1EX",
};
const signUpNotice = (o: Record<string, unknown> = {}) => (b: string) => buildSignUpStaffEmail({ ...SIGN_UP, ...o } as unknown as StaffSummary, admin(b));
const MEMORY_SIGN_UP = {
  inMemory: true,
  memoryName: MEMORY_NAME,
  isSporting: null,
  tshirtSize: null,
  over18: null,
  sharesWithOther: null,
  eventDate: null,
  startTime: null,
  venue: "",
  town: "",
  wants: { ...WANTS, posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, envelopeCount: 50, shoutOut: false, attend: false },
};
const joinNotice = (targetPence: number | null, split: string) => (b: string) =>
  buildJoinStaffEmail(
    { name: "Alex Example", email: "alex@example.com", title: "Alex's Santa Dash", targetPence, description: "I am joining to run with my friends." },
    { title: TEAM_TITLE, name: SAM.name },
    { ...admin(b), split },
  );
const COUNTS = {
  week: { from: "2026-09-28", to: "2026-10-04" },
  today: "2026-10-05",
  onlinePence: 45000,
  paidInPence: 10000,
  cashPence: 2500,
  giftAidPence: 5000,
  raisedPence: 57500,
  liveCount: 12,
  totalRaisedPence: 345600,
  newSignUps: [
    { title: PAGE, path: "raising", town: "Exampleton" },
    { title: "Example coffee morning", path: "event", town: "Exampleton" },
  ],
  toApprove: 2,
  changesToCheck: 1,
  newsToCheck: 3,
  thanksToCheck: 1,
  photosToCheck: 2,
  materials: { posters: 10, leaflets: 20, buckets: 1, tins: 2, leafletsOrPosters: 5, bucketsOrTins: 1, qrCodes: 5 },
  materialsFundraisers: 2,
  shoutOuts: 1,
  attend: ["2026-12-05", null],
  notBack: 4,
  notBackDue: 1,
  dueBackRequests: 1,
  callsDue: 2,
  invitesNotTaken: [
    { name: "Mary", signedBy: "Robin", type: "memory" },
    { name: "Jo", signedBy: "Robin" },
  ],
  pastDate: 2,
  saysFinished: 1,
  comingUp: [{ date: "2026-10-10", title: PAGE, town: "Exampleton" }],
  prompts: { behind: 1, ahead: 1, onTrack: 2, quiet: 1, materials: 1 },
  teamMembersToApprove: 1,
  teamsNobodyJoined: ["The Example Runners", "Team Example"],
  messagesToCheck: 2,
  memoryYearOn: 1,
  pledgesUnpaid: 3,
  pledgesPaidTwice: 1,
  packsToSend: 2,
  tshirtWaiting: 1,
  memoryToSend: 1,
  waiting: 38,
};
const QUIET = {
  ...COUNTS,
  onlinePence: 0,
  paidInPence: 0,
  cashPence: 0,
  giftAidPence: 0,
  raisedPence: 0,
  liveCount: 1,
  totalRaisedPence: 0,
  newSignUps: [],
  toApprove: 0,
  changesToCheck: 0,
  newsToCheck: 0,
  thanksToCheck: 0,
  photosToCheck: 0,
  materials: { posters: 0, leaflets: 0, buckets: 0, tins: 0, leafletsOrPosters: 0, bucketsOrTins: 0 },
  materialsFundraisers: 0,
  shoutOuts: 0,
  attend: [],
  notBack: 0,
  notBackDue: 0,
  dueBackRequests: 0,
  callsDue: 0,
  invitesNotTaken: [],
  pastDate: 0,
  saysFinished: 0,
  comingUp: [],
  prompts: { behind: 0, ahead: 0, onTrack: 0, quiet: 0, materials: 0 },
  teamMembersToApprove: 0,
  teamsNobodyJoined: [],
  messagesToCheck: 0,
  memoryYearOn: 0,
  pledgesUnpaid: 0,
  pledgesPaidTwice: 0,
  packsToSend: 0,
  tshirtWaiting: 0,
  memoryToSend: 0,
  waiting: 0,
};
const summary = (c: unknown, test = false) => (b: string) => buildSummaryEmail(summaryLines(c as SummaryCounts), { ...admin(b), test });
const pledgeNote = (n: { subject: string; lines: string[] }) => (b: string) => buildPledgeStaffEmail({ ...n, ...admin(b) });
const TWICE = [
  { title: PAGE, pledgeId: 42, amountPence: 1000, cashMarked: false },
  { title: PAGE, pledgeId: 43, amountPence: 1000, cashMarked: true },
];
const HOST = { title: EVENT_TITLE, organiserName: SAM.name };
type ProposedIn = Parameters<typeof buildTicketsProposedStaffEmail>[1];
const proposed = (o: ProposedIn) => (b: string) => buildTicketsProposedStaffEmail(HOST, o, admin(b));
const ballTransferNotice = (booking: Record<string, unknown> = {}, o: (b: string) => Record<string, unknown> = () => ({})) => (b: string) =>
  buildTransferStaffEmail(
    { ...BALL_BOOKING, buyerPhone: "07700 900000", ...booking } as unknown as Parameters<typeof buildTransferStaffEmail>[0],
    { payBy: PAY_BY, ...admin(b), invoice: null, addedBy: null, ...o(b) } as Parameters<typeof buildTransferStaffEmail>[1],
  );
const EVENTS_INBOX = "Goes to NBCC staff, at the events inbox,";
const staff = (id: string, name: string, when: string, logKind: string, versions: CatalogueVersion[], note = STAFF_NOTE): CatalogueEmail => ({
  id,
  group: "staff",
  name,
  who: `${EVENTS_INBOX} ${when}`,
  audience: "staff",
  logKinds: [logKind],
  note,
  versions,
});

const STAFF: CatalogueEmail[] = [
  staff("staff-signup", "New fundraiser", "when someone signs up.", "fundraiseStaff", [
    v("usual", "Someone raising money", signUpNotice()),
    v("team", "A team's sign up, sharing with another cause", signUpNotice({
      tshirtSize: null,
      sharesWithOther: true,
      nbccSharePercent: 60,
      otherCauseName: "Example Hospice",
      team: { isTeam: true, shareMode: "team", members: [{ firstName: "Alex", lastName: "Example", email: "alex@example.com" }, { firstName: "Robin", lastName: "Example", email: "robin@example.com" }] },
    })),
    v("event", "Someone holding an event", signUpNotice({
      path: "event",
      title: EVENT_TITLE,
      kind: "fair",
      kindLabel: "Christmas fair",
      description: "A festive fair with stalls, home baking and a visit from Santa.",
      targetPence: null,
      isSporting: null,
      tshirtSize: null,
      endTime: "12:00",
      cardLine: "A festive fair for all the family",
      venueAddress: "1 Example Road, Exampleton",
      venuePostcode: "EX1 1EX",
      access: ["step free entry", "accessible toilets"],
      price: "£5 on the door",
      booking: "door",
      ageLimit: "All ages",
      dressCode: "Christmas jumpers",
      included: "Tea and cake",
      creditName: "Example Community Group",
      wants: { ...WANTS, attend: false },
      socialOk: false,
      listed: false,
    })),
  ]),
  staff("staff-signup-memory", "New page in memory of someone", "when someone signs up a page in memory.", "fundraiseStaff", [
    v("usual", "Set up by family or a friend", signUpNotice({ ...MEMORY_SIGN_UP, memoryDates: "1950 to 2026", memorySetupBy: "family", memoryFamilyContactName: "Alex Example", memoryFamilyContactEmail: "alex@example.com" })),
    v("director", "Set up by a funeral director", signUpNotice({ ...MEMORY_SIGN_UP, memoryDates: null, memorySetupBy: "funeral_director", memoryDirectorBusiness: "Example Funeral Directors", targetPence: null })),
  ]),
  staff("staff-finished", "A fundraiser says they've finished", "when a fundraiser presses “I've finished”.", "fundraiseFinishedStaff", [
    v("usual", USUAL, (b) => buildFinishedStaffEmail({ id: 1, name: SAM.name, title: PAGE, email: "sam@example.com", raisedPence: 61200 }, admin(b))),
  ]),
  staff("staff-team-joined", "New team member", "when someone joins a team.", "fundraiseTeamJoinStaff", [
    v("usual", USUAL, joinNotice(20000, "No, all of it comes to NBCC")),
    v("sharing", "No target, and sharing with another cause as the whole team does", joinNotice(null, "60% to NBCC, the rest to Example Hospice (the whole team’s split)")),
  ]),
  staff("staff-team-removed", "Someone was taken off a team", "when a team organiser removes a member.", "fundraiseTeamMemberRemoved", [
    v("usual", USUAL, (b) => buildMemberRemovedStaffEmail({ memberName: "Alex Example", teamTitle: TEAM_TITLE, organiserName: SAM.name }, admin(b))),
  ]),
  {
    ...staff("staff-summary", "Monday staff summary", "", "fundraiseSummary", [
      v("usual", "A busy week", summary(COUNTS)),
      v("quiet", "A quiet week with nothing waiting", summary(QUIET)),
      v("test", "A test sent from the admin", summary(COUNTS, true)),
    ], NUMBERS_NOTE),
    who: "Goes to the people chosen in Weekly summary, on Mondays at 8am.",
  },
  staff("staff-pledge-hidden", "A pledge was hidden by its organiser", "when a fundraiser hides a pledge from their page.", "fundraisePledgeStaff", [
    v("usual", USUAL, pledgeNote(pledgeHiddenNote({ title: PAGE, pledgeId: 42, amountPence: 1000 }))),
  ]),
  staff("staff-pledge-twice", "Pledges paid twice: check and refund", "when a pledge is paid twice.", "fundraisePledgeStaff", [
    v("usual", "Two pledges", pledgeNote(pledgesPaidTwiceNote(TWICE))),
    v("one", "Only one pledge", pledgeNote(pledgesPaidTwiceNote(TWICE.slice(0, 1)))),
  ]),
  staff("staff-tickets-to-approve", "Tickets to approve", "when a host proposes tickets.", "eventTicketsToApprove", [
    v("usual", "A limit on tickets, closing the day before", proposed({ types: [{ name: "Adult", pricePence: 1300, quantity: 50 }, { name: "Child", pricePence: 0, quantity: null }], salesLimit: 80, close: { mode: "day_before", at: null } })),
    v("no-limit", "No limit, closing when the event starts", proposed({ types: [{ name: "Adult", pricePence: 1300, quantity: 50 }], salesLimit: null, close: { mode: "start", at: null } })),
    v("custom-close", "Sales close at a time the host chose", proposed({ types: [{ name: "Adult", pricePence: 1300, quantity: 50 }], salesLimit: 80, close: { mode: "custom", at: "2026-12-04T17:00:00Z" } })),
  ]),
  staff("staff-ticket-refund-asked", "A refund has been asked for", "when a host asks for a refund.", "eventTicketsRefundAsked", [
    v("usual", USUAL, (b) => buildRefundRequestStaffEmail(HOST, { reference: REF, buyerName: "Alex Example", tickets: "2 Adult", reason: "They can no longer come, and asked me for their money back." }, admin(b))),
  ]),
  staff("staff-ticket-check", "A ticket booking to check", "when a ticket booking needs a look.", "eventTicketsToCheck", [
    v("usual", "Every reason it can be flagged for", (b) =>
      buildOrderFlagStaffEmail(
        { title: EVENT_TITLE },
        { reference: REF, buyerName: "Alex Example", tickets: "2 Adult", paid: "£26" },
        flagWords({ paidLate: { overBy: 3 }, amountMismatch: { expected: 2600, paid: 2000 }, sessionMismatch: true, currencyMismatch: "eur", disputed: true, refundFailed: true }),
        admin(b),
      )),
    v("refund-failed", "A refund failed after the tickets were released", (b) =>
      buildOrderFlagStaffEmail(
        { title: EVENT_TITLE },
        { reference: REF, buyerName: "Alex Example", tickets: "", paid: "£26" },
        flagWords({ refundFailed: { released: true, overBy: 2 } }),
        // As ./send.ts sends it for a failed refund: it never says the buyer has their tickets email.
        { ...admin(b), refundFailed: true },
      )),
  ]),
  staff("staff-ticket-unknown", "A ticket payment with no booking", "if a ticket payment arrives with no matching booking.", "eventTicketsToCheck", [
    v("usual", USUAL, (b) => buildUnknownPaymentStaffEmail({ reference: REF, sessionId: "cs_test_example", amountTotal: 2600 }, admin(b))),
    v("no-amount", "Stripe gave no amount", (b) => buildUnknownPaymentStaffEmail({ reference: REF, sessionId: "cs_test_example", amountTotal: null }, admin(b))),
  ]),
  staff("staff-ball-transfer", "New bank transfer booking (Festive Ball)", "when someone books the Ball by bank transfer.", "ballTransferStaff", [
    v("usual", USUAL, ballTransferNotice()),
    v("invoice", "They asked for an invoice, and staff added the booking", ballTransferNotice({}, (b) => ({ invoice: { company: "Example Company Ltd", url: invoiceUrl(b) }, addedBy: "robin@example.com" }))),
    v("no-phone", "No phone number was given", ballTransferNotice({ buyerPhone: null })),
  ]),
];

/** Every email, in the order it is shown. */
export const CATALOGUE: ReadonlyArray<CatalogueEmail> = [...SIGNUP, ...INVITES, ...TEAMS, ...TOUCH, ...FINISHING, ...MEMORY, ...PLEDGES, ...EVENTS, ...BALL, ...STAFF];

// --- reading it ------------------------------------------------------------------------------------

const BY_ID = new Map(CATALOGUE.map((e) => [e.id, e]));

export function findEmail(id: unknown): CatalogueEmail | null {
  return typeof id === "string" ? (BY_ID.get(id) ?? null) : null;
}

export function findVersion(email: CatalogueEmail, id: unknown): CatalogueVersion | null {
  return email.versions.find((x) => x.id === id) ?? null;
}

/** Subject and HTML only: the plain text part is never shown. */
export function renderVersion(email: CatalogueEmail, version: CatalogueVersion, base: string): Rendered {
  const mail = version.render(base.replace(/\/+$/, ""));
  return { subject: mail.subject, html: mail.html };
}

/** Every approval key the catalogue points at, once each. */
export function catalogueApprovalKeys(): string[] {
  const keys = new Set<string>();
  for (const e of CATALOGUE) for (const x of e.versions) if (x.approval) keys.add(x.approval.key);
  return [...keys];
}

/**
 * The label on an email's row: nothing when none of it is approval gated, "waiting" (and the first
 * version still to be signed off) while any of it is, "approved" once all of it has been.
 */
export function emailState(email: CatalogueEmail, approved: ReadonlySet<string>): { state: "approved" | "waiting" | null; waitingVersion: string | null } {
  const gated = email.versions.filter((x) => x.approval);
  if (gated.length === 0) return { state: null, waitingVersion: null };
  const waiting = gated.find((x) => !approved.has(x.approval!.key));
  return waiting ? { state: "waiting", waitingVersion: waiting.id } : { state: "approved", waitingVersion: null };
}
