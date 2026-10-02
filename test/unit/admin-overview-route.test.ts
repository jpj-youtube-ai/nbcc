import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-508: GET /api/admin/overview. Each source reads through the same database functions as its
// own screen; here those are mocked, and the rules that turn rows into counts are the real ones. The
// viewer and admin are invented.

const m = vi.hoisted(() => ({
  getUserAuthRow: vi.fn(),
  listAwaitingTransfers: vi.fn(),
  getSettings: vi.fn(),
  listGuestProgress: vi.fn(),
  listMonthlySupporters: vi.fn(),
  listEligibleForClaim: vi.fn(),
  listAdjustmentDueDonations: vi.fn(),
  listAwaitingDeclarationDonations: vi.fn(),
  listDeclarationsDueReview: vi.fn(),
  listRetentionExpiryDeclarations: vi.fn(),
  listGasdsDeadlineDonations: vi.fn(),
  listRecentEmailFailures: vi.fn(),
  listAllFundraisers: vi.fn(),
  listFundraiserCalls: vi.fn(),
  listRequestRows: vi.fn(),
  countUnanswered: vi.fn(),
  listStories: vi.fn(),
  listBusinessFulfilments: vi.fn(),
  listOutreachForTodo: vi.fn(),
  listThankYouEligible: vi.fn(),
  getDashboard: vi.fn(),
  readSalesInputs: vi.fn(),
  sumDonations: vi.fn(),
  sumFundraisingCash: vi.fn(),
  sumBallTaken: vi.fn(),
  readWebsiteGlance: vi.fn(),
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: m.getUserAuthRow }));
vi.mock("../../src/db/ball-transfer", () => ({ listAwaitingTransfers: m.listAwaitingTransfers }));
vi.mock("../../src/db/ball", () => ({ getSettings: m.getSettings, listGuestProgress: m.listGuestProgress, getDashboard: m.getDashboard }));
vi.mock("../../src/db/ball-report", () => ({ readSalesInputs: m.readSalesInputs }));
vi.mock("../../src/db/overview-numbers", () => ({ sumDonations: m.sumDonations, sumFundraisingCash: m.sumFundraisingCash, sumBallTaken: m.sumBallTaken }));
vi.mock("../../src/db/analytics-report", () => ({ readWebsiteGlance: m.readWebsiteGlance }));
// The Ball's night, without the run up's email sending behind it.
vi.mock("../../src/ball/run-up-runner", () => ({ BALL_EVENT_DATE: new Date("2099-11-07T19:00:00Z") }));
vi.mock("../../src/db/monthly-supporters", () => ({ listMonthlySupporters: m.listMonthlySupporters }));
vi.mock("../../src/db/admin", () => ({
  listEligibleForClaim: m.listEligibleForClaim,
  listAdjustmentDueDonations: m.listAdjustmentDueDonations,
  listAwaitingDeclarationDonations: m.listAwaitingDeclarationDonations,
  listDeclarationsDueReview: m.listDeclarationsDueReview,
  listRetentionExpiryDeclarations: m.listRetentionExpiryDeclarations,
  listGasdsDeadlineDonations: m.listGasdsDeadlineDonations,
}));
vi.mock("../../src/db/email-log", () => ({ listRecentEmailFailures: m.listRecentEmailFailures }));
vi.mock("../../src/db/fundraisers", () => ({ listAllFundraisers: m.listAllFundraisers }));
vi.mock("../../src/db/fundraising-team", () => ({ listFundraiserCalls: m.listFundraiserCalls }));
vi.mock("../../src/db/fundraising-requests", () => ({ listRequestRows: m.listRequestRows }));
vi.mock("../../src/db/contact", () => ({ countUnanswered: m.countUnanswered }));
vi.mock("../../src/db/stories", () => ({ listStories: m.listStories }));
vi.mock("../../src/db/fulfilment", () => ({ listBusinessFulfilments: m.listBusinessFulfilments }));
vi.mock("../../src/db/outreach", () => ({ listOutreachForTodo: m.listOutreachForTodo }));
vi.mock("../../src/db/thank-you", () => ({ listThankYouEligible: m.listThankYouEligible }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "development", ADMIN_SESSION_SECRET: "test-admin-secret" } }));

