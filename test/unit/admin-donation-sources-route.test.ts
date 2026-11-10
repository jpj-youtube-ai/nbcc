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
  ball: { month: { pence: 7_500, gifts: 3 }, all: { pence: 7_500, gifts: 3 } },
  ballBags: { month: { pence: 10_000, gifts: 2 }, all: { pence: 15_000, gifts: 3 } },
  invoices: { month: { pence: 50_000, gifts: 2 }, all: { pence: 75_000, gifts: 3 } },
  elfSchool: { month: { pence: 148_600, gifts: 128 }, all: { pence: 148_600, gifts: 128 } },
  donatePage: { month: { pence: 213_000, gifts: 64 }, all: { pence: 3_140_000, gifts: 902 } },
  fundraiser: { month: { pence: 5_000, gifts: 2 }, all: { pence: 60_000, gifts: 30 } },
  cardReader: { month: { pence: 30_000, gifts: 12 }, all: { pence: 1_774_420, gifts: 27 } },
  monthly: { month: { pence: 12_000, gifts: 8 }, all: { pence: 96_000, gifts: 64 } },
  uniform: { month: { pence: 8_000, gifts: 2 }, all: { pence: 24_000, gifts: 6 } },
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
  it("gives the figures, the worded lines and the note", async () => {
    const res = await totals(tokenFor("viewer"));
    expect(res.body).toEqual({
      totals: TOTALS,
      lines: [
        { key: "redBag", name: "Fill a Red Bag", month: "£412 from 19 gifts", all: "£1,960 from 87 gifts" },
        { key: "ball", name: "Festive Ball", month: "£75 from 3 gifts", all: "£75 from 3 gifts" },
        { key: "ballBags", name: "Red bags at the Ball", month: "£100 from 2 gifts", all: "£150 from 3 gifts" },
        { key: "invoices", name: "Invoices", month: "£500 from 2 gifts", all: "£750 from 3 gifts" },
        { key: "elfSchool", name: "Elf Detective School", month: "£1,486 from 128 payments", all: "£1,486 from 128 payments" },
        { key: "donatePage", name: "Donate page", month: "£2,130 from 64 gifts", all: "£31,400 from 902 gifts" },
        { key: "fundraiser", name: "Fundraiser pages", month: "£50 from 2 gifts", all: "£600 from 30 gifts" },
        { key: "cardReader", name: "Card reader", month: "£300 from 12 gifts", all: "£17,744 from 27 gifts" },
        { key: "monthly", name: "Monthly gifts", month: "£120 from 8 payments", all: "£960 from 64 payments" },
        { key: "uniform", name: "Uniform", month: "£80 from 2 payments", all: "£240 from 6 payments" },
      ],
      note: "Fill a Red Bag gifts are counted from 5 October 2026. Festive Ball gifts are those made on the Ball's own donate page. Red bags at the Ball are gifts from the table cards at the Festive Ball. Elf Detective School payments are entries to take part, with any gift on top. Entries are never claimed for Gift Aid. Monthly gifts are every monthly payment, wherever it was set up, so each is in its place's figures too. Uniform is payments for school uniforms. They are not donations, so they are in no other figure.",
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

  // The Donations gift log (docs/superpowers/plans/2026-11-05-donations-screen.md, Task 3): its filters
  // are handed on as typed; listDonations checks each against its fixed list.
  it("hands on the gift log's search, dates, paid by, came from and Gift Aid", async () => {
    await list({ q: "sam", from: "2026-11-01", to: "2026-11-05", method: "apple_pay", came: "qr", giftAid: "yes" });
    expect(m.listDonations).toHaveBeenCalledWith(
      expect.objectContaining({ q: "sam", from: "2026-11-01", to: "2026-11-05", method: "apple_pay", came: "qr", giftAid: "yes" }),
    );
  });

  it("takes none of the gift log's filters unless each is a plain string", async () => {
    await list({ q: ["a", "b"], from: { x: 1 }, method: ["card"], came: ["qr"], giftAid: ["yes"] });
    const args = m.listDonations.mock.calls[0][0];
    for (const k of ["q", "from", "to", "method", "came", "giftAid"]) expect(args[k], k).toBeUndefined();
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
