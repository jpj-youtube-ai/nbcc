import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-506: the SQL behind news updates, checked against a mocked pool (no database): an update is
// only ever posted by the fundraiser's own organiser, five a day at most, and waits for staff; a
// photo's bytes never leave in a list; each photo answers only to its owner, to staff, or (once
// approved) to the public; and every staff decision writes its audit row in the same transaction.
// Every name and address is invented.

const { query, connect } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import {
  approvedForPage,
  countPendingUpdates,
  decideUpdate,
  listUpdates,
  pendingByFundraiser,
  photoForOwner,
  photoForStaff,
  postUpdate,
  publicPhoto,
  NewsError,
} from "../../src/db/fundraiser-updates";

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
  connect.mockResolvedValue(client);
  return { calls, client };
}
const sqlIn = (calls: Array<[string, unknown[]]>, re: RegExp) => calls.find((c) => re.test(c[0]));
const audits = (calls: Array<[string, unknown[]]>) => calls.filter((c) => /INSERT INTO audit_log/.test(c[0])).map((c) => c[1]);

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  connect.mockReset();
});

const owner = (over: Record<string, unknown> = {}) => ({
  id: 7,
  organiser_email: "Sam@Example.com",
  status: "approved",
  public: true,
  path: "raising",
  ...over,
});

const updateRow = (over: Record<string, unknown> = {}) => ({
  id: 31,
  fundraiser_id: 7,
  body: "We walked ten miles!",
  status: "pending",
  photo_id: null,
  created_at: new Date("2026-11-20T10:00:00Z"),
  decided_at: null,
  decided_by: null,
  reject_reason: null,
  ...over,
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe("posting an update", () => {
  function answer(f: Record<string, unknown> | null, postedToday = 0) {
    return useClient((sql) => {
      if (/FROM fundraisers WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: f ? [f] : [] };
      if (/count\(\*\)/i.test(sql)) return { rows: [{ n: postedToday }] };
      if (/INSERT INTO fundraiser_updates/.test(sql)) return { rows: [updateRow()] };
      return undefined;
    });
  }

  it("stores it as pending, under the fundraiser's lock, and records it", async () => {
    const { calls, client } = answer(owner());
    const out = await postUpdate(7, "sam@example.com", { text: "We walked ten miles!", photo: null });
    expect(out).toEqual({
      verdict: "ok",
      update: {
        id: 31,
        fundraiserId: 7,
        text: "We walked ten miles!",
        status: "pending",
        photoId: null,
        createdAt: "2026-11-20T10:00:00.000Z",
        decidedAt: null,
        decidedBy: null,
        rejectReason: null,
      },
    });
    expect(calls[0][0]).toBe("BEGIN");
    const insert = sqlIn(calls, /INSERT INTO fundraiser_updates/)!;
    // No status given: the table's default, pending.
    expect(insert[0]).toMatch(/\(fundraiser_id, body, photo_id, photo_mime, photo_bytes, photo_byte_size\)/);
    expect(insert[1]).toEqual([7, "We walked ten miles!", null, null, null, null]);
    expect(audits(calls)).toEqual([["organiser", "fundraiser.news_posted", "fundraiser", 7, { updateId: 31, photo: false }]]);
    expect(calls[calls.length - 1][0]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });

  it("keeps a photo's bytes under an address of its own", async () => {
    const { calls } = answer(owner());
    await postUpdate(7, "sam@example.com", { text: "Look!", photo: { mime: "image/jpeg", bytes: JPEG } });
    const params = sqlIn(calls, /INSERT INTO fundraiser_updates/)![1];
    expect(params[2]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(params.slice(3)).toEqual(["image/jpeg", JPEG, JPEG.length]);
    // The audit row says there was a photo, never what it was.
    expect(JSON.stringify(audits(calls))).not.toContain("255");
  });

  it("counts the last 24 hours, and stores nothing past five", async () => {
    const { calls } = answer(owner(), 5);
    expect(await postUpdate(7, "sam@example.com", { text: "Another", photo: null })).toEqual({ verdict: "limit" });
    expect(sqlIn(calls, /count\(\*\)/i)![0]).toMatch(/created_at > now\(\) - interval '24 hours'/);
    expect(sqlIn(calls, /INSERT INTO fundraiser_updates/)).toBeUndefined();
    expect(audits(calls)).toEqual([]);
  });

  it("reads someone else's fundraiser as not there", async () => {
    const { calls } = answer(owner({ organiser_email: "other@example.com" }));
    await expect(postUpdate(7, "sam@example.com", { text: "Hi", photo: null })).rejects.toMatchObject({ reason: "not_found" });
    expect(calls.some((c) => c[0] === "ROLLBACK")).toBe(true);
    const missing = answer(null);
    await expect(postUpdate(8, "sam@example.com", { text: "Hi", photo: null })).rejects.toBeInstanceOf(NewsError);
    expect(sqlIn(missing.calls, /INSERT/)).toBeUndefined();
  });

  // Event pages: a public event has a page now, so only a private one is refused.
  it("refuses one that is finished, not approved, a private event, or has no page", async () => {
    for (const f of [owner({ status: "finished" }), owner({ status: "new" }), owner({ path: "event", public: false }), owner({ public: false })]) {
      answer(f);
      await expect(postUpdate(7, "sam@example.com", { text: "Hi", photo: null })).rejects.toMatchObject({ reason: "bad_status" });
    }
  });
});

describe("reading updates", () => {
  it("lists a fundraiser's updates newest first, never with a photo's bytes", async () => {
    query.mockResolvedValue({ rows: [updateRow({ photo_id: "0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d" })] });
    const rows = await listUpdates([7, 9]);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).not.toMatch(/photo_bytes/);
    expect(sql).toMatch(/fundraiser_id = ANY\(\$1\)/);
    expect(sql).toMatch(/ORDER BY created_at DESC, id DESC/);
    expect(query.mock.calls[0][1]).toEqual([[7, 9]]);
    expect(rows[0].photoId).toBe("0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d");
  });

  it("gives the page only what is approved", async () => {
    query.mockResolvedValue({ rows: [updateRow({ status: "approved" })] });
    await approvedForPage(7);
    expect(String(query.mock.calls[0][0])).toMatch(/status = 'approved'/);
    expect(String(query.mock.calls[0][0])).not.toMatch(/photo_bytes/);
  });

  it("counts what is waiting, in all and for each fundraiser", async () => {
    query.mockResolvedValueOnce({ rows: [{ n: "3" }] });
    expect(await countPendingUpdates()).toBe(3);
    expect(String(query.mock.calls[0][0])).toMatch(/status = 'pending'/);
    query.mockResolvedValueOnce({ rows: [{ fundraiser_id: 7, n: "2" }, { fundraiser_id: 9, n: "1" }] });
    expect(await pendingByFundraiser()).toEqual({ 7: 2, 9: 1 });
    query.mockResolvedValueOnce({ rows: [] });
    expect(await countPendingUpdates()).toBe(0);
  });
});

describe("whose photo it is", () => {
  it("answers the owner only for an update on a fundraiser whose email is theirs", async () => {
    query.mockResolvedValue({ rows: [{ photo_mime: "image/jpeg", photo_bytes: JPEG }] });
    expect(await photoForOwner(31, "sam@example.com")).toEqual({ mime: "image/jpeg", bytes: JPEG });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/lower\(f\.organiser_email\) = \$2/);
    expect(query.mock.calls[0][1]).toEqual([31, "sam@example.com"]);
    query.mockResolvedValue({ rows: [] });
    expect(await photoForOwner(31, "other@example.com")).toBeNull();
  });

  it("answers staff for the fundraiser it belongs to", async () => {
    query.mockResolvedValue({ rows: [{ photo_mime: "image/png", photo_bytes: JPEG }] });
    await photoForStaff(7, 31);
    expect(String(query.mock.calls[0][0])).toMatch(/id = \$1 AND fundraiser_id = \$2/);
    expect(query.mock.calls[0][1]).toEqual([31, 7]);
  });

  it("answers the public only once approved, on a page that is up", async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await publicPhoto("0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d")).toBeNull();
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/u\.status = 'approved'/);
    expect(sql).toMatch(/f\.public = true/);
    // Event pages: an event's page shows its news photos too.
    expect(sql).toMatch(/f\.path IN \('raising', 'event'\)/);
    expect(sql).toMatch(/f\.status IN \('approved', 'finished'\)/);
  });
});