import { getAdminOverview } from "../../src/routes/admin-overview";
import { signAdminSession } from "../../src/admin/session";

const SECRET = "test-admin-secret";
const tokenFor = (role: "admin" | "editor" | "viewer", permissions: Record<string, string> = {}) => {
  m.getUserAuthRow.mockResolvedValue({ id: 4, email: "sam@example.com", status: "active", role, permissions });
  return signAdminSession({ sub: 4, email: "sam@example.com", role, now: new Date(), secret: SECRET }).token;
};
type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
const call = async (token: string | null) => {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  await getAdminOverview({ headers: token ? { authorization: `Bearer ${token}` } : {} } as never, res as never);
  return res;
};
type Answer = {
  updatedAt: string;
  needs: Array<{ key: string; level: number; text: string; view: string }>;
  numbers: Array<{ key: string; title: string; headline: string; detail: string; view: string }>;
  failed: string[];
};
const keys = (res: MockRes) => (res.body as Answer).needs.map((n) => n.key);
const numberKeys = (res: MockRes) => (res.body as Answer).numbers.map((n) => n.key);

const fundraiser = (over: Record<string, unknown>) => ({
  id: 1, status: "approved", editWaiting: false, finishedRequestedAt: null, eventDate: null, wants: {}, socialOk: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.listAwaitingTransfers.mockResolvedValue([{ payBy: "2020-01-01" }, { payBy: "2099-01-01" }, { payBy: "2099-01-02" }]);
  m.getSettings.mockResolvedValue({ guestDetailsLockAt: null });
  m.listGuestProgress.mockResolvedValue([]);
  const giver = (state: string, monthlyPence = 1_000) => ({ state, monthlyPence, firstPaidAt: "2020-01-10T10:00:00Z", cancelledAt: null, lapsedAt: null });
  m.listMonthlySupporters.mockResolvedValue([giver("past_due"), giver("active", 2_500), giver("lapsed")]);
  m.listEligibleForClaim.mockResolvedValue([{ amount_pence: 1000 }, { amount_pence: "2050" }]);
  m.listAdjustmentDueDonations.mockResolvedValue([]);
  m.listAwaitingDeclarationDonations.mockResolvedValue([{}, {}, {}]);
  m.listDeclarationsDueReview.mockResolvedValue([]);
  m.listRetentionExpiryDeclarations.mockResolvedValue([]);
  m.listGasdsDeadlineDonations.mockResolvedValue([]);
  m.listRecentEmailFailures.mockResolvedValue([{}]);
  m.listAllFundraisers.mockResolvedValue([
    fundraiser({ id: 1, status: "new" }),
    fundraiser({ id: 2, editWaiting: true }),
    fundraiser({ id: 3, finishedRequestedAt: "2026-10-01T09:00:00Z" }),
  ]);
  m.listFundraiserCalls.mockResolvedValue([]);
  m.listRequestRows.mockResolvedValue([]);
  m.countUnanswered.mockResolvedValue(2);
  m.listStories.mockResolvedValue([{}]);
  m.listBusinessFulfilments.mockResolvedValue([]);
  m.listOutreachForTodo.mockResolvedValue([]);
  // Only those ready to write to count, as on the Thank you screen: no email, or opted out, never clears.
  m.listThankYouEligible.mockResolvedValue([
    { alreadyThanked: false, sendState: "ready" },
    { alreadyThanked: true, sendState: "ready" },
    { alreadyThanked: false, sendState: "no_email" },
    { alreadyThanked: false, sendState: "opted_out" },
  ]);
  // The numbers (TASK-509). Invented money in pence.
  m.sumDonations.mockImplementation(async (_p: unknown, pages: boolean) => (pages ? { now: 10_000, before: 5_000 } : { now: 200_000, before: 150_000 }));
  m.sumFundraisingCash.mockResolvedValue({ now: 2_000, before: 0 });
  m.sumBallTaken.mockResolvedValue({ now: 50_000, before: 70_000 });
  m.readSalesInputs.mockResolvedValue({ seatsSold: 212, totalSeats: 300, awaitingTransferSeats: 16 });
  m.getDashboard.mockResolvedValue({ totalPence: 1_840_000 });
  m.readWebsiteGlance.mockResolvedValue({ visitors: 1_240, visitorsBefore: 1_100, onNow: 3, topChannel: "search" });
});

