import { describe, it, expect, vi } from "vitest";

// TASK-493: the two pieces of src/db/fundraisers.ts that matter most and can be checked without a
// database: how a partial change becomes SQL, and how the Stripe webhook puts a gift on a page.

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { patchAssignments, linkFundraiserGift, toRecord } from "../../src/db/fundraisers";

describe("a partial change", () => {
  it("sets only the fields given, through their own columns", () => {
    const { sets, values, fields } = patchAssignments({ title: "New name", targetPence: 75000, name: "Robin Testperson" });
    expect(sets).toEqual(["title = $1", "target_pence = $2", "organiser_name = $3"]);
    expect(values).toEqual(["New name", 75000, "Robin Testperson"]);
    expect(fields).toEqual(["title", "targetPence", "name"]);
  });

  it("can clear a field, and stores what they would like as JSON", () => {
    const { sets, values } = patchAssignments({ eventDate: null, wants: { leaflets: 5, buckets: 0, shoutOut: false, attend: true } }, 3);
    expect(sets).toEqual(["event_date = $3", "wants = $4"]);
    expect(values).toEqual([null, JSON.stringify({ leaflets: 5, buckets: 0, shoutOut: false, attend: true })]);
  });

  it("ignores anything that is not a known field", () => {
    const { sets } = patchAssignments({ status: "approved", "id = 1; DROP TABLE x; --": 1 } as never);
    expect(sets).toEqual([]);
  });
});

describe("a gift made on a fundraiser's page", () => {
  const gift = { fundraiserId: 7, message: "Go Robin!", showName: false, showAmount: true };

  function fakeClient(approved: boolean) {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT id FROM fundraisers")) return { rows: approved ? [{ id: 7 }] : [] };
      return { rows: [] };
    });
    return { query } as unknown as import("pg").PoolClient & { query: typeof query };
  }

  it("is linked, with its message and choices, when the fundraiser is approved", async () => {
    const client = fakeClient(true);
    expect(await linkFundraiserGift(client, 55, gift, "evt_1")).toBe(true);
    const calls = (client.query as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toContain("status = 'approved'");
    expect(calls[1]).toEqual([
      "UPDATE donations SET fundraiser_id = $1, supporter_message = $2, show_name = $3, show_amount = $4 WHERE id = $5",
      [7, "Go Robin!", false, true, 55],
    ]);
    expect(calls[2][0]).toContain("INSERT INTO audit_log");
    expect(calls[2][1]).toEqual(["stripe", "fundraiser.gift_received", "fundraiser", 7, { eventId: "evt_1", donationId: 55 }]);
  });

  it("stays an ordinary donation, with no message, when it names no approved fundraiser", async () => {
    const client = fakeClient(false);
    expect(await linkFundraiserGift(client, 56, gift, "evt_2")).toBe(false);
    const calls = (client.query as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => String(c[0]).startsWith("UPDATE donations"))).toBe(false);
    expect(calls[1][1]).toEqual(["stripe", "fundraiser.gift_not_linked", "donation", 56, { eventId: "evt_2", fundraiserId: 7 }]);
  });
});

describe("reading a row", () => {
  it("fills in what they would like when it was stored empty", () => {
    const r = toRecord({
      id: "3", slug: "a", path: "event", kind: "other", title: "A", description: "", event_date: null, start_time: null,
      venue: "", town: "", target_pence: null, public: false, status: "new", organiser_name: "Sam Sample",
      organiser_email: "sam@example.com", organiser_phone: "07700 900456", social_link: null, social_ok: false, wants: {},
      post_address: null, newsletter_ok: false, image_src: null, declined_reason: null,
      created_at: "2026-10-02T10:00:00Z", approved_at: null, approved_by: null, updated_at: "2026-10-02T10:00:00Z", updated_by: null,
    });
    expect(r.id).toBe(3);
    expect(r.wants).toEqual({ leaflets: 0, buckets: 0, shoutOut: false, attend: false });
    expect(r.createdAt).toBe("2026-10-02T10:00:00.000Z");
  });
});

// ---- transactions, with a fake client that answers by statement ----

import { pool } from "../../src/db/pool";
import { requestEdit, decideEdit, createFundraiser, FundraiserError } from "../../src/db/fundraisers";

const fundraiserRow = (over: Record<string, unknown> = {}) => ({
  id: 9, slug: "sams-walk", path: "raising", kind: "run_walk", title: "Sam's Walk", description: "", event_date: null,
  start_time: null, venue: "", town: "", target_pence: 50000, public: true, status: "approved", organiser_name: "Sam Sample",
  organiser_email: "sam@example.com", organiser_phone: "07700 900456", social_link: null, social_ok: false, wants: {},
  post_address: null, newsletter_ok: false, image_src: null, declined_reason: null, created_at: "2026-10-02T10:00:00Z",
  approved_at: null, approved_by: null, updated_at: "2026-10-02T10:00:00Z", updated_by: null, ...over,
});

