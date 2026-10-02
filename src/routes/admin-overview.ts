import { Router, type Request, type Response } from "express";
import { authorizeAny, loadEffectivePermissions } from "./admin-authz";
import { needsLines, type NeedCounts } from "../admin/overview";
import { gather, type Source } from "../admin/overview-sources";
import { giversFrom, monthSoFar, numbersLines, type NowAndBefore, type NumberCounts } from "../admin/overview-numbers";
import { listAwaitingTransfers } from "../db/ball-transfer";
import { isOverdue } from "../ball/transfer";
import { londonDate } from "../ball/sales-report";
import { getDashboard, getSettings, listGuestProgress } from "../db/ball";
import { readSalesInputs } from "../db/ball-report";
import { BALL_EVENT_DATE } from "../ball/run-up-runner";
import { daysToGo } from "../ball/sales-report";
import { sumBallTaken, sumDonations, sumFundraisingCash } from "../db/overview-numbers";
import { readWebsiteGlance } from "../db/analytics-report";
import { summariseGuestProgress } from "../ball/guest-progress";
import { listMonthlySupporters } from "../db/monthly-supporters";
import {
  listEligibleForClaim,
  listAdjustmentDueDonations,
  listAwaitingDeclarationDonations,
  listDeclarationsDueReview,
  listRetentionExpiryDeclarations,
  listGasdsDeadlineDonations,
} from "../db/admin";
import { listRecentEmailFailures } from "../db/email-log";
import { listAllFundraisers } from "../db/fundraisers";
import { listFundraiserCalls } from "../db/fundraising-team";
import { listRequestRows } from "../db/fundraising-requests";
import { requestViews, requestsToDo, type RequestRow } from "../fundraising/requests";
import { callStates, followUpToday, type CallRecord } from "../fundraising/follow-up";
import { countUnanswered } from "../db/contact";
import { listStories } from "../db/stories";
import { listBusinessFulfilments } from "../db/fulfilment";
import { callDue } from "../business/call-due";
import { londonToday } from "../events/model";
import { listOutreachForTodo } from "../db/outreach";
import { whatIsNeeded } from "../outreach/todo";
import { listThankYouEligible } from "../db/thank-you";
import { DEFAULT_THANK_YOU_THRESHOLD_PENCE } from "../thank-you/model";

// TASK-508: GET /api/admin/overview, "Needs you" on the admin Overview.
//
// Every waiting item a person may see, counted with the same functions and rules its own screen
// uses, so the Overview can never disagree with the screen it sends you to. Each source carries that
// screen's gate (src/admin/overview-sources.ts): a section the person cannot see is never asked for.
// One that fails is named in `failed` and the rest still answer. Design:
// docs/superpowers/specs/2026-10-03-admin-overview-design.md.

const DAY_MS = 86_400_000;

// TASK-509: the numbers ride on the same pass as "Needs you", so the three at a time limit covers
// both. Their keys sit beside the Needs you keys and never share a name with one.
type NumberReads = {
  moneyDonations?: NowAndBefore;
  moneyBall?: NowAndBefore;
  moneyFundraising?: NowAndBefore;
  givers?: NumberCounts["monthly"];
  ballSales?: NumberCounts["ball"];
  website?: NumberCounts["website"];
};
type OverviewCounts = NeedCounts & NumberReads;
const count = (n: number) => ({ count: n });

// The Festive Ball's guest details only become a "needs you" in the three weeks before they close.
const GUEST_DETAILS_WARNING_DAYS = 21;

