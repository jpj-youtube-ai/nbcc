import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-501: the SQL behind the private area, checked against a mocked pool (no database): the
// sign in code and the session, an organiser's change and "I've finished" held to their own
// fundraiser, and money paid in by the organiser. Every name and address here is invented.

const { query, connect } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import {
  saveSignInCode,
  countCodeTry,
  deleteSignInCode,
  createSession,
  findSession,
  deleteSession,
} from "../../src/db/fundraiser-sign-in";
import {
  requestEdit,
  markFinishedRequested,
  listForOrganiser,
  wallRows,
  linkFundraiserGift,
  toRecord,
  FundraiserError,
} from "../../src/db/fundraisers";

const sqlOf = (re: RegExp) => query.mock.calls.map((c) => String(c[0])).find((s) => re.test(s)) ?? "";
const paramsOf = (re: RegExp) => (query.mock.calls.find((c) => re.test(String(c[0]))) ?? [])[1] as unknown[];

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  connect.mockReset();
});

describe("the sign in code in the database", () => {
  it("keeps one code per email, lower case, and a new one starts its tries again", async () => {
    const at = new Date("2026-10-02T12:10:00Z");
    await saveSignInCode("Sam@Example.com", "keyed-hash", at);
    const sql = sqlOf(/INSERT INTO fundraiser_sign_in_codes/);
    expect(sql).toMatch(/ON CONFLICT \(email\) DO UPDATE/);
    expect(sql).toMatch(/attempts = 0/);
    expect(paramsOf(/INSERT INTO fundraiser_sign_in_codes/)).toEqual(["sam@example.com", "keyed-hash", at]);
  });

  it("counts a try in the same statement that reads the code, so tries at once cannot share a count", async () => {
    query.mockResolvedValueOnce({ rows: [{ code_hash: "h", expires_at: "2026-10-02T12:10:00Z", attempts: 2 }] });
    const row = await countCodeTry("Sam@Example.com");
    expect(sqlOf(/fundraiser_sign_in_codes/)).toMatch(/^UPDATE fundraiser_sign_in_codes SET attempts = attempts \+ 1 WHERE email = \$1 RETURNING/);
    expect(row).toEqual({ codeHash: "h", expiresAt: new Date("2026-10-02T12:10:00Z"), attempts: 2 });
    query.mockResolvedValueOnce({ rows: [] });
    expect(await countCodeTry("nobody@example.com")).toBeNull();
  });

  it("forgets a code once it is used or dead", async () => {
    await deleteSignInCode("Sam@Example.com");
    expect(paramsOf(/DELETE FROM fundraiser_sign_in_codes/)).toEqual(["sam@example.com"]);
  });
});

describe("the session in the database", () => {
  it("stores the hash, the email and the expiry, and tidies away sessions long gone", async () => {
    const at = new Date("2026-10-02T14:00:00Z");
    await createSession("a".repeat(64), "Sam@Example.com", at);
    expect(paramsOf(/INSERT INTO fundraiser_sessions/)).toEqual(["a".repeat(64), "sam@example.com", at]);
    expect(sqlOf(/DELETE FROM fundraiser_sessions WHERE expires_at/)).not.toBe("");
  });

  it("finds a session only while it has time left", async () => {
    query.mockResolvedValueOnce({ rows: [{ email: "sam@example.com", expires_at: "2026-10-02T14:00:00Z" }] });
    expect(await findSession("b".repeat(64))).toEqual({ email: "sam@example.com", expiresAt: new Date("2026-10-02T14:00:00Z") });
    expect(sqlOf(/FROM fundraiser_sessions/)).toMatch(/expires_at > now\(\)/);
  });

  it("ends a session", async () => {
    await deleteSession("c".repeat(64));
    expect(paramsOf(/DELETE FROM fundraiser_sessions WHERE session_hash/)).toEqual(["c".repeat(64)]);
  });
});

// ---- transactions, with a fake client that answers by statement ----

const fundraiserRow = (over: Record<string, unknown> = {}) => ({
  id: 9, slug: "sams-walk", path: "raising", kind: "run_walk", title: "Sam's Walk", description: "", event_date: null,
  start_time: null, venue: "", town: "", target_pence: 50000, public: true, status: "approved", organiser_name: "Sam Sample",
  organiser_email: "Sam@Example.com", organiser_phone: "07700 900456", social_link: null, social_ok: false, wants: {},
  post_address: null, newsletter_ok: false, image_src: null, declined_reason: null, created_at: "2026-10-02T10:00:00Z",
  approved_at: null, approved_by: null, updated_at: "2026-10-02T10:00:00Z", updated_by: null, finished_requested_at: null, ...over,
});

