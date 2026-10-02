import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-507: GET /api/admin/overview. Each source reads through the same database functions as its
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
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: m.getUserAuthRow }));
vi.mock("../../src/db/ball-transfer", () => ({ listAwaitingTransfers: m.listAwaitingTransfers }));
vi.mock("../../src/db/ball", () => ({ getSettings: m.getSettings, listGuestProgress: m.listGuestProgress }));
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
type Answer = { updatedAt: string; needs: Array<{ key: string; level: number; text: string; view: string }>; failed: string[] };
const keys = (res: MockRes) => (res.body as Answer).needs.map((n) => n.key);

const fundraiser = (over: Record<string, unknown>) => ({
  id: 1, status: "approved", editWaiting: false, finishedRequestedAt: null, eventDate: null, wants: {}, socialOk: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.listAwaitingTransfers.mockResolvedValue([{ payBy: "2020-01-01" }, { payBy: "2099-01-01" }, { payBy: "2099-01-02" }]);
  m.getSettings.mockResolvedValue({ guestDetailsLockAt: null });
  m.listGuestProgress.mockResolvedValue([]);
  m.listMonthlySupporters.mockResolvedValue([{ state: "past_due" }, { state: "active" }, { state: "lapsed" }]);
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
  m.listThankYouEligible.mockResolvedValue([{ alreadyThanked: false }, { alreadyThanked: true }]);
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