describe("GET /api/admin/overview", () => {
  it("needs a session", async () => {
    expect((await call(null)).statusCode).toBe(401);
  });

  it("tells an admin everything waiting, most urgent first, each one counted as its screen counts it", async () => {
    const res = await call(tokenFor("admin"));
    expect(res.statusCode).toBe(200);
    const answer = res.body as Answer;
    expect(answer.failed).toEqual([]);
    expect(keys(res)).toEqual([
      "transfersOverdue", "monthlyFailing", "giftAidReady", "emailFailures",
      "contactWaiting", "fundraisingNew", "fundraisingChanges", "fundraisingFinished", "storiesNew", "thankYouLetters", "transfersWaiting",
      "declarationsAwaiting",
    ]);
    const text = (key: string) => answer.needs.find((n) => n.key === key)?.text;
    expect(text("transfersOverdue")).toBe("1 bank transfer is overdue");
    expect(text("transfersWaiting")).toBe("2 bank transfers are still waiting for their money");
    expect(text("monthlyFailing")).toBe("1 monthly gift is failing to take");
    expect(text("thankYouLetters")).toBe("1 generous donor has not had a thank you letter yet");
    expect(text("giftAidReady")).toBe("2 donations are ready to claim Gift Aid on (£30.50 of giving)");
    expect(new Date(answer.updatedAt).getTime()).toBeGreaterThan(0);
  });

  // A viewer has no access to email audit or business supporters, so those are never even asked.
  it("asks nothing a person cannot see, and shows nothing of it", async () => {
    m.listBusinessFulfilments.mockResolvedValue([{ supporting: true, supporting_since: "2020-01-01", last_called_at: null }]);
    const res = await call(tokenFor("viewer"));
    expect(keys(res)).not.toContain("emailFailures");
    expect(keys(res)).not.toContain("businessCalls");
    expect(m.listRecentEmailFailures).not.toHaveBeenCalled();
    expect(m.listBusinessFulfilments).not.toHaveBeenCalled();
  });

  // Business supporters' calls need edit on that screen, as the screen itself does.
  it("shows business calls only to someone who can edit Business supporters", async () => {
    m.listBusinessFulfilments.mockResolvedValue([{ supporting: true, supporting_since: "2020-01-01", last_called_at: null }]);
    const viewOnly = await call(tokenFor("editor", { "business-supporters": "view", contact: "view" }));
    expect(keys(viewOnly)).toEqual(["contactWaiting"]);
    expect(m.listBusinessFulfilments).not.toHaveBeenCalled();
    const canEdit = await call(tokenFor("editor", { "business-supporters": "edit" }));
    expect(keys(canEdit)).toEqual(["businessCalls"]);
  });

  it("names a part it could not check, and still shows the rest", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.listAwaitingTransfers.mockRejectedValue(new Error("down"));
    const res = await call(tokenFor("admin"));
    expect((res.body as Answer).failed).toEqual(["Festive Ball"]);
    expect(keys(res)).toContain("contactWaiting");
    expect(keys(res)).not.toContain("transfersOverdue");
  });

  // Guest details are not urgent until they are about to close.
  it("raises missing guest details only in the three weeks before they close", async () => {
    m.listGuestProgress.mockResolvedValue([{ complete: false }, { complete: true }]);
    m.getSettings.mockResolvedValue({ guestDetailsLockAt: new Date(Date.now() + 10 * 86_400_000).toISOString() });
    expect(keys(await call(tokenFor("admin")))).toContain("ballGuestsMissing");
    m.getSettings.mockResolvedValue({ guestDetailsLockAt: new Date(Date.now() + 40 * 86_400_000).toISOString() });
    expect(keys(await call(tokenFor("admin")))).not.toContain("ballGuestsMissing");
  });
});

