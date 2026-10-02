import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-502: the SQL behind giving on a fundraiser's page, checked without a database. The Gift Aid
// sum the meter reads, a gift on a finished page reaching its meter, and the message added after
// paying: once, for a paid gift on that fundraiser, never over one already there. Every name and
// number here is invented.

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { pool } from "../../src/db/pool";
import { addWallMessage, getBySlug, giftForSession, linkFundraiserGift, listApprovedPublic, wallRows } from "../../src/db/fundraisers";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

const fundraiserRow = (over: Record<string, unknown> = {}) => ({
  id: 9, slug: "sams-walk", path: "raising", kind: "run_walk", title: "Sam's Walk", description: "", event_date: null,
  start_time: null, venue: "", town: "", target_pence: 50000, public: true, status: "approved", organiser_name: "Sam Sample",
  organiser_email: "sam@example.com", organiser_phone: "07700 900456", social_link: null, social_ok: false, wants: {},
  post_address: null, newsletter_ok: false, image_src: null, declined_reason: null, created_at: "2026-10-02T10:00:00Z",
  approved_at: null, approved_by: null, updated_at: "2026-10-02T10:00:00Z", updated_by: null, ...over,
});

beforeEach(() => {
  query.mockReset();
});

describe("the Gift Aid under the meter", () => {
  it("is summed per gift, a quarter rounded down, on paid gifts that claimed it, less refunds, never paid in", async () => {
    query.mockResolvedValue({ rows: [{ ...fundraiserRow(), online_pence: 30000, cash_pence: 0, gift_aid_pence: 4500 }] });
    const f = await getBySlug("sams-walk");
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(
      /SUM\(GREATEST\(d\.amount_pence - d\.refunded_amount_pence, 0\) \/ 4\)\s+FILTER \(WHERE d\.payment_status = 'paid' AND d\.gift_aid AND NOT d\.paid_in_by_organiser\)/,
    );
    expect(sql).toContain("AS gift_aid_pence");
    expect(f?.meter.giftAidPence).toBe(4500);
    expect(f?.meter.raisedPence).toBe(30000);
  });

  it("reaches the cards on Get involved too", async () => {
    query.mockResolvedValue({ rows: [{ ...fundraiserRow(), online_pence: 2000, cash_pence: 0, gift_aid_pence: 500 }] });
    const [f] = await listApprovedPublic();
    expect(f.meter.giftAidPence).toBe(500);
  });

  it("reads each gift's Gift Aid for the wall", async () => {
    query.mockResolvedValue({
      rows: [{ id: 3, full_name: "Alex Example", anonymous: false, show_name: true, show_amount: true, amount_pence: 2000, refunded_amount_pence: 0, supporter_message: null, message_hidden: false, created_at: "2026-10-01T10:00:00Z", paid_in_by_organiser: false, gift_aid: true }],
    });
    const [r] = await wallRows(9);
    expect(String(query.mock.calls[0][0])).toContain("d.gift_aid");
    expect(r.giftAid).toBe(true);
  });
});

describe("a gift made on a finished fundraiser's page", () => {
  function fakeClient(status: string | null) {
    const q = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT id, status FROM fundraisers")) return { rows: status ? [{ id: 7, status }] : [] };
      return { rows: [] };
    });
    return { query: q } as unknown as import("pg").PoolClient;
  }
  const gift = { fundraiserId: 7, message: null, showName: false, showAmount: true };

  it("still reaches its meter and wall", async () => {
    const client = fakeClient("finished");
    expect(await linkFundraiserGift(client, 55, gift, "evt_1")).toBe(true);
    const calls = (client.query as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1]).toEqual([
      "UPDATE donations SET fundraiser_id = $1, supporter_message = $2, show_name = $3, show_amount = $4 WHERE id = $5",
      [7, null, false, true, 55],
    ]);
  });

  it("is never linked to one that is new or declined", async () => {
    for (const status of ["new", "declined", null]) {
      const client = fakeClient(status);
      expect(await linkFundraiserGift(client, 56, gift, "evt_2"), String(status)).toBe(false);
    }
  });
});

describe("the gift behind a checkout session", () => {
  it("is read by the session id, with what the wall step needs and nothing about the giver", async () => {
    query.mockResolvedValue({
      rows: [{ id: 55, fundraiser_id: 9, paid_in_by_organiser: false, payment_status: "paid", supporter_message: null, wall_added_at: null }],
    });
    expect(await giftForSession("cs_test_abc")).toEqual({
      donationId: 55, fundraiserId: 9, paidIn: false, paymentStatus: "paid", message: null, wallAddedAt: null,
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("WHERE stripe_session_id = $1");
    expect(sql).not.toMatch(/email|full_name/);
    expect(params).toEqual(["cs_test_abc"]);
  });

  it("is null before the webhook has recorded it", async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await giftForSession("cs_test_abc")).toBeNull();
  });
});

