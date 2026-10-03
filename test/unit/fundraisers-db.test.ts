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
      if (sql.startsWith("SELECT id, status FROM fundraisers")) return { rows: approved ? [{ id: 7, status: "approved" }] : [] };
      return { rows: [] };
    });
    return { query } as unknown as import("pg").PoolClient & { query: typeof query };
  }

  it("is linked, with its message and choices, when the fundraiser is approved", async () => {
    const client = fakeClient(true);
    expect(await linkFundraiserGift(client, 55, gift, "evt_1")).toBe(true);
    const calls = (client.query as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe("SELECT id, status FROM fundraisers WHERE id = $1");
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
    expect(r.wants).toEqual({ posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, qrCount: 0, shoutOut: false, attend: false });
    expect(r.createdAt).toBe("2026-10-02T10:00:00.000Z");
  });
});

// ---- transactions, with a fake client that answers by statement ----

import { pool } from "../../src/db/pool";
import {
  requestEdit,
  decideEdit,
  createFundraiser,
  moveFundraiser,
  claimNextWaitingLiveEmail,
  countWaitingLiveEmails,
  markLiveEmailWaiting,
  patchFundraiser,
  FundraiserError,
} from "../../src/db/fundraisers";

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
    const edit = await requestEdit(9, { targetPence: 75000 }, "sam@example.com");
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
        return { rows: slugReads === 1 ? [] : [{ slug: "sw" }] };
      }
      if (sql.includes("INSERT INTO fundraisers")) {
        inserts += 1;
        if (inserts === 1) return Object.assign(new Error("duplicate key"), { code: "23505", constraint: "fundraisers_slug_key" });
        expect(params[0]).toBe("sw2");
        return { rows: [{ id: 12 }] };
      }
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [fundraiserRow({ id: 12, slug: "sw2", status: "new" })] };
      return { rows: [] };
    });
    const made = await createFundraiser({
      path: "raising", kind: "run_walk", title: "Sam's Walk", description: "Ten miles.", eventDate: null, startTime: null,
      venue: "", town: "", targetPence: null, public: true, name: "Sam Sample", email: "sam@example.com", phone: "07700 900456",
      socialLink: null, socialOk: false, wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false }, postAddress: null,
      newsletterOk: false,
    });
    expect(made.slug).toBe("sw2");
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

// TASK-497: a page holder approved while fundraising is off waits for "Your page is live", which
// goes when an admin switches fundraising on.
describe("approving while fundraising is switched off", () => {
  function approving(over: Record<string, unknown>, pageOn: boolean) {
    return useClient((sql) => {
      if (sql.includes("FROM fundraisers f WHERE f.id = $1 FOR UPDATE")) return { rows: [fundraiserRow({ status: "new", ...over })] };
      if (sql.startsWith("SELECT page_on FROM fundraising_settings")) return { rows: [{ page_on: pageOn }] };
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [fundraiserRow({ status: "approved", ...over })] };
      return { rows: [] };
    });
  }
  const approveSql = (calls: Array<[string, unknown[]]>) => calls.find(([s]) => s.includes("SET status = 'approved'"));

  it("marks someone who would have a public page as waiting for the live email, reading the switch under a lock", async () => {
    const calls = approving({}, false);
    const out = await moveFundraiser(9, "approve", "admin:kim@example.com");
    expect(out.livePending).toBe(true);
    expect(calls.some(([s]) => /SELECT page_on FROM fundraising_settings WHERE id = 1 FOR SHARE/.test(s))).toBe(true);
    const [sql, params] = approveSql(calls) as [string, unknown[]];
    expect(sql).toContain("live_email_pending = $2");
    expect(params).toEqual(["admin:kim@example.com", true, 9]);
  });

  it("does not mark them while fundraising is on: they are emailed straight away", async () => {
    const calls = approving({}, true);
    expect((await moveFundraiser(9, "approve", "admin:kim@example.com")).livePending).toBe(false);
    expect((approveSql(calls) as [string, unknown[]])[1]).toEqual(["admin:kim@example.com", false, 9]);
  });

  it.each([
    ["a private sign up", { public: false }],
    ["an event", { path: "event" }],
  ])("does not mark %s, who has no page and is told they are on our list now", async (_what, over) => {
    approving(over, false);
    expect((await moveFundraiser(9, "approve", "admin:kim@example.com")).livePending).toBe(false);
  });

  it.each(["decline", "finish"] as const)("clears the mark on %s, so a switch on never tells them their page is live", async (move) => {
    const calls = useClient((sql) => {
      if (sql.includes("FROM fundraisers f WHERE f.id = $1 FOR UPDATE")) return { rows: [fundraiserRow({ status: "approved" })] };
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [fundraiserRow({ status: move === "decline" ? "declined" : "finished" })] };
      return { rows: [] };
    });
    const out = await moveFundraiser(9, move, "admin:kim@example.com");
    expect(out.livePending).toBe(false);
    expect(calls.find(([s]) => s.startsWith("UPDATE fundraisers SET status"))?.[0]).toContain("live_email_pending = false");
  });
});

