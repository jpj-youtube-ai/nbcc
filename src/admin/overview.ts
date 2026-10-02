// TASK-508: "Needs you" on the admin Overview. The pure rules: every kind of waiting item, its words,
// how urgent it is, and the screen that deals with it. The counts come from
// src/admin/overview-sources.ts; the route is src/routes/admin-overview.ts. Design:
// docs/superpowers/specs/2026-10-03-admin-overview-design.md.
//
// Levels, in Jaimie's order: 1 money or overdue, 2 waiting on a reply, 3 slower deadlines. Within a
// level, the order of NEEDS below. Anything at zero is left out.

export type NeedKey =
  | "transfersOverdue"
  | "monthlyFailing"
  | "giftAidReady"
  | "emailFailures"
  | "fundraisingDueBack"
  | "contactWaiting"
  | "fundraisingNew"
  | "fundraisingChanges"
  | "fundraisingFinished"
  | "fundraisingRequests"
  | "fundraiserCalls"
  | "storiesNew"
  | "businessCalls"
  | "outreachMine"
  | "thankYouLetters"
  | "transfersWaiting"
  | "giftAidAdjustments"
  | "declarationsAwaiting"
  | "declarationsReview"
  | "retentionExpiring"
  | "gasdsDeadline"
  | "ballGuestsMissing";

export type NeedCount = { count: number; pence?: number };
export type NeedCounts = Partial<Record<NeedKey, NeedCount>>;

interface Need {
  key: NeedKey;
  level: 1 | 2 | 3;
  /** The admin screen (its data-view) that deals with it, and that screen's name in the menu. */
  view: string;
  button: string;
  /** The sentence after the number, for one and for more than one. */
  one: string;
  many: string;
}

const BALL = { view: "ball", button: "Festive Ball" };
const FUNDRAISING = { view: "fundraising", button: "Fundraising" };
const CLAIMS = { view: "claims", button: "Claims" };

export const NEEDS: readonly Need[] = [
  // 1. Money or overdue.
  { key: "transfersOverdue", level: 1, ...BALL, one: "bank transfer is overdue", many: "bank transfers are overdue" },
  { key: "monthlyFailing", level: 1, view: "monthly", button: "Monthly givers", one: "monthly gift is failing to take", many: "monthly gifts are failing to take" },
  { key: "giftAidReady", level: 1, ...CLAIMS, one: "donation is ready to claim Gift Aid on", many: "donations are ready to claim Gift Aid on" },
  { key: "emailFailures", level: 1, view: "email-audit", button: "Email audit", one: "email failed or bounced in the last 2 weeks", many: "emails failed or bounced in the last 2 weeks" },
  { key: "fundraisingDueBack", level: 1, ...FUNDRAISING, one: "fundraiser has a bucket or tin due back", many: "fundraisers have buckets or tins due back" },
  // 2. Waiting on a reply.
  { key: "contactWaiting", level: 2, view: "contact", button: "Contact form", one: "contact message is waiting for a reply", many: "contact messages are waiting for a reply" },
  { key: "fundraisingNew", level: 2, ...FUNDRAISING, one: "fundraising sign up is waiting for approval", many: "fundraising sign ups are waiting for approval" },
  { key: "fundraisingChanges", level: 2, ...FUNDRAISING, one: "fundraiser has changes to check", many: "fundraisers have changes to check" },
  { key: "fundraisingFinished", level: 2, ...FUNDRAISING, one: "fundraiser says they've finished", many: "fundraisers say they've finished" },
  { key: "fundraisingRequests", level: 2, ...FUNDRAISING, one: "fundraiser has requests to do", many: "fundraisers have requests to do" },
  { key: "fundraiserCalls", level: 2, ...FUNDRAISING, one: "fundraiser is due a call", many: "fundraisers are due a call" },
  { key: "storiesNew", level: 2, view: "stories", button: "Stories", one: "new story is waiting to be read", many: "new stories are waiting to be read" },
  { key: "businessCalls", level: 2, view: "fulfilments", button: "Business supporters", one: "business is due a thank you call", many: "businesses are due a thank you call" },
  { key: "outreachMine", level: 2, view: "outreach", button: "Contact businesses", one: "of your business contacts needs a next step", many: "of your business contacts need a next step" },
  { key: "thankYouLetters", level: 2, view: "thank-you", button: "Thank you", one: "generous donor has not had a thank you letter yet", many: "generous donors have not had a thank you letter yet" },
  { key: "transfersWaiting", level: 2, ...BALL, one: "bank transfer is still waiting for its money", many: "bank transfers are still waiting for their money" },
  // 3. Slower deadlines.
  { key: "giftAidAdjustments", level: 3, ...CLAIMS, one: "donation needs a Gift Aid adjustment", many: "donations need a Gift Aid adjustment" },
  { key: "declarationsAwaiting", level: 3, ...CLAIMS, one: "Gift Aid declaration has not come back yet", many: "Gift Aid declarations have not come back yet" },
  { key: "declarationsReview", level: 3, ...CLAIMS, one: "Gift Aid declaration is due a review", many: "Gift Aid declarations are due a review" },
  { key: "retentionExpiring", level: 3, ...CLAIMS, one: "Gift Aid record is reaching the end of its keep date", many: "Gift Aid records are reaching the end of their keep date" },
  { key: "gasdsDeadline", level: 3, view: "gasds", button: "GASDS", one: "small donation is near its GASDS claim deadline", many: "small donations are near their GASDS claim deadline" },
  { key: "ballGuestsMissing", level: 3, ...BALL, one: "Festive Ball booking still has guest details missing", many: "Festive Ball bookings still have guest details missing" },
];

export interface NeedLine {
  key: NeedKey;
  level: 1 | 2 | 3;
  text: string;
  view: string;
  button: string;
}

const money = (pence: number): string =>
  "£" + (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The waiting items as lines: most urgent first, anything at zero left out. */
export function needsLines(counts: NeedCounts): NeedLine[] {
  const lines: NeedLine[] = [];
  for (const level of [1, 2, 3] as const) {
    for (const need of NEEDS) {
      if (need.level !== level) continue;
      const c = counts[need.key];
      if (!c || !(c.count > 0)) continue;
      const words = c.count === 1 ? need.one : need.many;
      const extra = c.pence && c.pence > 0 ? ` (${money(c.pence)} of giving)` : "";
      lines.push({ key: need.key, level, text: `${c.count} ${words}${extra}`, view: need.view, button: need.button });
    }
  }
  return lines;
}
