import { describe, it, expect } from "vitest";
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
} from "../../src/fundraising/emails";
import { buildMemoryReceiptEmail, buildTshirtAskEmail } from "../../src/fundraising/signup-tidy-emails";
import { buildInMemoryApprovedEmail } from "../../src/fundraising/memory-emails";
import { buildSupporterThanksEmail } from "../../src/fundraising/thanks-email";
import { buildInviteEmail, buildSummaryEmail } from "../../src/fundraising/team-emails";
import {
  buildHandoverCodeEmail,
  buildJoinStaffEmail,
  buildJoinThanksEmail,
  buildMemberRemovedStaffEmail,
  buildTeamInviteEmail,
  buildTeamInviteReminderEmail,
  buildTeamLiveEmail,
  buildTeamNudgeEmail,
} from "../../src/fundraising/team-page-emails";
import { buildTouchEmail, touchUrls } from "../../src/fundraising/touch-emails";
import { TOUCH_KINDS } from "../../src/fundraising/touch-rules";
import { summaryLines } from "../../src/fundraising/summary";
import { buildPledgeConfirmEmail, buildPledgeEmail, buildPledgeStaffEmail } from "../../src/pledges/emails";
import {
  buildBookingCancelledEmail,
  buildOrderFlagStaffEmail,
  buildRefundRequestStaffEmail,
  buildTicketConfirmationEmail,
  buildTicketRefundEmail,
  buildTicketsProposedStaffEmail,
  buildTicketsReleasedEmail,
  buildUnknownPaymentStaffEmail,
} from "../../src/tickets/emails";
import { flagWords } from "../../src/tickets/model";

// One style across the fundraising, team, in memory, pledge, event ticket and staff
// emails (Jaimie, 2026-10-04). Every one is built here with invented details, and each rule below is
// checked against every part of every one: the subject, the HTML and the plain text.
//
// The two receipts (money paid in, a paid pledge) are donation receipts and are not in this list.
// Nor are the Festive Ball emails (46 to 56) or the Ball's staff notice (69): by the charity's
// decision they stay exactly as they are until after the Ball on 7 November 2026.

const BASE = "https://nbcc.example.com";
const ADMIN = { adminUrl: `${BASE}/admin` };
const ORG = { name: "Sam Example", firstName: "Sam", creditName: null };
const CHILD = { name: "Jack Example", firstName: "Jack", guardianFirstName: "Sarah" };
const TEAM = { title: "Team Tinsel", kind: "santa", kindLabel: "Santa dash", kindOther: null, eventDate: "2026-12-05" };

type Mail = { subject: string; html: string; text?: string };
const mails: Array<[string, Mail]> = [];
const add = (name: string, mail: Mail) => mails.push([name, mail]);

// --- signing up, approval and changes
add("1 thanks", buildSignUpThanksEmail("Sam Example"));
add("2 page live", buildApprovedEmail({ ...ORG, title: "Sam's Santa Dash", path: "raising" }, { pageUrl: `${BASE}/fundraise/sam`, manageUrl: `${BASE}/fundraise/manage` }));
add("3 on our list", buildApprovedEmail({ ...ORG, title: "Sam's Santa Dash", path: "raising" }, { pageUrl: null, manageUrl: null }));
add("4 code", buildSignInCodeEmail("Sam Example", "123456"));
add("4 code, in memory", buildSignInCodeEmail("Sam Example", "123456", { gentle: true }));
add("5 edit approved", buildEditApprovedEmail({ ...ORG, title: "Sam's Santa Dash" }, { pageUrl: `${BASE}/fundraise/sam` }));
add("6 edit rejected", buildEditRejectedEmail({ ...ORG, title: "Sam's Santa Dash" }, { pageLive: true }));
add("7 news approved", buildNewsApprovedEmail({ ...ORG, title: "Sam's Santa Dash" }, { pageUrl: `${BASE}/fundraise/sam` }));
add("8 news rejected", buildNewsRejectedEmail({ ...ORG, title: "Sam's Santa Dash" }, { pageLive: true }));
add("9 T-shirt", buildTshirtAskEmail("Sam", `${BASE}/fundraise/tshirt?t=x`));
for (const type of ["raising", "team", "event", "memory"] as const) {
  add(`10 to 13 invite, ${type}`, buildInviteEmail({ firstName: "Sam", note: "Lovely to meet you.", signer: "Fern", url: `${BASE}/fundraise?invite=x`, type }));
}

