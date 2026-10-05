import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// GET /api/admin/donations/source-totals: Fill a Red Bag against the Donate page, for the top of
// the Donations screen, and the list's ?source filter. Same gate as the donations list. The people
// and figures are invented.

const m = vi.hoisted(() => ({ getUserAuthRow: vi.fn(), sumGiftsBySource: vi.fn(), listDonations: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: m.getUserAuthRow }));
vi.mock("../../src/db/overview-numbers", () => ({ sumGiftsBySource: m.sumGiftsBySource }));
vi.mock("../../src/db/admin", async (original) => ({ ...(await original<Record<string, unknown>>()), listDonations: m.listDonations }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  },
}));
vi.mock("../../src/clients/stripe", () => ({ cancelSubscription: vi.fn() }));

import { getAdminDonationSourceTotals } from "../../src/routes/admin-donation-sources";
import { getAdminDonations } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

const tokenFor = (role: string, permissions: Record<string, string> = {}) => {
  m.getUserAuthRow.mockResolvedValue({ id: 4, email: "sam@example.com", status: "active", role, permissions });
  return signAdminSession({ sub: 4, email: "sam@example.com", role, now: new Date(), secret: "test-admin-secret" }).token;
};
type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
type Handler = (req: never, res: never) => Promise<unknown>;
const call = async (handler: Handler, token: string | null, query: Record<string, unknown> = {}) => {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  await handler({ headers: token ? { authorization: `Bearer ${token}` } : {}, query } as never, res as never);
  return res;
};
const totals = (token: string | null) => call(getAdminDonationSourceTotals as Handler, token);
const TOTALS = {
  redBag: { month: { pence: 41_200, gifts: 19 }, all: { pence: 196_000, gifts: 87 } },
  donatePage: { month: { pence: 213_000, gifts: 64 }, all: { pence: 3_140_000, gifts: 902 } },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.sumGiftsBySource.mockResolvedValue(TOTALS);
  m.listDonations.mockResolvedValue({ results: [], total: 0 });
});
afterEach(() => vi.useRealTimers());

describe("who may read the totals: exactly who may read the donations list", () => {
  it("refuses a request with no session, without touching the database", async () => {
    expect((await totals(null)).statusCode).toBe(401);
    expect(m.sumGiftsBySource).not.toHaveBeenCalled();
  });

  it("lets a Viewer read them", async () => {
    expect((await totals(tokenFor("viewer"))).statusCode).toBe(200);
  });

  it("refuses someone whose access leaves Donations out, without touching the database", async () => {
    const res = await totals(tokenFor("editor", { contact: "edit" }));
    expect(res.statusCode).toBe(403);
    expect(m.sumGiftsBySource).not.toHaveBeenCalled();
  });
});

describe("what the totals answer", () => {
  it("gives the figures, the two worded lines and the note", async () => {
    const res = await totals(tokenFor("viewer"));
    expect(res.body).toEqual({
      totals: TOTALS,
      lines: [
        { key: "redBag", name: "Fill a Red Bag", month: "£412 from 19 gifts", all: "£1,960 from 87 gifts" },
        { key: "donatePage", name: "Donate page", month: "£2,130 from 64 gifts", all: "£31,400 from 902 gifts" },
      ],
      note: "Fill a Red Bag gifts are counted from 5 October 2026.",
    });
  });

  it("asks for this UK month so far, as the Overview's money does", async () => {
    const token = tokenFor("viewer");
    // 00:30 on 1 October by the UK clock (BST) is still 30 September in UTC.
    vi.useFakeTimers({ now: new Date("2026-09-30T23:30:00.000Z"), toFake: ["Date"] });
    await totals(token);
    expect(m.sumGiftsBySource).toHaveBeenCalledWith({ from: "2026-10-01", until: "2026-09-30T23:30:00.000Z" });
  });

  it("answers a failure as a failure, never as zeros", async () => {
    m.sumGiftsBySource.mockRejectedValue(new Error("down"));
    const res = await totals(tokenFor("viewer"));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Admin is temporarily unavailable" });
  });
});

describe("the donations list takes ?source", () => {
  const list = (query: Record<string, unknown>) => call(getAdminDonations as Handler, tokenFor("viewer"), query);

  it("hands the source on with the filters that were already there", async () => {
    await list({ source: "red_bag", paymentStatus: "paid", mode: "monthly", limit: "25", offset: "25" });
    expect(m.listDonations).toHaveBeenCalledWith(
      expect.objectContaining({ source: "red_bag", paymentStatus: "paid", mode: "monthly", limit: 25, offset: 25 }),
    );
  });

  it("takes only a plain string: a repeated or nested parameter is no filter", async () => {
    await list({ source: ["red_bag", "red_bag"] });
    expect(m.listDonations.mock.calls[0][0].source).toBeUndefined();
  });

  it("is still refused without Donations access", async () => {
    const res = await call(getAdminDonations as Handler, tokenFor("editor", { contact: "edit" }), { source: "red_bag" });
    expect(res.statusCode).toBe(403);
    expect(m.listDonations).not.toHaveBeenCalled();
  });
});
