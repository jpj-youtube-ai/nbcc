import { describe, it, expect, vi } from "vitest";

// Jaimie, 2026-10-03: the SQL side of "18 or over" and "sharing with another cause", against a fake
// client that answers by statement (no database). A sign up stores both answers; a row from before
// reads them as null; and staff may correct the split only while the fundraiser has no gifts, under
// the row's lock. Every name here, the other cause's included, is invented.

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { pool } from "../../src/db/pool";
import { createFundraiser, setFundraiserSplit, toRecord } from "../../src/db/fundraisers";
import { signUpSchema } from "../../src/fundraising/model";

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

const signUp = (over: Record<string, unknown>) => {
  const r = signUpSchema.safeParse({
    path: "raising", kind: "walk", title: "Sam's Walk", description: "Five miles.", eventDate: "", startTime: "", venue: "",
    town: "Exampleton", targetPence: 20000, public: true, firstName: "Sam", lastName: "Sample", email: "sam@example.com",
    phone: "07700 900456", instagram: "", facebook: "", socialOk: true, over18: true,
    wants: { shoutOut: false, attend: false }, newsletterOk: false,
    // The sign up tidy (Jaimie, 2026-10-03): every new sign up gives an address, for the welcome pack,
    // and someone sharing ticks to say the split is right.
    postLine1: "1 Example Road", postTown: "Exampleton", postPostcode: "EX1 1EX", splitConfirmed: true, ...over,
  });
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data;
};

describe("a sign up's age and split", () => {
  it("are stored in their own columns", async () => {
    let inserted: { sql: string; params: unknown[] } | null = null;
    useClient((sql, params) => {
      if (sql.includes("INSERT INTO fundraisers")) {
        inserted = { sql, params };
        return { rows: [{ id: 21 }] };
      }
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [fundraiserRow({ id: 21 })] };
      return { rows: [] };
    });
    await createFundraiser(signUp({ sharesWithOther: true, nbccSharePercent: 60, otherCauseName: "Kilmarnock Food Larder" }));
    const got = inserted as unknown as { sql: string; params: unknown[] };
    for (const col of ["over_18", "shares_with_other", "nbcc_share_percent", "other_cause_name"]) expect(got.sql).toContain(col);
    const at = (col: string) => {
      const cols = got.sql.slice(got.sql.indexOf("(") + 1, got.sql.indexOf(")")).split(",").map((c) => c.trim());
      return got.params[cols.indexOf(col) - (cols.indexOf(col) > cols.indexOf("updated_by") ? 1 : 0)];
    };
    expect(at("over_18")).toBe(true);
    expect(at("shares_with_other")).toBe(true);
    expect(at("nbcc_share_percent")).toBe(60);
    expect(at("other_cause_name")).toBe("Kilmarnock Food Larder");
  });

  it("are read back, and a row from before reads them as never asked", () => {
    const r = toRecord(fundraiserRow({ over_18: true, shares_with_other: true, nbcc_share_percent: 50, other_cause_name: "Kilmarnock Food Larder" }));
    expect(r).toMatchObject({ over18: true, sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Kilmarnock Food Larder" });
    expect(toRecord(fundraiserRow())).toMatchObject({ over18: null, sharesWithOther: null, nbccSharePercent: null, otherCauseName: null });
  });
});

describe("staff correcting the split", () => {
  const split = { sharesWithOther: true, nbccSharePercent: 70, otherCauseName: "Kilmarnock Food Larder" };

  function answering(gifts: number, cash = 0) {
    return useClient((sql) => {
      if (sql.includes("FOR UPDATE") && sql.includes("FROM fundraisers f")) return { rows: [fundraiserRow()] };
      if (sql.includes("FROM donations") && sql.includes("fundraiser_id")) return { rows: [{ n: String(gifts) }] };
      if (sql.includes("FROM fundraiser_cash")) return { rows: [{ n: String(cash) }] };
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [fundraiserRow({ shares_with_other: true, nbcc_share_percent: 70, other_cause_name: "Kilmarnock Food Larder" })] };
      return undefined;
    });
  }

  it("is saved, with who did it, while there are no gifts", async () => {
    const calls = answering(0);
    const after = await setFundraiserSplit(9, split, "admin:kim@example.com");
    expect(after.nbccSharePercent).toBe(70);
    const update = calls.find(([s]) => s.startsWith("UPDATE fundraisers"));
    expect(update?.[0]).toContain("shares_with_other = $1, nbcc_share_percent = $2, other_cause_name = $3");
    expect(update?.[1]).toEqual([true, 70, "Kilmarnock Food Larder", "admin:kim@example.com", 9]);
    const audit = calls.find(([s]) => s.includes("INSERT INTO audit_log"));
    expect(audit?.[1]).toContain("fundraiser.split_changed");
    // The gifts are counted under the row's lock, before anything is written.
    const lock = calls.findIndex(([s]) => s.includes("FOR UPDATE"));
    const count = calls.findIndex(([s]) => s.includes("FROM donations"));
    expect(lock).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(lock);
    expect(calls.findIndex(([s]) => s.startsWith("UPDATE fundraisers"))).toBeGreaterThan(count);
  });

  it("is refused once there is a gift, changing nothing", async () => {
    const calls = answering(1);
    await expect(setFundraiserSplit(9, split, "admin:kim@example.com")).rejects.toMatchObject({ reason: "has_gifts" });
    expect(calls.some(([s]) => s.startsWith("UPDATE fundraisers"))).toBe(false);
    expect(calls.some(([s]) => s === "ROLLBACK")).toBe(true);
  });

  it("is refused once cash has been paid in, too", async () => {
    const calls = answering(0, 1);
    await expect(setFundraiserSplit(9, split, "admin:kim@example.com")).rejects.toMatchObject({ reason: "has_gifts" });
    expect(calls.some(([s]) => s.startsWith("UPDATE fundraisers"))).toBe(false);
  });
});