// --- teams
add("14 team live", buildTeamLiveEmail({ ...TEAM, ...ORG }, { pageUrl: `${BASE}/fundraise/team-tinsel`, manageUrl: `${BASE}/fundraise/manage`, joinUrl: `${BASE}/fundraise/team-tinsel/join`, invited: 3 }));
const invite = (over: object = {}) => ({ firstName: "Alex", organiserName: "Robin Example", organiserFirstName: "Robin", under18: false, team: TEAM, joinUrl: `${BASE}/j?invite=x`, ...over });
add("15 team invite", buildTeamInviteEmail(invite()));
add("16 team invite, under 18", buildTeamInviteEmail(invite({ firstName: "Jack", under18: true })));
add("17 team reminder", buildTeamInviteReminderEmail(invite()));
add("18 team reminder, under 18", buildTeamInviteReminderEmail(invite({ firstName: "Jack", under18: true })));
add("19 nudge 1", buildTeamNudgeEmail(1, { ...ORG, title: "Team Tinsel", pageUrl: `${BASE}/fundraise/team-tinsel`, joinUrl: `${BASE}/fundraise/team-tinsel/join` }));
add("20 nudge 2", buildTeamNudgeEmail(2, { ...ORG, title: "Team Tinsel", pageUrl: `${BASE}/fundraise/team-tinsel`, joinUrl: `${BASE}/fundraise/team-tinsel/join` }));
add("21 join thanks", buildJoinThanksEmail("Alex", "Team Tinsel"));
add("22 handover", buildHandoverCodeEmail({ firstName: "Alex", teamTitle: "Team Tinsel", code: "123456", manageUrl: `${BASE}/fundraise/manage` }));

// --- keeping in touch, to an adult and to a parent
const touch = (over: object = {}) => ({ ...ORG, guardianFirstName: null, title: "Sam's Santa Dash", raisedPence: 12350, targetPence: 50000, urls: touchUrls(BASE, { id: 7, slug: "sam" }), ...over });
for (const kind of TOUCH_KINDS) {
  add(`touch ${kind}`, buildTouchEmail(kind, touch()));
  add(`touch ${kind}, nothing raised`, buildTouchEmail(kind, touch({ raisedPence: 0 })));
  add(`touch ${kind}, to a parent`, buildTouchEmail(kind, touch(CHILD)));
}

// --- finishing, and in memory
add("33 supporter thanks", buildSupporterThanksEmail({ organiserName: "Sam Example", title: "Sam's Santa Dash", message: "Thank you all." }));
add("33 supporter thanks, in memory", buildSupporterThanksEmail({ organiserName: "Sam Example", title: "For Pat", message: "Thank you all.", inMemory: true }));
add("34 memory receipt", buildMemoryReceiptEmail("Sam Example"));
add("35 memory live", buildInMemoryApprovedEmail({ name: "Sam Example", firstName: "Sam", memoryName: "Pat Example", setupBy: "family" }, { pageUrl: `${BASE}/fundraise/pat` }));
add("36 memory live, funeral director", buildInMemoryApprovedEmail({ name: "Sam Example", firstName: "Sam", memoryName: "Pat Example", setupBy: "funeral_director" }, { pageUrl: `${BASE}/fundraise/pat` }));

// --- sponsor pledges
const PLEDGE = { sponsorFirstName: "Alex", organiserName: "James Example", title: "Sam's Santa Dash", amountPence: 1000, giftAid: true, pledgedAt: "2026-11-01T10:00:00.000Z", payUrl: `${BASE}/pledge/pay?t=x`, cancelUrl: `${BASE}/pledge/cancel?t=x` };
add("37 pledge confirm", buildPledgeConfirmEmail({ ...PLEDGE, confirmUrl: `${BASE}/pledge/confirm?t=x` }));
add("38 pledge pay", buildPledgeEmail("pledge_pay", PLEDGE));
add("38 pledge pay, no names", buildPledgeEmail("pledge_pay", { ...PLEDGE, sponsorFirstName: "x1", organiserName: "4x4 Club" }));
add("39 pledge reminder", buildPledgeEmail("pledge_reminder", PLEDGE));

