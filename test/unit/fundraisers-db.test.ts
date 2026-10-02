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