type Answer = (sql: string, params: unknown[]) => unknown;
function useClient(answer: Answer) {
  const calls: Array<[string, unknown[]]> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      const out = answer(sql, params);
      if (out instanceof Error) throw out;
      return out ?? { rows: [] };
    }),
    release: vi.fn(),
  };
  (pool.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return calls;
}

describe("an organiser saving a change while one is waiting", () => {
  it("adds a new change and marks the waiting one replaced, so staff never approve text they did not see", async () => {
    const calls = useClient((sql) => {
      if (sql.includes("FROM fundraisers f WHERE f.id = $1 FOR UPDATE")) return { rows: [fundraiserRow()] };
      if (sql.startsWith("SELECT id FROM fundraiser_edits")) return { rows: [{ id: 3 }] };
      if (sql.startsWith("INSERT INTO fundraiser_edits")) return { rows: [{ id: 4 }] };
      if (sql.startsWith("SELECT id, changes, status")) return { rows: [{ id: 4, changes: { targetPence: 75000 }, status: "waiting", created_at: "2026-10-02T12:00:00Z" }] };
      return { rows: [] };
    });
    const edit = await requestEdit(9, { targetPence: 75000 }, "hash");
    expect(edit.id).toBe(4);
    const sqls = calls.map(([s]) => s);
    expect(sqls.some((s) => /UPDATE fundraiser_edits SET status = 'replaced'/.test(s))).toBe(true);
    expect(calls.find(([s]) => /status = 'replaced'/.test(s))?.[1]).toEqual([3]);
    expect(sqls.some((s) => /UPDATE fundraiser_edits SET changes/.test(s))).toBe(false);
  });
});

describe("deciding a change that has been replaced", () => {
  it.each([true, false])("refuses (approve %s), so the staff member looks again", async (approve) => {
    useClient((sql) => {
      if (sql.includes("FROM fundraisers f WHERE f.id = $1 FOR UPDATE")) return { rows: [fundraiserRow()] };
      if (sql.startsWith("SELECT changes, status FROM fundraiser_edits")) return { rows: [{ changes: { targetPence: 1000 }, status: "replaced" }] };
      return { rows: [] };
    });
    await expect(decideEdit(9, 3, approve, "admin:kim@example.com")).rejects.toMatchObject({ reason: "replaced" });
    await expect(decideEdit(9, 3, approve, "admin:kim@example.com")).rejects.toBeInstanceOf(FundraiserError);
  });
});

describe("two sign ups with the same name at the same moment", () => {
  it("takes the next free web address when the first is taken under it, instead of failing", async () => {
    let slugReads = 0;
    let inserts = 0;
    const calls = useClient((sql, params) => {
      if (sql.startsWith("SELECT slug FROM fundraisers")) {
        slugReads += 1;
        // The second look sees the address the other sign up has just taken.
        return { rows: slugReads === 1 ? [] : [{ slug: "sams-walk" }] };
      }
      if (sql.includes("INSERT INTO fundraisers")) {
        inserts += 1;
        if (inserts === 1) return Object.assign(new Error("duplicate key"), { code: "23505", constraint: "fundraisers_slug_key" });
        expect(params[0]).toBe("sams-walk-2");
        return { rows: [{ id: 12 }] };
      }
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [fundraiserRow({ id: 12, slug: "sams-walk-2", status: "new" })] };
      return { rows: [] };
    });
    const made = await createFundraiser({
      path: "raising", kind: "run_walk", title: "Sam's Walk", description: "Ten miles.", eventDate: null, startTime: null,
      venue: "", town: "", targetPence: null, public: true, name: "Sam Sample", email: "sam@example.com", phone: "07700 900456",
      socialLink: null, socialOk: false, wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false }, postAddress: null,
      newsletterOk: false,
    });
    expect(made.slug).toBe("sams-walk-2");
    const sqls = calls.map(([s]) => s);
    expect(sqls).toContain("ROLLBACK TO SAVEPOINT fundraiser_slug");
    expect(sqls).toContain("COMMIT");
  });

  it("still fails on any other error", async () => {
    useClient((sql) => {
      if (sql.startsWith("SELECT slug FROM fundraisers")) return { rows: [] };
      if (sql.includes("INSERT INTO fundraisers")) return Object.assign(new Error("other"), { code: "23514" });
      return { rows: [] };
    });
    await expect(
      createFundraiser({
        path: "raising", kind: "run_walk", title: "X", description: "Y", eventDate: null, startTime: null, venue: "", town: "",
        targetPence: null, public: true, name: "Sam Sample", email: "sam@example.com", phone: "07700 900456", socialLink: null,
        socialOk: false, wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false }, postAddress: null, newsletterOk: false,
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