function useClient(answer: (sql: string) => unknown) {
  const calls: Array<[string, unknown[]]> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      return answer(sql) ?? { rows: [] };
    }),
    release: vi.fn(),
  };
  connect.mockResolvedValue(client);
  return calls;
}

describe("an organiser's change from the private area", () => {
  it("is stored waiting, for their own fundraiser, and says it came from the private area", async () => {
    const calls = useClient((sql) => {
      if (sql.includes("WHERE f.id = $1 FOR UPDATE")) return { rows: [fundraiserRow()] };
      if (sql.startsWith("INSERT INTO fundraiser_edits")) return { rows: [{ id: 4 }] };
      if (sql.startsWith("SELECT id, changes, status")) return { rows: [{ id: 4, changes: { price: "£5" }, status: "waiting", created_at: "2026-10-02T12:00:00Z" }] };
      return { rows: [] };
    });
    const edit = await requestEdit(9, { description: "New" }, "sam@example.com");
    expect(edit.id).toBe(4);
    expect(calls.some(([s]) => /fundraiser_manage_tokens/.test(s))).toBe(false);
    const audit = calls.find(([s]) => s.includes("INSERT INTO audit_log"));
    expect(audit?.[1][1]).toBe("fundraiser.edit_requested");
    expect(audit?.[1][4]).toMatchObject({ via: "private area" });
  });

  it("is refused for someone else's fundraiser, and nothing is written", async () => {
    const calls = useClient((sql) => (sql.includes("WHERE f.id = $1 FOR UPDATE") ? { rows: [fundraiserRow()] } : { rows: [] }));
    await expect(requestEdit(9, { description: "New" }, "kim@example.com")).rejects.toMatchObject({ reason: "not_found" });
    expect(calls.some(([s]) => s.startsWith("INSERT INTO fundraiser_edits"))).toBe(false);
    expect(calls.map(([s]) => s)).toContain("ROLLBACK");
  });
});

describe("I've finished", () => {
  it("records the first time it was pressed, and says whether this was it", async () => {
    const calls = useClient((sql) => {
      if (sql.includes("WHERE f.id = $1 FOR UPDATE")) return { rows: [fundraiserRow()] };
      if (sql.includes("WHERE f.id = $1") && !sql.includes("FOR UPDATE")) return { rows: [fundraiserRow({ finished_requested_at: "2026-10-02T12:00:00Z" })] };
      return { rows: [] };
    });
    const { record, first } = await markFinishedRequested(9, "sam@example.com");
    expect(first).toBe(true);
    expect(record.finishedRequestedAt).toBe("2026-10-02T12:00:00.000Z");
    expect(calls.find(([s]) => s.startsWith("UPDATE fundraisers SET finished_requested_at"))?.[0]).toMatch(/COALESCE\(finished_requested_at, now\(\)\)/);
    expect(calls.find(([s]) => s.includes("INSERT INTO audit_log"))?.[1][1]).toBe("fundraiser.finish_requested");
  });

  it("does not count a second press as the first", async () => {
    useClient((sql) =>
      sql.includes("WHERE f.id = $1") ? { rows: [fundraiserRow({ finished_requested_at: "2026-10-01T09:00:00Z" })] } : { rows: [] },
    );
    expect((await markFinishedRequested(9, "sam@example.com")).first).toBe(false);
  });

  it("is refused for someone else's fundraiser, or one no longer running", async () => {
    useClient((sql) => (sql.includes("WHERE f.id = $1 FOR UPDATE") ? { rows: [fundraiserRow()] } : { rows: [] }));
    await expect(markFinishedRequested(9, "kim@example.com")).rejects.toBeInstanceOf(FundraiserError);
    useClient((sql) => (sql.includes("WHERE f.id = $1 FOR UPDATE") ? { rows: [fundraiserRow({ status: "finished" })] } : { rows: [] }));
    await expect(markFinishedRequested(9, "sam@example.com")).rejects.toMatchObject({ reason: "bad_status" });
  });
});