function sources(email: string, now: Date): Source<OverviewCounts>[] {
  // Monthly givers is read once for both its "Needs you" line and its number.
  let givers: ReturnType<typeof listMonthlySupporters> | null = null;
  const monthlyGivers = () => (givers ??= listMonthlySupporters());
  const months = monthSoFar(now);

  // The fundraising sources share one read of the sign ups, calls and request rows.
  let fundraising: Promise<{
    fundraisers: Awaited<ReturnType<typeof listAllFundraisers>>;
    calls: Array<CallRecord & { fundraiserId: number }>;
    rows: RequestRow[];
  }> | null = null;
  const fundraisingData = () =>
    (fundraising ??= Promise.all([listAllFundraisers(), listFundraiserCalls(), listRequestRows()]).then(
      ([fundraisers, calls, rows]) => ({ fundraisers, calls, rows }),
    ));

  return [
    {
      name: "Festive Ball",
      section: "ball",
      level: "view",
      read: async () => {
        const today = londonDate(now);
        const awaiting = await listAwaitingTransfers();
        const overdue = awaiting.filter((t) => isOverdue(t.payBy, today)).length;
        return { transfersOverdue: count(overdue), transfersWaiting: count(awaiting.length - overdue) };
      },
    },
    {
      name: "Festive Ball",
      section: "ball",
      level: "view",
      read: async () => {
        const settings = await getSettings();
        const lock = settings.guestDetailsLockAt ? new Date(settings.guestDetailsLockAt) : null;
        if (!lock || lock.getTime() < now.getTime() || lock.getTime() - now.getTime() > GUEST_DETAILS_WARNING_DAYS * DAY_MS) return {};
        return { ballGuestsMissing: count(summariseGuestProgress(await listGuestProgress()).bookingsOutstanding) };
      },
    },
    {
      name: "Monthly givers",
      section: "donations",
      level: "view",
      read: async () => ({ monthlyFailing: count((await monthlyGivers()).filter((m) => m.state === "past_due").length) }),
    },
    {
      name: "Claims",
      section: "claims",
      level: "view",
      read: async () => {
        const ready = await listEligibleForClaim();
        return { giftAidReady: { count: ready.length, pence: ready.reduce((n, d) => n + Number(d.amount_pence ?? 0), 0) } };
      },
    },
    { name: "Claims", section: "claims", level: "view", read: async () => ({ giftAidAdjustments: count((await listAdjustmentDueDonations()).length) }) },
    { name: "Claims", section: "claims", level: "view", read: async () => ({ declarationsAwaiting: count((await listAwaitingDeclarationDonations()).length) }) },
    { name: "Claims", section: "claims", level: "view", read: async () => ({ declarationsReview: count((await listDeclarationsDueReview()).length) }) },
    { name: "Claims", section: "claims", level: "view", read: async () => ({ retentionExpiring: count((await listRetentionExpiryDeclarations()).length) }) },
    { name: "GASDS", section: "gasds", level: "view", read: async () => ({ gasdsDeadline: count((await listGasdsDeadlineDonations()).length) }) },
    { name: "Email audit", section: "email-audit", level: "view", read: async () => ({ emailFailures: count((await listRecentEmailFailures(14, 200)).length) }) },
    {
      name: "Fundraising",
      section: "fundraising",
      level: "view",
      read: async () => {
        const { fundraisers, calls, rows } = await fundraisingData();
        const today = followUpToday(now);
        const out: NeedCounts = {
          fundraisingNew: count(fundraisers.filter((f) => f.status === "new").length),
          fundraisingChanges: count(fundraisers.filter((f) => f.editWaiting).length),
          fundraisingFinished: count(fundraisers.filter((f) => f.finishedRequestedAt && f.status === "approved").length),
        };
        let dueBack = 0;
        let toDo = 0;
        let callsDue = 0;
        for (const f of fundraisers) {
          const views = requestViews(f, rows.filter((r) => r.fundraiserId === f.id), today);
          if (views.some((v) => v.dueBack === true)) dueBack += 1;
          if (views.length && requestsToDo(f, views, today)) toDo += 1;
          if (f.eventDate && callStates(f, calls.filter((c) => c.fundraiserId === f.id), today).due) callsDue += 1;
        }
        return { ...out, fundraisingDueBack: count(dueBack), fundraisingRequests: count(toDo), fundraiserCalls: count(callsDue) };
      },
    },
    { name: "Contact form", section: "contact", level: "view", read: async () => ({ contactWaiting: count(await countUnanswered()) }) },
    { name: "Stories", section: "stories", level: "view", read: async () => ({ storiesNew: count((await listStories({ status: "new" })).length) }) },
    {
      name: "Business supporters",
      section: "business-supporters",
      level: "edit",
      read: async () => {
        const today = londonToday(now);
        const ukDay = (d: Date | string | null | undefined) => (d ? londonToday(new Date(d)) : null);
        const due = (await listBusinessFulfilments()).filter(
          (r) =>
            callDue({
              today,
              supportingSince: ukDay(r.supporting_since),
              lastCalledAt: ukDay(r.last_called_at),
              supporting: r.supporting === true,
            }).due,
        ).length;
        return { businessCalls: count(due) };
      },
    },
    {
      name: "Contact businesses",
      section: "outreach",
      level: "view",
      read: async () => {
        // Mine, as the Contact businesses screen shows by default: mine, or nobody's yet.
        const rows = (await listOutreachForTodo()).filter((r) => !r.ownerEmail || r.ownerEmail === email);
        return { outreachMine: count(rows.map((r) => whatIsNeeded(r, now)).filter((t) => t !== null).length) };
      },
    },
    {
      name: "Thank you",
      section: "thank-you",
      level: "view",
      read: async () => ({
        // Ready to write to, as the Thank you screen counts them: a donor with no email, or who has
        // opted out, can never be thanked from there, so would never clear.
        thankYouLetters: count(
          (await listThankYouEligible(DEFAULT_THANK_YOU_THRESHOLD_PENCE)).filter((d) => d.sendState === "ready" && !d.alreadyThanked).length,
        ),
      }),
    },

    // --- the numbers (TASK-509): how we are doing, each behind its own screen's gate ---------------
    { name: "Donations", section: "donations", level: "view", read: async () => ({ moneyDonations: await sumDonations(months, false) }) },
    { name: "Festive Ball", section: "ball", level: "view", read: async () => ({ moneyBall: await sumBallTaken(months) }) },
    {
      name: "Fundraising",
      section: "fundraising",
      level: "view",
      read: async () => {
        // Gifts through the pages, and cash organisers paid in: the two halves of the meter.
        const online = await sumDonations(months, true);
        const cash = await sumFundraisingCash(months);
        return { moneyFundraising: { now: online.now + cash.now, before: online.before + cash.before } };
      },
    },
    { name: "Monthly givers", section: "donations", level: "view", read: async () => ({ givers: giversFrom(await monthlyGivers(), now) }) },
    {
      name: "Festive Ball",
      section: "ball",
      level: "view",
      read: async () => {
        // The ticket report's own count of seats, and the Festive Ball dashboard's money taken.
        const sales = await readSalesInputs(now, null);
        const taken = await getDashboard();
        return {
          ballSales: {
            seatsSold: sales.seatsSold,
            totalSeats: sales.totalSeats,
            takenPence: taken.totalPence,
            transferSeats: sales.awaitingTransferSeats,
            daysToGo: daysToGo(londonDate(now), londonDate(BALL_EVENT_DATE)),
          },
        };
      },
    },
    {
      name: "Analytics",
      section: "analytics",
      level: "view",
      read: async () => {
        const website = await readWebsiteGlance(now);
        return website ? { website } : {};
      },
    },
  ];
}

export async function getAdminOverview(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeAny(req, res);
  if (!claims) return;
  try {
    const perms = await loadEffectivePermissions(claims.sub);
    if (!perms) return res.status(401).json({ error: "Invalid or expired admin session" });
    const now = new Date();
    const { counts: c, failed } = await gather(perms, sources(claims.email, now));
    const numbers = numbersLines({
      money: { donations: c.moneyDonations, ball: c.moneyBall, fundraising: c.moneyFundraising },
      monthly: c.givers,
      ball: c.ballSales,
      website: c.website,
    });
    return res.status(200).json({ updatedAt: now.toISOString(), needs: needsLines(c), numbers, failed });
  } catch (err) {
    console.error("admin overview failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "The overview could not load. Try again." });
  }
}

export const adminOverviewRouter = Router();
adminOverviewRouter.get("/api/admin/overview", getAdminOverview);