describe("switching fundraising on, for the people waiting", () => {
  const q = () => pool.query as unknown as ReturnType<typeof vi.fn>;

  it("claims ONE approved page holder still waiting, clearing its mark, skipping any row another sender holds", async () => {
    q().mockResolvedValueOnce({ rows: [fundraiserRow({ id: 9 })] });
    const got = await claimNextWaitingLiveEmail(0);
    expect(got?.id).toBe(9);
    const [sql, params] = q().mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/UPDATE fundraisers f SET live_email_pending = false/);
    expect(sql).toMatch(/WHERE f\.id = \(\s*SELECT id FROM fundraisers/);
    expect(sql).toMatch(/live_email_pending AND status = 'approved' AND public AND path = 'raising' AND id > \$1/);
    expect(sql).toMatch(/ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/RETURNING/);
    expect(params).toEqual([0]);
  });

  // A failed send marks the row as waiting again; going past it by id means one run never loops on it.
  it("looks only past the last one this run tried", async () => {
    q().mockResolvedValueOnce({ rows: [] });
    expect(await claimNextWaitingLiveEmail(9)).toBeNull();
    expect((q().mock.calls.at(-1) as [string, unknown[]])[1]).toEqual([9]);
  });

  it("counts the page holders waiting", async () => {
    q().mockResolvedValueOnce({ rows: [{ n: "3" }] });
    expect(await countWaitingLiveEmails()).toBe(3);
    expect(String(q().mock.calls.at(-1)?.[0])).toMatch(/count\(\*\).*live_email_pending AND status = 'approved' AND public AND path = 'raising'/s);
  });

  it("can mark one as waiting again, when its email did not go", async () => {
    (pool.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });
    await markLiveEmailWaiting(9);
    expect((pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)).toEqual([
      "UPDATE fundraisers SET live_email_pending = true WHERE id = $1 AND status = 'approved'",
      [9],
    ]);
  });
});

