import { describe, it, expect, vi } from "vitest";

// Event pages, the SQL side (src/db/fundraisers.ts), checked against a fake client without a
// database: staff saving a short name stamps slug_set_at; approving an event without one is refused
// under the row's lock; and an event approved while fundraising is off waits for "Your page is live"
// like any page holder. Every name here is invented.

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { pool } from "../../src/db/pool";
import {
  claimNextWaitingLiveEmail,
  countWaitingLiveEmails,
  FundraiserError,
  getBySlug,
  moveFundraiser,
  patchFundraiser,
  toRecord,
} from "../../src/db/fundraisers";

const eventRow = (over: Record<string, unknown> = {}) => ({
  id: 12, slug: "eqn", path: "event", kind: "quiz", title: "Exampleton Quiz Night", description: "", event_date: "2026-12-05",
  start_time: null, venue: "The Hall", town: "Exampleton", target_pence: null, public: true, status: "new",
  organiser_name: "Alex Example", organiser_email: "alex@example.com", organiser_phone: "07700 900222", social_link: null,
  social_ok: false, wants: {}, post_address: null, newsletter_ok: false, image_src: null, declined_reason: null,
  created_at: "2026-10-02T10:00:00Z", approved_at: null, approved_by: null, updated_at: "2026-10-02T10:00:00Z", updated_by: null,
  slug_set_at: null, ...over,
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

describe("reading when the short name was set", () => {
  it("reads it with the row", () => {
    expect(toRecord(eventRow({ slug_set_at: "2026-10-03T09:00:00Z" })).slugSetAt).toBe("2026-10-03T09:00:00.000Z");
    expect(toRecord(eventRow()).slugSetAt).toBeNull();
  });

  it("selects it with every record", async () => {
    const q = pool.query as unknown as ReturnType<typeof vi.fn>;
    q.mockResolvedValueOnce({ rows: [] });
    await getBySlug("eqn");
    expect(String(q.mock.calls.at(-1)?.[0])).toContain("f.slug_set_at");
  });
});

describe("staff saving a short name", () => {
  const editing = (row = eventRow()) =>
    useClient((sql) => (sql.includes("FROM fundraisers f WHERE f.id = $1") ? { rows: [row] } : { rows: [] }));
  const stamped = (calls: Array<[string, unknown[]]>) => calls.find(([s]) => /slug_set_at = now\(\)/.test(s));

  it("stamps when, even when they keep the suggested one", async () => {
    const calls = editing();
    await patchFundraiser(12, { slug: "eqn" }, "admin:kim@example.com");
    expect(stamped(calls)?.[0]).toBe("UPDATE fundraisers SET slug_set_at = now() WHERE id = $1");
    expect(stamped(calls)?.[1]).toEqual([12]);
  });

  it("stamps a new one too", async () => {
    const calls = editing();
    await patchFundraiser(12, { slug: "exampleton-quiz" }, "admin:kim@example.com");
    expect(stamped(calls)).toBeTruthy();
  });

  it("leaves it alone when the change has no short name in it", async () => {
    const calls = editing();
    await patchFundraiser(12, { title: "Exampleton Big Quiz" }, "admin:kim@example.com");
    expect(stamped(calls)).toBeUndefined();
  });
});

describe("approving an event", () => {
  function approving(over: Record<string, unknown>, pageOn = true) {
    return useClient((sql) => {
      if (sql.includes("FROM fundraisers f WHERE f.id = $1 FOR UPDATE")) return { rows: [eventRow(over)] };
      if (sql.startsWith("SELECT page_on FROM fundraising_settings")) return { rows: [{ page_on: pageOn }] };
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [eventRow({ ...over, status: "approved" })] };
      return { rows: [] };
    });
  }

  it("is refused while it has no short name, and nothing is written", async () => {
    const calls = approving({});
    await expect(moveFundraiser(12, "approve", "admin:kim@example.com")).rejects.toMatchObject({ reason: "needs_short_name" });
    await expect(moveFundraiser(12, "approve", "admin:kim@example.com")).rejects.toBeInstanceOf(FundraiserError);
    expect(calls.some(([s]) => s.includes("SET status = 'approved'"))).toBe(false);
    expect(calls.some(([s]) => s.includes("INSERT INTO audit_log"))).toBe(false);
  });

  it("goes ahead once it has one", async () => {
    const calls = approving({ slug_set_at: "2026-10-03T09:00:00Z" });
    await moveFundraiser(12, "approve", "admin:kim@example.com");
    expect(calls.some(([s]) => s.includes("SET status = 'approved'"))).toBe(true);
  });

  it("while fundraising is off, waits for the live email like any page holder", async () => {
    approving({ slug_set_at: "2026-10-03T09:00:00Z" }, false);
    expect((await moveFundraiser(12, "approve", "admin:kim@example.com")).livePending).toBe(true);
  });

  it("never stops declining one", async () => {
    const calls = approving({});
    await moveFundraiser(12, "decline", "admin:kim@example.com");
    expect(calls.some(([s]) => s.includes("SET status = 'declined'"))).toBe(true);
  });
});

describe("the live emails at the switch", () => {
  it("are claimed and counted for events as well as fundraisers", async () => {
    const q = pool.query as unknown as ReturnType<typeof vi.fn>;
    q.mockResolvedValueOnce({ rows: [] });
    await claimNextWaitingLiveEmail(0);
    expect(String(q.mock.calls.at(-1)?.[0])).toMatch(/path IN \('raising', 'event'\)/);
    q.mockResolvedValueOnce({ rows: [{ n: "1" }] });
    await countWaitingLiveEmails();
    expect(String(q.mock.calls.at(-1)?.[0])).toMatch(/path IN \('raising', 'event'\)/);
  });
});