describe("reading for the private area", () => {
  it("lists only that email's approved (and finished) fundraisers, with their meters", async () => {
    query.mockResolvedValueOnce({ rows: [{ ...fundraiserRow(), online_pence: 2500, cash_pence: 1000, edit_waiting: false }] });
    const list = await listForOrganiser("Sam@Example.com");
    expect(sqlOf(/FROM fundraisers f/)).toMatch(/lower\(f\.organiser_email\) = lower\(\$1\) AND f\.status IN \('approved', 'finished'\)/);
    expect(paramsOf(/FROM fundraisers f/)).toEqual(["Sam@Example.com"]);
    expect(list[0].meter.raisedPence).toBe(3500);
  });

  it("reads when they pressed I've finished", () => {
    expect(toRecord(fundraiserRow({ finished_requested_at: "2026-10-02T12:00:00Z" })).finishedRequestedAt).toBe("2026-10-02T12:00:00.000Z");
    expect(toRecord(fundraiserRow()).finishedRequestedAt).toBeNull();
  });

  it("marks money paid in by the organiser on the gifts it reads", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 1, full_name: "Sam Sample", anonymous: true, show_name: false, show_amount: false, amount_pence: 5000,
        refunded_amount_pence: 0, supporter_message: null, message_hidden: false, created_at: "2026-10-02T12:00:00Z", paid_in_by_organiser: true }],
    });
    const rows = await wallRows(9);
    expect(sqlOf(/FROM donations d/)).toMatch(/d\.paid_in_by_organiser/);
    expect(rows[0].paidIn).toBe(true);
  });
});

describe("money the organiser paid in, from the Stripe webhook", () => {
  it("is linked to their approved fundraiser and marked, with no message and nothing for the wall", async () => {
    const q = vi.fn(async (sql: string) => (sql.startsWith("SELECT id, status FROM fundraisers") ? { rows: [{ id: 7, status: "approved" }] } : { rows: [] }));
    const client = { query: q } as unknown as import("pg").PoolClient;
    const linked = await linkFundraiserGift(
      client,
      55,
      { fundraiserId: 7, message: "ignored", showName: true, showAmount: true, paidIn: true },
      "evt_1",
    );
    expect(linked).toBe(true);
    expect(q.mock.calls[1]).toEqual([
      "UPDATE donations SET fundraiser_id = $1, supporter_message = $2, show_name = $3, show_amount = $4, paid_in_by_organiser = $5 WHERE id = $6",
      [7, null, false, false, true, 55],
    ]);
    expect((q.mock.calls[2] as unknown as unknown[])[1]).toEqual(["stripe", "fundraiser.paid_in", "fundraiser", 7, { eventId: "evt_1", donationId: 55 }]);
  });
});

// ---- TASK-501 review fixes ----

describe("a finished fundraiser, in the database", () => {
  it("is still listed for its organiser, with the approved ones", async () => {
    await listForOrganiser("sam@example.com");
    expect(sqlOf(/FROM fundraisers f/)).toMatch(/f\.status IN \('approved', 'finished'\)/);
  });

  function fakeClient(statusOfFundraiser: string | null) {
    const q = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT id, status FROM fundraisers")) return { rows: statusOfFundraiser ? [{ id: 7, status: statusOfFundraiser }] : [] };
      return { rows: [] };
    });
    return { client: { query: q } as unknown as import("pg").PoolClient, q };
  }
  const payIn = { fundraiserId: 7, message: null, showName: false, showAmount: false, paidIn: true };
  const gift = { fundraiserId: 7, message: "Go", showName: true, showAmount: true };

  it("takes late money its organiser pays in", async () => {
    const { client, q } = fakeClient("finished");
    expect(await linkFundraiserGift(client, 55, payIn, "evt_late")).toBe(true);
    expect(q.mock.calls.some((c) => String(c[0]).includes("paid_in_by_organiser = $5"))).toBe(true);
  });

  it("does not put a supporter's gift on a finished page (stage 1 hides it)", async () => {
    const { client, q } = fakeClient("finished");
    expect(await linkFundraiserGift(client, 56, gift, "evt_gift")).toBe(false);
    expect(q.mock.calls.some((c) => String(c[0]).startsWith("UPDATE donations"))).toBe(false);
  });

  it.each(["declined", "new", null])("keeps the paid in mark on money paid in when the fundraiser is %s", async (status) => {
    const { client, q } = fakeClient(status);
    expect(await linkFundraiserGift(client, 57, payIn, "evt_odd")).toBe(false);
    const mark = q.mock.calls.find((c) => String(c[0]).startsWith("UPDATE donations"));
    expect(mark?.[0]).toBe("UPDATE donations SET paid_in_by_organiser = true WHERE id = $1");
    expect((mark as unknown as unknown[])[1]).toEqual([57]);
  });
});