// TASK-499: the posting address in separate boxes, and the event questions, as columns of their own.
describe("the sign up details (TASK-499)", () => {
  it("reads every new column, tidied", () => {
    const r = toRecord(
      fundraiserRow({
        path: "event",
        post_line1: "1 Example Road",
        post_line2: null,
        post_town: "Exampleton",
        post_postcode: "EX1 1EX",
        card_line: "Cakes for NBCC.",
        end_time: "12:00",
        time_tbc: true,
        venue_address: "Main Street",
        venue_postcode: "KA1 1AA",
        access: ["step free entry", "a hearing loop"],
        price: "Free",
        booking: "free",
        ticket_url: null,
        age_limit: "All ages",
        dress_code: null,
        included: "A cuppa",
        credit_name: "The Example Bakers",
        wants: { posterCount: 2, leafletCount: 30, bucketCount: 1, tinCount: 4, shoutOut: true },
      }),
    );
    expect(r).toMatchObject({
      postLine1: "1 Example Road",
      postLine2: null,
      postTown: "Exampleton",
      postPostcode: "EX1 1EX",
      cardLine: "Cakes for NBCC.",
      endTime: "12:00",
      timeTbc: true,
      venueAddress: "Main Street",
      venuePostcode: "KA1 1AA",
      access: ["step free entry", "a hearing loop"],
      price: "Free",
      booking: "free",
      ticketUrl: null,
      ageLimit: "All ages",
      dressCode: null,
      included: "A cuppa",
      creditName: "The Example Bakers",
    });
    expect(r.wants).toEqual({ posterCount: 2, leafletCount: 30, bucketCount: 1, tinCount: 4, leaflets: 0, buckets: 0, qrCount: 0, shoutOut: true, attend: false });
  });

  it("reads a sign up from before the new questions as not answered, with its old combined requests", () => {
    const r = toRecord(fundraiserRow({ wants: { leaflets: 20, buckets: 1, shoutOut: false, attend: true }, post_address: "1 Old Street" }));
    expect(r.wants).toEqual({ posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 20, buckets: 1, qrCount: 0, shoutOut: false, attend: true });
    expect(r.postAddress).toBe("1 Old Street");
    expect(r).toMatchObject({ postLine1: null, cardLine: null, endTime: null, timeTbc: false, access: [], booking: null, creditName: null });
  });

  it("never reads a way in or an access tick the code does not know", () => {
    const r = toRecord(fundraiserRow({ booking: "nbcc", access: ["a lift", "accessible toilets"] }));
    expect(r.booking).toBeNull();
    expect(r.access).toEqual(["accessible toilets"]);
  });

  it("changes each new field through its own column", () => {
    const { sets, values } = patchAssignments({
      postLine1: "2 Example Road",
      postPostcode: "EX1 1EX",
      cardLine: "Short.",
      endTime: "12:00",
      timeTbc: true,
      access: ["a hearing loop"],
      booking: "away",
      ticketUrl: "https://tickets.example.com/a",
      creditName: "Example Bakery",
    });
    expect(sets).toEqual([
      "post_line1 = $1",
      "post_postcode = $2",
      "card_line = $3",
      "end_time = $4",
      "time_tbc = $5",
      "access = $6",
      "booking = $7",
      "ticket_url = $8",
      "credit_name = $9",
    ]);
    expect(values[5]).toEqual(["a hearing loop"]);
  });

  it("stores every answer of a new sign up, and nothing in the old address box", async () => {
    let inserted: { sql: string; params: unknown[] } | null = null;
    useClient((sql, params) => {
      if (sql.startsWith("SELECT slug FROM fundraisers")) return { rows: [] };
      if (sql.includes("INSERT INTO fundraisers")) {
        inserted = { sql, params };
        return { rows: [{ id: 14 }] };
      }
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [fundraiserRow({ id: 14, status: "new" })] };
      return { rows: [] };
    });
    await createFundraiser({
      path: "event", kind: "quiz_party", title: "The Example Quiz", description: "A quiz.", eventDate: "2026-12-04", startTime: "19:30",
      venue: "Example Hall", town: "Exampleton", targetPence: null, public: true, name: "Sam Sample", email: "sam@example.com",
      phone: "07700 900456", socialLink: null, socialOk: false,
      wants: { posterCount: 5, leafletCount: 0, bucketCount: 0, tinCount: 1, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
      postLine1: "1 Example Road", postLine2: null, postTown: "Exampleton", postPostcode: "EX1 1EX", newsletterOk: false,
      cardLine: "Eight rounds.", endTime: "22:30", timeTbc: false, venueAddress: "Main Street", venuePostcode: "KA1 1AA",
      access: ["step free entry"], price: "£5", booking: "away", ticketUrl: "https://tickets.example.com/q", ageLimit: "18 and over",
      dressCode: null, included: null, creditName: "Quiz Team",
    });
    const got = inserted as unknown as { sql: string; params: unknown[] };
    for (const col of ["post_line1", "post_line2", "post_town", "post_postcode", "card_line", "end_time", "time_tbc", "venue_address",
      "venue_postcode", "access", "price", "booking", "ticket_url", "age_limit", "dress_code", "included", "credit_name"]) {
      expect(got.sql).toContain(col);
    }
    expect(got.sql).not.toContain("post_address");
    expect(got.params).toContain("Eight rounds.");
    expect(got.params).toContainEqual(["step free entry"]);
    expect(got.params).toContain("https://tickets.example.com/q");
    expect(got.params).toContain("EX1 1EX");
  });
});