describe("staff decisions", () => {
  function answer(row: Record<string, unknown> | null) {
    return useClient((sql) => {
      if (/FROM fundraiser_updates WHERE id = \$1 AND fundraiser_id = \$2 FOR UPDATE/.test(sql)) return { rows: row ? [row] : [] };
      if (/UPDATE fundraiser_updates/.test(sql)) return { rows: [{ ...updateRow(), ...(row ?? {}), status: "x" }] };
      return undefined;
    });
  }

  it("approves a waiting update, saying who and when, with its audit row", async () => {
    const { calls } = answer(updateRow());
    await decideUpdate(7, 31, "approve", "admin:fern@example.com");
    const upd = sqlIn(calls, /UPDATE fundraiser_updates/)!;
    expect(upd[0]).toMatch(/decided_at = now\(\)/);
    expect(upd[1]).toEqual(["approved", "admin:fern@example.com", null, 31]);
    expect(audits(calls)).toEqual([["admin:fern@example.com", "fundraiser.news_approved", "fundraiser", 7, { updateId: 31 }]]);
  });

  it("rejects one with an internal reason, kept on the row and in the audit", async () => {
    const { calls } = answer(updateRow());
    await decideUpdate(7, 31, "reject", "admin:fern@example.com", "A poster, not a photo");
    expect(sqlIn(calls, /UPDATE fundraiser_updates/)![1]).toEqual(["rejected", "admin:fern@example.com", "A poster, not a photo", 31]);
    expect(audits(calls)[0]).toEqual(["admin:fern@example.com", "fundraiser.news_rejected", "fundraiser", 7, { updateId: 31, reason: "A poster, not a photo" }]);
  });

  it("hides an approved one, and shows it again", async () => {
    let r = answer(updateRow({ status: "approved" }));
    await decideUpdate(7, 31, "hide", "admin:fern@example.com");
    expect(audits(r.calls)[0][1]).toBe("fundraiser.news_hidden");
    r = answer(updateRow({ status: "hidden" }));
    await decideUpdate(7, 31, "show", "admin:fern@example.com");
    expect(sqlIn(r.calls, /UPDATE fundraiser_updates/)![1][0]).toBe("approved");
    expect(audits(r.calls)[0][1]).toBe("fundraiser.news_shown");
  });

  it("refuses a decision that does not fit where it is up to, and one that is not there", async () => {
    const cases: Array<[string, "approve" | "reject" | "hide" | "show"]> = [
      ["approved", "approve"],
      ["rejected", "approve"],
      ["approved", "reject"],
      ["pending", "hide"],
      ["approved", "show"],
    ];
    for (const [status, decision] of cases) {
      const { calls } = answer(updateRow({ status }));
      await expect(decideUpdate(7, 31, decision, "admin:fern@example.com")).rejects.toMatchObject({ reason: "not_waiting" });
      expect(audits(calls)).toEqual([]);
    }
    answer(null);
    await expect(decideUpdate(7, 99, "approve", "admin:fern@example.com")).rejects.toMatchObject({ reason: "not_found" });
  });
});
