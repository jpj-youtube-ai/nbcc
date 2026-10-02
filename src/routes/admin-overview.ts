import { Router, type Request, type Response } from "express";
import { authorizeAny, loadEffectivePermissions } from "./admin-authz";
import { needsLines, type NeedCounts } from "../admin/overview";
import { gatherNeeds, type NeedSource } from "../admin/overview-sources";
import { listAwaitingTransfers } from "../db/ball-transfer";
import { isOverdue } from "../ball/transfer";
import { londonDate } from "../ball/sales-report";
import { getSettings, listGuestProgress } from "../db/ball";
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

// TASK-507: GET /api/admin/overview, "Needs you" on the admin Overview.
//
// Every waiting item a person may see, counted with the same functions and rules its own screen
// uses, so the Overview can never disagree with the screen it sends you to. Each source carries that
// screen's gate (src/admin/overview-sources.ts): a section the person cannot see is never asked for.
// One that fails is named in `failed` and the rest still answer. Design:
// docs/superpowers/specs/2026-10-03-admin-overview-design.md.

const DAY_MS = 86_400_000;
const count = (n: number) => ({ count: n });

// The Festive Ball's guest details only become a "needs you" in the three weeks before they close.
const GUEST_DETAILS_WARNING_DAYS = 21;

function sources(email: string, now: Date): NeedSource[] {
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
      read: async () => ({ monthlyFailing: count((await listMonthlySupporters()).filter((m) => m.state === "past_due").length) }),
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
        thankYouLetters: count((await listThankYouEligible(DEFAULT_THANK_YOU_THRESHOLD_PENCE)).filter((d) => !d.alreadyThanked).length),
      }),
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
    const { counts, failed } = await gatherNeeds(perms, sources(claims.email, now));
    return res.status(200).json({ updatedAt: now.toISOString(), needs: needsLines(counts), failed });
  } catch (err) {
    console.error("admin overview failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "The overview could not load. Try again." });
  }
}

export const adminOverviewRouter = Router();
adminOverviewRouter.get("/api/admin/overview", getAdminOverview);