// Review fix: a staff change or an approved organiser change can never leave the finish before the
// start: each is checked against the row as it is, under its lock, and nothing is written if not.
describe("a change that would put the finish before the start", () => {
  const timed = (over: Record<string, unknown> = {}) => fundraiserRow({ path: "event", start_time: "10:00", end_time: "12:00", ...over });
  const lockAnd = (row: Record<string, unknown>, extra: Answer = () => undefined) =>
    useClient((sql, params) => {
      if (sql.includes("FOR UPDATE") && sql.includes("FROM fundraisers f")) return { rows: [row] };
      return extra(sql, params);
    });

  it("refuses a staff change of only the start, past the stored finish, naming the start", async () => {
    const calls = lockAnd(timed());
    await expect(patchFundraiser(9, { startTime: "13:00" }, "admin:kim@example.com")).rejects.toMatchObject({
      reason: "bad_times",
      field: "startTime",
    });
    expect(calls.some(([sql]) => sql.startsWith("UPDATE fundraisers"))).toBe(false);
    expect(calls.map(([sql]) => sql)).toContain("ROLLBACK");
  });

  it("refuses a staff change of only the finish, before the stored start, naming the finish", async () => {
    lockAnd(timed());
    await expect(patchFundraiser(9, { endTime: "09:30" }, "admin:kim@example.com")).rejects.toMatchObject({
      reason: "bad_times",
      field: "endTime",
    });
  });

  it("saves a start change on a sign up with no finish time, as every old one is", async () => {
    const calls = lockAnd(timed({ end_time: null }), (sql) => (sql.includes("FROM fundraisers f WHERE f.id = $1") ? { rows: [timed({ end_time: null })] } : undefined));
    await patchFundraiser(9, { startTime: "23:00" }, "admin:kim@example.com");
    expect(calls.some(([sql]) => sql.startsWith("UPDATE fundraisers SET start_time = $1"))).toBe(true);
  });

  it("refuses to approve an organiser's new start that is past the stored finish", async () => {
    const calls = lockAnd(timed(), (sql) =>
      sql.startsWith("SELECT changes, status FROM fundraiser_edits") ? { rows: [{ changes: { startTime: "12:30" }, status: "waiting" }] } : undefined,
    );
    await expect(decideEdit(9, 3, true, "admin:kim@example.com")).rejects.toMatchObject({ reason: "bad_times", field: "startTime" });
    expect(calls.some(([sql]) => sql.startsWith("UPDATE fundraisers") || sql.startsWith("UPDATE fundraiser_edits"))).toBe(false);
  });

  it("still lets staff reject that change", async () => {
    const calls = lockAnd(timed(), (sql) => {
      if (sql.startsWith("SELECT changes, status FROM fundraiser_edits")) return { rows: [{ changes: { startTime: "12:30" }, status: "waiting" }] };
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [timed()] };
      return undefined;
    });
    await decideEdit(9, 3, false, "admin:kim@example.com");
    expect(calls.some(([sql]) => sql.startsWith("UPDATE fundraiser_edits SET status"))).toBe(true);
  });
});