// --- event tickets
const EVENT = { title: "Festive Quiz", eventDate: "2026-12-05", startTime: "19:30", endTime: "22:30", timeTbc: false, where: "Example Hall, 1 Example Road, Exampleton, EX1 1EX", organisedBy: "Example Group", pageUrl: `${BASE}/event/quiz` };
const LINE = { id: 1, typeName: "Adult", unitPence: 1300, quantity: 2, refundedQuantity: 0 };
add("42 tickets", buildTicketConfirmationEmail(EVENT, { reference: "EXREF", firstName: "Alex", lines: [LINE], ticketsPence: 2600, feeCoverPence: 100, totalPence: 2700 }));
add("43 refund", buildTicketRefundEmail(EVENT, { reference: "EXREF", firstName: "Alex", amountPence: 1300, full: false, standing: "1 Adult" }));
add("44 cancelled", buildBookingCancelledEmail(EVENT, { reference: "EXREF", firstName: "Alex", tickets: "2 Adult" }));
add("45 released", buildTicketsReleasedEmail(EVENT, { reference: "EXREF", firstName: "Alex", released: "1 Adult", standing: "1 Adult" }));

// --- staff notices
const WANTS = { posterCount: 10, leafletCount: 20, bucketCount: 1, tinCount: 2, leaflets: 0, buckets: 0, qrCount: 5, shoutOut: true, attend: true };
const SIGN_UP = {
  id: 1, path: "raising", kind: "santa", kindLabel: "Santa dash", kindOther: null, title: "Sam's Santa Dash", description: "A dash in a Santa suit.", eventDate: "2026-12-05", startTime: "10:00", endTime: null, timeTbc: false, dateTbc: false,
  venue: "Example Park", town: "Exampleton", targetPence: 50000, public: true, listed: true, name: "Sam Example", firstName: "Sam", lastName: "Example", email: "sam@example.com", phone: "07700 900000",
  instagram: "@example", facebook: null, socialOk: true, wants: WANTS, newsletterOk: true, over18: true, sharesWithOther: false,
  postLine1: "1 Example Road", postLine2: null, postTown: "Exampleton", postPostcode: "EX1 1EX",
} as unknown as Parameters<typeof buildSignUpStaffEmail>[0];
add("57 staff sign up", buildSignUpStaffEmail(SIGN_UP, ADMIN));
add("58 staff sign up, in memory", buildSignUpStaffEmail({ ...SIGN_UP, inMemory: true, memoryName: "Pat Example", memorySetupBy: "family" } as typeof SIGN_UP, ADMIN));
add("59 staff finished", buildFinishedStaffEmail({ id: 1, name: "Sam Example", title: "Sam's Santa Dash", email: "sam@example.com", raisedPence: 12300 }, ADMIN));
add("60 staff team join", buildJoinStaffEmail({ name: "Alex Example", email: "alex@example.com", title: "Alex's page", targetPence: 10000, description: "For the team." }, { title: "Team Tinsel", name: "Robin Example" }, { ...ADMIN, split: "No, all of it comes to NBCC" }));
add("61 staff member removed", buildMemberRemovedStaffEmail({ memberName: "Alex Example", teamTitle: "Team Tinsel", organiserName: "Robin Example" }, ADMIN));
const COUNTS = {
  week: { from: "2026-09-28", to: "2026-10-04" }, today: "2026-10-05", onlinePence: 45000, paidInPence: 10000, cashPence: 2500, giftAidPence: 5000, raisedPence: 57500, liveCount: 12, totalRaisedPence: 345600,
  newSignUps: [{ title: "Sam's Santa Dash", path: "raising", town: "Exampleton" }],
  toApprove: 2, changesToCheck: 1, newsToCheck: 3, thanksToCheck: 1, photosToCheck: 2, materials: { posters: 10, leaflets: 20, buckets: 1, tins: 2, leafletsOrPosters: 5, bucketsOrTins: 1, qrCodes: 5 }, materialsFundraisers: 2, shoutOuts: 1,
  attend: ["2026-12-05", null], notBack: 4, notBackDue: 1, dueBackRequests: 1, callsDue: 2, invitesNotTaken: [{ name: "Jo", signedBy: "Fern" }], pastDate: 2, saysFinished: 1,
  comingUp: [{ date: "2026-10-10", title: "Sam's Santa Dash", town: "Exampleton" }], prompts: { behind: 1, ahead: 1, onTrack: 2, quiet: 1, materials: 1 }, teamMembersToApprove: 1, teamsNobodyJoined: ["Team Tinsel"],
  messagesToCheck: 2, memoryYearOn: 1, pledgesUnpaid: 3, pledgesPaidTwice: 1, packsToSend: 2, tshirtWaiting: 1, memoryToSend: 1, waiting: 38,
} as unknown as Parameters<typeof summaryLines>[0];
add("62 staff summary", buildSummaryEmail(summaryLines(COUNTS), { ...ADMIN, test: false }));
add("63 and 64 staff pledge note", buildPledgeStaffEmail({ subject: "A pledge was hidden by its organiser", lines: ["Sam's Santa Dash: pledge 42 (£10) was hidden from the page by its organiser."], ...ADMIN }));
add("65 staff tickets to approve", buildTicketsProposedStaffEmail({ title: "Festive Quiz", organiserName: "Robin Example" }, { types: [{ name: "Adult", pricePence: 1300, quantity: 50 }], salesLimit: 80, close: { mode: "custom", at: "2026-12-04T17:00:00Z" } }, ADMIN));
add("66 staff refund asked", buildRefundRequestStaffEmail({ title: "Festive Quiz", organiserName: "Robin Example" }, { reference: "EXREF", buyerName: "Alex Example", tickets: "2 Adult", reason: "They cannot come." }, ADMIN));
add("67 staff booking to check", buildOrderFlagStaffEmail({ title: "Festive Quiz" }, { reference: "EXREF", buyerName: "Alex Example", tickets: "2 Adult", paid: "£26" }, flagWords({ paidLate: { overBy: 3 }, disputed: true }), ADMIN));
add("67 staff booking to check, a refund failed", buildOrderFlagStaffEmail({ title: "Festive Quiz" }, { reference: "EXREF", buyerName: "Alex Example", tickets: "", paid: "£26" }, flagWords({ refundFailed: { released: true, overBy: 2 } }), { ...ADMIN, refundFailed: true }));
add("68 staff unknown payment", buildUnknownPaymentStaffEmail({ reference: "EXREF", sessionId: "cs_example", amountTotal: 2600 }, ADMIN));