describe("GET /api/admin/overview: the numbers (TASK-509)", () => {
  it("tells an admin how we are doing: money in, monthly givers, the Ball and the website", async () => {
    const answer = (await call(tokenFor("admin"))).body as Answer;
    expect(answer.numbers.map((n) => n.key)).toEqual(["money", "monthly", "ball", "website"]);
    const line = (key: string) => answer.numbers.find((n) => n.key === key);
    // Donations £2,000; fundraising pages £100 online and £20 cash paid in; the Ball £500.
    expect(line("money")).toMatchObject({
      headline: "£2,620 this month so far",
      detail: "£2,250 by this time last month. Donations £2,000, Festive Ball £500, fundraising pages £120.",
    });
    // Only the active giver is giving; past due and lapsed are not.
    expect(line("monthly")?.headline).toBe("1 person gives £25 a month");
    expect(line("ball")?.headline).toBe("212 of 300 seats sold");
    expect(line("ball")?.detail).toMatch(/^£18,400 taken\. 16 seats held for bank transfers\. [\d,]+ days to go\.$/);
    expect(line("website")?.headline).toBe("1,240 visitors in the last 7 days");
  });

  it("reads the monthly givers once for both their Needs you line and their number", async () => {
    await call(tokenFor("admin"));
    expect(m.listMonthlySupporters).toHaveBeenCalledTimes(1);
  });

  // A viewer has no Analytics access by default.
  it("never asks for, or shows, a number a person cannot see", async () => {
    const res = await call(tokenFor("viewer"));
    expect(numberKeys(res)).not.toContain("website");
    expect(m.readWebsiteGlance).not.toHaveBeenCalled();
  });

  it("gives someone who sees only the Ball its share of the money, opening the Ball's screen", async () => {
    const res = await call(tokenFor("editor", { ball: "view" }));
    expect(numberKeys(res)).toEqual(["money", "ball"]);
    const money = (res.body as Answer).numbers[0];
    expect(money).toMatchObject({ headline: "£500 this month so far", detail: "£700 by this time last month.", view: "ball" });
    expect(m.sumDonations).not.toHaveBeenCalled();
    expect(m.sumFundraisingCash).not.toHaveBeenCalled();
  });

  it("names a number it could not check, and still shows the rest", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.readWebsiteGlance.mockRejectedValue(new Error("down"));
    const res = await call(tokenFor("admin"));
    expect((res.body as Answer).failed).toEqual(["Analytics"]);
    expect(numberKeys(res)).toEqual(["money", "monthly", "ball"]);
  });

  // One source takes one of the 3 slots, so it may hold only one database connection at a time.
  it("reads the fundraising sign ups, calls and requests one after another", async () => {
    let running = 0;
    let most = 0;
    const slow = <T,>(value: T) => async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return value;
    };
    m.listAllFundraisers.mockImplementation(slow([]));
    m.listFundraiserCalls.mockImplementation(slow([]));
    m.listRequestRows.mockImplementation(slow([]));
    await call(tokenFor("admin"));
    expect(m.listRequestRows).toHaveBeenCalledTimes(1);
    expect(most).toBe(1);
  });

  // A total from the parts that answered would read as all the money in; it is left out instead, and
  // "Could not check" names the part that failed.
  it("leaves Money in out when part of it could not be read, rather than a total that is short", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.sumDonations.mockRejectedValue(new Error("down"));
    const res = await call(tokenFor("admin"));
    expect(numberKeys(res)).toEqual(["monthly", "ball", "website"]);
    expect((res.body as Answer).failed).toContain("Donations");
  });

  it("still gives Money in when the only part that failed is one the person may not see anyway", async () => {
    m.sumDonations.mockRejectedValue(new Error("never asked"));
    const res = await call(tokenFor("editor", { ball: "view" }));
    expect(numberKeys(res)).toEqual(["money", "ball"]);
    expect((res.body as Answer).failed).toEqual([]);
  });

  it("leaves the website out while counting is switched off", async () => {
    m.readWebsiteGlance.mockResolvedValue(null);
    const res = await call(tokenFor("admin"));
    expect(numberKeys(res)).not.toContain("website");
    expect((res.body as Answer).failed).toEqual([]);
  });
});