type Answer = (sql: string, params: unknown[]) => unknown;
function useClient(answer: Answer) {
  const calls: Array<[string, unknown[]]> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      return answer(sql, params) ?? { rows: [] };
    }),
    release: vi.fn(),
  };
  (pool.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return calls;
}

const locked = (over: Record<string, unknown> = {}) => ({
  id: 55, fundraiser_id: 9, paid_in_by_organiser: false, payment_status: "paid", supporter_message: null, wall_added_at: null,
  full_name: "Alex Example", anonymous: false, amount_pence: 2000, refunded_amount_pence: 0, gift_aid: true,
  created_at: "2026-10-02T09:00:00Z", ...over,
});

describe("adding to the wall after paying", () => {
  const input = { message: "Go Sam!", showName: true, showAmount: true };

  it("saves the words and the choices once, under the row's lock, and audits it", async () => {
    const calls = useClient((sql) => (sql.includes("FOR UPDATE") ? { rows: [locked()] } : undefined));
    const out = await addWallMessage("cs_test_abc", 9, input);
    expect(out.verdict).toBe("ok");
    const select = calls.find(([s]) => s.includes("FOR UPDATE"));
    expect(select?.[0]).toContain("WHERE d.stripe_session_id = $1");
    expect(select?.[1]).toEqual(["cs_test_abc"]);
    const update = calls.find(([s]) => s.startsWith("UPDATE donations"));
    expect(update?.[0]).toContain("supporter_message = $1, show_name = $2, show_amount = $3, wall_added_at = now()");
    expect(update?.[0]).toContain("wall_added_at IS NULL");
    expect(update?.[1]).toEqual(["Go Sam!", true, true, 55]);
    const audit = calls.find(([s]) => s.includes("INSERT INTO audit_log"));
    expect(audit?.[1]).toEqual(["giver", "fundraiser.wall_message_added", "fundraiser", 9, { donationId: 55, withMessage: true, showName: true, showAmount: true }]);
    expect(calls.map(([s]) => s)).toContain("COMMIT");
    // What the wall now shows for it, so the page can say so.
    expect(out.entry).toMatchObject({ name: "Alex E.", amountPence: 2000, giftAidPence: 500, message: "Go Sam!" });
  });

  it("stores no message as none, keeping the choices", async () => {
    const calls = useClient((sql) => (sql.includes("FOR UPDATE") ? { rows: [locked()] } : undefined));
    await addWallMessage("cs_test_abc", 9, { message: "", showName: false, showAmount: false });
    expect(calls.find(([s]) => s.startsWith("UPDATE donations"))?.[1]).toEqual([null, false, false, 55]);
  });

  it.each([
    ["another fundraiser's gift", { fundraiser_id: 10 }, "not_found"],
    ["money paid in", { paid_in_by_organiser: true }, "paid_in"],
    ["a failed payment", { payment_status: "failed" }, "unpaid"],
    ["a second time", { wall_added_at: "2026-10-02T10:00:00Z" }, "already"],
    ["over a message left when paying", { supporter_message: "Hello" }, "already"],
  ])("refuses %s, changing nothing", async (_label, over, verdict) => {
    const calls = useClient((sql) => (sql.includes("FOR UPDATE") ? { rows: [locked(over)] } : undefined));
    const out = await addWallMessage("cs_test_abc", 9, input);
    expect(out.verdict).toBe(verdict);
    expect(calls.some(([s]) => s.startsWith("UPDATE donations"))).toBe(false);
    expect(calls.some(([s]) => s.includes("INSERT INTO audit_log"))).toBe(false);
  });

  it("says when the payment has not been recorded yet", async () => {
    useClient(() => undefined);
    expect((await addWallMessage("cs_test_abc", 9, input)).verdict).toBe("not_recorded");
  });

  it("has nothing to show yet for a Direct Debit still settling", async () => {
    useClient((sql) => (sql.includes("FOR UPDATE") ? { rows: [locked({ payment_status: "pending" })] } : undefined));
    const out = await addWallMessage("cs_test_abc", 9, input);
    expect(out.verdict).toBe("ok");
    expect(out.entry).toBeNull();
  });
});