const parts = (m: Mail): Array<[string, string]> => [["subject", m.subject], ["html", m.html], ["text", m.text ?? ""]];
const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
/** The words of an HTML part, with the tags taken out, so a link's address or a style never counts. */
const words = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, "\u00a6");

describe("one style across the fundraising and events emails", () => {
  it("builds every email", () => {
    expect(mails.length).toBeGreaterThan(70);
    for (const [name, m] of mails) expect(m.subject, name).toBeTruthy();
  });

  it("uses straight apostrophes only, in every part", () => {
    for (const [name, m] of mails) for (const [part, s] of parts(m)) expect(s, `${name}, ${part}`).not.toMatch(/[‘’]/);
  });

  it("uses no en or em dashes", () => {
    for (const [name, m] of mails) for (const [part, s] of parts(m)) expect(s, `${name}, ${part}`).not.toMatch(/[–—]/);
  });

  it("writes whole pounds without pence", () => {
    for (const [name, m] of mails) for (const [part, s] of parts(m)) expect(s, `${name}, ${part}`).not.toMatch(/£[\d,]+\.00\b/);
  });

  it("still writes the pence when an amount is not whole", () => {
    expect(buildTouchEmail("first_gift", touch()).html).toContain("£123.50");
  });

  it("writes every date with its ending: plain in a subject and a plain text part", () => {
    const bare = new RegExp(`\\b\\d{1,2} ${MONTH}\\b`);
    for (const [name, m] of mails) {
      expect(m.subject, `${name}, subject`).not.toMatch(bare);
      expect(m.subject, `${name}, subject`).not.toContain("<sup>");
      expect(m.text ?? "", `${name}, text`).not.toMatch(bare);
      expect(m.text ?? "", `${name}, text`).not.toContain("<sup>");
      expect(words(m.html), `${name}, html`).not.toMatch(bare);
    }
  });

  it("raises the ending in an HTML body", () => {
    const unraised = new RegExp(`\\d(?:st|nd|rd|th) ${MONTH}\\b`);
    for (const [name, m] of mails) expect(words(m.html), `${name}, html`).not.toMatch(unraised);
    expect(buildTeamInviteEmail(invite()).html).toContain("Saturday 5<sup>th</sup> December");
    expect(buildTeamInviteEmail(invite()).text).toContain("Saturday 5th December");
  });

  it("never shows a date as it is stored", () => {
    for (const [name, m] of mails) for (const [part, s] of [["html", words(m.html)], ["text", m.text ?? ""]] as const) expect(s, `${name}, ${part}`).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
  });

  it("signs every staff notice off the same way", () => {
    for (const [name, m] of mails) {
      // 58, about a page in memory of someone, is deliberately quiet: "Thank you." with no mark.
      if (!/^(5[79]|6[0-8]) /.test(name)) continue;
      expect(m.text, name).toContain("Thank you!\nNBCC Team");
      expect(words(m.html), name).toMatch(/Thank you!\u00a6+NBCC Team/);
    }
  });
});

